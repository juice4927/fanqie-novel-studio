import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { GENRES, type MarketOpportunity, type RankingAnalytics, type RankingEntry, type RankingSnapshot } from "../src/shared/types";
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
const FANQIE_OPENING_CHAPTER_LIMIT = 10;
const PUBLIC_PAGE_TIMEOUT_MS = 30_000;

// Fanqie's public reader uses a fixed Source Han Sans subset with remapped codepoints.
// Keep the mapping local so public chapter text is never sent to a third-party decoder.
const FANQIE_ENCODED_CHARS = "";
const FANQIE_DECODED_CHARS = "D在主特家军然表场4要只v和6别还g现儿岁此象月3出战工相o男直失世F都平文什VO将真T那当会立些u是十张学气大爱两命全后东性通被1它乐接而感车山公了常以何可话先pi叫轻M士w着变尔快l个说少色里安花远7难师放t报认面道S克地度I好机U民写把万同水新没书电吃像斯5为y白几日教看但第加候作上拉住有法r事应位利你声身国问马女他Y比父xAHNsX边美对所金活回意到z从j知又内因点Q三定8Rb正或夫向德听更得告并本q过记L让打f人就者去原满体做经K走如孩cG给使物最笑部员等受k行一条果动光门头见往自解成处天能于名其发总母的死手入路进心来h时力多开已许d至由很界n小与Z想代么分生口再妈望次西风种带J实情才这E我神格长觉间年眼无不亲关结0友信下却重己老2音字m呢明之前高PB目太e9起稜她也W用方子英每理便四数期中C外样a海们任";
const FANQIE_CHAR_MAP = new Map([...FANQIE_ENCODED_CHARS].map((char, index) => [char, [...FANQIE_DECODED_CHARS][index]]));

export interface PublicOpeningSample {
  title: string;
  author: string;
  sourceUrl: string;
  chapters: Array<{ title: string; content: string; wordCount: number }>;
}

export async function fetchPublicHtml(url: URL, options: { timeoutMs?: number; attempts?: number } = {}) {
  const attempts = Math.max(1, options.attempts ?? 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? PUBLIC_PAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "NovelStudio/0.1 public-metadata-reader",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) throw new Error(`公开页返回 HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > PUBLIC_PAGE_LIMIT) throw new Error("公开页超过 5MB 安全限制");
      if (!response.body) return "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let html = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > PUBLIC_PAGE_LIMIT) {
          controller.abort();
          throw new Error("公开页超过 5MB 安全限制");
        }
        html += decoder.decode(value, { stream: true });
      }
      return html + decoder.decode();
    } catch (error) {
      lastError = timedOut ? new Error(`公开页请求超时（${Math.ceil((options.timeoutMs ?? PUBLIC_PAGE_TIMEOUT_MS) / 1000)} 秒）`) : error;
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      if (/HTTP 4\d\d|超过 5MB/.test(message) || attempt === attempts - 1) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export function decodeFanqiePublicText(value: string) {
  return [...value].map((char) => FANQIE_CHAR_MAP.get(char) ?? char).join("");
}

function fanqieReaderState($: ReturnType<typeof load>) {
  const script = $("script").map((_index, element) => $(element).html() ?? "").get()
    .find((value) => value.includes("window.__INITIAL_STATE__="));
  const marker = "window.__INITIAL_STATE__=";
  const start = script ? script.indexOf(marker) + marker.length : -1;
  if (!script || start < marker.length) throw new Error("公开阅读页缺少章节状态");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < script.length; index += 1) {
    const char = script[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error("公开阅读页章节状态不完整");
  return JSON.parse(script.slice(start, end)) as {
    reader?: { chapterData?: { needPay?: number; order?: string; title?: string } };
  };
}

export async function captureFanqieOpeningSample(sourceUrl: string): Promise<PublicOpeningSample> {
  const detailUrl = new URL(sourceUrl);
  if (!(detailUrl.hostname === "fanqienovel.com" || detailUrl.hostname.endsWith(".fanqienovel.com")) || !detailUrl.pathname.startsWith("/page/"))
    throw new Error("只支持番茄小说官方详情页");
  const detailHtml = await fetchPublicHtml(detailUrl);
  const detail = load(detailHtml);
  const title = fanqieBookTitle(detail);
  if (!title) throw new Error("番茄详情页缺少书名");
  const author = clean(detail(".author-name-text").first().text()) || clean(detail(".author-name").first().text()) || "未知";
  const discoveredLinks = detail('a[href*="/reader/"]').map((_index, element) => {
    const label = clean(detail(element).text());
    const order = Number(label.match(/^第\s*(\d+)\s*章/)?.[1]);
    const href = detail(element).attr("href");
    return href && order >= 1 && order <= FANQIE_OPENING_CHAPTER_LIMIT
      ? { order, url: new URL(href, detailUrl) }
      : null;
  }).get().filter((item): item is { order: number; url: URL } => item !== null);
  const byOrder = new Map(discoveredLinks.map((item) => [item.order, item]));
  const links = Array.from({ length: FANQIE_OPENING_CHAPTER_LIMIT }, (_value, index) => byOrder.get(index + 1));
  if (links.some((item) => !item)) throw new Error("详情页未完整提供公开的前 10 章");

  const chapters = await mapWithConcurrency(links as Array<{ order: number; url: URL }>, 3, async ({ order, url }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const html = await fetchPublicHtml(url, { attempts: 1 });
        const page = load(html);
        const chapterData = fanqieReaderState(page).reader?.chapterData;
        if (!chapterData || Number(chapterData.needPay ?? 1) !== 0)
          throw new Error(`第 ${order} 章需要登录或付费，已停止读取`);
        if (Number(chapterData.order) !== order) throw new Error(`第 ${order} 章返回了不一致的章节序号`);
        const paragraphs = page(".muye-reader-content p").map((_index, element) => clean(page(element).text())).get().filter(Boolean);
        const content = decodeFanqiePublicText(paragraphs.join("\n"));
        if (!content || /[\uE000-\uF8FF]/.test(content)) throw new Error(`第 ${order} 章公开正文无法可靠识别`);
        return {
          title: clean(chapterData.title ?? "") || `第${order}章`,
          content,
          wordCount: content.replace(/\s/g, "").length,
        };
      } catch (error) {
        if (error instanceof Error && /登录或付费/.test(error.message)) throw error;
        lastError = error;
      }
    }
    throw new Error(`第 ${order} 章读取失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  });
  if (chapters.length < FANQIE_OPENING_CHAPTER_LIMIT)
    throw new Error(`公开开篇仅识别到 ${chapters.length} 章，未保存不完整样本`);
  return { title, author, sourceUrl: detailUrl.toString(), chapters };
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
  const readerHref = $("a[href*='/reader/']").filter((_index, element) => /^第\s*1\s*章/.test(clean($(element).text()))).first().attr("href")
    ?? $("a[href*='/reader/']").first().attr("href");
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
    officialReaderUrl: readerHref ? new URL(readerHref, detailUrl).toString() : officialReaderUrl,
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
    const hasTrend = list.length >= 2;
    const competition: MarketOpportunity["competition"] = !hasTrend ? "未知" : stabilityRate >= 0.7 ? "高" : stabilityRate >= 0.4 ? "中" : "低";
    const momentumScore = hasTrend
      ? Math.round(Math.max(0, Math.min(100, 35 + newRate * 45 + Math.max(-5, Math.min(5, averageRankChange)) * 4 + (listName.includes("新书榜") ? 5 : 0))))
      : null;
    const dataSufficiency = list.length === 1 ? 10 : list.length === 2 ? 30 : Math.min(100, 45 + (list.length - 3) * 10);
    const evidenceLevel: MarketOpportunity["evidenceLevel"] = list.length === 1 ? "基线" : list.length === 2 ? "暂定" : "可参考";
    const score = momentumScore === null ? null : Math.round(Math.max(0, Math.min(100, momentumScore * 0.75 + (100 - stabilityRate * 100) * 0.25)));
    const uncertainty = list.length >= 7 ? 8 : list.length >= 3 ? 13 : 20;
    const scoreRange: [number, number] | null = score === null ? null : [Math.max(0, score - uncertainty), Math.min(100, score + uncertainty)];
    const profile = profileForList(listName);
    const inferredGenre: MarketOpportunity["genre"] = GENRES.find((genre) => latestEntries.some((entry) => entry.genre === genre)) ?? "待校对";
    const confidence: MarketOpportunity["confidence"] = list.length >= 7 ? "高" : list.length >= 3 ? "中" : "低";
    const sampleWarning = list.length === 1 ? "仅有一次快照，只能建立榜单基线，不能判断趋势。" : list.length === 2 ? "仅有两个时间点，变化可能来自短期波动。" : list.length < 7 ? "样本尚未覆盖完整周周期，结论需继续复核。" : null;
    const recommendation = score === null
      ? `先继续采集${profile?.name ?? "该榜单"}，当前不据单点数据判断机会。`
      : score >= 65
      ? `可作为${profile?.genre ?? "该题材"}候选方向：保留${profile?.coreFantasy ?? "题材核心幻想"}，用差异化主角、冲突发动机和开篇回报避开同质化。`
      : score >= 50
        ? `适合小规模验证：优先测试${profile?.openingFocus ?? "开篇承诺和首轮回报"}，连续采样后再决定是否扩张。`
        : "竞争或动能暂不突出，不建议仅凭单次榜单追热点。";
    return {
      listName,
      categoryKey: profile?.key,
      categoryName: profile?.name ?? listName,
      genre: profile?.genre ?? inferredGenre,
      snapshots: list.length,
      latestSampleSize: latestEntries.length,
      newEntrantRate: Math.round(newRate * 100),
      averageRankChange: Math.round(averageRankChange * 10) / 10,
      stabilityRate: Math.round(stabilityRate * 100),
      competition,
      momentumScore,
      dataSufficiency,
      evidenceLevel,
      opportunityScore: score,
      scoreRange,
      sampleWarning,
      formulaVersion: "fanqie-opportunity-v2",
      confidence,
      recommendation,
    };
  }).sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1));
  return {
    snapshotCount: successful.length, sampleSize: entries.length, timeRange: range,
    confidence: successful.length >= 7 && entries.length >= 100 ? "高" : successful.length >= 2 && entries.length >= 20 ? "中" : "低",
    genreDistribution: countBy(entries.map((entry) => entry.genre)), wordBands: countBy(bands), statusDistribution: countBy(entries.map((entry) => entry.status)),
    newEntrants, movers, continuousAppearances: [...appearances.values()].filter((item) => item.snapshots > 1).sort((a, b) => b.snapshots - a.snapshots),
    marketOpportunities,
  };
}
