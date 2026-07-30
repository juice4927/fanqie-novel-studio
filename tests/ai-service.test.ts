import { afterEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { Chapter, ContextPackage, ProjectDetail, ResearchBook } from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());

describe("AI request timeout", () => {
  it("aborts a hung request and records the failed job", async () => {
    const finished: Array<{ output: string; error?: string }> = [];
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined,
      startAiJob: () => "job-1",
      finishAiJob: (_id: string, output: string, error?: string) => finished.push({ output, error }),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const service = new AiService(database, () => "secret", 10);
    const book: ResearchBook = {
      id: "book", title: "测试书", author: "作者", genre: "都市脑洞", sourceType: "TXT",
      chapterCount: 1, wordCount: 1000, rightsConfirmed: true, cloudConsent: true,
      importedAt: new Date().toISOString(), status: "待拆解",
    };

    await expect(service.deconstruct(book, [{ ordinal: 1, title: "第一章", content: "沈砚走进云港市。".repeat(100), wordCount: 900 }]))
      .rejects.toThrow("模型请求超时");
    expect(finished).toEqual([{ output: "", error: expect.stringContaining("模型请求超时") }]);
  });
});

describe("semantic quality review", () => {
  it("maps evidence-backed model findings to auditable quality issues", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined,
      startAiJob: () => "job-quality",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ severity: "硬性", category: "知识边界", message: "角色使用了尚未知晓的信息", evidence: "林舟直接说出了密码" }] }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-3", number: 3, title: "错误的密码", outline: "目标：进入机房", content: "林舟直接说出了密码。", wordCount: 10,
      status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = { contract: "", commercialGuidance: "", chapterIntent: "", expectationLedger: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "密码仅反派知晓", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;

    const issues = await service.reviewChapter(project, chapter, context);

    expect(issues).toMatchObject([{ projectId: "project-1", chapterId: "chapter-3", severity: "硬性", category: "知识边界", status: "待处理" }]);
    expect(issues[0].id).toBeTruthy();
  });

  it("does not let unsupported model claims become hard gates", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-unsupported", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ severity: "硬性", category: "设定冲突", message: "模型推测出的冲突", evidence: "正文和账本中不存在的句子" }] }) } }] }), { status: 200 })));
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-4", number: 4, title: "正常章节", outline: "目标：继续调查", content: "林舟检查了门锁。", wordCount: 8, status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString() } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = { contract: "", commercialGuidance: "", chapterIntent: "", expectationLedger: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;

    expect((await service.reviewChapter(project, chapter, context))[0].severity).toBe("警告");
  });
});
