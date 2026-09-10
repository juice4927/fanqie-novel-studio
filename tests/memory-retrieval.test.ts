import { describe, expect, it } from "vitest";
import type { MemoryBrief } from "../src/shared/memory-retrieval";
import {
  DEFAULT_HALF_LIFE,
  IMPORTANCE_WEIGHT,
  NEUTRAL_IMPORTANCE,
  RECENCY_WEIGHT,
  RELEVANCE_WEIGHT,
  rankFacts,
  rankSummaryNodes,
  selectSummaryNodes,
} from "../src/shared/memory-retrieval";
import type { LedgerFact, StorySummary } from "../src/shared/types";

function summary(
  id: string,
  layer: StorySummary["layer"],
  fromChapter: number,
  toChapter: number,
  content: string,
  title = id,
): StorySummary {
  return { id, layer, title, fromChapter, toChapter, content, version: 1, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function brief(chapterNumber: number, text: string, properNouns: readonly string[] = []): MemoryBrief {
  return { chapterNumber, text, properNouns };
}

function fact(id: string, overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id,
    kind: "事件",
    subject: "林舟",
    predicate: "获得",
    value: "门禁卡",
    validFromChapter: 10,
    validToChapter: null,
    evidenceChapter: 10,
    confidence: "已确认",
    knowledgeScope: "主角",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function byId<T extends { summary: StorySummary }>(ranked: readonly T[]) {
  return new Map(ranked.map((item) => [item.summary.id, item]));
}

describe("query-conditioned memory retrieval", () => {
  it("ranks a relevant node above a more recent but irrelevant node", () => {
    const nodes = [
      summary("irrelevant", "章节", 98, 98, "苏晚在集市购买药材，与摊主讨价还价。"),
      summary("relevant", "章节", 95, 95, "林舟在北仓城取得门禁卡，线索指向地下仓库。"),
    ];

    const ranked = rankSummaryNodes(nodes, brief(100, "林舟前往北仓城寻找门禁卡", ["林舟", "北仓城"]));

    expect(ranked.map((item) => item.summary.id)).toEqual(["relevant", "irrelevant"]);
    expect(ranked[0].relevance).toBeGreaterThan(ranked[1].relevance);
    // 无关节点更靠近当前章，近因更高；相关性仍然压过近因。
    expect(ranked[0].recency).toBeLessThan(ranked[1].recency);
    expect(ranked[0].score).toBeCloseTo(
      RELEVANCE_WEIGHT * ranked[0].relevance +
        IMPORTANCE_WEIGHT * ranked[0].importance +
        RECENCY_WEIGHT * ranked[0].recency,
      10,
    );
  });

  it("normalizes full-width characters and latin case before matching", () => {
    const nodes = [summary("miss", "章节", 10, 10, "无关内容"), summary("hit", "章节", 10, 10, "LIN 在旧城追查")];

    const ranked = rankSummaryNodes(nodes, brief(10, "lin", ["ＬＩＮ"]));

    expect(ranked[0].summary.id).toBe("hit");
    expect(ranked[0].relevance).toBe(1);
  });

  it("decays recency by the configured half life and clamps to [0,1]", () => {
    const nodes = [
      summary("old", "章节", 60, 60, "同样的内容"),
      summary("new", "章节", 100, 100, "同样的内容"),
      summary("future", "章节", 110, 110, "同样的内容"),
    ];

    const ranked = byId(rankSummaryNodes(nodes, brief(100, ""), { halfLife: DEFAULT_HALF_LIFE }));
    expect(ranked.get("new")!.recency).toBe(1);
    expect(ranked.get("future")!.recency).toBe(1);
    expect(ranked.get("old")!.recency).toBeCloseTo(Math.exp(-1), 10);

    const shortHalfLife = byId(rankSummaryNodes(nodes, brief(100, ""), { halfLife: 20 }));
    expect(shortHalfLife.get("old")!.recency).toBeCloseTo(Math.exp(-2), 10);

    const defaults = byId(rankSummaryNodes(nodes, brief(100, "")));
    expect(defaults.get("old")!.recency).toBeCloseTo(Math.exp(-1), 10);
  });

  it("weights summary layers and payoff markers into importance", () => {
    const layers = byId(
      rankSummaryNodes(
        [
          summary("scene", "场景", 100, 100, "同样的内容"),
          summary("chapter", "章节", 100, 100, "同样的内容"),
          summary("book", "全书", 1, 100, "同样的内容"),
        ],
        brief(100, ""),
      ),
    );
    expect(layers.get("book")!.importance).toBeGreaterThan(layers.get("chapter")!.importance);
    expect(layers.get("chapter")!.importance).toBeGreaterThan(layers.get("scene")!.importance);
    expect(layers.get("chapter")!.importance).toBe(NEUTRAL_IMPORTANCE);

    const markers = byId(
      rankSummaryNodes(
        [
          summary("plain", "章节", 100, 100, "同样的内容"),
          summary("payoff", "章节", 100, 100, "同样的内容，伏笔回收"),
          summary("major", "章节", 100, 100, "同样的内容，林舟死亡"),
        ],
        brief(100, ""),
      ),
    );
    expect(markers.get("payoff")!.importance).toBeGreaterThan(markers.get("plain")!.importance);
    expect(markers.get("major")!.importance).toBeGreaterThan(markers.get("plain")!.importance);
  });

  it("selects the highest-scoring nodes within the character budget in chronological order", () => {
    const nodes = [
      summary("high", "章节", 10, 10, `林舟线索${"线索".repeat(13)}`),
      summary("low", "章节", 20, 20, `苏晚集市${"集市".repeat(13)}`),
      summary("medium", "章节", 30, 30, `林舟记录${"记录".repeat(13)}`),
    ];

    const result = selectSummaryNodes(nodes, brief(40, "林舟线索"), 60);

    expect(result.selected.map((item) => item.id)).toEqual(["high", "medium"]);
    expect(result.omitted).toBe(1);
    expect(result.selected.map((item) => item.fromChapter)).toEqual([10, 30]);
    expect(result.selected.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(60);
  });

  it("skips an oversized node and still fills the budget with smaller ones", () => {
    const nodes = [
      summary("huge", "章节", 10, 10, `林舟线索${"线索".repeat(48)}`),
      summary("small", "章节", 20, 20, "林舟记录"),
    ];

    const result = selectSummaryNodes(nodes, brief(40, "林舟线索"), 20);

    expect(result.selected.map((item) => item.id)).toEqual(["small"]);
    expect(result.omitted).toBe(1);
    expect(selectSummaryNodes(nodes, brief(40, "林舟线索"), 0)).toEqual({ selected: [], omitted: 2 });
  });

  it("orders facts by relevance, then recency, then id", () => {
    const ranked = rankFacts(
      [
        fact("old-relevant", { subject: "林舟", value: "门禁卡", validFromChapter: 20 }),
        fact("new-relevant", { subject: "林舟", value: "门禁卡", validFromChapter: 90 }),
        fact("irrelevant", { subject: "苏晚", value: "药材", validFromChapter: 99 }),
      ],
      brief(100, "林舟门禁卡", ["林舟"]),
    );
    expect(ranked.map((item) => item.id)).toEqual(["new-relevant", "old-relevant", "irrelevant"]);

    const tied = rankFacts(
      [
        fact("b", { subject: "林舟", value: "门禁卡", validFromChapter: 50 }),
        fact("a", { subject: "林舟", value: "门禁卡", validFromChapter: 50 }),
      ],
      brief(100, "林舟门禁卡"),
    );
    expect(tied.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("weights fact kind and confidence into importance", () => {
    const ranked = rankFacts(
      [
        fact("place", { kind: "地点", confidence: "待确认", subject: "北仓城", value: "港口" }),
        fact("secret", { kind: "秘密", confidence: "已确认", subject: "北仓城", value: "港口" }),
      ],
      brief(100, "北仓城港口"),
    );
    expect(ranked.map((item) => item.id)).toEqual(["secret", "place"]);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const nodes = [
      summary("book", "全书", 1, 120, "全书线索：门禁卡指向北仓城。"),
      summary("volume", "分卷", 81, 140, "当前卷目标：夺回北仓城。"),
      summary("stage", "十章阶段", 111, 120, "林舟追查门禁卡。"),
      summary("chapter", "章节", 120, 120, "林舟在北仓城找到门禁卡。"),
      summary("scene", "场景", 120, 120, "仓库门口的对峙。"),
    ];
    const facts = [
      fact("fact-1", { subject: "林舟", value: "门禁卡", validFromChapter: 118 }),
      fact("fact-2", { subject: "苏晚", value: "药材", validFromChapter: 119 }),
    ];
    const nodesSnapshot = structuredClone(nodes);
    const factsSnapshot = structuredClone(facts);
    const input = brief(120, "林舟在北仓城追查门禁卡的下落", ["林舟", "北仓城"]);

    const rankedFirst = rankSummaryNodes(nodes, input);
    const rankedSecond = rankSummaryNodes(nodes, input);
    expect(rankedSecond).toEqual(rankedFirst);

    const selectedFirst = selectSummaryNodes(nodes, input, 200);
    const selectedSecond = selectSummaryNodes(nodes, input, 200);
    expect(selectedSecond).toEqual(selectedFirst);

    expect(rankFacts(facts, input)).toEqual(rankFacts(facts, input));
    expect(nodes).toEqual(nodesSnapshot);
    expect(facts).toEqual(factsSnapshot);
  });
});
