import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import type { RankingAnalytics, RankingEntry, RankingSnapshot } from "../src/shared/types";

function parseCompactNumber(value: string) {
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*(万)?\s*字?/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
}

export async function capturePublicRankingPage(url: string, listName: string): Promise<RankingSnapshot> {
  const capturedAt = new Date().toISOString();
  const snapshotId = randomUUID();
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new Error("公开页 URL 无效"); }
  if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("只允许访问 HTTP 或 HTTPS 公开页面");
  try {
    const response = await fetch(parsedUrl, {
      redirect: "follow",
      headers: { "User-Agent": "NovelStudio/0.1 public-metadata-reader", Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`公开页返回 HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 5_000_000) throw new Error("公开页超过 5MB 安全限制");
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error("公开页超过 5MB 安全限制");
    const $ = load(html);
    const entries: RankingEntry[] = [];
    const seen = new Set<string>();
    $('a[href*="/page/"], a[href*="/reader/"], a[href*="/book/"]').each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr("href") ?? "";
      const title = (anchor.attr("title") || anchor.find("[class*=title]").first().text() || anchor.text()).replace(/\s+/g, " ").trim();
      if (!title || title.length > 80 || seen.has(href || title)) return;
      const container = anchor.closest("li, article, [class*=book], [class*=rank], [class*=item]");
      const context = (container.length ? container.text() : anchor.parent().text()).replace(/\s+/g, " ").trim();
      if (context.length < title.length) return;
      const rankText = container.find("[class*=rank], [class*=index], [class*=order]").first().text();
      const author = container.find("[class*=author], [class*=writer]").first().text().replace(/\s+/g, " ").trim() || "未知";
      const wordsText = context.match(/[0-9]+(?:\.[0-9]+)?\s*万?\s*字/)?.[0] ?? "";
      const status = /完结|已完本/.test(context) ? "完结" : /连载/.test(context) ? "连载" : "未知";
      seen.add(href || title);
      entries.push({
        id: randomUUID(), snapshotId, rank: Number(rankText.match(/\d+/)?.[0]) || entries.length + 1,
        title, author, genre: "待校对", words: parseCompactNumber(wordsText), status, tags: [],
        sourceUrl: new URL(href, parsedUrl).toString(),
      });
    });
    if (!entries.length) throw new Error("页面中未识别到公开书目；请改用 CSV 导入或更新页面适配器");
    return { id: snapshotId, source: parsedUrl.hostname, listName, capturedAt, status: "成功", error: null, entries };
  } catch (error) {
    return { id: snapshotId, source: parsedUrl.hostname, listName, capturedAt, status: "失败", error: error instanceof Error ? error.message : String(error), entries: [] };
  }
}

export function analyzeRankings(snapshots: RankingSnapshot[]): RankingAnalytics {
  const successful = snapshots.filter((snapshot) => snapshot.entries.length > 0).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const entries = successful.flatMap((snapshot) => snapshot.entries);
  const countBy = (values: string[]) => [...values.reduce((map, value) => map.set(value || "未知", (map.get(value || "未知") ?? 0) + 1), new Map<string, number>())]
    .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const bands = entries.map((entry) => entry.words === 0 ? "未知" : entry.words < 300000 ? "30万以下" : entry.words < 1000000 ? "30–100万" : entry.words < 2000000 ? "100–200万" : "200万以上");
  const latest = successful.at(-1);
  const previous = successful.at(-2);
  const identity = (entry: RankingEntry) => `${entry.title}::${entry.author}`;
  const previousMap = new Map(previous?.entries.map((entry) => [identity(entry), entry]) ?? []);
  const latestKeys = new Set(latest?.entries.map(identity) ?? []);
  const newEntrants = latest?.entries.filter((entry) => !previousMap.has(identity(entry))).map((entry) => entry.title) ?? [];
  const movers = (latest?.entries ?? []).flatMap((entry) => {
    const before = previousMap.get(identity(entry));
    return before ? [{ title: entry.title, from: before.rank, to: entry.rank, change: before.rank - entry.rank }] : [];
  }).filter((item) => item.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const appearances = new Map<string, { title: string; snapshots: number }>();
  for (const snapshot of successful) {
    const once = new Set<string>();
    for (const entry of snapshot.entries) {
      const itemKey = identity(entry);
      if (once.has(itemKey)) continue;
      once.add(itemKey);
      const current = appearances.get(itemKey) ?? { title: entry.title, snapshots: 0 };
      current.snapshots += 1; appearances.set(itemKey, current);
    }
  }
  const range = successful.length ? `${successful[0].capturedAt.slice(0, 10)} 至 ${successful.at(-1)!.capturedAt.slice(0, 10)}` : "暂无数据";
  return {
    snapshotCount: successful.length, sampleSize: entries.length, timeRange: range,
    confidence: successful.length >= 7 && entries.length >= 100 ? "高" : successful.length >= 2 && entries.length >= 20 ? "中" : "低",
    genreDistribution: countBy(entries.map((entry) => entry.genre)), wordBands: countBy(bands), statusDistribution: countBy(entries.map((entry) => entry.status)),
    newEntrants, movers, continuousAppearances: [...appearances.values()].filter((item) => item.snapshots > 1).sort((a, b) => b.snapshots - a.snapshots),
  };
}
