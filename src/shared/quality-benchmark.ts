import type { QualityIssue } from "./types";

export type BenchmarkSeverity = QualityIssue["severity"];

export interface ExpectedBenchmarkIssue {
  id: string;
  category: string;
  severity: BenchmarkSeverity;
  matchAny: string[];
}

export interface QualityBenchmarkFixture {
  id: string;
  title: string;
  genre: string;
  stage: string;
  chapter: string;
  contextEvidence: string[];
  expectedIssues: ExpectedBenchmarkIssue[];
  forbiddenIssueTerms?: string[];
}

export interface BenchmarkIssueInput {
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  evidence?: unknown;
}

export interface QualityBenchmarkScore {
  fixtureId: string;
  expectedCount: number;
  actualCount: number;
  matchedCount: number;
  falsePositiveCount: number;
  unsupportedEvidenceCount: number;
  issueRecall: number;
  precision: number;
  severityAccuracy: number;
  evidenceAccuracy: number;
  falsePositiveControl: number;
  totalScore: number;
  hardIssueRecall: number;
  passed: boolean;
  failures: string[];
}

export interface QualityBenchmarkSummary {
  fixtureCount: number;
  averageScore: number;
  issueRecall: number;
  precision: number;
  severityAccuracy: number;
  evidenceAccuracy: number;
  falsePositiveControl: number;
  hardIssueRecall: number;
  failedFixtureIds: string[];
  passed: boolean;
}

const compact = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
const percentage = (numerator: number, denominator: number) => denominator ? numerator / denominator * 100 : 100;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 100;

function normalizeIssues(output: unknown): Array<Required<BenchmarkIssueInput>> {
  const issues = output && typeof output === "object" && Array.isArray((output as { issues?: unknown }).issues)
    ? (output as { issues: unknown[] }).issues
    : [];
  return issues
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === "object")
    .map((issue) => ({
      severity: typeof issue.severity === "string" ? issue.severity : "",
      category: typeof issue.category === "string" ? issue.category : "",
      message: typeof issue.message === "string" ? issue.message : "",
      evidence: typeof issue.evidence === "string" ? issue.evidence : "",
    }));
}

function issueMatches(expected: ExpectedBenchmarkIssue, actual: Required<BenchmarkIssueInput>) {
  if (compact(String(actual.category)) !== compact(expected.category)) return false;
  const searchable = compact(`${actual.message}\n${actual.evidence}`);
  return expected.matchAny.some((term) => searchable.includes(compact(term)));
}

function evidenceIsSupported(fixture: QualityBenchmarkFixture, evidence: string) {
  const candidate = compact(evidence);
  if (candidate.length < 4) return false;
  return [fixture.chapter, ...fixture.contextEvidence].some((source) => compact(source).includes(candidate));
}

export function evaluateQualityBenchmark(
  fixture: QualityBenchmarkFixture,
  output: unknown,
  minimumScore = 85,
): QualityBenchmarkScore {
  const actual = normalizeIssues(output);
  const unmatchedActual = new Set(actual.map((_, index) => index));
  const matches: Array<{ expected: ExpectedBenchmarkIssue; actual: Required<BenchmarkIssueInput> }> = [];

  for (const expected of fixture.expectedIssues) {
    const matchIndex = [...unmatchedActual].find((index) => issueMatches(expected, actual[index]));
    if (matchIndex === undefined) continue;
    unmatchedActual.delete(matchIndex);
    matches.push({ expected, actual: actual[matchIndex] });
  }

  const matchedCount = matches.length;
  const falsePositiveCount = unmatchedActual.size;
  const supportedMatches = matches.filter(({ actual: issue }) => evidenceIsSupported(fixture, String(issue.evidence)));
  const unsupportedEvidenceCount = actual.filter((issue) => !evidenceIsSupported(fixture, String(issue.evidence))).length;
  const correctSeverity = matches.filter(({ expected, actual: issue }) => issue.severity === expected.severity).length;
  const expectedHard = fixture.expectedIssues.filter((issue) => issue.severity === "硬性");
  const matchedHard = expectedHard.filter((expected) => matches.some((match) => match.expected.id === expected.id && match.actual.severity === "硬性"));
  const forbiddenHits = actual.filter((issue) => (fixture.forbiddenIssueTerms ?? []).some((term) => compact(`${issue.category}${issue.message}${issue.evidence}`).includes(compact(term))));

  const issueRecall = percentage(matchedCount, fixture.expectedIssues.length);
  const precision = percentage(matchedCount, actual.length);
  const severityAccuracy = percentage(correctSeverity, matches.length);
  const evidenceAccuracy = percentage(supportedMatches.length, matches.length);
  const falsePositiveControl = actual.length ? Math.max(0, 100 - falsePositiveCount / actual.length * 100) : 100;
  const hardIssueRecall = percentage(matchedHard.length, expectedHard.length);
  const totalScore = issueRecall * .35 + precision * .2 + severityAccuracy * .15 + evidenceAccuracy * .2 + falsePositiveControl * .1;
  const failures: string[] = [];

  if (totalScore < minimumScore) failures.push(`总分 ${totalScore.toFixed(1)} 低于门槛 ${minimumScore}`);
  if (hardIssueRecall < 100) failures.push("存在硬性问题漏检或严重级别降级");
  if (forbiddenHits.length) failures.push(`命中 ${forbiddenHits.length} 条禁止误报`);
  if (unsupportedEvidenceCount) failures.push(`${unsupportedEvidenceCount} 条问题缺少可追溯证据`);

  return {
    fixtureId: fixture.id,
    expectedCount: fixture.expectedIssues.length,
    actualCount: actual.length,
    matchedCount,
    falsePositiveCount,
    unsupportedEvidenceCount,
    issueRecall,
    precision,
    severityAccuracy,
    evidenceAccuracy,
    falsePositiveControl,
    totalScore,
    hardIssueRecall,
    passed: failures.length === 0,
    failures,
  };
}

export function summarizeQualityBenchmark(scores: QualityBenchmarkScore[], minimumAverageScore = 90): QualityBenchmarkSummary {
  const summary = {
    fixtureCount: scores.length,
    averageScore: average(scores.map((score) => score.totalScore)),
    issueRecall: average(scores.map((score) => score.issueRecall)),
    precision: average(scores.map((score) => score.precision)),
    severityAccuracy: average(scores.map((score) => score.severityAccuracy)),
    evidenceAccuracy: average(scores.map((score) => score.evidenceAccuracy)),
    falsePositiveControl: average(scores.map((score) => score.falsePositiveControl)),
    hardIssueRecall: average(scores.map((score) => score.hardIssueRecall)),
    failedFixtureIds: scores.filter((score) => !score.passed).map((score) => score.fixtureId),
  };
  return {
    ...summary,
    passed: scores.length > 0 && summary.averageScore >= minimumAverageScore && summary.hardIssueRecall === 100 && summary.failedFixtureIds.length === 0,
  };
}

export function compareQualityBenchmarkVersions(baseline: QualityBenchmarkSummary, candidate: QualityBenchmarkSummary) {
  const reasons: string[] = [];
  if (candidate.averageScore + 2 < baseline.averageScore) reasons.push("平均质量分下降超过 2 分");
  if (candidate.issueRecall < baseline.issueRecall) reasons.push("问题召回率下降");
  if (candidate.hardIssueRecall < 100) reasons.push("硬性问题未全部识别");
  if (candidate.evidenceAccuracy < baseline.evidenceAccuracy) reasons.push("证据准确率下降");
  if (!candidate.passed) reasons.push("候选版本未通过质量门禁");
  return { delta: candidate.averageScore - baseline.averageScore, regressed: reasons.length > 0, reasons };
}
