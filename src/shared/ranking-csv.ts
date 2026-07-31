import Papa from "papaparse";
import type { RankingSnapshot } from "./types";

interface ParseRankingCsvOptions {
  createId: () => string;
  capturedAt: string;
}

function value(
  row: Record<string, string>,
  keys: string[],
  fallback = "",
): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return fallback;
}

function parseNumber(raw: string): number {
  const numeric = Number(String(raw).replace(/[,，万]/g, ""));
  if (String(raw).includes("万")) return Math.round(numeric * 10_000);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseRankingCsv(
  csvText: string,
  listName: string,
  options: ParseRankingCsvOptions,
): RankingSnapshot {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0].message);
  }

  const snapshotId = options.createId();
  return {
    id: snapshotId,
    source: "CSV 手动导入",
    listName,
    capturedAt: options.capturedAt,
    status: parsed.errors.length ? "部分成功" : "成功",
    error: parsed.errors.length
      ? parsed.errors.map((error) => error.message).join("；")
      : null,
    entries: parsed.data.map((row, index) => ({
      id: options.createId(),
      snapshotId,
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
