import { describe, expect, it } from "vitest";
import { compareDrafts, type DraftCandidate, lengthControlledWinRate } from "../src/shared/pairwise-review";

const baseline: DraftCandidate = { id: "baseline", text: "甲稿，铺陈较多。" };
const candidate: DraftCandidate = { id: "candidate", text: "乙稿，冲突更集中。" };

describe("成对比较", () => {
  it("换序后结论一致时采用胜者", async () => {
    const comparison = await compareDrafts({
      baseline,
      candidate,
      judge: async (a, b) => ({ winnerId: a.text.includes("乙") ? a.id : b.id, confidence: 0.8 }),
    });

    expect(comparison.winnerId).toBe("candidate");
    expect(comparison.disagreement).toBe(false);
    expect(comparison.firstVerdict.winnerId).toBe("candidate");
    expect(comparison.swappedVerdict.winnerId).toBe("candidate");
  });

  it("位置偏好导致换序结论不一致时标记高分歧", async () => {
    const comparison = await compareDrafts({
      baseline,
      candidate,
      judge: async (a) => ({ winnerId: a.id, rationale: "偏好第一个候选" }),
    });

    expect(comparison.winnerId).toBeNull();
    expect(comparison.disagreement).toBe(true);
    expect(comparison.firstVerdict.winnerId).toBe("baseline");
    expect(comparison.swappedVerdict.winnerId).toBe("candidate");
    expect(comparison.firstVerdict.rationale).toBe("偏好第一个候选");
  });

  it("兼容按位置作答的裁判，换序后映射回原始 id", async () => {
    const comparison = await compareDrafts({
      baseline,
      candidate,
      judge: async (_a, b) => ({ winnerId: b.text.includes("乙") ? "b" : "a" }),
    });

    expect(comparison.winnerId).toBe("candidate");
    expect(comparison.disagreement).toBe(false);
  });

  it("裁判给出未知胜者时按分歧处理", async () => {
    const comparison = await compareDrafts({
      baseline,
      candidate,
      judge: async () => ({ winnerId: "someone-else" }),
    });

    expect(comparison.winnerId).toBeNull();
    expect(comparison.disagreement).toBe(true);
  });
});

describe("长度控制胜率", () => {
  it("更长者更容易获胜时扣除长度带来的胜率", () => {
    const result = lengthControlledWinRate([
      { candidateWon: true, baselineChars: 100, candidateChars: 200 },
      { candidateWon: true, baselineChars: 100, candidateChars: 200 },
      { candidateWon: true, baselineChars: 100, candidateChars: 200 },
      { candidateWon: false, baselineChars: 100, candidateChars: 100 },
      { candidateWon: false, baselineChars: 100, candidateChars: 100 },
      { candidateWon: false, baselineChars: 100, candidateChars: 100 },
    ]);

    expect(result.rawWinRate).toBe(0.5);
    expect(result.lengthAdjustment).toBeCloseTo(0.5, 10);
    expect(result.lengthControlledWinRate).toBe(0);
    expect(result.lengthControlledWinRate).toBeLessThan(result.rawWinRate);
  });

  it("字数差为零或样本为空时不产生长度调整", () => {
    expect(
      lengthControlledWinRate([
        { candidateWon: true, baselineChars: 120, candidateChars: 120 },
        { candidateWon: false, baselineChars: 120, candidateChars: 120 },
      ]),
    ).toEqual({ rawWinRate: 0.5, lengthControlledWinRate: 0.5, lengthAdjustment: 0 });
    expect(lengthControlledWinRate([])).toEqual({
      rawWinRate: 0,
      lengthControlledWinRate: 0,
      lengthAdjustment: 0,
    });
  });

  it("受控胜率始终落在 [0,1]", () => {
    const allWins = lengthControlledWinRate([
      { candidateWon: true, baselineChars: 100, candidateChars: 300 },
      { candidateWon: true, baselineChars: 200, candidateChars: 100 },
    ]);
    expect(allWins.lengthControlledWinRate).toBe(1);
  });
});
