import type { Genre } from "./types";
import { GENRE_PLUGINS, type GenreStage } from "./genre-plugins";
import { getFanqieCategoryProfile } from "./fanqie-taxonomy";
import { compileGenreComposition, type GenreComposition } from "./genre-composition";

export const COMMERCIAL_KNOWLEDGE_VERSION =
  "cn-web-fiction.2026-07.v5-motif-balance";

export interface CommercialKnowledgeSource {
  title: string;
  url: string;
  authority: "平台官方" | "作者经验";
  appliesTo: string;
}

export const COMMERCIAL_KNOWLEDGE_SOURCES: CommercialKnowledgeSource[] = [
  {
    title: "推荐验证期规则全指南",
    url: "https://fanqienovel.com/writer/zone/article/7659317147297923134",
    authority: "平台官方",
    appliesTo: "包装转化、读完率、追读率与评论复盘",
  },
  {
    title: "从平到爽：黄金节奏点",
    url: "https://fanqienovel.com/writer/zone/article/7656736513551515673",
    authority: "平台官方",
    appliesTo: "阶段目标、爽点、小危机与下一轮期待",
  },
  {
    title: "让主线真正立起来",
    url: "https://fanqienovel.com/writer/zone/article/7656736024898322457",
    authority: "平台官方",
    appliesTo: "主线、阶段高潮、伏笔与承诺兑现",
  },
  {
    title: "打破流水账升级",
    url: "https://fanqienovel.com/writer/zone/article/7651934392931057689",
    authority: "平台官方",
    appliesTo: "升级体系、资源、边界、质变与代价",
  },
  {
    title: "封面简介双剑合璧",
    url: "https://fanqienovel.com/writer/zone/article/7480101551080489022",
    authority: "平台官方",
    appliesTo: "书名、封面、简介与正文承诺一致性",
  },
  {
    title: "爆款新书怎么写",
    url: "https://fanqienovel.com/writer/zone/article/7619170181129961534",
    authority: "作者经验",
    appliesTo: "开篇切入与看点密度；仅作观察提示",
  },
];

const CORE_LOOP = [
  "读者承诺：本章承接哪项题材或故事期待",
  "具体压力：用事件证明利益、尊严、生存、关系、机会或身份受到影响",
  "主动行动：主角为目标作出可观察的选择",
  "情绪回报：回应期待或释放此前积累的压力",
  "影响发酵：胜负必须改变资源、关系、地位、信息或后续机会",
  "续读问题：在回报后产生可理解、可解决的下一轮危机或期待",
];

export interface CommercialProgress extends GenreComposition {
  currentWords: number;
  targetWords: number;
  stage?: GenreStage;
  subtype?: string;
  fanqieCategoryKey?: string;
  storyStage?: { title: string; goal: string; conflict: string; outcome: string };
}

export function resolveStoryStage(
  plans: Array<{ kind: string; status: string; ordinal: number; targetWords: number; title: string; goal: string; conflict: string; outcome: string }>,
  currentWords: number,
) {
  const stages = plans
    .filter((plan) => plan.kind === "宏观阶段" && plan.status === "已批准")
    .sort((left, right) => left.ordinal - right.ordinal);
  if (!stages.length) return undefined;
  let boundary = 0;
  for (const stage of stages) {
    boundary += Math.max(0, stage.targetWords);
    if (currentWords < boundary) return stage;
  }
  return stages.at(-1);
}

export function resolveGenreStage(
  chapterNumber: number,
  progress?: CommercialProgress,
): GenreStage {
  if (progress?.stage) return progress.stage;
  if (chapterNumber <= 3) return "开篇";
  if (chapterNumber <= 10) return "追读";
  const ratio = progress?.targetWords
    ? progress.currentWords / progress.targetWords
    : 0;
  if (ratio >= 0.9) return "收束";
  if (ratio >= 0.72) return "高潮";
  if (chapterNumber > 40 || ratio >= 0.3) return "中期";
  return "扩张";
}

export function compileCommercialGuidance(
  genre: Genre,
  chapterNumber: number,
  progress?: CommercialProgress,
) {
  const plugin = GENRE_PLUGINS[genre];
  const phase = resolveGenreStage(chapterNumber, progress);
  const phaseRule = plugin.stages[phase];
  const subtype = plugin.subtypes.find((item) => item.name === progress?.subtype);
  const fanqieCategory = getFanqieCategoryProfile(progress?.fanqieCategoryKey);
  return [
    `知识库：${COMMERCIAL_KNOWLEDGE_VERSION}`,
    progress?.storyStage
      ? `当前项目阶段：${progress.storyStage.title}（第${chapterNumber}章）`
      : `当前题材节奏参考：${phase}（第${chapterNumber}章；尚无已审批宏观阶段）`,
    `题材承诺：${plugin.readerPromise}`,
    compileGenreComposition(progress),
    subtype
      ? `当前子类型：${subtype.name}｜核心幻想：${subtype.coreFantasy}｜目标读者：${subtype.targetAudience}｜禁忌：${subtype.tabooBoundary}`
      : progress?.subtype
        ? `当前自定义子类型：${progress.subtype}｜以创作契约中的读者承诺、人物动机和自定义方向确定具体规则，不强套内置子类型。`
        : `可选子类型：${plugin.subtypes.map((item) => item.name).join("、")}`,
    fanqieCategory ? `番茄分类映射：${fanqieCategory.channel}·${fanqieCategory.name}｜建议子类型：${fanqieCategory.recommendedSubtype}｜核心幻想：${fanqieCategory.coreFantasy}｜目标读者：${fanqieCategory.audience}｜开篇抓手：${fanqieCategory.openingFocus}｜禁忌：${fanqieCategory.taboo}` : "番茄分类映射：尚未选择，先按六套基础题材规则执行",
    ...(fanqieCategory ? [
      `分类叙事主轴：${fanqieCategory.narrativeGenres.join(" + ")}`,
      `分类元素参考：${fanqieCategory.genreElements.join("、") || "无固定元素"}`,
      `分类冲突发动机：${fanqieCategory.conflictEngine}`,
      `分类回报模式：${fanqieCategory.payoffPattern}`,
      `分类长线扩张：${fanqieCategory.expansionAxis}`,
      `分类疲劳信号：${fanqieCategory.fatigueSignal}`,
      "分类专属质检：",
      ...fanqieCategory.qualityChecks.map((item) => `- ${item}`),
    ] : []),
    `目标读者：${plugin.targetAudience.join("；")}`,
    `基础题材母题（按需选用，不是固定套路）：${plugin.coreFantasies.join("；")}`,
    `禁忌边界：${plugin.tabooBoundaries.join("；")}`,
    ...(progress?.storyStage ? [
      `项目阶段目标：${progress.storyStage.goal}`,
      `项目阶段冲突：${progress.storyStage.conflict}`,
      `项目阶段预期结果：${progress.storyStage.outcome}`,
      `题材节奏参考（仅作工具）：${phaseRule.objective}；${phaseRule.payoff}`,
    ] : [
      `参考阶段目标：${phaseRule.objective}`,
      `参考阶段冲突：${phaseRule.conflict}`,
      `参考阶段回报：${phaseRule.payoff}`,
      `参考阶段完成信号：${phaseRule.exitSignal}`,
    ]),
    "商业叙事循环：",
    ...CORE_LOOP.map((item) => `- ${item}`),
    "冲突工具箱（本章最多选择一项，不要求全部使用）：",
    ...plugin.conflictEngines.map((item) => `- ${item}`),
    `回报工具箱（不要求按固定顺序升级）：${plugin.rewardLadder.join("、")}`,
    "扩张轴工具箱（每个项目阶段选择一条主轴）：",
    ...plugin.expansionAxes.map((item) => `- ${item}`),
    "重复疲劳识别：",
    ...plugin.fatigueRules.map(
      (item) =>
        `- ${item.name}｜信号：${item.signals.join("、")}｜修复：${item.recovery}`,
    ),
    "题材规划检查：",
    ...plugin.planningChecks.map((item) => `- ${item}`),
    "题材质量检查：",
    ...plugin.qualityChecks.map((item) => `- ${item}`),
    "使用边界：密度和字数仅用于观察，不作为机械硬门禁；不得为制造钩子破坏人物动机、事实或创作契约。成本、资源与后果是抽象约束，不得在作者未指定时反复具象为债务、欠款、账目、清算或同类财务母题。",
  ].join("\n");
}

export function compileDeconstructionFramework(genre: Genre) {
  const plugin = GENRE_PLUGINS[genre];
  return [
    `知识库：${COMMERCIAL_KNOWLEDGE_VERSION}`,
    "按证据拆解，不复述剧情，不评价文笔好坏。每章识别：进入期待、主角目标、核心阻碍、核心利益、行动、信息增量、情绪变化、回报类型与强度、实际影响、新问题、章末钩子、状态变化。",
    "爽点必须验证期待→压力证据→主动行动→结果兑现→实际影响；缺少前置期待的胜利不能直接判为有效爽点。",
    "阶段识别目标→阻碍→代价→收获→新问题，以及回报间距、重复回报和中段疲软。",
    `目标读者：${plugin.targetAudience.join("；")}`,
    `核心幻想：${plugin.coreFantasies.join("；")}`,
    `题材重点：${plugin.deconstructionDimensions.join("、")}`,
    `题材回报阶梯：${plugin.rewardLadder.join(" → ")}`,
    `长线扩张轴：${plugin.expansionAxes.join("；")}`,
    `重复疲劳模式：${plugin.fatigueRules.map((item) => `${item.name}（${item.signals.join("、")}）`).join("；")}`,
  ].join("\n");
}
