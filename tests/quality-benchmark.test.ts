import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "../src/shared/prompt-version";
import {
  compareQualityBenchmarkVersions,
  evaluateQualityBenchmark,
  summarizeQualityBenchmark,
} from "../src/shared/quality-benchmark";
import { QUALITY_BENCHMARK } from "../src/shared/quality-benchmark-corpus";

describe("quality benchmark", () => {
  it("keeps the checked-in baseline above all quality gates", () => {
    expect(QUALITY_BENCHMARK.promptVersion).toBe(PROMPT_VERSION);
    const scores = QUALITY_BENCHMARK.cases.map(({ fixture, baselineOutput }) =>
      evaluateQualityBenchmark(fixture, baselineOutput),
    );
    const summary = summarizeQualityBenchmark(scores, QUALITY_BENCHMARK.minimumAverageScore);

    expect(summary).toMatchObject({ passed: true, hardIssueRecall: 100, evidenceAccuracy: 100 });
    expect(summary.averageScore).toBeGreaterThanOrEqual(QUALITY_BENCHMARK.minimumAverageScore);
  });

  it("fails when a hard issue is omitted even if the remaining output is well formed", () => {
    const fixture = QUALITY_BENCHMARK.cases[0].fixture;
    const score = evaluateQualityBenchmark(fixture, { issues: [] });

    expect(score.passed).toBe(false);
    expect(score.hardIssueRecall).toBe(0);
    expect(score.failures).toContain("存在硬性问题漏检或严重级别降级");
  });

  it("fails unsupported evidence and clean-case false positives", () => {
    const conflict = QUALITY_BENCHMARK.cases[1].fixture;
    const unsupported = evaluateQualityBenchmark(conflict, {
      issues: [{ severity: "硬性", category: "资源一致性", message: "灵石不足", evidence: "账本里从未出现的证据" }],
    });
    expect(unsupported.passed).toBe(false);
    expect(unsupported.unsupportedEvidenceCount).toBe(1);

    const clean = QUALITY_BENCHMARK.cases[4].fixture;
    const falsePositive = evaluateQualityBenchmark(clean, {
      issues: [{ severity: "硬性", category: "知识边界", message: "知识边界冲突", evidence: "第一张正式订单" }],
    });
    expect(falsePositive.passed).toBe(false);
    expect(falsePositive.falsePositiveCount).toBe(1);
  });

  it("reports why a candidate prompt version regressed", () => {
    const baselineScores = QUALITY_BENCHMARK.cases.map(({ fixture, baselineOutput }) =>
      evaluateQualityBenchmark(fixture, baselineOutput),
    );
    const candidateScores = QUALITY_BENCHMARK.cases.map(({ fixture, baselineOutput }, index) =>
      evaluateQualityBenchmark(fixture, index === 0 ? { issues: [] } : baselineOutput),
    );
    const comparison = compareQualityBenchmarkVersions(
      summarizeQualityBenchmark(baselineScores),
      summarizeQualityBenchmark(candidateScores),
    );

    expect(comparison.regressed).toBe(true);
    expect(comparison.reasons).toContain("硬性问题未全部识别");
    expect(comparison.delta).toBeLessThan(0);
  });
});
