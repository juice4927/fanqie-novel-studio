import { describe, expect, it } from "vitest";
import {
  estimateChapterOutputTokens,
  estimateCjkTextTokens,
  estimateStructuredRequestTokens,
  estimateTextTokens,
  STRUCTURED_REQUEST_OVERHEAD_TOKENS,
  TOKEN_ESTIMATE_WARNING,
} from "../src/shared/token-estimator";

describe("token estimates", () => {
  it("estimates CJK, latin text, punctuation and protocol overhead explicitly", () => {
    expect(estimateTextTokens("北仓控制方")).toBe(5);
    expect(estimateTextTokens("tokenEstimate1234")).toBe(5);
    expect(estimateTextTokens("北仓 token1234！")).toBe(6);
    expect(estimateStructuredRequestTokens(["北仓", "token1234"])).toBe(
      STRUCTURED_REQUEST_OVERHEAD_TOKENS + 2 + 3,
    );
  });

  it("uses chapter target length instead of a fixed output size", () => {
    expect(estimateCjkTextTokens(3_000_000)).toBe(3_000_000);
    expect(estimateCjkTextTokens(-1)).toBe(0);
    expect(estimateChapterOutputTokens(1800)).toBe(1880);
    expect(estimateChapterOutputTokens(3200)).toBe(3280);
    expect(TOKEN_ESTIMATE_WARNING).toContain("±50%");
  });
});
