import { describe, expect, it, vi } from "vitest";
import { AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { Chapter, ContextPackage, ProjectDetail } from "../src/shared/types";

const chapter = {
  id: "chapter-budget",
  number: 1,
  title: "预算测试",
  outline: "测试重试预算",
  content: "林舟检查了门锁。",
  wordCount: 8,
  status: "待质检",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 1,
  updatedAt: new Date().toISOString(),
} satisfies Chapter;

const project = { summary: { id: "project-budget", genre: "都市脑洞" } } as unknown as ProjectDetail;

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

function databaseFor(finishAiJob: ReturnType<typeof vi.fn>) {
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
    startAiJob: () => "job-budget",
    finishAiJob,
  } as unknown as WorkspaceDatabase;
}

const validReview = () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({ issues: [] }),
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const invalidReview = () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({ issues: "invalid" }),
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("重试与结构修复预算", () => {
  it("网络重试不会吃掉结构修复额度：两次 503 后仍可修复一次并成功", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(invalidReview())
      .mockResolvedValueOnce(validReview());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(databaseFor(vi.fn()), () => "secret").reviewChapter(project, chapter, context),
    ).resolves.toEqual({ issues: [], observations: [] });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 20_000);

  it("结构修复额度独立封顶：连续非法结构最多修复两次", async () => {
    const fetchMock = vi.fn(async () => invalidReview());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(databaseFor(vi.fn()), () => "secret").reviewChapter(project, chapter, context),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
