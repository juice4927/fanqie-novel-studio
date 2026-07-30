import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMetrics } from "../src/shared/metrics";
import { analyzeRankings, capturePublicRankingPage } from "../electron/ranking-service";
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

  it("captures only public page metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html><body><article class="book-item"><span class="rank">1</span><a href="/page/123" title="公开书名">公开书名</a><span class="author">公开作者</span><span>都市脑洞 88万字 连载</span></article></body></html>`, { status: 200, headers: { "content-type": "text/html" } })));
    const result = await capturePublicRankingPage("https://example.com/rank", "公开榜");
    expect(result.status).toBe("成功");
    expect(result.entries[0]).toMatchObject({ title: "公开书名", author: "公开作者", words: 880000 });
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
});
