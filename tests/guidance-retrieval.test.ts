import { describe, expect, it } from "vitest";
import { compileChapterGuidance } from "../src/shared/commercial-knowledge";
import { constraintDensity } from "../src/shared/guidance-metrics";
import {
  formatRetrievedGuidance,
  type GuidanceSignal,
  MAX_RETRIEVED_GUIDANCE,
  retrieveGuidance,
} from "../src/shared/guidance-retrieval";

function signal(patch: Partial<GuidanceSignal> = {}): GuidanceSignal {
  return {
    chapterNumber: 10,
    chapterFunction: "行动",
    isKeyChapter: false,
    phase: "追读",
    hasApprovedStructure: true,
    chapterText: "林舟调取门禁记录",
    recentChapterTexts: ["林舟查监控", "林舟核对进货单", "林舟走访仓库"],
    ...patch,
  };
}

describe("on-demand genre guidance retrieval", () => {
  it("injects nothing for a normal chapter with an approved stage", () => {
    expect(retrieveGuidance("都市脑洞", signal())).toEqual([]);
  });

  it("retrieves a fatigue warning when recent chapters repeat the same mechanism", () => {
    const items = retrieveGuidance(
      "都市脑洞",
      signal({ recentChapterTexts: ["众人震惊，经理认错", "又一次围观打脸", "林舟回家"] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "重复疲劳" });
    expect(items[0].reason).toContain("震惊循环");
    expect(items[0].text).toContain("资源或关系");
  });

  it("retrieves a reward hint for key, climax and reveal chapters", () => {
    for (const chapterFunction of ["高潮", "揭秘"] as const) {
      const items = retrieveGuidance("都市脑洞", signal({ chapterFunction }));
      expect(items.map((item) => item.source)).toContain("回报参考");
    }
    const key = retrieveGuidance("都市脑洞", signal({ isKeyChapter: true }));
    expect(key.find((item) => item.source === "回报参考")?.reason).toContain("关键章");
  });

  it("falls back to a stage reference only when no macro stage is approved", () => {
    expect(retrieveGuidance("都市脑洞", signal({ hasApprovedStructure: false }))).toHaveLength(1);
    expect(retrieveGuidance("都市脑洞", signal({ hasApprovedStructure: false }))[0]).toMatchObject({
      source: "阶段参考",
    });
    expect(retrieveGuidance("都市脑洞", signal({ hasApprovedStructure: true }))).toEqual([]);
  });

  it("caps retrieval at two items, fatigue first", () => {
    const items = retrieveGuidance(
      "都市脑洞",
      signal({
        isKeyChapter: true,
        hasApprovedStructure: false,
        recentChapterTexts: ["众人震惊", "围观打脸", "林舟回家"],
      }),
    );
    expect(items).toHaveLength(MAX_RETRIEVED_GUIDANCE);
    expect(items[0].source).toBe("重复疲劳");
    expect(items[1].source).toBe("回报参考");
  });

  it("formats every item with its trigger reason and no bare prohibition", () => {
    const text = formatRetrievedGuidance(
      retrieveGuidance("都市脑洞", signal({ isKeyChapter: true, hasApprovedStructure: false })),
    );
    expect(text).toContain("回报参考（本章是关键章）");
    expect(text).toContain("阶段参考（");
    expect(constraintDensity(text)).toBeLessThanOrEqual(1);
  });
});

describe("compileChapterGuidance modes", () => {
  const progress = { currentWords: 20_000, targetWords: 1_000_000 };
  const stagedProgress = {
    ...progress,
    storyStage: { title: "第一卷", goal: "站稳脚跟", conflict: "资源不足", outcome: "拿到第一笔订单" },
  };
  const chapterSignal = {
    chapterFunction: "行动" as const,
    isKeyChapter: false,
    hasApprovedStructure: true,
    chapterText: "查账",
    recentChapterTexts: [] as string[],
  };

  it("injects nothing in 自由 and only triggered items in 均衡", () => {
    expect(compileChapterGuidance("都市脑洞", 10, stagedProgress, "自由", chapterSignal)).toBe("");
    expect(compileChapterGuidance("都市脑洞", 10, stagedProgress, "均衡", chapterSignal)).toBe("");
    expect(
      compileChapterGuidance("都市脑洞", 10, stagedProgress, "均衡", { ...chapterSignal, isKeyChapter: true }),
    ).toContain("回报参考");
  });

  it("uses the stage reference only while the book has no approved structure", () => {
    expect(
      compileChapterGuidance("都市脑洞", 10, progress, "均衡", { ...chapterSignal, hasApprovedStructure: false }),
    ).toContain("阶段参考");
    expect(compileChapterGuidance("都市脑洞", 10, progress, "均衡", chapterSignal)).toBe("");
  });

  it("returns the full reference only in 严谨", () => {
    const strict = compileChapterGuidance("都市脑洞", 10, progress, "严谨", chapterSignal);
    expect(strict).toContain("题材质量检查");
    expect(strict).toContain("正向边界");
    expect(strict.length).toBeGreaterThan(1000);
  });

  it("needs a signal before retrieving in 均衡", () => {
    expect(compileChapterGuidance("都市脑洞", 10, progress, "均衡")).toBe("");
  });
});
