import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "../src/shared/prompt-version";
import {
  bootstrapConfidenceInterval,
  compareQualityBenchmarkVersions,
  DEFAULT_QUALITY_RUBRIC_WEIGHTS,
  evaluateQualityBenchmark,
  type QualityBenchmarkFixture,
  type QualityBenchmarkSummary,
  rubricWeightsForChapterKind,
  summarizeQualityBenchmark,
} from "../src/shared/quality-benchmark";
import { QUALITY_BENCHMARK } from "../src/shared/quality-benchmark-corpus";
import { buildPercentileReport } from "../src/shared/quality-benchmark-report";

function fixtureById(id: string): QualityBenchmarkFixture {
  const found = QUALITY_BENCHMARK.cases.find(({ fixture }) => fixture.id === id);
  if (!found) throw new Error(`未知 fixture：${id}`);
  return found.fixture;
}

function summary(overrides: Partial<QualityBenchmarkSummary> = {}): QualityBenchmarkSummary {
  return {
    fixtureCount: 3,
    averageScore: 90,
    issueRecall: 100,
    precision: 100,
    severityAccuracy: 100,
    evidenceAccuracy: 100,
    falsePositiveControl: 100,
    hardIssueRecall: 100,
    failedFixtureIds: [],
    passed: true,
    ...overrides,
  };
}

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
    expect(comparison.confidenceInterval).toBeUndefined();
  });

  it("默认 rubric 权重与历史逐位一致，章型权重必须显式传入", () => {
    expect(DEFAULT_QUALITY_RUBRIC_WEIGHTS).toEqual({
      issueRecall: 0.35,
      precision: 0.2,
      severityAccuracy: 0.15,
      evidenceAccuracy: 0.2,
      falsePositiveControl: 0.1,
    });
    const fixture = fixtureById("flat-but-valid");
    expect(fixture.chapterKind).toBe("过渡");
    const output = {
      issues: [{ severity: "建议", category: "文风", message: "节奏平淡", evidence: "值班室的灯亮着" }],
    };
    // 改动前该输出即 70 分：召回 / 严重度 / 证据维度 100，精确率与误报控制 0。
    const score = evaluateQualityBenchmark(fixture, output);
    expect(score.totalScore).toBe(70);
    expect(score.advisoryCount).toBe(0);
    // 只有显式传入章型 rubric 才会改变权重。
    expect(evaluateQualityBenchmark(fixture, output, 85, rubricWeightsForChapterKind("过渡")).totalScore).toBe(55);
    expect(rubricWeightsForChapterKind("过渡")).toEqual({
      issueRecall: 0.25,
      precision: 0.25,
      severityAccuracy: 0.15,
      evidenceAccuracy: 0.15,
      falsePositiveControl: 0.2,
    });
    expect(rubricWeightsForChapterKind(undefined)).toEqual(DEFAULT_QUALITY_RUBRIC_WEIGHTS);
  });

  it("advisory 观察项只计数，不影响通过判定", () => {
    const fixture: QualityBenchmarkFixture = {
      id: "advisory-only",
      title: "紫辞藻只作观察",
      genre: "都市脑洞",
      stage: "追读",
      chapter: "林舟站在窗前，夜色如墨。",
      contextEvidence: [],
      expectedIssues: [],
      advisoryIssues: [{ id: "purple-prose", category: "文风", matchAny: ["紫辞藻", "强行比喻"] }],
    };
    const advisory = evaluateQualityBenchmark(fixture, {
      issues: [{ severity: "建议", category: "文风", message: "紫辞藻堆砌", evidence: "夜色如墨" }],
    });

    expect(advisory.advisoryCount).toBe(1);
    expect(advisory.falsePositiveCount).toBe(0);
    expect(advisory.passed).toBe(true);
    expect(advisory.totalScore).toBe(100);

    const undeclared = evaluateQualityBenchmark(fixture, {
      issues: [{ severity: "建议", category: "文风", message: "节奏拖沓", evidence: "夜色如墨" }],
    });
    expect(undeclared.advisoryCount).toBe(0);
    expect(undeclared.falsePositiveCount).toBe(1);
    expect(undeclared.passed).toBe(false);
  });

  it("bootstrap 置信区间可复现且有界", () => {
    const scores = [70, 80, 90, 100];
    const first = bootstrapConfidenceInterval(scores, { seed: 7 });
    const second = bootstrapConfidenceInterval(scores, { seed: 7 });

    expect(first).toEqual(second);
    expect(first.mean).toBe(85);
    expect(first.lower).toBeLessThanOrEqual(first.mean);
    expect(first.mean).toBeLessThanOrEqual(first.upper);
    expect(bootstrapConfidenceInterval([80, 80, 80], { iterations: 200, seed: 1 })).toEqual({
      mean: 80,
      lower: 80,
      upper: 80,
    });
    expect(bootstrapConfidenceInterval([])).toEqual({ mean: 0, lower: 0, upper: 0 });

    const narrow = bootstrapConfidenceInterval(scores, { confidence: 0.8, seed: 11 });
    const wide = bootstrapConfidenceInterval(scores, { confidence: 0.99, seed: 11 });
    expect(wide.upper - wide.lower).toBeGreaterThanOrEqual(narrow.upper - narrow.lower);
  });

  it("差异落在置信区间内时不判回归", () => {
    const baseline = summary();
    const candidate = summary({ averageScore: 87 });

    const significant = compareQualityBenchmarkVersions(baseline, candidate, {
      baselineScores: [90, 90, 90],
      candidateScores: [85, 88, 86],
    });
    expect(significant.reasons).toContain("平均质量分下降超过 2 分");
    expect(significant.confidenceInterval!.upper).toBeLessThan(0);
    expect(significant.regressed).toBe(true);

    const ambiguous = compareQualityBenchmarkVersions(baseline, candidate, {
      baselineScores: [90, 90, 90],
      candidateScores: [89, 91, 89],
    });
    expect(ambiguous.reasons).toContain("平均质量分下降超过 2 分");
    expect(ambiguous.confidenceInterval!.upper).toBeGreaterThanOrEqual(0);
    expect(ambiguous.regressed).toBe(false);
  });

  it("分位报告只输出观察值，不含通过判定", () => {
    const samples = [
      { dimension: "连贯", score: 60 },
      { dimension: "连贯", score: 80 },
      { dimension: "人物一致", score: 90 },
      { dimension: "文笔", score: 70 },
      { dimension: "文笔", score: 90 },
      { dimension: "未知维度", score: 100 },
    ];
    const report = buildPercentileReport(samples, { iterations: 200, seed: 3 });

    expect(report.observational).toBe(true);
    expect(report.note).toContain("观察");
    expect("passed" in report).toBe(false);
    expect(report.dimensions.map((item) => item.name)).toEqual(["连贯", "人物一致", "文笔"]);
    expect(report.dimensions[0]).toMatchObject({ percentile: 70, sampleCount: 2 });
    expect(report.dimensions[1]).toMatchObject({ percentile: 90, sampleCount: 1 });
    expect(report.dimensions[0].confidenceInterval.lower).toBeLessThanOrEqual(70);
    expect(report.dimensions[0].confidenceInterval.upper).toBeGreaterThanOrEqual(70);
    expect(buildPercentileReport(samples, { iterations: 200, seed: 3 })).toEqual(report);
  });
});
