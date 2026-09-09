import type { RankingSnapshot } from "./types";

export interface CategoryTagStat {
  tag: string;
  /** 出现次数（同一本书在多次快照中只计一次） */
  count: number;
  /** 在最新一次快照的样本中出现的比例 */
  share: number;
  /** 最近一次快照新进入者中携带该标签的比例 */
  newEntrantShare: number;
  /** 携带该标签书籍的平均排名（越小越靠前） */
  avgRank: number;
}

interface TagAccumulator {
  tag: string;
  books: Set<string>;
  ranks: number[];
}

const bookIdentity = (title: string, author: string) => `${title}::${author}`;

/**
 * 聚合某个番茄分类在已采集榜单快照里的标签分布。
 * 只使用本地已采集的公开榜单数据，不发起任何网络请求。
 * 传 channel 时按「频道 + 分类名」双重匹配，避免同名分类或子串
 * （如"都市种田"命中"种田"）把别的频道数据混进来。
 */
export function aggregateCategoryTags(
  snapshots: readonly RankingSnapshot[],
  categoryName: string,
  channel?: string,
): CategoryTagStat[] {
  const matched = snapshots
    .filter(
      (snapshot) =>
        snapshot.status === "成功" &&
        snapshot.listName.includes(categoryName) &&
        (!channel || snapshot.listName.includes(channel)),
    )
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (!matched.length) return [];
  const latest = matched.at(-1)!;
  const previous = matched.at(-2);
  const previousIdentities = new Set((previous?.entries ?? []).map((entry) => bookIdentity(entry.title, entry.author)));
  const newEntrants = latest.entries.filter(
    (entry) => !previousIdentities.has(bookIdentity(entry.title, entry.author)),
  );
  const newEntrantIdentities = new Set(newEntrants.map((entry) => bookIdentity(entry.title, entry.author)));

  const accumulators = new Map<string, TagAccumulator>();
  for (const snapshot of matched) {
    for (const entry of snapshot.entries) {
      const identity = bookIdentity(entry.title, entry.author);
      for (const tag of entry.tags) {
        const normalized = tag.trim();
        if (!normalized) continue;
        const accumulator = accumulators.get(normalized) ?? { tag: normalized, books: new Set<string>(), ranks: [] };
        accumulator.books.add(identity);
        accumulator.ranks.push(entry.rank);
        accumulators.set(normalized, accumulator);
      }
    }
  }

  const latestTagCounts = new Map<string, number>();
  for (const entry of latest.entries) {
    for (const tag of new Set(entry.tags.map((item) => item.trim()).filter(Boolean))) {
      latestTagCounts.set(tag, (latestTagCounts.get(tag) ?? 0) + 1);
    }
  }
  const latestSize = Math.max(1, latest.entries.length);

  return [...accumulators.values()]
    .map((accumulator) => {
      const entrantHits = [...accumulator.books].filter((identity) => newEntrantIdentities.has(identity)).length;
      return {
        tag: accumulator.tag,
        count: accumulator.books.size,
        share: (latestTagCounts.get(accumulator.tag) ?? 0) / latestSize,
        newEntrantShare: newEntrants.length ? entrantHits / newEntrants.length : 0,
        avgRank: accumulator.ranks.reduce((sum, value) => sum + value, 0) / accumulator.ranks.length,
      } satisfies CategoryTagStat;
    })
    .sort(
      (left, right) =>
        right.newEntrantShare - left.newEntrantShare || right.share - left.share || left.avgRank - right.avgRank,
    );
}

export function topCategoryTags(stats: readonly CategoryTagStat[], limit = 24) {
  return stats.slice(0, limit).map((item) => item.tag);
}
