import type {
  BatchGenerationPreview,
  Chapter,
  ChapterDraftStreamEvent,
  ContextPackage,
  PlanningGenerationResult,
  PlanningRepairInput,
  ProjectDetail,
  QualityIssue,
} from "../../src/shared/types";
import { assertChapterRetrySnapshot, validateChapterAiRetrySource } from "../ai-retry";
import type { AiService, StartedAiTask } from "../ai-service";
import type { WorkspaceDatabase } from "../database";
import { analyzeRankings } from "../ranking-service";
import type { RegisterHandler } from "./types";

type AiDatabase = Pick<
  WorkspaceDatabase,
  | "getAiJob"
  | "getAiJobRetryContext"
  | "getAiSettings"
  | "getChapter"
  | "findOriginalityMatches"
  | "getInsights"
  | "getProject"
  | "getProjectOverview"
  | "listAiJobs"
  | "listRankings"
  | "saveChapter"
  | "saveAiSettings"
  | "savePlan"
  | "saveFact"
  | "saveGeneratedChapter"
  | "saveIssues"
  | "searchRelevantFacts"
  | "transitionChapter"
>;

interface RetryFailureDetails {
  sourceJobId: string;
  retryJobId: string | null;
  projectId: string;
  chapterId: string;
  error: string;
}

export interface AiHandlerDependencies {
  register: RegisterHandler;
  database: AiDatabase;
  ai: Pick<
    AiService,
    | "cancelJob"
    | "extractChapterFacts"
    | "generateConcepts"
    | "generatePlanning"
    | "reviewChapter"
    | "reviewPlanning"
    | "reviseChapter"
  >;
  compileContext: (
    project: ProjectDetail,
    chapter: Chapter,
    relevantFacts?: ReadonlyArray<ProjectDetail["facts"][number]>,
  ) => ContextPackage;
  generateChapterDraft: (
    projectId: string,
    chapterId: string,
    onStream?: (event: ChapterDraftStreamEvent) => void,
  ) => Promise<Chapter>;
  sendChapterDraftStream: (streamId: string, event: ChapterDraftStreamEvent) => void;
  previewChapterBatch: (
    project: ProjectDetail,
    settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
    chapterId: string,
  ) => BatchGenerationPreview;
  generateChapterBatch: (projectId: string, chapterId: string) => Promise<Chapter[]>;
  runLocalQualityCheck: (input: {
    projectId: string;
    chapter: Chapter;
    previousChapter: Chapter | undefined;
    recentChapters: Chapter[];
    facts: ProjectDetail["facts"];
    contract: ProjectDetail["contract"];
    genre: ProjectDetail["summary"]["genre"];
    originalityMatches: ReturnType<WorkspaceDatabase["findOriginalityMatches"]>;
  }) => Promise<QualityIssue[]>;
  createId: () => string;
  currentTimestamp: () => string;
  isGenerationActive: (projectId: string) => boolean;
  markGenerationActive: (projectId: string) => void;
  markGenerationIdle: (projectId: string) => void;
  getApiKey: () => string;
  saveApiKey: (apiKey: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  queueFinalizedFactExtraction: (projectId: string, chapter: Chapter) => void;
  startChapterRetry: (projectId: string, chapterId: string) => StartedAiTask<Chapter>;
  logRetryFailure: (details: RetryFailureDetails) => void;
}

export function registerAiHandlers({
  register,
  database,
  ai,
  compileContext,
  generateChapterDraft,
  sendChapterDraftStream,
  previewChapterBatch,
  generateChapterBatch,
  runLocalQualityCheck,
  createId,
  currentTimestamp,
  isGenerationActive,
  markGenerationActive,
  markGenerationIdle,
  getApiKey,
  saveApiKey,
  clearApiKey,
  queueFinalizedFactExtraction,
  startChapterRetry,
  logRetryFailure,
}: AiHandlerDependencies): void {
  register("runQualityCheck", async (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    const localIssues = await runLocalQualityCheck({
      projectId: id,
      chapter,
      previousChapter: project.chapters.find((item) => item.number === chapter.number - 1),
      recentChapters: project.chapters.filter((item) => item.number < chapter.number).slice(-12),
      facts: project.facts,
      contract: project.contract,
      genre: project.summary.genre,
      originalityMatches: database.findOriginalityMatches(chapter.content),
    });
    const intentIssues: QualityIssue[] = [
      ["本章承诺", chapter.chapterPromise],
      ["预期回报", chapter.expectedPayoff],
      ["当前危机", chapter.crisis],
      ["结尾期待", chapter.endingExpectation],
    ]
      .filter(([, value]) => !String(value ?? "").trim())
      .map(([label]) => ({
        id: createId(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "章节商业意图",
        message: `${label}尚未规划，建议在写作台补充后再判断本章闭环。`,
        evidence: "",
        status: "待处理" as const,
        createdAt: currentTimestamp(),
      }));
    const dueExpectationIssues: QualityIssue[] = project.expectations
      .filter(
        (item) =>
          (item.status === "待兑现" || item.status === "部分兑现") &&
          item.expectedPayoffChapter !== null &&
          item.expectedPayoffChapter <= chapter.number &&
          !chapter.linkedExpectationIds?.includes(item.id),
      )
      .map((item) => ({
        id: createId(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "期待兑现",
        message: `“${item.title}”已到预计兑现章，但本章未标记承接；请确认延期、部分兑现或调整目标章。`,
        evidence: `第${item.sourceChapter}章提出`,
        status: "待处理" as const,
        createdAt: currentTimestamp(),
      }));
    let semanticIssues: QualityIssue[] = [];
    if (getApiKey()) {
      try {
        semanticIssues = await ai.reviewChapter(
          { ...project, facts },
          chapter,
          compileContext(project, chapter, facts),
        );
      } catch (error) {
        semanticIssues = [
          {
            id: createId(),
            projectId: id,
            chapterId,
            severity: "警告",
            category: "语义质检",
            message: "云端语义质检未完成，本次结果仅包含本地规则检查。",
            evidence: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
            status: "待处理",
            createdAt: currentTimestamp(),
          },
        ];
      }
    }
    const seen = new Set<string>();
    const issues = [...localIssues, ...intentIssues, ...dueExpectationIssues, ...semanticIssues].filter((issue) => {
      const key = `${issue.category}\n${issue.message}\n${issue.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    database.saveIssues(id, chapterId, issues);
    if (chapter.status === "草稿") {
      database.transitionChapter(id, chapterId, "待质检");
    }
    return issues;
  });
  register("reviseChapterFromQuality", async (id, chapterId) => {
    if (isGenerationActive(id)) {
      throw new Error("该作品已有正文生成或修订任务正在运行");
    }
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (["已定稿", "待发布", "已发布"].includes(chapter.status)) {
      throw new Error("已定稿或进入发布流程的章节不能直接由 AI 修改");
    }
    const issues = project.issues.filter((issue) => issue.chapterId === chapterId && issue.status === "待处理");
    if (!issues.length) throw new Error("本章没有可供 AI 修订的待处理问题");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    markGenerationActive(id);
    try {
      const revised = await ai.reviseChapter(
        { ...project, facts },
        chapter,
        compileContext(project, chapter, facts),
        issues,
      );
      return database.saveGeneratedChapter(id, revised);
    } finally {
      markGenerationIdle(id);
    }
  });
  register("generateChapterDraft", (id, chapterId, streamId) =>
    generateChapterDraft(id, chapterId, streamId ? (event) => sendChapterDraftStream(streamId, event) : undefined),
  );
  register("previewChapterBatch", (id, chapterId) =>
    previewChapterBatch(database.getProject(id), database.getAiSettings(), chapterId),
  );
  register("generateChapterBatch", (id, chapterId) => generateChapterBatch(id, chapterId));
  register("transitionChapter", (id, chapterId, status) => {
    const saved = database.transitionChapter(id, chapterId, status);
    if (status !== "已定稿") {
      return {
        chapter: saved,
        ledgerExtraction: { status: "不适用", candidateCount: 0 },
      };
    }
    if (!getApiKey()) {
      return {
        chapter: saved,
        ledgerExtraction: { status: "未配置", candidateCount: 0 },
      };
    }
    queueFinalizedFactExtraction(id, saved);
    return {
      chapter: saved,
      ledgerExtraction: { status: "排队中", candidateCount: 0 },
    };
  });
  register("compileContext", (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    return compileContext(
      project,
      chapter,
      database.searchRelevantFacts(id, `${chapter.title} ${chapter.outline}`, chapter.number),
    );
  });
  register("extractChapterFacts", async (id, chapterId) => {
    const project = database.getProjectOverview(id);
    const chapter = database.getChapter(id, chapterId);
    if (!chapter.content.trim()) throw new Error("章节还没有正文");
    const relevantFacts = database.searchRelevantFacts(
      id,
      `${chapter.title}\n${chapter.outline}\n${chapter.content.slice(0, 4_000)}`,
      chapter.number,
      40,
    );
    const candidates = await ai.extractChapterFacts({ ...project, facts: relevantFacts }, chapter);
    const existing = new Set(
      project.facts.map(
        (fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`,
      ),
    );
    const saved = [];
    for (const fact of candidates) {
      const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
      if (existing.has(key)) continue;
      saved.push(database.saveFact(id, fact));
      existing.add(key);
    }
    return saved;
  });
  register("generateConcepts", async (id) => {
    const project = database.getProject(id);
    const opportunities = analyzeRankings(database.listRankings())
      .marketOpportunities.filter((item) =>
        project.contract.fanqieCategoryKey
          ? item.categoryKey === project.contract.fanqieCategoryKey
          : item.genre === project.summary.genre,
      )
      .filter((item) => item.evidenceLevel !== "基线")
      .slice(0, 5);
    return ai.generateConcepts(project, database.getInsights(project.insightIds), opportunities);
  });
  register("generatePlanningDraft", async (id, input) => {
    const project = database.getProject(id);
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    if (input.mode === "全书结构" && project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷")) {
      throw new Error("当前已有宏观阶段或分卷；为避免重复，AI 不会覆盖现有结构");
    }
    const fromChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const count = input.mode === "后续章纲" ? (input.chapterCount ?? 10) : 0;
    if (
      input.mode === "后续章纲" &&
      project.chapters.some((chapter) => chapter.number >= fromChapter && chapter.number < fromChapter + count)
    ) {
      throw new Error(`第${fromChapter}–${fromChapter + count - 1}章范围内已有章节，AI 不会覆盖`);
    }
    const savedPlans: PlanningGenerationResult["plans"] = [];
    const savedChapters: PlanningGenerationResult["chapters"] = [];
    try {
      const generated = await ai.generatePlanning(project, { ...input, fromChapter }, (batch) => {
        const latest = database.getProject(id);
        if (batch.chapters.some((chapter) => latest.chapters.some((existing) => existing.number === chapter.number))) {
          throw new Error("生成期间章节范围发生变化，本批结果未保存，请重新生成");
        }
        savedPlans.push(...batch.plans.map((plan) => database.savePlan(id, plan)));
        savedChapters.push(...batch.chapters.map((chapter) => database.saveChapter(id, chapter)));
      });
      if (!generated.chapters.length) {
        savedPlans.push(...generated.plans.map((plan) => database.savePlan(id, plan)));
      }
      return {
        ...generated,
        plans: savedPlans,
        chapters: savedChapters,
      };
    } catch (error) {
      if (!savedChapters.length) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `已保存第${savedChapters[0].number}–${savedChapters.at(-1)!.number}章；后续批次生成失败：${message}`,
      );
    }
  });
  register("reviewPlanning", (id, input) => ai.reviewPlanning(database.getProject(id), input));
  register("applyPlanningRepairs", (id, input: PlanningRepairInput) => {
    const project = database.getProject(id);
    const plansById = new Map(project.plans.map((plan) => [plan.id, plan]));
    const chaptersById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
    if (!input.plans.length && !input.chapters.length) {
      throw new Error("没有可应用的规划修复");
    }
    if (
      new Set(input.plans.map((item) => item.targetId)).size !== input.plans.length ||
      new Set(input.chapters.map((item) => item.targetId)).size !== input.chapters.length
    ) {
      throw new Error("修复提案包含重复目标");
    }
    for (const repair of input.plans) {
      const current = plansById.get(repair.targetId);
      if (!current) throw new Error(`规划修复目标不存在：${repair.targetId}`);
      if (current.status === "已批准") {
        throw new Error(`规划“${current.title}”已经批准，需先建立并批准改纲变更单`);
      }
    }
    for (const repair of input.chapters) {
      const current = chaptersById.get(repair.targetId);
      if (!current) throw new Error(`章节修复目标不存在：${repair.targetId}`);
      if (["已定稿", "待发布", "已发布"].includes(current.status)) {
        throw new Error(`第${current.number}章已受保护，需先建立并批准章节变更单`);
      }
    }
    const appliedPlanIds = input.plans.map(
      (repair) =>
        database.savePlan(id, {
          ...plansById.get(repair.targetId)!,
          ...repair.after,
        }).id,
    );
    const appliedChapterIds = input.chapters.map((repair) => {
      const definedAfter = Object.fromEntries(Object.entries(repair.after).filter(([, value]) => value !== undefined));
      return database.saveChapter(id, {
        ...chaptersById.get(repair.targetId)!,
        ...definedAfter,
      }).id;
    });
    return { appliedPlanIds, appliedChapterIds };
  });
  register("getAiSettings", () => ({
    ...database.getAiSettings(),
    hasApiKey: Boolean(getApiKey()),
  }));
  register("saveAiSettings", async (settings, apiKey) => {
    const previousSettings = database.getAiSettings();
    const previousOrigin = new URL(previousSettings.baseUrl).origin;
    const nextOrigin = new URL(settings.baseUrl).origin;
    if (apiKey) await saveApiKey(apiKey);
    else if ((previousSettings.protocol !== settings.protocol || previousOrigin !== nextOrigin) && getApiKey())
      await clearApiKey();
    return {
      ...database.saveAiSettings(settings),
      hasApiKey: Boolean(getApiKey()),
    };
  });
  register("listAiJobs", (projectId) => database.listAiJobs(projectId));
  register("cancelAiJob", (id) => ai.cancelJob(id));
  register("retryAiJob", async (id) => {
    const sourceJob = database.getAiJob(id);
    if (!sourceJob) throw new Error("AI 任务不存在");
    const context = validateChapterAiRetrySource(sourceJob, database.getAiJobRetryContext(id));
    assertChapterRetrySnapshot(context, database.getChapter(context.projectId, context.chapterId));
    const task = startChapterRetry(context.projectId, context.chapterId);
    if (!task.jobId || task.source !== "network") {
      await task.completion;
      throw new Error("重试没有创建新的 AI 任务，请返回章节工作区重新生成");
    }
    void task.completion
      .catch((error) => {
        logRetryFailure({
          sourceJobId: id,
          retryJobId: task.jobId,
          projectId: context.projectId,
          chapterId: context.chapterId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .catch(() => {});
    const retryJob = database.getAiJob(task.jobId);
    if (!retryJob) {
      throw new Error("AI 重试任务已启动，但审计记录不可用");
    }
    return retryJob;
  });
}
