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
  PlanNode,
  ProjectDetail,
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

const planningProject = {
  summary: {
    id: "project-1",
    title: "旧城回声",
  },
  contract: { approved: true },
  plans: [plan],
  chapters: [chapter],
} as unknown as ProjectDetail;

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
    getProject: vi.fn(() => planningProject),
    listAiJobs: vi.fn(() => [sourceJob]),
    saveChapter: vi.fn((_id, next: Chapter) => next),
    saveAiSettings: vi.fn((next) => ({ ...next, hasApiKey: false })),
    savePlan: vi.fn((_id, next: PlanNode) => next),
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
  const dependencies = {
    register,
    database,
    ai: {
      cancelJob: vi.fn(() => true),
      generatePlanning: vi.fn(),
      reviewPlanning: vi.fn(),
    },
    getApiKey: () => apiKey,
    saveApiKey,
    startChapterRetry,
    logRetryFailure,
  } as unknown as AiHandlerDependencies;
  return {
    dependencies,
    handlers,
    database,
    ai: dependencies.ai,
    saveApiKey,
    startChapterRetry,
    logRetryFailure,
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
      "generatePlanningDraft",
      "getAiSettings",
      "listAiJobs",
      "retryAiJob",
      "reviewPlanning",
      "saveAiSettings",
    ]);
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
