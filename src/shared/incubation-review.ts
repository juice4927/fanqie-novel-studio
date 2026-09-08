import { missingContractApprovalFields } from "./contract-service";
import { PROTAGONIST_ROLES, TONE_TAGS } from "./creation-options";
import { CHAPTERS_PER_LADDER_LEVEL, type CreationPreset } from "./creation-presets";
import { type FanqieCategoryProfile, type FanqieSubGenreProfile, getFanqieCategoryProfile } from "./fanqie-taxonomy";
import type { BookConceptSkeleton, IncubationCandidate, StoryContract } from "./types";

export type FindingLevel = "通过" | "提示" | "警告" | "阻断";

export interface IncubationFinding {
  id: string;
  label: string;
  level: FindingLevel;
  detail: string;
  suggestion: string;
}

export interface IncubationReviewInput {
  candidate: IncubationCandidate;
  targetWords: number;
  wordsPerChapter: number;
  genreElements: string[];
  category?: FanqieCategoryProfile;
  subGenres?: FanqieSubGenreProfile[];
  skeleton?: BookConceptSkeleton | null;
  existingContracts?: Array<{ title: string; premise: string; openingMechanism: string }>;
  tagStats?: string[];
  /** 分类/篇幅形态预设；缺省时退回分类画像与全局阈值。 */
  preset?: CreationPreset;
}

const VAGUE_OPENING_WORDS = ["命运", "宿命", "觉醒", "神秘力量", "冥冥之中", "不知为何", "忽然之间"];
const ACTIONABLE_DESIRE_VERBS = [
  "得到",
  "阻止",
  "查明",
  "守住",
  "夺回",
  "证明",
  "救",
  "找回",
  "完成",
  "摆脱",
  "建立",
  "改变",
];
/**
 * 真正互斥的题材元素。表里的每个词都必须是开书面板可选项，
 * 否则规则永远不会触发（tests/positioning-tags.test.ts 会守住这一点）。
 */
export const MUTUALLY_EXCLUSIVE_ELEMENTS: Array<[string, string]> = [
  ["无CP", "先婚后爱"],
  ["无CP", "破镜重圆"],
];
/** 由专属字段收集的标签，不计入题材元素额度。 */
const DEDICATED_FIELD_LABELS = new Set<string>([...PROTAGONIST_ROLES, ...TONE_TAGS]);
const LIGHT_TONE_WORDS = ["轻松", "治愈", "甜宠", "沙雕"];
const HEAVY_TONE_WORDS = ["压抑", "沉重", "虐恋", "冷峻", "绝望"];

const normalize = (value: string) => value.toLowerCase().replace(/[\s，。、“”‘’：；！？,.!?:;\-_/（）()]+/g, "");

function ngramSimilarity(left: string, right: string, size = 2) {
  const grams = (value: string) => {
    const normalized = normalize(value);
    if (normalized.length <= size) return new Set([normalized]);
    return new Set(
      Array.from({ length: normalized.length - size + 1 }, (_, index) => normalized.slice(index, index + size)),
    );
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const smallest = Math.min(leftGrams.size, rightGrams.size);
  if (!smallest) return 0;
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  return shared / smallest;
}

function candidateText(candidate: IncubationCandidate) {
  return [
    candidate.title,
    candidate.premise,
    candidate.openingMechanism,
    candidate.growthCarrier,
    candidate.primaryPayoff,
    candidate.protagonistDesire,
    candidate.readerPromise,
    candidate.coreEmotion,
    candidate.ending,
    candidate.commercialHook,
    candidate.longFormEngine,
    candidate.openingDesign.chapter1Hook,
    candidate.openingDesign.firstThreeChaptersPromise,
    ...candidate.differentiation.against,
  ].join("；");
}

function splitKeywords(value: string) {
  return value
    .split(/[、，；;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

const finding = (
  id: string,
  label: string,
  level: FindingLevel,
  detail: string,
  suggestion: string,
): IncubationFinding => ({ id, label, level, detail, suggestion });

export function reviewIncubationCandidate(input: IncubationReviewInput): IncubationFinding[] {
  const { candidate, category, subGenres = [] } = input;
  const text = candidateText(candidate);
  const findings: IncubationFinding[] = [];

  // 1 分类匹配
  if (category) {
    const axisOverlap = candidate.secondaryGenres.filter((axis) => category.narrativeGenres.includes(axis));
    findings.push(
      axisOverlap.length
        ? finding(
            "category-fit",
            "分类匹配",
            "通过",
            `叙事主轴与 ${category.name} 的推荐主轴重合：${axisOverlap.join("、")}`,
            "",
          )
        : finding(
            "category-fit",
            "分类匹配",
            "警告",
            `候选的叙事主轴（${candidate.secondaryGenres.join("、")}）不在 ${category.name} 的推荐主轴（${category.narrativeGenres.join("、")}）内。`,
            `改用 ${category.narrativeGenres.slice(0, 2).join(" 或 ")} 作为主轴，或确认这是一次有意的跨类尝试。`,
          ),
    );
  }

  // 2 分类禁忌
  if (category) {
    const tabooHits = splitKeywords(category.taboo).filter((keyword) => text.includes(keyword));
    const clicheHits = category.clicheTraps.filter((keyword) => text.includes(keyword));
    const hits = [...new Set([...tabooHits, ...clicheHits])];
    findings.push(
      hits.length
        ? finding(
            "category-taboo",
            "分类禁忌",
            "阻断",
            `候选命中分类禁忌或常见毒点：${hits.join("、")}`,
            `把「${hits[0]}」替换为分类推荐的差异化切口：${category.differentiationAngles[0] ?? "另找一个具体切口"}。`,
          )
        : finding("category-taboo", "分类禁忌", "通过", "未命中分类禁忌与常见毒点。", ""),
    );
  }

  // 3 元素过量与互斥
  const selectedElements = input.genreElements;
  const elements = selectedElements.filter((element) => !DEDICATED_FIELD_LABELS.has(element));
  const conflicts = MUTUALLY_EXCLUSIVE_ELEMENTS.filter(
    ([left, right]) => selectedElements.includes(left) && selectedElements.includes(right),
  );
  findings.push(
    conflicts.length
      ? finding(
          "element-overload",
          "元素过量",
          "阻断",
          `同时选择了互斥元素：${conflicts.map(([left, right]) => `${left} + ${right}`).join("；")}`,
          "保留其中一个，另一个改为正向替代设定。",
        )
      : elements.length > 8
        ? finding(
            "element-overload",
            "元素过量",
            "阻断",
            `已选择 ${elements.length} 个题材元素，超过上限 8 个。`,
            "删减到 8 个以内，只保留真正会推动主线的元素。",
          )
        : finding("element-overload", "元素过量", "通过", `题材元素 ${elements.length} 个，在合理范围内。`, ""),
  );

  // 4 开局可执行
  const hook = candidate.openingDesign.chapter1Hook;
  const vague = VAGUE_OPENING_WORDS.filter((word) => hook.includes(word));
  findings.push(
    hook.trim().length < 12 || vague.length
      ? finding(
          "opening-concrete",
          "开局可执行",
          "警告",
          vague.length ? `首章钩子含空泛词：${vague.join("、")}` : "首章钩子过短，难以判断具体事件。",
          "改成「谁在什么处境下做了什么选择、立刻产生什么后果」的具体写法。",
        )
      : finding("opening-concrete", "开局可执行", "通过", "首章钩子包含具体事件与选择。", ""),
  );

  // 5 首个回报窗口
  if (category) {
    const [from, to] = input.preset?.structure.firstPayoffWindow ?? category.firstPayoffWindow;
    const payoffChapter = candidate.openingDesign.firstPayoffChapter;
    const late = payoffChapter - to;
    findings.push(
      payoffChapter <= to
        ? finding(
            "first-payoff-window",
            "首个回报",
            "通过",
            `首个实质回报落在第 ${payoffChapter} 章，在分类窗口内。`,
            "",
          )
        : late <= 3
          ? finding(
              "first-payoff-window",
              "首个回报",
              "警告",
              `首个实质回报在第 ${payoffChapter} 章，比 ${category.name} 的建议窗口（第 ${from}–${to} 章）晚 ${late} 章。`,
              "把一次可见的小回报提前到前三章。",
            )
          : finding(
              "first-payoff-window",
              "首个回报",
              "阻断",
              `首个实质回报在第 ${payoffChapter} 章，比建议窗口晚 ${late} 章，前段会失去追读动力。`,
              "在第 1–3 章安排一次与主线相关的具体回报。",
            ),
    );
  }

  // 6 升级阶梯
  const ladder = candidate.escalationLadder;
  const axisCount = new Set(ladder.map((step) => step.expansionAxis)).size;
  const missingCost = ladder.filter((step) => !step.cost.trim()).length;
  findings.push(
    ladder.length < 3
      ? finding(
          "escalation-ladder",
          "升级阶梯",
          "阻断",
          `只给出 ${ladder.length} 级升级，撑不起长篇。`,
          "补到至少 3 级，并写清每级的冲突、回报与代价。",
        )
      : axisCount < 2
        ? finding(
            "escalation-ladder",
            "升级阶梯",
            "阻断",
            `升级阶梯只用了「${ladder[0]?.expansionAxis}」一种扩张轴。`,
            "至少再选一种扩张轴（资源/关系/地图/规则/身份/技艺/势力）。",
          )
        : missingCost
          ? finding(
              "escalation-ladder",
              "升级阶梯",
              "警告",
              `有 ${missingCost} 级升级没有写明代价。`,
              "为每级补上人物要付出的代价。",
            )
          : finding(
              "escalation-ladder",
              "升级阶梯",
              "通过",
              `${ladder.length} 级升级，覆盖 ${axisCount} 种扩张轴。`,
              "",
            ),
  );

  // 7 发动机容量
  const perChapter = input.wordsPerChapter > 0 ? input.wordsPerChapter : 2500;
  const chaptersPerLevel = input.preset ? CHAPTERS_PER_LADDER_LEVEL[input.preset.lengthShape] : 60;
  const capacity = ladder.length * chaptersPerLevel * perChapter;
  findings.push(
    input.targetWords > capacity
      ? finding(
          "engine-capacity",
          "发动机容量",
          "警告",
          `按 ${ladder.length} 级、每级约 ${chaptersPerLevel} 章估算，可承载约 ${Math.round(capacity / 10000)} 万字，低于目标 ${Math.round(input.targetWords / 10000)} 万字。`,
          "增加升级层级，或把每级的可承载章节量写得更具体。",
        )
      : finding("engine-capacity", "发动机容量", "通过", "升级阶梯与目标字数匹配。", ""),
  );

  // 8 承诺一致
  const light = LIGHT_TONE_WORDS.filter((word) => `${candidate.audience}${candidate.readerPromise}`.includes(word));
  const heavy = HEAVY_TONE_WORDS.filter((word) => candidate.coreEmotion.includes(word));
  findings.push(
    light.length && heavy.length
      ? finding(
          "promise-consistency",
          "承诺一致",
          "警告",
          `读者承诺偏「${light.join("、")}」，核心情绪却是「${heavy.join("、")}」。`,
          "统一情绪基调，或在读者承诺里明确说明沉重情绪的价值。",
        )
      : finding("promise-consistency", "承诺一致", "通过", "读者承诺与核心情绪方向一致。", ""),
  );

  // 9 结局兑现
  const payoffOverlap = ngramSimilarity(candidate.ending, candidate.readerPromise);
  findings.push(
    payoffOverlap >= 0.12
      ? finding("ending-payoff", "结局兑现", "通过", "结局与读者承诺存在明确呼应。", "")
      : finding(
          "ending-payoff",
          "结局兑现",
          "警告",
          "结局与读者承诺的关键词几乎没有交集，存在承诺落空风险。",
          "让结局直接回应读者承诺里最重要的那件事。",
        ),
  );

  // 10 主角欲望
  findings.push(
    ACTIONABLE_DESIRE_VERBS.some((verb) => candidate.protagonistDesire.includes(verb))
      ? finding("protagonist-desire", "主角欲望", "通过", "主角欲望包含可执行的目标动词。", "")
      : finding(
          "protagonist-desire",
          "主角欲望",
          "警告",
          "主角欲望更像状态描述，缺少可执行目标。",
          "改写为「想要得到/阻止/查明什么」的具体目标。",
        ),
  );

  // 11 原创风险
  findings.push(
    candidate.differentiation.originalityRisk === "高"
      ? finding(
          "originality-risk",
          "原创风险",
          "阻断",
          `原创风险为高：${candidate.differentiation.riskNotes || "未说明原因"}`,
          "人工复核与已有作品的重合点，或换一个差异化切口后重生成。",
        )
      : finding("originality-risk", "原创风险", "通过", `原创风险：${candidate.differentiation.originalityRisk}`, ""),
  );

  // 12 同质化
  const similar = (input.existingContracts ?? []).find(
    (item) =>
      ngramSimilarity(candidate.premise, item.premise) >= 0.68 ||
      ngramSimilarity(candidate.openingMechanism, item.openingMechanism) >= 0.68,
  );
  findings.push(
    similar
      ? finding(
          "homogeneity",
          "同质化",
          "警告",
          `与已有作品《${similar.title}》的前提或开局机制高度相似。`,
          "换一条开局机制或主角身份，拉开与已有作品的差异。",
        )
      : finding("homogeneity", "同质化", "通过", "与已有作品未出现高相似度。", ""),
  );

  // 13 契约完整
  const contractLike = {
    premise: candidate.premise,
    readerPromise: candidate.readerPromise,
    ending: candidate.ending,
    openingMechanism: candidate.openingMechanism,
    growthCarrier: candidate.growthCarrier,
    primaryPayoff: candidate.primaryPayoff,
    longFormEngine: candidate.longFormEngine,
    protagonistArc: input.skeleton?.protagonistArc ?? "",
    keyRelationships: input.skeleton?.keyRelationships ?? [],
    worldRules: input.skeleton?.worldRules ?? [],
    majorForces: input.skeleton?.majorForces ?? [],
    timelineAnchors: input.skeleton?.timelineAnchors ?? [],
  } as unknown as StoryContract;
  const missing = missingContractApprovalFields(contractLike);
  if (!input.skeleton) {
    findings.push(
      finding(
        "contract-complete",
        "契约完整",
        "提示",
        "人物与世界骨架将在创建时生成，契约必填项请在创建后的故事圣经里复核。",
        "",
      ),
    );
  } else {
    findings.push(
      missing.length
        ? finding("contract-complete", "契约完整", "阻断", `创作契约仍缺：${missing.join("、")}`, "补齐后再进入立项。")
        : finding("contract-complete", "契约完整", "通过", "创作契约必填项齐全。", ""),
    );
  }

  // 14 开局同质
  if (category) {
    const clicheOpenings = category.commonOpenings.filter(
      (opening) => ngramSimilarity(candidate.openingDesign.chapter1Hook, opening) >= 0.68,
    );
    findings.push(
      clicheOpenings.length && !candidate.differentiation.against.length
        ? finding(
            "opening-cliche",
            "开局同质",
            "警告",
            `首章钩子接近分类常见开局：${clicheOpenings[0]}`,
            "在差异化说明里写清本作与这类开局的区别，或换一个开局。",
          )
        : finding("opening-cliche", "开局同质", "通过", "首章钩子未落入分类常见开局。", ""),
    );
  }

  // 15 标签偏离
  const knownTags = [...new Set([...(input.tagStats ?? []), ...(category?.tags ?? [])])];
  if (knownTags.length) {
    const overlap = candidate.suggestedTags.filter((tag) => knownTags.includes(tag)).length;
    const ratio = overlap / Math.max(1, candidate.suggestedTags.length);
    findings.push(
      ratio < 0.3
        ? finding(
            "tag-alignment",
            "标签偏离",
            "提示",
            `建议标签与分类标签重合度 ${Math.round(ratio * 100)}%，可能不利于冷启动。`,
            `优先选用分类常见标签：${knownTags.slice(0, 6).join("、")}。`,
          )
        : finding("tag-alignment", "标签偏离", "通过", `建议标签与分类标签重合度 ${Math.round(ratio * 100)}%。`, ""),
    );
  }

  // 16 兄弟分类混淆
  if (category) {
    const confused = category.siblingCategories
      .map((key) => getFanqieCategoryProfile(key))
      .filter((profile): profile is FanqieCategoryProfile => Boolean(profile))
      .find(
        (sibling) =>
          ngramSimilarity(candidate.openingMechanism, sibling.openingFocus) >= 0.6 ||
          (candidate.genreSubtype === sibling.recommendedSubtype &&
            ngramSimilarity(candidate.primaryPayoff, sibling.payoffPattern) >= 0.5),
      );
    findings.push(
      confused
        ? finding(
            "sibling-confusion",
            "兄弟分类混淆",
            "警告",
            `开局机制或子类型与兄弟分类「${confused.name}」高度接近，读者难以区分。`,
            `补一条只属于本书的差异化切口：${confused.differentiationAngles[0] ?? "换一个开局机制"}。`,
          )
        : finding("sibling-confusion", "兄弟分类混淆", "通过", "与兄弟分类定位区分度足够。", ""),
    );
  }

  // 17 流派一致
  if (subGenres.length) {
    const matched = subGenres.some((subGenre) => {
      const tokens = [...splitKeywords(subGenre.coreFantasy), ...subGenre.typicalTags];
      return tokens.some((token) => text.includes(token));
    });
    findings.push(
      matched
        ? finding("subgenre-consistency", "流派一致", "通过", "候选定位与所选二级流派一致。", "")
        : finding(
            "subgenre-consistency",
            "流派一致",
            "警告",
            `候选定位与所选二级流派（${subGenres.map((item) => item.name).join("、")}）缺少呼应。`,
            "要么在方案里体现该流派的核心幻想，要么取消这个流派选择。",
          ),
    );
  }

  // 18 单章字数匹配
  if (category) {
    const [min, max] = input.preset?.structure.chapterWords ?? category.typicalChapterWords;
    findings.push(
      input.wordsPerChapter >= min && input.wordsPerChapter <= max
        ? finding("chapter-words", "单章字数匹配", "通过", `单章 ${input.wordsPerChapter} 字在分类参考区间内。`, "")
        : finding(
            "chapter-words",
            "单章字数匹配",
            "提示",
            `单章 ${input.wordsPerChapter} 字不在分类参考区间（${min}–${max} 字）。`,
            `如无特别理由，调到 ${min}–${max} 字更贴近该分类的阅读节奏。`,
          ),
    );
  }

  return findings;
}

export function blockingFindings(findings: readonly IncubationFinding[], acknowledged: readonly string[]) {
  return findings.filter((item) => item.level === "阻断" && !acknowledged.includes(item.id));
}

export function canPromote(findings: readonly IncubationFinding[], acknowledged: readonly string[]) {
  return blockingFindings(findings, acknowledged).length === 0;
}

export function summarizeFindings(findings: readonly IncubationFinding[]) {
  return {
    blocked: findings.filter((item) => item.level === "阻断").length,
    warnings: findings.filter((item) => item.level === "警告").length,
    hints: findings.filter((item) => item.level === "提示").length,
    passed: findings.filter((item) => item.level === "通过").length,
  };
}
