import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMetrics, parseMetricsCsv, summarizeMetrics } from "../src/shared/metrics";
import { completeRankingSchedule, failRankingSchedule, nextRankingRun } from "../src/shared/ranking-schedule";
import { analyzeRankings, capturePublicRankingPage, parseFanqieDetailPage } from "../electron/ranking-service";
import type { RankingSnapshot } from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());

describe("ranking analytics", () => {
  it("reports entrants, movers, distribution, range and confidence", () => {
    const snapshots: RankingSnapshot[] = [
      { id: "one", source: "test", listName: "榜单", capturedAt: "2026-07-29T00:00:00Z", status: "成功", error: null, entries: [{ id: "a", snapshotId: "one", rank: 3, title: "甲", author: "作者", genre: "都市脑洞", words: 500000, status: "连载", tags: [], sourceUrl: "" }] },
      { id: "two", source: "test", listName: "榜单", capturedAt: "2026-07-30T00:00:00Z", status: "成功", error: null, entries: [{ id: "b", snapshotId: "two", rank: 1, title: "甲", author: "作者", genre: "都市脑洞", words: 600000, status: "连载", tags: [], sourceUrl: "" }, { id: "c", snapshotId: "two", rank: 2, title: "乙", author: "作者乙", genre: "现言甜宠", words: 300000, status: "完结", tags: [], sourceUrl: "" }] },
    ];
    const result = analyzeRankings(snapshots);
    expect(result.newEntrants).toContain("乙");
    expect(result.movers[0].change).toBe(2);
    expect(result.continuousAppearances[0].snapshots).toBe(2);
  });

  it("builds market opportunities only from repeated snapshots of the same list", () => {
    const makeEntry = (snapshotId: string, rank: number, title: string) => ({ id: `${snapshotId}-${title}`, snapshotId, rank, title, author: "作者", genre: "都市脑洞", words: 500000, status: "连载", tags: [], sourceUrl: "" });
    const snapshots: RankingSnapshot[] = [
      { id: "old", source: "番茄小说官网", listName: "番茄男频阅读榜·都市脑洞", capturedAt: "2026-07-28T00:00:00Z", status: "成功", error: null, entries: [makeEntry("old", 3, "甲"), makeEntry("old", 2, "乙")] },
      { id: "other", source: "番茄小说官网", listName: "番茄女频阅读榜·年代", capturedAt: "2026-07-29T00:00:00Z", status: "成功", error: null, entries: [makeEntry("other", 1, "无关作品")] },
      { id: "new", source: "番茄小说官网", listName: "番茄男频阅读榜·都市脑洞", capturedAt: "2026-07-30T00:00:00Z", status: "成功", error: null, entries: [makeEntry("new", 1, "甲"), makeEntry("new", 2, "丙")] },
    ];
    const opportunity = analyzeRankings(snapshots).marketOpportunities.find((item) => item.categoryKey === "男频:262")!;
    expect(opportunity).toMatchObject({ snapshots: 2, newEntrantRate: 50, stabilityRate: 50, averageRankChange: 2, genre: "都市脑洞" });
    expect(opportunity).toMatchObject({ evidenceLevel: "暂定", dataSufficiency: 30, formulaVersion: "fanqie-opportunity-v2" });
    expect(opportunity.scoreRange).not.toBeNull();
  });

  it("treats a single ranking snapshot as a baseline without an opportunity score", () => {
    const snapshots: RankingSnapshot[] = [{ id: "one", source: "番茄小说官网", listName: "番茄男频阅读榜·都市脑洞", capturedAt: "2026-07-30T00:00:00Z", status: "成功", error: null, entries: [{ id: "a", snapshotId: "one", rank: 1, title: "甲", author: "作者", genre: "都市脑洞", words: 500000, status: "连载", tags: [], sourceUrl: "" }] }];
    const opportunity = analyzeRankings(snapshots).marketOpportunities[0];
    expect(opportunity).toMatchObject({ evidenceLevel: "基线", opportunityScore: null, momentumScore: null, competition: "未知", confidence: "低" });
    expect(opportunity.sampleWarning).toContain("不能判断趋势");
  });

  it("captures only public page metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html><body><article class="book-item"><span class="rank">1</span><a href="/page/123" title="公开书名">公开书名</a><span class="author">公开作者</span><span>都市脑洞 88万字 连载</span></article></body></html>`, { status: 200, headers: { "content-type": "text/html" } })));
    const result = await capturePublicRankingPage("https://example.com/rank", "公开榜");
    expect(result.status).toBe("成功");
    expect(result.entries[0]).toMatchObject({ title: "公开书名", author: "公开作者", words: 880000 });
  });

  it("parses public Zongheng ranking cards without duplicating detail links", async () => {
    const html = `<section><div class="zh-modules-rank-book"><div class="book-rank--title"><a title="示例作品" href="//www.zongheng.com/detail/123">示例作品</a></div><div class="book-rank--hover"><a class="global-hover bookeName" href="//www.zongheng.com/detail/123">示例作品</a><a class="global-hover">示例作者</a><span>12.5 万字 连载</span></div></div></section>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })));
    const snapshot = await capturePublicRankingPage("https://www.zongheng.com/rank", "纵横公开榜单");
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({ title: "示例作品", author: "示例作者", words: 125000, status: "连载" });
    expect(snapshot.entries[0].sourceUrl).toBe("https://www.zongheng.com/detail/123");
    vi.unstubAllGlobals();
  });

  it("parses normal metadata from a public Fanqie detail page", () => {
    const html = `<html><head><title>测试作品完整版在线免费阅读_测试作品小说_番茄小说官网</title><meta name="description" content="番茄小说提供测试作品完整版在线免费阅读，精彩小说尽在番茄小说网。公开简介内容"></head><body><h1>测试作品</h1><div class="info-label"><span>已完结</span><span>古风世情</span><span>古代言情</span></div><div class="info-count-word"><span class="detail">66.6</span><span>万字</span></div><span class="author-name-text">测试作者</span><a href="/reader/456">开始阅读</a></body></html>`;
    const entry = parseFanqieDetailPage(html, new URL("https://fanqienovel.com/page/123"), "snapshot", 1);
    expect(entry).toMatchObject({ title: "测试作品", author: "测试作者", genre: "古风世情", words: 666000, status: "已完结", synopsis: "公开简介内容", platform: "番茄小说" });
    expect(entry.officialReaderUrl).toBe("https://fanqienovel.com/reader/456");
  });

  it("uses Fanqie detail metadata instead of obfuscated ranking text", async () => {
    const rankHtml = `<div class="rank-item"><a href="/page/123">乱码书名</a><a href="/reader/456">阅读</a></div>`;
    const detailHtml = `<html><head><title>正常书名完整版在线免费阅读_正常书名小说_番茄小说官网</title><meta name="description" content="番茄小说提供正常书名完整版在线免费阅读，精彩小说尽在番茄小说网。简介"></head><body><h1>正常书名</h1><div class="info-label"><span>连载中</span><span>都市脑洞</span></div><div class="info-count-word">88 万字</div><span class="author-name-text">公开作者</span></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => new Response(String(input).includes("/page/123") ? detailHtml : rankHtml, { status: 200, headers: { "content-type": "text/html" } })));
    const snapshot = await capturePublicRankingPage("https://fanqienovel.com/rank", "番茄综合榜");
    expect(snapshot.status).toBe("成功");
    expect(snapshot.entries[0]).toMatchObject({ title: "正常书名", author: "公开作者", genre: "都市脑洞", platform: "番茄小说" });
    expect(snapshot.entries[0].title).not.toContain("");
  });
});

describe("metric review", () => {
  it("turns declining retention into a review suggestion, not an automatic edit", () => {
    const metrics = [
      { id: "1", chapterNumber: 1, recordedAt: "2026-07-01", exposure: 1000, reads: 600, retention: 50, follows: 200, revenue: 10, comments: "" },
      { id: "2", chapterNumber: 2, recordedAt: "2026-07-08", exposure: 1000, reads: 580, retention: 42, follows: 150, revenue: 9, comments: "" },
    ];
    expect(analyzeMetrics(metrics).some((item) => item.category === "节奏")).toBe(true);
  });

  it("parses legacy and expanded CSV headers without shifting columns", () => {
    let sequence = 0;
    const legacy = parseMetricsCsv("日期,章节,曝光,阅读,留存,追读,收益,评论摘要\n2026-07-01,3,1000,600,42,120,9.5,旧格式", () => `legacy-${++sequence}`)[0];
    expect(legacy).toMatchObject({ chapterNumber: 3, exposure: 1000, clicks: 0, reads: 600, retention: 42, follows: 120, revenue: 9.5, comments: "旧格式" });
    const expanded = parseMetricsCsv("date,chapter,exposure,clicks,reads,firstChapterCompletion,threeChapterRetention,retention,follows,bookshelfAdds,revenue\n2026-07-02,4,2000,900,700,48%,31%,40,140,80,15", () => `new-${++sequence}`)[0];
    expect(expanded).toMatchObject({ clicks: 900, firstChapterCompletion: 48, threeChapterRetention: 31, bookshelfAdds: 80 });
  });

  it("summarizes the Fanqie funnel and attributes retention decline to the weakest later chapter", () => {
    const metrics = [
      { id: "1", chapterNumber: 1, recordedAt: "2026-07-01", exposure: 1000, clicks: 200, reads: 100, firstChapterCompletion: 30, threeChapterRetention: 20, retention: 55, follows: 10, bookshelfAdds: 2, revenue: 0, comments: "" },
      { id: "2", chapterNumber: 2, recordedAt: "2026-07-02", exposure: 1000, clicks: 180, reads: 90, firstChapterCompletion: 32, threeChapterRetention: 22, retention: 50, follows: 9, bookshelfAdds: 3, revenue: 0, comments: "" },
      { id: "3", chapterNumber: 7, recordedAt: "2026-07-03", exposure: 1000, clicks: 150, reads: 70, firstChapterCompletion: 25, threeChapterRetention: 18, retention: 28, follows: 4, bookshelfAdds: 1, revenue: 0, comments: "" },
    ];
    expect(summarizeMetrics(metrics).clickRate).toBeCloseTo(17.67, 1);
    expect(analyzeMetrics(metrics).find((item) => item.id === "retention-drop")?.recommendation).toContain("第7章");
  });
});

describe("ranking schedules", () => {
  const schedule = { id: "s", url: "https://example.com", listName: "榜单", frequency: "每日" as const, enabled: true, lastRunAt: null, nextRunAt: "2026-07-30T00:00:00.000Z", lastStatus: "未运行" as const, lastError: null };

  it("advances successful and failed runs to the next cycle", () => {
    const from = new Date("2026-07-30T08:00:00.000Z");
    expect(nextRankingRun("每日", from)).toBe("2026-07-31T08:00:00.000Z");
    expect(nextRankingRun("每周", from)).toBe("2026-08-06T08:00:00.000Z");
    const snapshot: RankingSnapshot = { id: "r", source: "test", listName: "榜单", capturedAt: "2026-07-30T08:00:01.000Z", status: "成功", error: null, entries: [] };
    expect(completeRankingSchedule(schedule, snapshot, from)).toMatchObject({ lastStatus: "成功", lastRunAt: snapshot.capturedAt, nextRunAt: "2026-07-31T08:00:00.000Z" });
    expect(failRankingSchedule(schedule, new Error("访问受限"), from)).toMatchObject({ lastStatus: "失败", lastError: "访问受限", nextRunAt: "2026-07-31T08:00:00.000Z" });
  });
});
