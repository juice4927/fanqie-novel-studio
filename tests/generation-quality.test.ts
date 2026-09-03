import { describe, expect, it } from "vitest";
import { computeGenerationQuality, type GenerationDecision, reviewTierLabel } from "../src/shared/generation-quality";

const decision = (action: "adopted" | "reverted", index = 0): GenerationDecision => ({
  chapterId: `chapter-${index}`,
  action,
  at: `2026-09-03T00:00:${String(index).padStart(2, "0")}.000Z`,
});

describe("generation quality window", () => {
  it("starts in scrutiny until enough samples exist", () => {
    expect(computeGenerationQuality([decision("adopted", 1)]).tier).toBe("scrutiny");
    expect(computeGenerationQuality([decision("adopted", 1), decision("adopted", 2)]).total).toBe(2);
  });

  it("recommends scrutiny when revert rate is high", () => {
    const decisions = Array.from({ length: 10 }, (_, index) => decision(index < 4 ? "reverted" : "adopted", index));
    const quality = computeGenerationQuality(decisions);
    expect(quality.revertRate).toBeCloseTo(0.4);
    expect(quality.tier).toBe("scrutiny");
  });

  it("recommends sampling when AI output is stable", () => {
    const decisions = Array.from({ length: 10 }, (_, index) => decision(index === 9 ? "reverted" : "adopted", index));
    const quality = computeGenerationQuality(decisions);
    expect(quality.tier).toBe("sample");
    expect(reviewTierLabel("sample")).toContain("摘要与异常");
  });

  it("keeps only the most recent window", () => {
    const decisions = Array.from({ length: 25 }, (_, index) =>
      decision(index % 3 === 0 ? "reverted" : "adopted", index),
    );
    expect(computeGenerationQuality(decisions).total).toBe(20);
  });
});
