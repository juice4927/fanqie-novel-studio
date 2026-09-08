import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QUALITY_BENCHMARK } from "../src/shared/quality-benchmark-corpus";
import { compareQualityRuns, evaluateQualityRun } from "../src/shared/quality-run";

const fixtures = QUALITY_BENCHMARK.cases.map((item) => item.fixture);
const corpusHash = createHash("sha256").update(JSON.stringify(fixtures)).digest("hex");

function run(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    corpusHash,
    model: "test-model",
    promptVersion: "test-prompt",
    capturedAt: "2026-09-08T00:00:00.000Z",
    parameters: { temperature: 0 },
    results: QUALITY_BENCHMARK.cases.map(({ fixture, baselineOutput }) => ({
      fixtureId: fixture.id,
      output: baselineOutput,
      durationMs: 100,
      usage: { inputTokens: 10, outputTokens: 20 },
      cost: 0.01,
    })),
    ...overrides,
  };
}

describe("actual quality run evaluation", () => {
  it("aggregates model output with usage and cost measurements", () => {
    const result = evaluateQualityRun(run(), fixtures, corpusHash);
    expect(result.summary.passed).toBe(true);
    expect(result.measurements).toMatchObject({ inputTokens: 60, outputTokens: 120, cost: 0.06 });
  });

  it("rejects incomplete or mismatched runs before grading", () => {
    expect(() => evaluateQualityRun(run({ corpusHash: "0".repeat(64) }), fixtures, corpusHash)).toThrow(
      "语料指纹不匹配",
    );
    expect(() =>
      evaluateQualityRun(
        run({ results: (run().results as Array<Record<string, unknown>>).slice(1) }),
        fixtures,
        corpusHash,
      ),
    ).toThrow("完整覆盖");
  });

  it("reports a regression when the candidate drops a hard issue", () => {
    const candidateResults = (run().results as Array<Record<string, unknown>>).map((result, index) =>
      index === 0 ? { ...result, output: { issues: [] } } : result,
    );
    const comparison = compareQualityRuns(run(), run({ results: candidateResults }), fixtures, corpusHash);
    expect(comparison.comparison.regressed).toBe(true);
    expect(comparison.comparison.reasons).toContain("硬性问题未全部识别");
  });
});
