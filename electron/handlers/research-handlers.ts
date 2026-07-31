import { randomUUID } from "node:crypto";
import path from "node:path";
import Papa from "papaparse";
import type {
  AppApi,
  ImportPreview,
  InsightPack,
  RankingSnapshot,
  ResearchBook,
} from "../../src/shared/types";
import {
  completeRankingSchedule,
  failRankingSchedule,
  nextRankingRun,
} from "../../src/shared/ranking-schedule";
import { assertLocalResearchImportRights } from "../../src/shared/research-import-service";
import type { AiService } from "../ai-service";
import { now, type WorkspaceDatabase } from "../database";
import {
  analyzeRankings,
  captureFanqieOpeningSample,
  capturePublicRankingPage,
} from "../ranking-service";
import type { BackgroundWorker } from "../worker-client";
import type { RegisterHandler } from "./types";

type ResearchDatabase = Pick<
  WorkspaceDatabase,
  | "deleteRankingSchedule"
  | "getResearchBook"
  | "listInsights"
  | "listRankingSchedules"
  | "listRankings"
  | "listResearchAnalyses"
  | "listResearchBooks"
  | "saveInsight"
  | "saveRanking"
  | "saveRankingSchedule"
  | "saveResearchAnalyses"
  | "saveResearchBook"
  | "updateResearchBook"
>;

export interface ResearchHandlerDependencies {
  register: RegisterHandler;
  database: ResearchDatabase;
  ai: Pick<AiService, "deconstruct">;
  worker: Pick<BackgroundWorker, "run">;
  chooseResearchFile: () => Promise<string | null>;
}

export interface ResearchHandlerRuntime {
  runDueRankingSchedules: () => Promise<void>;
}

function value(row: Record<string, string>, keys: string[], fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return fallback;
}

function parseNumber(raw: string) {
  const numeric = Number(String(raw).replace(/[,，万]/g, ""));
  if (String(raw).includes("万")) return Math.round(numeric * 10_000);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseRankingCsv(
  csvText: string,
  listName: string,
): RankingSnapshot {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length && !parsed.data.length)
    throw new Error(parsed.errors[0].message);
  const id = randomUUID();
  return {
    id,
    source: "CSV 手动导入",
    listName,
    capturedAt: now(),
    status: parsed.errors.length ? "部分成功" : "成功",
    error: parsed.errors.length
      ? parsed.errors.map((error) => error.message).join("；")
      : null,
    entries: parsed.data.map((row, index) => ({
      id: randomUUID(),
      snapshotId: id,
      rank: parseNumber(value(row, ["排名", "rank"], String(index + 1))),
      title: value(row, ["书名", "title"], "未命名"),
      author: value(row, ["作者", "author"], "未知"),
      genre: value(row, ["题材", "分类", "genre"], "未分类"),
      words: parseNumber(value(row, ["字数", "words"])),
      status: value(row, ["状态", "status"], "未知"),
      tags: value(row, ["标签", "tags"])
        .split(/[、,，]/)
        .filter(Boolean),
      sourceUrl: value(row, ["链接", "url", "sourceUrl"]),
    })),
  };
}

export function registerResearchHandlers({
  register,
  database,
  ai,
  worker,
  chooseResearchFile,
}: ResearchHandlerDependencies): ResearchHandlerRuntime {
  const runRankingSchedule = async (id: string) => {
    const schedule = database
      .listRankingSchedules()
      .find((item) => item.id === id);
    if (!schedule) throw new Error("定时采榜任务不存在");
    const snapshot = await capturePublicRankingPage(
      schedule.url,
      schedule.listName,
    );
    database.saveRanking(snapshot);
    database.saveRankingSchedule(completeRankingSchedule(schedule, snapshot));
    return snapshot;
  };

  const runDueRankingSchedules = async () => {
    const current = Date.now();
    for (const schedule of database.listRankingSchedules()) {
      if (!schedule.enabled || Date.parse(schedule.nextRunAt) > current)
        continue;
      try {
        await runRankingSchedule(schedule.id);
      } catch (error) {
        database.saveRankingSchedule(failRankingSchedule(schedule, error));
      }
    }
  };

  register("listRankings", () => database.listRankings());
  register("importRankingCsv", (csvText, listName) => {
    const snapshot = parseRankingCsv(csvText, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  register("capturePublicRanking", async (url, listName) => {
    const snapshot = await capturePublicRankingPage(url, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  register("listRankingSchedules", () => database.listRankingSchedules());
  register(
    "saveRankingSchedule",
    (input: Parameters<AppApi["saveRankingSchedule"]>[0]) => {
      const existing = input.id
        ? database
            .listRankingSchedules()
            .find((item) => item.id === input.id)
        : undefined;
      const restartCycle =
        !existing ||
        existing.frequency !== input.frequency ||
        (!existing.enabled && input.enabled);
      return database.saveRankingSchedule({
        id: input.id || randomUUID(),
        url: input.url,
        listName: input.listName,
        frequency: input.frequency,
        enabled: input.enabled,
        lastRunAt: existing?.lastRunAt ?? null,
        nextRunAt: restartCycle
          ? nextRankingRun(input.frequency)
          : existing.nextRunAt,
        lastStatus: existing?.lastStatus ?? "未运行",
        lastError: existing?.lastError ?? null,
      });
    },
  );
  register("runRankingSchedule", runRankingSchedule);
  register("deleteRankingSchedule", (id) =>
    database.deleteRankingSchedule(id),
  );
  register("getRankingAnalytics", () =>
    analyzeRankings(database.listRankings()),
  );
  register("listResearchBooks", () => database.listResearchBooks());
  register("previewResearchFile", async () => {
    const filePath = await chooseResearchFile();
    if (!filePath) return null;
    return worker.run<ImportPreview>("parse-document", { filePath });
  });
  register(
    "importResearchBook",
    (preview, genre, rightsConfirmed, cloudConsent) => {
      assertLocalResearchImportRights(rightsConfirmed);
      const book: ResearchBook = {
        id: randomUUID(),
        title: path.basename(preview.fileName, path.extname(preview.fileName)),
        author: "未标注",
        genre,
        sourceType: preview.sourceType,
        chapterCount: preview.chapters.length,
        wordCount: preview.totalWords,
        rightsConfirmed,
        cloudConsent,
        importedAt: now(),
        status: "待拆解",
      };
      database.saveResearchBook(book, preview.chapters);
      return book;
    },
  );
  register(
    "importPublicResearchSample",
    async (sourceUrl, genre, cloudConsent) => {
      const sample = await captureFanqieOpeningSample(sourceUrl);
      const book: ResearchBook = {
        id: randomUUID(),
        title: sample.title,
        author: sample.author,
        genre,
        sourceType: "公开试读",
        sourceUrl: sample.sourceUrl,
        sampleScope: `官方公开前 ${sample.chapters.length} 章，仅代表开篇样本`,
        chapterCount: sample.chapters.length,
        wordCount: sample.chapters.reduce(
          (sum, chapter) => sum + chapter.wordCount,
          0,
        ),
        rightsConfirmed: false,
        cloudConsent,
        importedAt: now(),
        status: "待拆解",
      };
      database.saveResearchBook(book, sample.chapters);
      return book;
    },
  );
  register("listInsights", () => database.listInsights());
  register("createInsight", (input) => {
    const insight: InsightPack = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
    };
    database.saveInsight(insight);
    return insight;
  });
  register("deconstructResearchBook", async (bookId) => {
    const source = database.getResearchBook(bookId);
    database.updateResearchBook({ ...source.book, status: "拆解中" });
    try {
      const result = await ai.deconstruct(source.book, source.chapters);
      database.saveInsight(result.insight);
      database.saveResearchAnalyses(result.analyses);
      database.updateResearchBook({ ...source.book, status: "已拆解" });
      return result.insight;
    } catch (error) {
      database.updateResearchBook({ ...source.book, status: "失败" });
      throw error;
    }
  });
  register("listResearchAnalyses", (bookId) =>
    database.listResearchAnalyses(bookId),
  );

  return { runDueRankingSchedules };
}
