import { describe, expect, it, vi } from "vitest";
import {
  registerAiHandlers,
  type AiHandlerDependencies,
} from "../electron/handlers/ai-handlers";
import { serializeChapterAiRetryContext } from "../electron/ai-retry";
import type { RegisterHandler } from "../electron/handlers/types";
import type {
  AiJobRecord,
  AiSettings,
  Chapter,
  ContextPackage,
  InsightPack,
  LedgerFact,
  PlanNode,
  ProjectDetail,
  RankingSnapshot,
} from "../src/shared/types";

const chapter = {
  id: "chapter-2",
  number: 2,
  title: "旧标题",
  outline: "旧章纲",
  content: "",
  wordCount: 0,
  status: "章纲",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 7,
  updatedAt: "2026-07-31T00:00:00.000Z",
} satisfies Chapter;

function job(id: string): AiJobRecord {
  return {
    id,
    projectId: "project-1",
    taskType: "draft-chapter",
    inputSummary: "第2章",
    promptVersion: "v1",
    provider: "openai-compatible",
    model: "test-model",
    status: id === "source" ? "失败" : "运行中",
    inputTokens: 0,
    outputTokens: 0,
    actualCost: 0,
    durationMs: 0,
    headersAt: null,
    firstTokenAt: null,
    completedAt: null,
    chunkCount: 0,
    attemptCount: 1,
    error: id === "source" ? "timeout" : null,
    retryable: true,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

const settings: Omit<AiSettings, "hasApiKey"> = {
  baseUrl: "https://example.com/v1",
  model: "test-model",
  embeddingModel: "test-embedding",
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
  longTaskTimeoutMinutes: 5,
};

const plan = {
  id: "plan-1",
  kind: "粗纲",
  title: "旧粗纲",
  ordinal: 1,
  goal: "旧目标",
  conflict: "旧冲突",
  outcome: "旧结果",
  targetWords: 20_000,
  status: "草稿",
  parentId: null,
} satisfies PlanNode;

const existingFact = {
  id: "fact-existing",
  kind: "地点",
  subject: "林舟",
  predicate: "所在地",
  value: "旧城",
  validFromChapter: 1,
  validToChapter: null,
  evidenceChapter: 2,
  confidence: "已确认",
  knowledgeScope: "公开",
  updatedAt: "2026-07-31T00:00:00.000Z",
} satisfies LedgerFact;

const planningProject = {
  summary: {
    id: "project-1",
    title: "旧城回声",
    genre: "都市脑洞",
  },
  contract: { approved: true, fanqieCategoryKey: "男频:262" },
  plans: [plan],
  chapters: [chapter],
  facts: [existingFact],
  insightIds: ["insight-1"],
} as unknown as ProjectDetail;

const insight = {
  id: "insight-1",
  name: "开篇异常承诺",
  genre: "都市脑洞",
  audienceNeed: "快速确认异常规则",
  openingPromise: "首章出现可验证异常",
  conflictEngine: "调查推进与规则反噬",
  emotionalRhythm: "紧张后短暂缓冲",
  retentionDevices: "证据链",
  longFormEngine: "规则逐层揭示",
  marketGap: "职业调查",
  risks: "设定解释过量",
  evidenceCount: 3,
  confidence: "中",
  createdAt: "2026-07-31T00:00:00.000Z",
} satisfies InsightPack;

function rankingSnapshot(
  id: string,
  capturedAt: string,
  rank: number,
): RankingSnapshot {
  return {
    id,
    source: "番茄小说官网",
    listName: "番茄男频阅读榜·都市脑洞",
    capturedAt,
    status: "成功",
    error: null,
    entries: [
      {
        id: `${id}-entry`,
        snapshotId: id,
        rank,
        title: "规则调查员",
        author: "作者",
        genre: "都市脑洞",
        words: 500_000,
        status: "连载",
        tags: [],
        sourceUrl: "",
      },
    ],
  };
}

const rankings = [
  rankingSnapshot("rank-old", "2026-07-29T00:00:00.000Z", 3),
  rankingSnapshot("rank-new", "2026-07-30T00:00:00.000Z", 1),
];

function createDependencies(
  completion: Promise<Chapter> = new Promise(() => {}),
) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    if (handlers.has(channel)) throw new Error(`重复注册：${channel}`);
    handlers.set(channel, callback);
  };
  let apiKey = "";
  const sourceJob = job("source");
  const retryJob = job("retry");
  const database = {
    getAiJob: vi.fn((id: string) =>
      id === sourceJob.id ? sourceJob : id === retryJob.id ? retryJob : undefined,
    ),
    getAiJobRetryContext: vi.fn(() =>
      serializeChapterAiRetryContext("chapter", "project-1", chapter),
    ),
    getAiSettings: vi.fn(() => ({ ...settings, hasApiKey: false })),
    getChapter: vi.fn(() => chapter),
    getInsights: vi.fn(() => [insight]),
    getProject: vi.fn(() => planningProject),
    getProjectOverview: vi.fn(() => planningProject),
    listAiJobs: vi.fn(() => [sourceJob]),
    listRankings: vi.fn(() => rankings),
    saveChapter: vi.fn((_id, next: Chapter) => next),
    saveFact: vi.fn((_id, fact: LedgerFact) => fact),
    saveAiSettings: vi.fn((next) => ({ ...next, hasApiKey: false })),
    savePlan: vi.fn((_id, next: PlanNode) => next),
    searchRelevantFacts: vi.fn(() => [existingFact]),
    transitionChapter: vi.fn((_id, _chapterId, status) => ({
      ...chapter,
      status,
    })),
  };
  const saveApiKey = vi.fn(async (next: string) => {
    apiKey = next;
  });
  const startChapterRetry = vi.fn(() => ({
    jobId: retryJob.id,
    source: "network" as const,
    completion,
  }));
  const logRetryFailure = vi.fn();
  const queueFinalizedFactExtraction = vi.fn();
  const dependencies = {
    register,
    database,
    ai: {
      cancelJob: vi.fn(() => true),
      extractChapterFacts: vi.fn(),
      generateConcepts: vi.fn(async () => []),
      generatePlanning: vi.fn(),
      reviewPlanning: vi.fn(),
    },
    compileContext: vi.fn(
      () => ({ estimatedTokens: 123 }) as ContextPackage,
    ),
    getApiKey: () => apiKey,
    saveApiKey,
    queueFinalizedFactExtraction,
    startChapterRetry,
    logRetryFailure,
  } as unknown as AiHandlerDependencies;
  return {
    dependencies,
    handlers,
    database,
    ai: dependencies.ai,
    compileContext: dependencies.compileContext,
    saveApiKey,
    startChapterRetry,
    logRetryFailure,
    queueFinalizedFactExtraction,
    retryJob,
  };
}

describe("AI handlers", () => {
  it("registers the planning, settings, and job lifecycle surface", () => {
    const { dependencies, handlers } = createDependencies();
    registerAiHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "applyPlanningRepairs",
      "cancelAiJob",
      "compileContext",
      "extractChapterFacts",
      "generateConcepts",
      "generatePlanningDraft",
      "getAiSettings",
      "listAiJobs",
      "retryAiJob",
      "reviewPlanning",
      "saveAiSettings",
      "transitionChapter",
    ]);
  });

  it("returns chapter transitions immediately and queues finalized fact extraction", async () => {
    const {
      dependencies,
      handlers,
      saveApiKey,
      queueFinalizedFactExtraction,
    } = createDependencies();
    registerAiHandlers(dependencies);

    expect(
      handlers.get("transitionChapter")!("project-1", chapter.id, "草稿"),
    ).toMatchObject({ ledgerExtraction: { status: "不适用" } });
    expect(
      handlers.get("transitionChapter")!("project-1", chapter.id, "已定稿"),
    ).toMatchObject({ ledgerExtraction: { status: "未配置" } });
    expect(queueFinalizedFactExtraction).not.toHaveBeenCalled();

    await saveApiKey("secret");
    const finalized = handlers.get("transitionChapter")!(
      "project-1",
      chapter.id,
      "已定稿",
    );

    expect(finalized).toMatchObject({
      chapter: { id: chapter.id, status: "已定稿" },
      ledgerExtraction: { status: "排队中", candidateCount: 0 },
    });
    expect(queueFinalizedFactExtraction).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: chapter.id, status: "已定稿" }),
    );
  });

  it("compiles chapter context with relevant facts from the database", () => {
    const { dependencies, handlers, database, compileContext } =
      createDependencies();
    registerAiHandlers(dependencies);

    expect(handlers.get("compileContext")!("project-1", chapter.id)).toEqual({
      estimatedTokens: 123,
    });
    expect(database.getProject).toHaveBeenCalledWith("project-1");
    expect(database.getProjectOverview).not.toHaveBeenCalled();
    expect(database.searchRelevantFacts).toHaveBeenCalledWith(
      "project-1",
      `${chapter.title} ${chapter.outline}`,
      chapter.number,
    );
    expect(compileContext).toHaveBeenCalledWith(
      planningProject,
      chapter,
      [existingFact],
    );
  });

  it("rejects context compilation when the chapter is missing", () => {
    const { dependencies, handlers, database, compileContext } =
      createDependencies();
    database.getProject.mockReturnValue({
      ...planningProject,
      chapters: [],
    });
    registerAiHandlers(dependencies);

    expect(() =>
      handlers.get("compileContext")!("project-1", "missing-chapter"),
    ).toThrow("章节不存在");
    expect(database.searchRelevantFacts).not.toHaveBeenCalled();
    expect(compileContext).not.toHaveBeenCalled();
  });

  it("rejects fact extraction before search and AI when content is blank", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    database.getChapter.mockReturnValue({ ...chapter, content: " \n\t" });
    registerAiHandlers(dependencies);

    await expect(
      handlers.get("extractChapterFacts")!("project-1", chapter.id),
    ).rejects.toThrow("章节还没有正文");
    expect(database.getProjectOverview).toHaveBeenCalledWith("project-1");
    expect(database.getChapter).toHaveBeenCalledWith(
      "project-1",
      chapter.id,
    );
    expect(database.searchRelevantFacts).not.toHaveBeenCalled();
    expect(ai.extractChapterFacts).not.toHaveBeenCalled();
    expect(database.saveFact).not.toHaveBeenCalled();
  });

  it("extracts and saves only facts that are new to the project and batch", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerAiHandlers(dependencies);
    const contentChapter = { ...chapter, content: "甲".repeat(4_001) };
    const unrelatedFact = {
      ...existingFact,
      id: "fact-unrelated",
      subject: "顾晴",
      predicate: "身份",
      value: "记者",
    };
    const projectOverview = {
      ...planningProject,
      facts: [existingFact, unrelatedFact],
    };
    const newFact = {
      ...existingFact,
      id: "fact-new",
      predicate: "行动",
      value: "返回旧城",
    };
    const savedFact = {
      ...newFact,
      id: "fact-saved",
      updatedAt: "2026-07-31T01:00:00.000Z",
    };
    database.getProjectOverview.mockReturnValue(projectOverview);
    database.getChapter.mockReturnValue(contentChapter);
    database.saveFact.mockReturnValue(savedFact);
    ai.extractChapterFacts.mockResolvedValue([
      existingFact,
      unrelatedFact,
      newFact,
      { ...newFact, id: "fact-duplicate" },
    ]);

    await expect(
      handlers.get("extractChapterFacts")!("project-1", chapter.id),
    ).resolves.toEqual([savedFact]);
    expect(database.getProjectOverview).toHaveBeenCalledWith("project-1");
    expect(database.getChapter).toHaveBeenCalledWith(
      "project-1",
      chapter.id,
    );
    expect(database.searchRelevantFacts).toHaveBeenCalledWith(
      "project-1",
      `${chapter.title}\n${chapter.outline}\n${"甲".repeat(4_000)}`,
      chapter.number,
      40,
    );
    expect(ai.extractChapterFacts).toHaveBeenCalledWith(
      { ...projectOverview, facts: [existingFact] },
      contentChapter,
    );
    expect(database.saveFact).toHaveBeenCalledTimes(1);
    expect(database.saveFact).toHaveBeenCalledWith("project-1", newFact);
    expect(database.getProject).not.toHaveBeenCalled();
  });

  it("generates concepts from linked insights and matching non-baseline opportunities", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerAiHandlers(dependencies);

    await handlers.get("generateConcepts")!("project-1");

    expect(database.getInsights).toHaveBeenCalledWith(["insight-1"]);
    expect(ai.generateConcepts).toHaveBeenCalledWith(
      planningProject,
      [insight],
      [
        expect.objectContaining({
          categoryKey: "男频:262",
          evidenceLevel: "暂定",
          snapshots: 2,
        }),
      ],
    );
  });

  it("persists streamed planning batches and returns their saved records", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerAiHandlers(dependencies);
    const generatedChapter = {
      ...chapter,
      id: "chapter-3",
      number: 3,
      title: "新章纲",
    };
    const generatedPlan = { ...plan, id: "plan-3", title: "新粗纲" };
    ai.generatePlanning.mockImplementation(
      async (_project, input, onChapterBatch) => {
        expect(input).toEqual({
          mode: "后续章纲",
          chapterCount: 10,
          fromChapter: 3,
        });
        const batch = {
          startChapter: 3,
          plans: [generatedPlan],
          chapters: [generatedChapter],
        };
        await onChapterBatch?.(batch);
        return batch;
      },
    );

    const result = await handlers.get("generatePlanningDraft")!(
      "project-1",
      { mode: "后续章纲", chapterCount: 10 },
    );

    expect(database.savePlan).toHaveBeenCalledWith("project-1", generatedPlan);
    expect(database.saveChapter).toHaveBeenCalledWith(
      "project-1",
      generatedChapter,
    );
    expect(result).toEqual({
      startChapter: 3,
      plans: [generatedPlan],
      chapters: [generatedChapter],
    });
  });

  it("rejects a planning range that would overwrite an existing chapter", async () => {
    const { dependencies, handlers, ai } = createDependencies();
    registerAiHandlers(dependencies);

    await expect(
      handlers.get("generatePlanningDraft")!("project-1", {
        mode: "后续章纲",
        fromChapter: 2,
        chapterCount: 10,
      }),
    ).rejects.toThrow("第2–11章范围内已有章节");
    expect(ai.generatePlanning).not.toHaveBeenCalled();
  });

  it("applies planning repairs without replacing fields with undefined", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerAiHandlers(dependencies);

    const result = handlers.get("applyPlanningRepairs")!("project-1", {
      plans: [
        {
          targetId: plan.id,
          after: {
            title: "新粗纲",
            goal: "新目标",
            conflict: "新冲突",
            outcome: "新结果",
            targetWords: 25_000,
          },
        },
      ],
      chapters: [
        {
          targetId: chapter.id,
          after: {
            title: "新标题",
            outline: "新章纲",
            chapterFunction: undefined,
            targetWords: 2_500,
            chapterPromise: "承诺",
            expectedPayoff: "回报",
            crisis: "危机",
            endingExpectation: "期待",
            expectationTargetChapter: 5,
          },
        },
      ],
    });

    expect(database.saveChapter).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        id: chapter.id,
        title: "新标题",
        batchMode: chapter.batchMode,
      }),
    );
    expect(database.saveChapter.mock.calls[0][1]).not.toHaveProperty(
      "chapterFunction",
    );
    expect(result).toEqual({
      appliedPlanIds: [plan.id],
      appliedChapterIds: [chapter.id],
    });
  });

  it("persists a supplied credential before reporting masked settings", async () => {
    const { dependencies, handlers, database, saveApiKey } =
      createDependencies();
    registerAiHandlers(dependencies);

    expect(handlers.get("getAiSettings")!()).toMatchObject({
      hasApiKey: false,
    });
    const saved = await handlers.get("saveAiSettings")!(settings, "secret");

    expect(saveApiKey).toHaveBeenCalledWith("secret");
    expect(database.saveAiSettings).toHaveBeenCalledWith(settings);
    expect(saved).toMatchObject({ ...settings, hasApiKey: true });
  });

  it("returns the new retry job immediately and logs later failure", async () => {
    const completion = Promise.reject(new Error("retry failed"));
    const {
      dependencies,
      handlers,
      startChapterRetry,
      logRetryFailure,
      retryJob,
    } = createDependencies(completion);
    registerAiHandlers(dependencies);

    await expect(handlers.get("retryAiJob")!("source")).resolves.toBe(
      retryJob,
    );
    expect(startChapterRetry).toHaveBeenCalledWith("project-1", "chapter-2");
    await Promise.resolve();
    expect(logRetryFailure).toHaveBeenCalledWith({
      sourceJobId: "source",
      retryJobId: "retry",
      projectId: "project-1",
      chapterId: "chapter-2",
      error: "retry failed",
    });
  });
});
