import { compileAestheticGuidance } from "./aesthetic-profile";
import { compileChapterGuidance, resolveStoryStage } from "./commercial-knowledge";
import { contextBudgetTokens, DEFAULT_CLOUD_CONTEXT_WINDOW, scaledCap } from "./context-budget";
import { buildContextDiagnostics, type ContextContentKey } from "./context-diagnostics";
import { CONTEXT_LAYOUT } from "./context-layout";
import { dedupeLabels } from "./genre-composition";
import { normalizeGuidanceMode } from "./guidance-mode";
import { type MemoryBrief, rankFacts, selectSummaryNodes } from "./memory-retrieval";
import type { MentionSegment } from "./mention-detection";
import { findCurrentVolume } from "./planning";
import { analyzeProseTemperature } from "./prose-temperature";
import { evaluateStoryConstraints } from "./story-constraints";
import { renderStoryEntryLine, selectStoryEntriesForChapter, storyEntryProperNouns } from "./story-entry-service";
import { buildLongTermMemory } from "./summaries";
import { estimateStructuredRequestTokens } from "./token-estimator";
import type {
  Chapter,
  ContextBand,
  ContextPackage,
  ExpectationEntry,
  LedgerFact,
  PlanNode,
  ProjectDetail,
  ProjectSummary,
  StoryContract,
  StoryEntry,
  StorySummary,
} from "./types";

export type ContextChapterExcerpt = Pick<Chapter, "number" | "title" | "outline" | "content">;

export interface ContextCompilerInput {
  summary: Pick<ProjectSummary, "genre" | "currentWords" | "targetWords"> & { wordsPerChapter?: number };
  contract: StoryContract;
  chapter: Chapter;
  plans: readonly PlanNode[];
  relevantFacts: readonly LedgerFact[];
  constraintFacts: readonly LedgerFact[];
  summaries: readonly StorySummary[];
  expectations: readonly ExpectationEntry[];
  recentChapters: readonly ContextChapterExcerpt[];
  styleSamples: readonly string[];
  /** 设定条目：按提及与生效区间注入，替代契约长列表的全量平铺。 */
  storyEntries?: readonly StoryEntry[];
  directorNotes?: readonly string[];
}

export type ProjectContextSource = Pick<
  ProjectDetail,
  | "summary"
  | "contract"
  | "plans"
  | "chapters"
  | "facts"
  | "summaries"
  | "expectations"
  | "storyEntries"
  | "directorNotes"
>;

export interface ContextCompileOptions {
  /** 本次请求可用的上下文 token 预算；缺省按云端默认窗口推导。 */
  budgetTokens?: number;
  /** 用于诊断展示的模型窗口；缺省等于默认窗口。 */
  windowTokens?: number;
}

const styleSampleStatuses = new Set<Chapter["status"]>(["已定稿", "待发布", "已发布"]);

/** 文风统计只看近期定稿，不扫描全书正文。 */
const STYLE_SAMPLE_LIMIT = 20;

/** 大窗口下的各段上限；小窗口按预算等比收缩。 */
const ROLLING_CHAPTER_WINDOW = 120;
const RECENT_SUMMARY_LIMIT = 100;
const FACT_LIMIT = 80;
const OPEN_EXPECTATION_LIMIT = 40;
const CONTRACT_LIST_ITEM_LIMIT = 40;
const DIRECTOR_NOTE_LIMIT = 20;
const LONG_TERM_MEMORY_CHARACTERS = 12_000;
/** 单章注入的设定条目上限；大窗口放宽，小窗口收缩。 */
const STORY_ENTRY_LIMIT = 40;
/** 条目段字符预算：条数与字符双重约束，避免长详述挤占整段。 */
const STORY_ENTRY_CHARACTERS = 6_000;

/** 默认预算：按云端默认窗口（1M）推导，不再是无限。 */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = contextBudgetTokens(DEFAULT_CLOUD_CONTEXT_WINDOW);

export function buildProjectContextInput(
  project: ProjectContextSource,
  chapter: Chapter,
  relevantFacts: readonly LedgerFact[] = project.facts,
): ContextCompilerInput {
  return {
    summary: project.summary,
    contract: project.contract,
    chapter,
    plans: project.plans,
    relevantFacts,
    constraintFacts: project.facts,
    summaries: project.summaries,
    expectations: project.expectations,
    recentChapters: project.chapters,
    storyEntries: project.storyEntries,
    styleSamples: project.chapters
      .filter((item) => item.number < chapter.number && styleSampleStatuses.has(item.status) && item.content)
      .sort((left, right) => left.number - right.number)
      .slice(-STYLE_SAMPLE_LIMIT)
      .map((item) => item.content),
    directorNotes: project.directorNotes,
  };
}

export function compileProjectChapterContext(
  project: ProjectContextSource,
  chapter: Chapter,
  relevantFacts: readonly LedgerFact[] = project.facts,
  options: ContextCompileOptions = {},
): ContextPackage {
  return compileChapterContext(buildProjectContextInput(project, chapter, relevantFacts), options);
}

export function compileChapterContext(
  input: ContextCompilerInput,
  options: ContextCompileOptions = {},
): ContextPackage {
  const { chapter, contract, summary } = input;
  const budgetTokens = options.budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS;
  const windowTokens = options.windowTokens ?? DEFAULT_CLOUD_CONTEXT_WINDOW;
  // 大窗口给足上限，小窗口按预算等比收缩；上限保证 1M 窗口也不会被填满。
  const rollingChapterWindow = scaledCap(ROLLING_CHAPTER_WINDOW, 5, budgetTokens);
  const recentSummaryLimit = scaledCap(RECENT_SUMMARY_LIMIT, 5, budgetTokens);
  const factLimit = scaledCap(FACT_LIMIT, 10, budgetTokens);
  const openExpectationLimit = scaledCap(OPEN_EXPECTATION_LIMIT, 5, budgetTokens);
  const contractListItemLimit = scaledCap(CONTRACT_LIST_ITEM_LIMIT, 3, budgetTokens);
  const directorNoteLimit = scaledCap(DIRECTOR_NOTE_LIMIT, 3, budgetTokens);
  const longTermMemoryCharacters = scaledCap(LONG_TERM_MEMORY_CHARACTERS, 1_800, budgetTokens);

  const directorNotes = (input.directorNotes ?? []).filter(Boolean);
  const approvedPlans = input.plans
    .filter((plan) => plan.status === "已批准")
    .sort((left, right) => left.ordinal - right.ordinal);
  const volume = findCurrentVolume(approvedPlans, chapter.number, summary.wordsPerChapter);
  // 场景卡的 ordinal 编码（章号*10+序号）是历史约定；优先用父细纲定位章号，避免人工编辑后失配。
  const detailOrdinals = new Map(
    input.plans.filter((plan) => plan.kind === "细纲").map((plan) => [plan.id, plan.ordinal]),
  );
  const planChapter = (plan: PlanNode) =>
    plan.kind === "场景卡" ? (detailOrdinals.get(plan.parentId ?? "") ?? Math.floor(plan.ordinal / 10)) : plan.ordinal;
  const rollingCandidates = approvedPlans.filter(
    (plan) =>
      ["粗纲", "细纲", "场景卡"].includes(plan.kind) &&
      planChapter(plan) >= chapter.number &&
      planChapter(plan) <= chapter.number + rollingChapterWindow,
  );
  const rolling = rollingCandidates;
  const priorChapters = input.recentChapters
    .filter((item) => item.number < chapter.number)
    .sort((left, right) => left.number - right.number);
  const recent = priorChapters.slice(-recentSummaryLimit);
  const styleSamples = input.styleSamples.filter(Boolean).slice(-STYLE_SAMPLE_LIMIT);
  const ownText = styleSamples.join("\n");
  const sentences = ownText.split(/[。！？!?]/).filter(Boolean);
  const paragraphs = ownText.split(/\n+/).filter(Boolean);
  const averageSentence = sentences.length
    ? Math.round(sentences.reduce((sum, item) => sum + item.length, 0) / sentences.length)
    : 0;
  const averageParagraph = paragraphs.length
    ? Math.round(paragraphs.reduce((sum, item) => sum + item.length, 0) / paragraphs.length)
    : 0;
  const dialogueDensity = ownText.length
    ? Math.round(((ownText.match(/[“”]/g)?.length ?? 0) / ownText.length) * 1000)
    : 0;
  const proseTemperature = analyzeProseTemperature(ownText);
  const storyEntries = input.storyEntries ?? [];
  const chapterBriefText = [
    chapter.outline,
    chapter.chapterPromise,
    chapter.expectedPayoff,
    chapter.crisis,
    chapter.endingExpectation,
  ]
    .filter(Boolean)
    .join("\n");
  const mentionSegments: MentionSegment[] = [
    { source: "章纲", text: chapterBriefText },
    { source: "上章末尾", text: priorChapters.at(-1)?.content.slice(-300) ?? "" },
    // 重新生成时 chapter.content 是当前草稿：草稿里已经写到的设定同样要注入。
    ...(chapter.content.trim() ? [{ source: "草稿" as const, text: chapter.content }] : []),
  ];
  const entryLimit = scaledCap(STORY_ENTRY_LIMIT, 8, budgetTokens);
  const entryCharacters = scaledCap(STORY_ENTRY_CHARACTERS, 1_200, budgetTokens);
  const entrySelection = selectStoryEntriesForChapter({
    entries: storyEntries,
    chapterNumber: chapter.number,
    segments: mentionSegments,
    limit: entryLimit,
    maxCharacters: entryCharacters,
  });
  const chapterBrief: MemoryBrief = {
    chapterNumber: chapter.number,
    text: chapterBriefText,
    properNouns: storyEntryProperNouns(storyEntries),
  };
  const memorySelection = selectSummaryNodes(input.summaries, chapterBrief, longTermMemoryCharacters);
  const activeFacts = input.relevantFacts.filter(
    (fact) =>
      fact.confidence === "已确认" &&
      fact.validFromChapter <= chapter.number &&
      (fact.validToChapter === null || fact.validToChapter >= chapter.number),
  );
  const secrets = activeFacts.filter((fact) => fact.kind === "秘密" && fact.knowledgeScope.trim());
  const linkedExpectations = input.expectations.filter((item) => chapter.linkedExpectationIds?.includes(item.id));
  const openExpectations = input.expectations.filter((item) => item.status === "待兑现" || item.status === "部分兑现");
  const unlinkedOpenExpectations = openExpectations.filter(
    (item) => !linkedExpectations.some((linked) => linked.id === item.id),
  );
  const dueExpectations = unlinkedOpenExpectations.filter(
    (item) => item.expectedPayoffChapter !== null && item.expectedPayoffChapter <= chapter.number,
  );
  const pendingExpectations = unlinkedOpenExpectations
    .filter((item) => !dueExpectations.some((due) => due.id === item.id))
    .sort(
      (left, right) =>
        (left.expectedPayoffChapter ?? Number.MAX_SAFE_INTEGER) -
          (right.expectedPayoffChapter ?? Number.MAX_SAFE_INTEGER) || left.sourceChapter - right.sourceChapter,
    )
    .slice(0, openExpectationLimit);
  let contractListOmitted = 0;
  const contractList = (label: string, items: readonly string[] | undefined) => {
    const values = (items ?? []).map((item) => item.trim()).filter(Boolean);
    if (!values.length) return `${label}：未填写`;
    const kept = values.slice(0, contractListItemLimit);
    const omitted = values.length - kept.length;
    contractListOmitted += omitted;
    return `${label}：\n${kept.join("\n")}${omitted > 0 ? `\n（另有 ${omitted} 条已省略，可在故事圣经查看）` : ""}`;
  };
  // 已被设定条目接管的契约长列表不再平铺，避免与条目段重复并挤占预算。
  const managedSources = new Set(
    storyEntries.map((entry) => entry.sourceContractItem).filter((value): value is string => Boolean(value)),
  );
  const contractListOrManaged = (label: string, source: string, items: readonly string[] | undefined) =>
    managedSources.has(source)
      ? `${label}：已转为设定条目，按提及注入（共 ${(items ?? []).filter((item) => item.trim()).length} 条）`
      : contractList(label, items);
  const expectationLine = (item: ExpectationEntry, prefix: string) =>
    `[${prefix}] ${item.title}｜第${item.sourceChapter}章提出｜预计第${item.expectedPayoffChapter ?? "未定"}章兑现｜${item.status}`;

  const context: ContextPackage = {
    contract: [
      `故事前提：${contract.premise}`,
      `题材子类型：${contract.genreSubtype || "未选择"}`,
      `复合叙事类型：${contract.secondaryGenres?.join(" + ") || "未选择"}`,
      `题材元素：${dedupeLabels(contract.secondaryGenres, contract.genreElements).join("、") || "未选择"}`,
      `自定义创作方向：${contract.customGenreDirection || "未填写"}`,
      `番茄分类：${contract.fanqieCategoryKey || "未选择"}`,
      `主角欲望：${contract.protagonistDesire}`,
      `主角弧光：${contract.protagonistArc || "未填写"}`,
      contractListOrManaged("关键关系", "keyRelationships", contract.keyRelationships),
      contractListOrManaged("世界规则", "worldRules", contract.worldRules),
      contractListOrManaged("主要势力", "majorForces", contract.majorForces),
      contractListOrManaged("时间锚点", "timelineAnchors", contract.timelineAnchors),
      ...(contract.genreSpecificSections ?? []).map((section, index) =>
        contractListOrManaged(section.label, `genreSpecificSections:${index}`, section.items),
      ),
      `读者承诺：${contract.readerPromise}`,
      `核心情绪：${contract.coreEmotion}`,
      `终局：${contract.ending}`,
      `不可破坏规则：${contract.immutableRules.join("；") || "无"}`,
      `禁写项：${contract.prohibitedPatterns.join("；") || "无"}`,
      ...(contract.creativeBrief?.trim()
        ? [`作者补充引导（写作偏好，非硬性禁写项）：${contract.creativeBrief.trim()}`]
        : []),
      `项目审美：\n${compileAestheticGuidance(contract.aestheticProfile)}`,
    ].join("\n"),
    commercialGuidance: compileChapterGuidance(
      summary.genre,
      chapter.number,
      {
        currentWords: summary.currentWords,
        targetWords: summary.targetWords,
        subtype: contract.genreSubtype,
        fanqieCategoryKey: contract.fanqieCategoryKey,
        secondaryGenres: contract.secondaryGenres,
        genreElements: contract.genreElements,
        customGenreDirection: contract.customGenreDirection,
        storyStage: resolveStoryStage(input.plans, summary.currentWords),
      },
      contract.guidanceMode,
      {
        chapterFunction: chapter.chapterFunction ?? "行动",
        isKeyChapter: chapter.isKeyChapter,
        hasApprovedStructure: Boolean(volume) || Boolean(resolveStoryStage(input.plans, summary.currentWords)),
        chapterText: [
          chapter.outline,
          chapter.chapterPromise,
          chapter.expectedPayoff,
          chapter.crisis,
          chapter.endingExpectation,
        ]
          .filter(Boolean)
          .join("\n"),
        recentChapterTexts: priorChapters.map((item) => item.outline),
      },
    ),
    chapterIntent: [
      `本章承诺：${chapter.chapterPromise || "未填写"}`,
      `预期回报：${chapter.expectedPayoff || "未填写"}`,
      `当前危机：${chapter.crisis || "未填写"}`,
      `结尾期待：${chapter.endingExpectation || "未填写"}`,
    ].join("\n"),
    expectationLedger:
      [
        ...linkedExpectations.map((item) => expectationLine(item, "本章承接")),
        ...dueExpectations.map((item) => expectationLine(item, "已到期")),
        ...pendingExpectations.map((item) => expectationLine(item, "待处理")),
      ].join("\n") || "暂无跨章节期待",
    longTermMemory: buildLongTermMemory(
      input.summaries,
      chapter.number,
      longTermMemoryCharacters,
      memorySelection.selected,
    ),
    volumeGoal: volume
      ? `${volume.title}\n目标：${volume.goal}\n矛盾：${volume.conflict}\n结果：${volume.outcome}`
      : "尚未批准当前卷纲",
    rollingOutline:
      rolling.map((plan) => `${planChapter(plan)}. ${plan.title}｜${plan.goal}｜${plan.outcome}`).join("\n") ||
      chapter.outline,
    recentSummary: recent
      .map(
        (item) =>
          input.summaries.find(
            (storySummary) => storySummary.layer === "章节" && storySummary.fromChapter === item.number,
          )?.content ?? `第${item.number}章 ${item.title}：${item.outline || item.content.slice(0, 180)}`,
      )
      .join("\n"),
    relevantFacts: rankFacts(activeFacts, chapterBrief)
      .slice(0, factLimit)
      .map(
        (fact) =>
          `[${fact.genreDimension || fact.kind}] ${fact.subject}｜${fact.predicate}｜${fact.value}（自第${fact.validFromChapter}章）`,
      )
      .join("\n"),
    storyEntries: entrySelection.selected.length
      ? entrySelection.selected.map((item) => renderStoryEntryLine(item)).join("\n")
      : storyEntries.length
        ? "本章未命中任何设定条目"
        : "尚未建立设定条目（可在故事圣经「设定条目」生成）",
    forbiddenKnowledge:
      secrets.map((fact) => `${fact.subject}：${fact.value}；当前知情范围：${fact.knowledgeScope}`).join("\n") ||
      "无额外限制",
    authorStyle: [
      ...(directorNotes.length
        ? [
            `作者近期纠错偏好（后续写作必须遵守）：\n${directorNotes
              .slice(-directorNoteLimit)
              .map((note) => `- ${note}`)
              .join("\n")}`,
          ]
        : []),
      styleSamples.length
        ? `仅根据本项目已定稿正文统计：平均句长 ${averageSentence} 字，平均段长 ${averageParagraph} 字，对话标记密度 ${dialogueDensity}‰，每千字具身情绪 ${proseTemperature.embodiedEmotionPerThousand.toFixed(1)} 次，感官反馈 ${proseTemperature.sensoryPerThousand.toFixed(1)} 次。保持当前项目的叙事密度，不模仿研究样本；这些统计只是观察值，具体取舍以本项目审美设定为准。`
        : "尚无本项目已定稿正文，不加载任何样本文风。",
    ].join("\n"),
    guidanceMode: normalizeGuidanceMode(contract.guidanceMode),
    estimatedTokens: 0,
  };
  context.estimatedTokens = estimateStructuredRequestTokens([
    contextText(context),
    chapter.outline,
    chapter.chapterFunction ?? "行动",
  ]);
  const trimmedSections = applyContextBudget(context, budgetTokens);

  const confirmedConflicts = input.constraintFacts.filter((fact) => fact.confidence === "有冲突");
  const constraintFindings = evaluateStoryConstraints(input.constraintFacts, chapter);
  const missingIntent = [
    chapter.chapterPromise,
    chapter.expectedPayoff,
    chapter.crisis,
    chapter.endingExpectation,
  ].filter((value) => !value?.trim()).length;
  context.diagnostics = buildContextDiagnostics(
    context,
    {
      contract: { includedItems: contract.approved ? 1 : 0, totalItems: 1 },
      chapterIntent: { includedItems: 4 - missingIntent, totalItems: 4 },
      expectationLedger: {
        includedItems: linkedExpectations.length + dueExpectations.length + pendingExpectations.length,
        totalItems: linkedExpectations.length + unlinkedOpenExpectations.length,
      },
      longTermMemory: { includedItems: input.summaries.length, totalItems: input.summaries.length },
      volumeGoal: { includedItems: volume ? 1 : 0, totalItems: 1 },
      rollingOutline: { includedItems: rolling.length, totalItems: rollingCandidates.length },
      recentSummary: { includedItems: recent.length, totalItems: priorChapters.length },
      relevantFacts: { includedItems: Math.min(factLimit, activeFacts.length), totalItems: activeFacts.length },
      storyEntries: { includedItems: entrySelection.selected.length, totalItems: entrySelection.total },
      forbiddenKnowledge: { includedItems: secrets.length, totalItems: secrets.length },
      authorStyle: { includedItems: styleSamples.length, totalItems: styleSamples.length },
    },
    [
      trimmedSections.length ? `已按 token 预算裁剪：${trimmedSections.join("、")}` : "",
      entrySelection.omitted > 0 ? `设定条目按预算省略 ${entrySelection.omitted} 条` : "",
      `上下文预算 ${budgetTokens} token（模型窗口 ${windowTokens}，近 ${recentSummaryLimit} 章摘要、前瞻 ${rollingChapterWindow} 章章纲）`,
      contractListOmitted > 0 ? `契约长列表已按预算截断 ${contractListOmitted} 条，完整内容见故事圣经` : "",
      !contract.approved ? "创作契约尚未审批，生成门禁应阻止使用未确认方向" : "",
      missingIntent ? `本章商业意图缺少 ${missingIntent} 项` : "",
      !volume ? "当前章节没有已批准分卷目标" : "",
      !activeFacts.length ? "没有可用于本章的已确认有效事实" : "",
      confirmedConflicts.length ? `状态账本存在 ${confirmedConflicts.length} 条冲突事实，未纳入生成上下文` : "",
      ...constraintFindings.map((finding) => `${finding.severity}·${finding.category}：${finding.message}`),
    ],
    { windowTokens, budgetTokens },
  );
  return context;
}

function contextText(context: ContextPackage) {
  return Object.values(context)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

/** 按优先级裁剪的上下文段：文风统计与长期记忆先让位，硬边界永不裁剪。 */
const TRIM_ORDER = [
  "authorStyle",
  "longTermMemory",
  "recentSummary",
  "relevantFacts",
  "storyEntries",
  "expectationLedger",
  "rollingOutline",
] as const satisfies readonly ContextContentKey[];

function applyContextBudget(context: ContextPackage, budgetTokens: number): ContextContentKey[] {
  const trimmed: ContextContentKey[] = [];
  for (const key of TRIM_ORDER) {
    if (context.estimatedTokens <= budgetTokens) break;
    if (!context[key].trim()) continue;
    context[key] = "";
    trimmed.push(key);
    context.estimatedTokens = estimateStructuredRequestTokens([contextText(context)]);
  }
  return trimmed;
}

const CONTEXT_SECTION_TITLES = {
  chapterIntent: "本章任务",
  rollingOutline: "滚动章纲",
  contract: "创作契约与审美",
  commercialGuidance: "题材引导",
  volumeGoal: "当前卷目标",
  expectationLedger: "跨章期待",
  recentSummary: "近期摘要",
  longTermMemory: "长期记忆",
  relevantFacts: "相关事实",
  storyEntries: "设定条目",
  authorStyle: "作者文风参考",
  forbiddenKnowledge: "角色未知信息（边界）",
} as const satisfies Record<(typeof CONTEXT_LAYOUT)[number]["key"], string>;

export interface ContextRenderOptions {
  /** 稳定前缀已放进 system 提示时，正文里不再重复渲染。 */
  excludeStable?: boolean;
}

function renderContextBands(context: ContextPackage, bands: readonly ContextBand[]): string {
  return CONTEXT_LAYOUT.filter((item) => bands.includes(item.band))
    .map((item) => {
      const value = context[item.key]?.trim();
      return value ? `## ${CONTEXT_SECTION_TITLES[item.key]}\n${value}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 把上下文渲染成分节标签文本，替代 JSON.stringify：
 * 键名与转义不再占用 token，模型读到的是一份写作简报而不是数据校验表。
 * 顺序由 CONTEXT_LAYOUT 决定：稳定前缀在前，本章任务在末。
 */
export function renderContextForPrompt(context: ContextPackage, options: ContextRenderOptions = {}): string {
  const bands: ContextBand[] = options.excludeStable ? ["slow", "fast", "task"] : ["stable", "slow", "fast", "task"];
  return renderContextBands(context, bands);
}

/**
 * 书级稳定块（当前只有创作契约与审美）：内容只在契约审批后变化，
 * 适合作为 system 提示的固定尾部，让供应商前缀缓存跨章节复用。
 */
export function renderStableBookContext(context: ContextPackage): string {
  return renderContextBands(context, ["stable"]);
}
