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
    listAiJobs: vi.fn(() => [sourceJob]),
    saveAiSettings: vi.fn((next) => ({ ...next, hasApiKey: false })),
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
    ai: { cancelJob: vi.fn(() => true) },
    getApiKey: () => apiKey,
    saveApiKey,
    startChapterRetry,
    logRetryFailure,
  } as unknown as AiHandlerDependencies;
  return {
    dependencies,
    handlers,
    database,
    saveApiKey,
    startChapterRetry,
    logRetryFailure,
    retryJob,
  };
}

describe("AI handlers", () => {
  it("registers the settings and job lifecycle surface", () => {
    const { dependencies, handlers } = createDependencies();
    registerAiHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "cancelAiJob",
      "getAiSettings",
      "listAiJobs",
      "retryAiJob",
      "saveAiSettings",
    ]);
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
