import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import type { MarketOpportunity, RankingAnalytics, RankingEntry, RankingSnapshot } from "../src/shared/types";
import { FANQIE_CATEGORY_PROFILES } from "../src/shared/fanqie-taxonomy";

function parseCompactNumber(value: string) {
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*(万)?\s*字?/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const PUBLIC_PAGE_LIMIT = 5_000_000;
const FANQIE_BOOK_LIMIT = 20;
const FANQIE_CONCURRENCY = 4;

async function fetchPublicHtml(url: URL) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "NovelStudio/0.1 public-metadata-reader",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`公开页返回 HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > PUBLIC_PAGE_LIMIT) throw new Error("公开页超过 5MB 安全限制");
  const html = await response.text();
  if (html.length > PUBLIC_PAGE_LIMIT) throw new Error("公开页超过 5MB 安全限制");
  return html;
}

function fanqieBookTitle($: ReturnType<typeof load>) {
  const heading = clean($("h1").first().text());
  if (heading) return heading;
  return clean($("title").text()).split("完整版在线免费阅读")[0];
}

export function parseFanqieDetailPage(
  html: string,
  detailUrl: URL,
  snapshotId: string,
  rank: number,
  officialReaderUrl?: string,
): RankingEntry {
  const $ = load(html);
  const title = fanqieBookTitle($);
  if (!title) throw new Error("详情页缺少书名");
  const labels = $(".info-label span")
    .map((_index, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const status = labels.find((label) => /完结|连载/.test(label)) ?? "未知";
  const tags = labels.filter((label) => label !== status);
  const wordsText = clean($(".info-count-word").first().text());
  const description = clean($('meta[name="description"]').attr("content") ?? "");
  const synopsis = description
    .replace(new RegExp(`^番茄小说提供${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}完整版在线免费阅读，精彩小说尽在番茄小说网。`), "")
    .trim();
  const readerHref = $("a[href*='/reader/']").first().attr("href");
  return {
    id: randomUUID(),
    snapshotId,
    rank,
    title,
    author: clean($(".author-name-text").first().text()) || clean($(".author-name").first().text()) || "未知",
    genre: tags[0] ?? "待校对",
    words: parseCompactNumber(wordsText),
    status,
    tags,
    sourceUrl: detailUrl.toString(),
    synopsis,
    officialReaderUrl: officialReaderUrl || (readerHref ? new URL(readerHref, detailUrl).toString() : undefined),
    platform: "番茄小说",
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function parseFanqieRanking($: ReturnType<typeof load>, parsedUrl: URL, snapshotId: string) {
  const books: Array<{ detailUrl: URL; readerUrl?: string }> = [];
  const seen = new Set<string>();
  $('a[href*="/page/"]').each((_index, element) => {
    if (books.length >= FANQIE_BOOK_LIMIT) return;
    const href = $(element).attr("href");
    if (!href) return;
    const detailUrl = new URL(href, parsedUrl);
    if (seen.has(detailUrl.toString())) return;
    seen.add(detailUrl.toString());
    const container = $(element).closest("li, article, [class*=book], [class*=rank], [class*=item]");
    const readerHref = container.find('a[href*="/reader/"]').first().attr("href");
    books.push({ detailUrl, readerUrl: readerHref ? new URL(readerHref, parsedUrl).toString() : undefined });
  });
  if (!books.length) throw new Error("番茄榜单页中未识别到公开书籍链接");
  const failures: string[] = [];
  const entries = await mapWithConcurrency(books, FANQIE_CONCURRENCY, async (book, index) => {
    try {
      const html = await fetchPublicHtml(book.detailUrl);
      return parseFanqieDetailPage(html, book.detailUrl, snapshotId, index + 1, book.readerUrl);
    } catch (error) {
      failures.push(`第 ${index + 1} 本：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  return { entries: entries.filter((entry): entry is RankingEntry => entry !== null), failures };
}

function parseZongheng($: ReturnType<typeof load>, parsedUrl: URL, snapshotId: string): RankingEntry[] {
  const entries: RankingEntry[] = [];
  const seen = new Set<string>();
  $(".zh-modules-rank-book").each((_index, element) => {
    const container = $(element);
    const anchor = container.find('a[href*="/detail/"]').filter((_i, item) => clean($(item).text()).length > 0).first();
    const href = anchor.attr("href") ?? "";
    const title = clean(anchor.attr("title") || anchor.text());
    if (!title || seen.has(href || title)) return;
    seen.add(href || title);
    const authorLinks = container.find("a.global-hover").filter((_i, item) => clean($(item).text()) !== title);
    const context = clean(container.text());
    entries.push({
      id: randomUUID(), snapshotId, rank: entries.length + 1, title,
      author: clean(authorLinks.first().text()) || "未知", genre: "待校对",
      words: parseCompactNumber(context.match(/[0-9]+(?:\.[0-9]+)?\s*万\s*字/)?.[0] ?? ""),
      status: /完结|已完本/.test(context) ? "完结" : /连载/.test(context) ? "连载" : "未知",
      tags: [], sourceUrl: new URL(href, parsedUrl).toString(),
    });
  });
  return entries;
}

export async function capturePublicRankingPage(url: string, listName: string): Promise<RankingSnapshot> {
  const capturedAt = new Date().toISOString();
  const snapshotId = randomUUID();
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new Error("公开页 URL 无效"); }
  if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("只允许访问 HTTP 或 HTTPS 公开页面");
  try {
    const html = await fetchPublicHtml(parsedUrl);
    const $ = load(html);
    if (parsedUrl.hostname === "fanqienovel.com" || parsedUrl.hostname.endsWith(".fanqienovel.com")) {
      const { entries, failures } = await parseFanqieRanking($, parsedUrl, snapshotId);
      if (!entries.length) throw new Error(`番茄详情元数据采集失败：${failures.join("；")}`);
      return {
        id: snapshotId,
        source: "番茄小说官网",
        listName,
        capturedAt,
        status: failures.length ? "部分成功" : "成功",
        error: failures.length ? `${failures.length} 本详情采集失败；其余书目已保存` : null,
        entries,
      };
    }
    const adaptedEntries = parsedUrl.hostname.endsWith("zongheng.com") ? parseZongheng($, parsedUrl, snapshotId) : [];
    if (adaptedEntries.length) return { id: snapshotId, source: parsedUrl.hostname, listName, capturedAt, status: "成功", error: null, entries: adaptedEntries };
    const entries: RankingEntry[] = [];
    const seen = new Set<string>();
    $('a[href*="/page/"], a[href*="/reader/"], a[href*="/book/"]').each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr("href") ?? "";
      const title = clean(anchor.attr("title") || anchor.find("[class*=title]").first().text() || anchor.text());
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
  const identity = (entry: RankingEntry) => `${entry.title}::${entry.author}`;
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
  const profileForList = (listName: string) => {
    const profile = FANQIE_CATEGORY_PROFILES.find((item) => listName.includes(item.channel) && listName.includes(item.name));
    return profile;
  };
  const grouped = new Map<string, RankingSnapshot[]>();
  for (const snapshot of successful) {
    const list = grouped.get(snapshot.listName) ?? [];
    list.push(snapshot);
    grouped.set(snapshot.listName, list);
  }
  const comparableLists = [...grouped.values()].filter((list) => list.length >= 2);
  const newEntrants = comparableLists.flatMap((list) => {
    const latest = list.at(-1)!;
    const previousKeys = new Set(list.at(-2)!.entries.map(identity));
    return latest.entries.filter((entry) => !previousKeys.has(identity(entry))).map((entry) => entry.title);
  });
  const movers = comparableLists.flatMap((list) => {
    const latest = list.at(-1)!;
    const previousMap = new Map(list.at(-2)!.entries.map((entry) => [identity(entry), entry]));
    return latest.entries.flatMap((entry) => {
      const before = previousMap.get(identity(entry));
      return before ? [{ title: entry.title, from: before.rank, to: entry.rank, change: before.rank - entry.rank }] : [];
    });
  }).filter((item) => item.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const marketOpportunities: MarketOpportunity[] = [...grouped.entries()].map(([listName, list]) => {
    const latestSnapshot = list.at(-1)!;
    const previousSnapshot = list.at(-2);
    const latestEntries = latestSnapshot.entries;
    const previousEntries = previousSnapshot?.entries ?? [];
    const previousByIdentity = new Map(previousEntries.map((entry) => [identity(entry), entry]));
    const newRate = previousEntries.length ? latestEntries.filter((entry) => !previousByIdentity.has(identity(entry))).length / latestEntries.length : 0;
    const changes = latestEntries.flatMap((entry) => {
      const before = previousByIdentity.get(identity(entry));
      return before ? [before.rank - entry.rank] : [];
    });
    const averageRankChange = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
    const previousIdentities = new Set(previousEntries.map(identity));
    const stabilityRate = latestEntries.length ? latestEntries.filter((entry) => previousIdentities.has(identity(entry))).length / latestEntries.length : 0;
    const competition: MarketOpportunity["competition"] = stabilityRate >= 0.7 ? "高" : stabilityRate >= 0.4 ? "中" : "低";
    const score = Math.round(Math.max(0, Math.min(100, 50 + newRate * 30 + Math.max(0, averageRankChange) * 4 - stabilityRate * 20 + (listName.includes("新书榜") ? 5 : 0))));
    const profile = profileForList(listName);
    const confidence: MarketOpportunity["confidence"] = list.length >= 7 ? "高" : list.length >= 3 ? "中" : "低";
    const recommendation = score >= 65
      ? `可作为${profile?.genre ?? "该题材"}候选方向：保留${profile?.coreFantasy ?? "题材核心幻想"}，用差异化主角、冲突发动机和开篇回报避开同质化。`
      : score >= 50
        ? `适合小规模验证：优先测试${profile?.openingFocus ?? "开篇承诺和首轮回报"}，连续采样后再决定是否扩张。`
        : "竞争或动能暂不突出，不建议仅凭单次榜单追热点。";
    return {
      listName,
      categoryKey: profile?.key,
      categoryName: profile?.name ?? listName,
      genre: profile?.genre ?? "都市脑洞",
      snapshots: list.length,
      latestSampleSize: latestEntries.length,
      newEntrantRate: Math.round(newRate * 100),
      averageRankChange: Math.round(averageRankChange * 10) / 10,
      stabilityRate: Math.round(stabilityRate * 100),
      competition,
      opportunityScore: score,
      confidence,
      recommendation,
    };
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);
  return {
    snapshotCount: successful.length, sampleSize: entries.length, timeRange: range,
    confidence: successful.length >= 7 && entries.length >= 100 ? "高" : successful.length >= 2 && entries.length >= 20 ? "中" : "低",
    genreDistribution: countBy(entries.map((entry) => entry.genre)), wordBands: countBy(bands), statusDistribution: countBy(entries.map((entry) => entry.status)),
    newEntrants, movers, continuousAppearances: [...appearances.values()].filter((item) => item.snapshots > 1).sort((a, b) => b.snapshots - a.snapshots),
    marketOpportunities,
  };
}
