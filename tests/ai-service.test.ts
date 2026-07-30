import { afterEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { ResearchBook } from "../src/shared/types";

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
