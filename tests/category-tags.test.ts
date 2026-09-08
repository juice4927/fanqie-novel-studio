import { describe, expect, it } from "vitest";
import { aggregateCategoryTags, topCategoryTags } from "../src/shared/category-tags";
import type { RankingEntry, RankingSnapshot } from "../src/shared/types";

const entry = (overrides: Partial<RankingEntry>): RankingEntry => ({
  id: overrides.id ?? "entry",
  snapshotId: overrides.snapshotId ?? "snapshot",
  rank: overrides.rank ?? 1,
  title: overrides.title ?? "书",
  author: overrides.author ?? "作者",
  genre: overrides.genre ?? "都市脑洞",
  words: overrides.words ?? 100000,
  status: overrides.status ?? "连载中",
  tags: overrides.tags ?? [],
  sourceUrl: overrides.sourceUrl ?? "https://fanqienovel.com/rank",
});

const snapshot = (capturedAt: string, entries: RankingEntry[]): RankingSnapshot => ({
  id: `snapshot-${capturedAt}`,
  source: "公开榜单",
  listName: "番茄男频阅读榜·都市脑洞",
  capturedAt,
  status: "成功",
  error: null,
  entries: entries.map((item) => ({ ...item, snapshotId: `snapshot-${capturedAt}` })),
});

describe("category tag aggregation", () => {
  const snapshots = [
    snapshot("2026-09-01T00:00:00.000Z", [
      entry({ id: "a", title: "规则回收站", author: "甲", rank: 1, tags: ["系统流", "都市"] }),
      entry({ id: "b", title: "旧货市场", author: "乙", rank: 3, tags: ["系统流", "经营"] }),
    ]),
    snapshot("2026-09-08T00:00:00.000Z", [
      entry({ id: "a", title: "规则回收站", author: "甲", rank: 2, tags: ["系统流", "都市"] }),
      entry({ id: "c", title: "新书上榜", author: "丙", rank: 4, tags: ["系统流", "脑洞"] }),
    ]),
  ];

  it("aggregates tags from locally captured snapshots only", () => {
    const stats = aggregateCategoryTags(snapshots, "都市脑洞");
    expect(stats[0].tag).toBe("系统流");
    expect(stats[0].count).toBe(3);
    expect(stats[0].share).toBeCloseTo(1);
    expect(stats[0].newEntrantShare).toBeCloseTo(1);
  });

  it("returns an empty list when the category has no captured snapshots", () => {
    expect(aggregateCategoryTags(snapshots, "玄幻脑洞")).toEqual([]);
  });

  it("exposes the top tags for the evidence panel", () => {
    expect(topCategoryTags(aggregateCategoryTags(snapshots, "都市脑洞"), 2)).toEqual(["系统流", "脑洞"]);
  });
});
