import type {
  Chapter,
  ContextPackage,
  ExpectationEntry,
  LedgerFact,
  PlanNode,
  ProjectDetail,
  ProjectSummary,
  StoryContract,
  StorySummary,
} from "./types";
import { compileAestheticGuidance } from "./aesthetic-profile";
import { compileCommercialGuidance, resolveStoryStage } from "./commercial-knowledge";
import { buildContextDiagnostics } from "./context-diagnostics";
import { estimateStructuredRequestTokens } from "./token-estimator";
import { findCurrentVolume } from "./planning";
import { analyzeProseTemperature } from "./prose-temperature";
import { evaluateStoryConstraints } from "./story-constraints";
import { buildLongTermMemory } from "./summaries";

export type ContextChapterExcerpt = Pick<
  Chapter,
  "number" | "title" | "outline" | "content"
>;

export interface ContextCompilerInput {
  summary: Pick<ProjectSummary, "genre" | "currentWords" | "targetWords">;
  contract: StoryContract;
  chapter: Chapter;
  plans: readonly PlanNode[];
  relevantFacts: readonly LedgerFact[];
  constraintFacts: readonly LedgerFact[];
  summaries: readonly StorySummary[];
  expectations: readonly ExpectationEntry[];
  recentChapters: readonly ContextChapterExcerpt[];
  styleSamples: readonly string[];
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
>;

const styleSampleStatuses = new Set<Chapter["status"]>([
  "已定稿",
  "待发布",
  "已发布",
]);

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
    styleSamples: project.chapters
      .filter(
        (item) =>
          item.number < chapter.number &&
          styleSampleStatuses.has(item.status) &&
          item.content,
      )
      .sort((left, right) => left.number - right.number)
      .slice(-20)
      .map((item) => item.content),
  };
}

export function compileProjectChapterContext(
  project: ProjectContextSource,
  chapter: Chapter,
  relevantFacts: readonly LedgerFact[] = project.facts,
): ContextPackage {
  return compileChapterContext(
    buildProjectContextInput(project, chapter, relevantFacts),
  );
}

export function compileChapterContext(input: ContextCompilerInput): ContextPackage {
  const { chapter, contract, summary } = input;
  const approvedPlans = input.plans
    .filter((plan) => plan.status === "已批准")
    .sort((left, right) => left.ordinal - right.ordinal);
  const volume = findCurrentVolume(approvedPlans, chapter.number);
  const rollingCandidates = approvedPlans.filter(
    (plan) =>
      ["粗纲", "细纲", "场景卡"].includes(plan.kind) &&
      plan.ordinal >= chapter.number &&
      plan.ordinal <= chapter.number + 30,
  );
  const rolling = rollingCandidates.slice(0, 30);
  const priorChapters = input.recentChapters
    .filter((item) => item.number < chapter.number)
    .sort((left, right) => left.number - right.number);
  const recent = priorChapters.slice(-5);
  const styleSamples = input.styleSamples.filter(Boolean).slice(-20);
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
  const activeFacts = input.relevantFacts.filter(
    (fact) =>
      fact.confidence === "已确认" &&
      fact.validFromChapter <= chapter.number &&
      (fact.validToChapter === null || fact.validToChapter >= chapter.number),
  );
  const secrets = activeFacts.filter(
    (fact) => fact.kind === "秘密" && fact.knowledgeScope.trim(),
  );
  const linkedExpectations = input.expectations.filter((item) =>
    chapter.linkedExpectationIds?.includes(item.id),
  );
  const openExpectations = input.expectations.filter(
    (item) => item.status === "待兑现" || item.status === "部分兑现",
  );
  const unlinkedOpenExpectations = openExpectations.filter(
    (item) => !linkedExpectations.some((linked) => linked.id === item.id),
  );

  const context: ContextPackage = {
    contract: [
      `故事前提：${contract.premise}`,
      `题材子类型：${contract.genreSubtype || "未选择"}`,
      `复合叙事类型：${contract.secondaryGenres?.join(" + ") || "未选择"}`,
      `题材元素：${contract.genreElements?.join("、") || "未选择"}`,
      `自定义创作方向：${contract.customGenreDirection || "未填写"}`,
      `番茄分类：${contract.fanqieCategoryKey || "未选择"}`,
      `主角欲望：${contract.protagonistDesire}`,
      `读者承诺：${contract.readerPromise}`,
      `核心情绪：${contract.coreEmotion}`,
      `终局：${contract.ending}`,
      `不可破坏规则：${contract.immutableRules.join("；") || "无"}`,
      `禁写项：${contract.prohibitedPatterns.join("；") || "无"}`,
      `项目审美：\n${compileAestheticGuidance(contract.aestheticProfile)}`,
    ].join("\n"),
    commercialGuidance: compileCommercialGuidance(summary.genre, chapter.number, {
      currentWords: summary.currentWords,
      targetWords: summary.targetWords,
      subtype: contract.genreSubtype,
      fanqieCategoryKey: contract.fanqieCategoryKey,
      secondaryGenres: contract.secondaryGenres,
      genreElements: contract.genreElements,
      customGenreDirection: contract.customGenreDirection,
      storyStage: resolveStoryStage(input.plans, summary.currentWords),
    }),
    chapterIntent: [
      `本章承诺：${chapter.chapterPromise || "未填写"}`,
      `预期回报：${chapter.expectedPayoff || "未填写"}`,
      `当前危机：${chapter.crisis || "未填写"}`,
      `结尾期待：${chapter.endingExpectation || "未填写"}`,
    ].join("\n"),
    expectationLedger: [
      ...linkedExpectations.map(
        (item) => `[本章承接] ${item.title}｜第${item.sourceChapter}章提出｜预计第${item.expectedPayoffChapter ?? "未定"}章兑现｜${item.status}`,
      ),
      ...unlinkedOpenExpectations.slice(-20).map(
        (item) => `[待处理] ${item.title}｜第${item.sourceChapter}章提出｜预计第${item.expectedPayoffChapter ?? "未定"}章兑现｜${item.status}`,
      ),
    ].join("\n") || "暂无跨章节期待",
    longTermMemory: buildLongTermMemory(input.summaries, chapter.number),
    volumeGoal: volume
      ? `${volume.title}\n目标：${volume.goal}\n矛盾：${volume.conflict}\n结果：${volume.outcome}`
      : "尚未批准当前卷纲",
    rollingOutline: rolling
      .map((plan) => `${plan.ordinal}. ${plan.title}｜${plan.goal}｜${plan.outcome}`)
      .join("\n") || chapter.outline,
    recentSummary: recent.map((item) =>
      input.summaries.find(
        (storySummary) => storySummary.layer === "章节" && storySummary.fromChapter === item.number,
      )?.content ?? `第${item.number}章 ${item.title}：${item.outline || item.content.slice(0, 180)}`,
    ).join("\n"),
    relevantFacts: activeFacts.slice(0, 80).map(
      (fact) => `[${fact.genreDimension || fact.kind}] ${fact.subject}｜${fact.predicate}｜${fact.value}（自第${fact.validFromChapter}章）`,
    ).join("\n"),
    forbiddenKnowledge: secrets.map(
      (fact) => `${fact.subject}：${fact.value}；当前知情范围：${fact.knowledgeScope}`,
    ).join("\n") || "无额外限制",
    authorStyle: styleSamples.length
      ? `仅根据本项目已定稿正文统计：平均句长 ${averageSentence} 字，平均段长 ${averageParagraph} 字，对话标记密度 ${dialogueDensity}‰，每千字具身情绪 ${proseTemperature.embodiedEmotionPerThousand.toFixed(1)} 次，感官反馈 ${proseTemperature.sensoryPerThousand.toFixed(1)} 次。保持当前项目的叙事密度，不模仿研究样本；这些统计只是观察值，具体取舍以本项目审美设定为准。`
      : "尚无本项目已定稿正文，不加载任何样本文风。",
    estimatedTokens: 0,
  };
  context.estimatedTokens = estimateStructuredRequestTokens([
    contextText(context),
    chapter.outline,
    chapter.chapterFunction ?? "行动",
  ]);

  const confirmedConflicts = input.constraintFacts.filter((fact) => fact.confidence === "有冲突");
  const constraintFindings = evaluateStoryConstraints(input.constraintFacts, chapter);
  const missingIntent = [
    chapter.chapterPromise,
    chapter.expectedPayoff,
    chapter.crisis,
    chapter.endingExpectation,
  ].filter((value) => !value?.trim()).length;
  context.diagnostics = buildContextDiagnostics(context, {
    contract: { includedItems: contract.approved ? 1 : 0, totalItems: 1 },
    chapterIntent: { includedItems: 4 - missingIntent, totalItems: 4 },
    expectationLedger: {
      includedItems: linkedExpectations.length + Math.min(20, unlinkedOpenExpectations.length),
      totalItems: linkedExpectations.length + unlinkedOpenExpectations.length,
    },
    longTermMemory: { includedItems: input.summaries.length, totalItems: input.summaries.length },
    volumeGoal: { includedItems: volume ? 1 : 0, totalItems: 1 },
    rollingOutline: { includedItems: rolling.length, totalItems: rollingCandidates.length },
    recentSummary: { includedItems: recent.length, totalItems: Math.min(5, priorChapters.length) },
    relevantFacts: { includedItems: Math.min(80, activeFacts.length), totalItems: activeFacts.length },
    forbiddenKnowledge: { includedItems: secrets.length, totalItems: secrets.length },
    authorStyle: { includedItems: styleSamples.length, totalItems: styleSamples.length },
  }, [
    !contract.approved ? "创作契约尚未审批，生成门禁应阻止使用未确认方向" : "",
    missingIntent ? `本章商业意图缺少 ${missingIntent} 项` : "",
    !volume ? "当前章节没有已批准分卷目标" : "",
    !activeFacts.length ? "没有可用于本章的已确认有效事实" : "",
    confirmedConflicts.length ? `状态账本存在 ${confirmedConflicts.length} 条冲突事实，未纳入生成上下文` : "",
    ...constraintFindings.map((finding) => `${finding.severity}·${finding.category}：${finding.message}`),
  ]);
  return context;
}

function contextText(context: ContextPackage) {
  return Object.values(context)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}
