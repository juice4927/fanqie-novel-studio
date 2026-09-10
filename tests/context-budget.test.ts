import { describe, expect, it } from "vitest";
import {
  CONTEXT_REFERENCE_BUDGET_TOKENS,
  CONTEXT_REFERENCE_WINDOW,
  contextBudgetTokens,
  contextScale,
  DEFAULT_CLOUD_CONTEXT_WINDOW,
  DEFAULT_LOCAL_CONTEXT_WINDOW,
  resolveContextWindow,
} from "../src/shared/context-budget";
import { DEFAULT_CONTEXT_BUDGET_TOKENS } from "../src/shared/context-compiler";

describe("context budget", () => {
  it("defaults unknown cloud windows to 1M and local endpoints to 32k", () => {
    expect(DEFAULT_CLOUD_CONTEXT_WINDOW).toBe(1_000_000);
    expect(resolveContextWindow({})).toBe(1_000_000);
    expect(resolveContextWindow({ contextWindow: null })).toBe(1_000_000);
    expect(resolveContextWindow({ localEndpoint: true })).toBe(DEFAULT_LOCAL_CONTEXT_WINDOW);
  });

  it("prefers an explicit window over the default", () => {
    expect(resolveContextWindow({ contextWindow: 128_000 })).toBe(128_000);
    expect(resolveContextWindow({ contextWindow: 200_000, localEndpoint: true })).toBe(200_000);
  });

  it("derives the default budget from the 1M default window", () => {
    expect(DEFAULT_CONTEXT_BUDGET_TOKENS).toBe(contextBudgetTokens(1_000_000));
    expect(DEFAULT_CONTEXT_BUDGET_TOKENS).toBeGreaterThan(CONTEXT_REFERENCE_BUDGET_TOKENS);
  });

  it("keeps the cap-scaling reference at 128k so small windows are not squeezed", () => {
    expect(CONTEXT_REFERENCE_WINDOW).toBe(128_000);
    expect(contextScale(CONTEXT_REFERENCE_BUDGET_TOKENS)).toBe(1);
    expect(contextScale(contextBudgetTokens(1_000_000))).toBe(1);
    expect(contextScale(contextBudgetTokens(32_000))).toBeCloseTo(0.15, 5);
  });
});
