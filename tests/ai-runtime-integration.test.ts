import { describe, expect, it, vi } from "vitest";
import type { ProfileRuntime } from "../electron/ai/profile-runtime";
import type { ResolvedAiRoute } from "../electron/ai/route-resolver";
import { AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { Chapter, ContextPackage, ProjectDetail } from "../src/shared/types";

const chapter = {
  id: "chapter-runtime",
  number: 1,
  title: "运行时",
  outline: "测试熔断",
  content: "林舟检查了门锁。",
  wordCount: 8,
  status: "待质检",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 1,
  updatedAt: new Date().toISOString(),
} satisfies Chapter;

const project = { summary: { id: "project-runtime", genre: "都市脑洞" } } as unknown as ProjectDetail;

const context = {
  contract: "",
  commercialGuidance: "",
  chapterIntent: "",
  expectationLedger: "",
  longTermMemory: "",
  volumeGoal: "",
  rollingOutline: "",
  recentSummary: "",
  relevantFacts: "",
  forbiddenKnowledge: "",
  authorStyle: "",
  estimatedTokens: 10,
} satisfies ContextPackage;

const route: ResolvedAiRoute = {
  profileId: "p-main",
  profileName: "主力",
  baseUrl: "https://api.example.com/v1",
  model: "gpt-5.1",
  apiKey: "secret",
  requiresKey: true,
  apiSurface: "openai-chat",
  authHeaders: {},
  extraHeaders: {},
  extraQuery: {},
  localEndpoint: false,
  legacyProviderKey: null,
};

function databaseFor(startAiJob = vi.fn(() => "job-runtime")) {
  return {
    getAiSettings: () => ({
      baseUrl: "https://api.example.com/v1",
      model: "gpt-5.1",
      embeddingModel: "test",
      hasApiKey: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    }),
    findAiJob: () => undefined,
    startAiJob,
    finishAiJob: vi.fn(),
  } as unknown as WorkspaceDatabase;
}

function runtimeSpy(overrides: Partial<ProfileRuntime> = {}): ProfileRuntime {
  return {
    assertReady: vi.fn(),
    acquire: vi.fn(async () => () => undefined),
    noteSuccess: vi.fn(),
    noteFailure: vi.fn(),
    snapshot: vi.fn(() => []),
    ...overrides,
  };
}

function createService(database: WorkspaceDatabase, runtime: ProfileRuntime, timeoutMs = 120_000) {
  return new AiService(
    database,
    () => "secret",
    timeoutMs,
    0,
    () => undefined,
    () => route,
    undefined,
    runtime,
  );
}

describe("来源运行时接入", () => {
  it("熔断中的来源在创建任务前就被拒绝", async () => {
    const startAiJob = vi.fn(() => "job-runtime");
    const runtime = runtimeSpy({
      assertReady: vi.fn(() => {
        throw new Error("来源「主力」连续失败已暂停服务");
      }),
    });

    await expect(
      createService(databaseFor(startAiJob), runtime).reviewChapter(project, chapter, context),
    ).rejects.toThrow(/暂停服务/);
    expect(startAiJob).not.toHaveBeenCalled();
  });

  it("请求成功时记录成功并释放并发槽位", async () => {
    const release = vi.fn();
    const runtime = runtimeSpy({ acquire: vi.fn(async () => release) });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await createService(databaseFor(), runtime).reviewChapter(project, chapter, context);

    expect(runtime.acquire).toHaveBeenCalledWith("p-main", "主力", expect.any(AbortSignal));
    expect(runtime.noteSuccess).toHaveBeenCalledWith("p-main");
    expect(runtime.noteFailure).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("可重试失败耗尽后记入熔断计数", async () => {
    const runtime = runtimeSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 })),
    );

    await expect(createService(databaseFor(), runtime, 30).reviewChapter(project, chapter, context)).rejects.toThrow();

    expect(runtime.noteFailure).toHaveBeenCalledWith("p-main", "主力", true);
    expect(runtime.noteSuccess).not.toHaveBeenCalled();
  });
});
