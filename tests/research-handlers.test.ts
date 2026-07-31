import { describe, expect, it, vi } from "vitest";
import {
  registerResearchHandlers,
  type ResearchHandlerDependencies,
} from "../electron/handlers/research-handlers";
import type { RegisterHandler } from "../electron/handlers/types";
import type { ImportPreview, RankingSnapshot } from "../src/shared/types";

function createDependencies() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    handlers.set(channel, callback);
  };
  const workerRun = vi.fn(async () => ({
    fileName: "sample.txt",
    sourceType: "TXT",
    detectedEncoding: "UTF-8",
    chapters: [],
    totalWords: 0,
    warnings: [],
  } satisfies ImportPreview));
  const database = {
    deleteRankingSchedule: vi.fn(),
    getResearchBook: vi.fn(),
    listInsights: vi.fn(() => []),
    listRankingSchedules: vi.fn(() => []),
    listRankings: vi.fn(() => []),
    listResearchAnalyses: vi.fn(() => []),
    listResearchBooks: vi.fn(() => []),
    saveInsight: vi.fn(),
    saveRanking: vi.fn(),
    saveRankingSchedule: vi.fn((schedule) => schedule),
    saveResearchAnalyses: vi.fn(),
    saveResearchBook: vi.fn(),
    updateResearchBook: vi.fn(),
  };
  const dependencies = {
    register,
    database,
    ai: { deconstruct: vi.fn() },
    worker: { run: workerRun },
    chooseResearchFile: vi.fn(async () => "C:/samples/sample.txt"),
  } as unknown as ResearchHandlerDependencies;
  return { dependencies, handlers, workerRun, database };
}

describe("research handlers", () => {
  it("parses quoted CSV fields, Chinese word units, tags, and source links", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerResearchHandlers(dependencies);
    const snapshot = handlers.get("importRankingCsv")!(
      [
        "排名,书名,作者,题材,字数,状态,标签,链接",
        '1,"城,市回声",林舟,都市脑洞,1.2万,连载,"悬疑,成长",https://example.com/book',
      ].join("\n"),
      "测试榜",
    ) as RankingSnapshot;

    expect(snapshot).toMatchObject({
      source: "CSV 手动导入",
      listName: "测试榜",
      status: "成功",
      entries: [{
        rank: 1,
        title: "城,市回声",
        author: "林舟",
        genre: "都市脑洞",
        words: 12_000,
        status: "连载",
        tags: ["悬疑", "成长"],
        sourceUrl: "https://example.com/book",
      }],
    });
    expect(snapshot.entries[0].snapshotId).toBe(snapshot.id);
    expect(database.saveRanking).toHaveBeenCalledWith(snapshot);
  });

  it("registers the complete research surface and delegates file parsing", async () => {
    const { dependencies, handlers, workerRun } = createDependencies();
    registerResearchHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "capturePublicRanking",
      "createInsight",
      "deconstructResearchBook",
      "deleteRankingSchedule",
      "getRankingAnalytics",
      "importPublicResearchSample",
      "importRankingCsv",
      "importResearchBook",
      "listInsights",
      "listRankingSchedules",
      "listRankings",
      "listResearchAnalyses",
      "listResearchBooks",
      "previewResearchFile",
      "runRankingSchedule",
      "saveRankingSchedule",
    ]);

    await handlers.get("previewResearchFile")!();
    expect(workerRun).toHaveBeenCalledWith("parse-document", {
      filePath: "C:/samples/sample.txt",
    });
  });

  it("keeps the local research import behind explicit rights confirmation", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerResearchHandlers(dependencies);
    const preview = {
      fileName: "sample.txt",
      sourceType: "TXT",
      detectedEncoding: "UTF-8",
      chapters: [],
      totalWords: 0,
      warnings: [],
    } satisfies ImportPreview;

    expect(() =>
      handlers.get("importResearchBook")!(
        preview,
        "都市脑洞",
        false,
        false,
      ),
    ).toThrow("必须确认拥有材料的合法使用权");
    expect(database.saveResearchBook).not.toHaveBeenCalled();
  });

  it("does not require cloud consent for an authorized local import", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerResearchHandlers(dependencies);
    const preview = {
      fileName: "sample.txt",
      sourceType: "TXT",
      detectedEncoding: "UTF-8",
      chapters: [],
      totalWords: 0,
      warnings: [],
    } satisfies ImportPreview;

    const imported = handlers.get("importResearchBook")!(
      preview,
      "都市脑洞",
      true,
      false,
    );

    expect(imported).toMatchObject({
      title: "sample",
      rightsConfirmed: true,
      cloudConsent: false,
      status: "待拆解",
    });
    expect(database.saveResearchBook).toHaveBeenCalledWith(imported, []);
  });
});
