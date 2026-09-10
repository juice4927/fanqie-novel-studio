import type { QualityIssue } from "./types";

export type BenchmarkSeverity = QualityIssue["severity"];

/** 章节类型：不同章型的评测侧重不同，仅在调用方显式传入 rubric 时生效。 */
export type BenchmarkChapterKind = "开篇" | "蓄势" | "高潮" | "过渡" | "揭秘";

export interface ExpectedBenchmarkIssue {
  id: string;
  category: string;
  severity: BenchmarkSeverity;
  matchAny: string[];
}

/** 观察项：命中只计数（advisoryCount），既不判失败，也不计入误报与证据缺失。 */
export interface AdvisoryBenchmarkIssue {
  id: string;
  category: string;
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
  chapterKind?: BenchmarkChapterKind;
  advisoryIssues?: AdvisoryBenchmarkIssue[];
}

/** 五个维度的评分权重；默认值必须与历史实现逐位一致，改动会让历史分数不可比。 */
export interface QualityRubricWeights {
  issueRecall: number;
  precision: number;
  severityAccuracy: number;
  evidenceAccuracy: number;
  falsePositiveControl: number;
}

export const DEFAULT_QUALITY_RUBRIC_WEIGHTS: QualityRubricWeights = {
  issueRecall: 0.35,
  precision: 0.2,
  severityAccuracy: 0.15,
  evidenceAccuracy: 0.2,
  falsePositiveControl: 0.1,
};

/** 章节类型 rubric：只在调用方显式取用时生效，不传 rubric 的评测仍用默认权重。 */
export const CHAPTER_KIND_RUBRIC_WEIGHTS: Record<BenchmarkChapterKind, QualityRubricWeights> = {
  开篇: { issueRecall: 0.4, precision: 0.2, severityAccuracy: 0.15, evidenceAccuracy: 0.15, falsePositiveControl: 0.1 },
  蓄势: {
    issueRecall: 0.3,
    precision: 0.25,
    severityAccuracy: 0.15,
    evidenceAccuracy: 0.15,
    falsePositiveControl: 0.15,
  },
  高潮: { issueRecall: 0.4, precision: 0.15, severityAccuracy: 0.15, evidenceAccuracy: 0.2, falsePositiveControl: 0.1 },
  过渡: {
    issueRecall: 0.25,
    precision: 0.25,
    severityAccuracy: 0.15,
    evidenceAccuracy: 0.15,
    falsePositiveControl: 0.2,
  },
  揭秘: { issueRecall: 0.3, precision: 0.2, severityAccuracy: 0.15, evidenceAccuracy: 0.25, falsePositiveControl: 0.1 },
};

export interface BootstrapOptions {
  iterations?: number;
  confidence?: number;
  seed?: number;
}

export interface BootstrapConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
}

export interface QualityBenchmarkBootstrapInput extends BootstrapOptions {
  baselineScores: readonly number[];
  candidateScores: readonly number[];
}

export interface QualityBenchmarkComparison {
  delta: number;
  regressed: boolean;
  reasons: string[];
  confidenceInterval?: BootstrapConfidenceInterval;
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
  /** 命中 advisoryIssues 的条数：只观察，不影响 passed。 */
  advisoryCount: number;
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
const percentage = (numerator: number, denominator: number) => (denominator ? (numerator / denominator) * 100 : 100);
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 100;

/** 权重按总和归一；总和已经等于 1 时原样返回，避免浮点归一改变历史分数。 */
export function normalizeRubricWeights(weights: QualityRubricWeights): QualityRubricWeights {
  const total =
    weights.issueRecall +
    weights.precision +
    weights.severityAccuracy +
    weights.evidenceAccuracy +
    weights.falsePositiveControl;
  if (!Number.isFinite(total) || total <= 0) return DEFAULT_QUALITY_RUBRIC_WEIGHTS;
  if (Math.abs(total - 1) < 1e-9) return { ...weights };
  return {
    issueRecall: weights.issueRecall / total,
    precision: weights.precision / total,
    severityAccuracy: weights.severityAccuracy / total,
    evidenceAccuracy: weights.evidenceAccuracy / total,
    falsePositiveControl: weights.falsePositiveControl / total,
  };
}

/** 取某章节类型的权重；不传 chapterKind 时退回默认权重（与历史分数一致）。 */
export function rubricWeightsForChapterKind(
  chapterKind?: BenchmarkChapterKind,
  override?: Partial<QualityRubricWeights>,
): QualityRubricWeights {
  const base = chapterKind ? CHAPTER_KIND_RUBRIC_WEIGHTS[chapterKind] : DEFAULT_QUALITY_RUBRIC_WEIGHTS;
  return normalizeRubricWeights({ ...base, ...override });
}

/** mulberry32：32 位确定性 PRNG，保证同一 seed 的重采样结果完全可复现。 */
function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 线性插值分位数（type 7），入参必须已升序排序。 */
function quantile(sorted: readonly number[], ratio: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * ratio;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * (position - lowerIndex);
}

/**
 * 对样本均值做 bootstrap 重采样，返回置信区间。
 * 百分位法：把 iterations 次重采样均值升序排列，取 (1-confidence)/2 与 1-(1-confidence)/2 分位。
 */
export function bootstrapConfidenceInterval(
  scores: readonly number[],
  options: BootstrapOptions = {},
): BootstrapConfidenceInterval {
  const values = scores.filter((score) => Number.isFinite(score));
  if (!values.length) return { mean: 0, lower: 0, upper: 0 };
  const iterations = Math.max(1, Math.floor(Number.isFinite(options.iterations) ? options.iterations! : 1000));
  const confidence =
    Number.isFinite(options.confidence) && options.confidence! > 0 && options.confidence! < 1
      ? options.confidence!
      : 0.95;
  const random = createSeededRandom(Number.isFinite(options.seed) ? options.seed! : 42);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return { mean: average(values), lower: quantile(means, tail), upper: quantile(means, 1 - tail) };
}

function normalizeIssues(output: unknown): Array<Required<BenchmarkIssueInput>> {
  const issues =
    output && typeof output === "object" && Array.isArray((output as { issues?: unknown }).issues)
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

function issueMatchesPattern(pattern: { category: string; matchAny: string[] }, actual: Required<BenchmarkIssueInput>) {
  if (compact(String(actual.category)) !== compact(pattern.category)) return false;
  const searchable = compact(`${actual.message}\n${actual.evidence}`);
  return pattern.matchAny.some((term) => searchable.includes(compact(term)));
}

function evidenceIsSupported(fixture: QualityBenchmarkFixture, evidence: string) {
  const candidate = compact(evidence);
  if (candidate.length < 4) return false;
  return [fixture.chapter, ...fixture.contextEvidence].some((source) => compact(source).includes(candidate));
}

/**
 * 评测单个 fixture。rubricOverride 缺省时使用 DEFAULT_QUALITY_RUBRIC_WEIGHTS，
 * 因此已入库 fixture 的分数与历史完全一致；需要按章型调权时传 rubricWeightsForChapterKind(...)。
 */
export function evaluateQualityBenchmark(
  fixture: QualityBenchmarkFixture,
  output: unknown,
  minimumScore = 85,
  rubricOverride?: Partial<QualityRubricWeights>,
): QualityBenchmarkScore {
  const weights = rubricOverride
    ? normalizeRubricWeights({ ...DEFAULT_QUALITY_RUBRIC_WEIGHTS, ...rubricOverride })
    : DEFAULT_QUALITY_RUBRIC_WEIGHTS;
  const actual = normalizeIssues(output);
  const unmatchedActual = new Set(actual.map((_, index) => index));
  const matches: Array<{ expected: ExpectedBenchmarkIssue; actual: Required<BenchmarkIssueInput> }> = [];

  for (const expected of fixture.expectedIssues) {
    const matchIndex = [...unmatchedActual].find((index) => issueMatchesPattern(expected, actual[index]));
    if (matchIndex === undefined) continue;
    unmatchedActual.delete(matchIndex);
    matches.push({ expected, actual: actual[matchIndex] });
  }

  // 观察项在期望项之后匹配：同一条问题同时命中两者时按期望项计，避免召回被观察项吞掉。
  const advisoryIndexes = new Set<number>();
  for (const advisory of fixture.advisoryIssues ?? []) {
    for (const index of [...unmatchedActual]) {
      if (!issueMatchesPattern(advisory, actual[index])) continue;
      unmatchedActual.delete(index);
      advisoryIndexes.add(index);
    }
  }

  const matchedCount = matches.length;
  const advisoryCount = advisoryIndexes.size;
  const scoredActualCount = actual.length - advisoryCount;
  const falsePositiveCount = unmatchedActual.size;
  const supportedMatches = matches.filter(({ actual: issue }) => evidenceIsSupported(fixture, String(issue.evidence)));
  const unsupportedEvidenceCount = actual.filter(
    (issue, index) => !advisoryIndexes.has(index) && !evidenceIsSupported(fixture, String(issue.evidence)),
  ).length;
  const correctSeverity = matches.filter(({ expected, actual: issue }) => issue.severity === expected.severity).length;
  const expectedHard = fixture.expectedIssues.filter((issue) => issue.severity === "硬性");
  const matchedHard = expectedHard.filter((expected) =>
    matches.some((match) => match.expected.id === expected.id && match.actual.severity === "硬性"),
  );
  const forbiddenHits = actual.filter((issue) =>
    (fixture.forbiddenIssueTerms ?? []).some((term) =>
      compact(`${issue.category}${issue.message}${issue.evidence}`).includes(compact(term)),
    ),
  );

  const issueRecall = percentage(matchedCount, fixture.expectedIssues.length);
  const precision = percentage(matchedCount, scoredActualCount);
  const severityAccuracy = percentage(correctSeverity, matches.length);
  const evidenceAccuracy = percentage(supportedMatches.length, matches.length);
  const falsePositiveControl = scoredActualCount
    ? Math.max(0, 100 - (falsePositiveCount / scoredActualCount) * 100)
    : 100;
  const hardIssueRecall = percentage(matchedHard.length, expectedHard.length);
  const totalScore =
    issueRecall * weights.issueRecall +
    precision * weights.precision +
    severityAccuracy * weights.severityAccuracy +
    evidenceAccuracy * weights.evidenceAccuracy +
    falsePositiveControl * weights.falsePositiveControl;
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
    advisoryCount,
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

export function summarizeQualityBenchmark(
  scores: QualityBenchmarkScore[],
  minimumAverageScore = 90,
): QualityBenchmarkSummary {
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
    passed:
      scores.length > 0 &&
      summary.averageScore >= minimumAverageScore &&
      summary.hardIssueRecall === 100 &&
      summary.failedFixtureIds.length === 0,
  };
}

/**
 * 比较两个版本的质量摘要。
 * 传入 bootstrap 输入（两次评测的逐 fixture 分数）时额外返回置信区间：
 * 只有逐 fixture 分差的重采样区间整体低于 0（即 0 不在区间内），才把阈值触发的差异判为回归；
 * 不传 bootstrap 时行为与历史完全一致。
 */
export function compareQualityBenchmarkVersions(
  baseline: QualityBenchmarkSummary,
  candidate: QualityBenchmarkSummary,
  bootstrap?: QualityBenchmarkBootstrapInput,
): QualityBenchmarkComparison {
  const reasons: string[] = [];
  if (candidate.averageScore + 2 < baseline.averageScore) reasons.push("平均质量分下降超过 2 分");
  if (candidate.issueRecall < baseline.issueRecall) reasons.push("问题召回率下降");
  if (candidate.hardIssueRecall < 100) reasons.push("硬性问题未全部识别");
  if (candidate.evidenceAccuracy < baseline.evidenceAccuracy) reasons.push("证据准确率下降");
  if (!candidate.passed) reasons.push("候选版本未通过质量门禁");
  const delta = candidate.averageScore - baseline.averageScore;
  if (!bootstrap) return { delta, regressed: reasons.length > 0, reasons };
  const { baselineScores, candidateScores } = bootstrap;
  if (baselineScores.length !== candidateScores.length) {
    throw new Error("bootstrap 的 baselineScores 与 candidateScores 长度必须一致");
  }
  const deltas = baselineScores.map((score, index) => candidateScores[index] - score);
  const confidenceInterval = bootstrapConfidenceInterval(deltas, bootstrap);
  return {
    delta,
    regressed: reasons.length > 0 && confidenceInterval.upper < 0,
    reasons,
    confidenceInterval,
  };
}
