import {
  compareQualityBenchmarkVersions,
  evaluateQualityBenchmark,
  type QualityBenchmarkFixture,
  type QualityBenchmarkScore,
  type QualityBenchmarkSummary,
  summarizeQualityBenchmark,
} from "./quality-benchmark";
import { QUALITY_BENCHMARK } from "./quality-benchmark-corpus";

export interface QualityRunUsage {
  inputTokens: number;
  outputTokens: number;
  actualCost: number;
  durationMs?: number;
}

export interface QualityRunCase {
  fixtureId: string;
  output: { issues: Array<{ severity: string; category: string; message: string; evidence: string }> };
  usage: QualityRunUsage;
}

export interface QualityBenchmarkRun {
  runId: string;
  model: string;
  promptVersion: string;
  corpusVersion: string;
  cases: QualityRunCase[];
}

export interface EvaluatedQualityRun {
  run: QualityBenchmarkRun;
  scores: QualityBenchmarkScore[];
  summary: QualityBenchmarkSummary;
  usage: { inputTokens: number; outputTokens: number; actualCost: number; durationMs: number };
}

const severities = new Set(["硬性", "警告", "建议"]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label}包含未知字段：${unknown.join("、")}`);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}必须是非空字符串`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label}必须是非负整数`);
  return Number(value);
}

function parseUsage(value: unknown, label: string): QualityRunUsage {
  if (!isObject(value)) throw new Error(`${label}必须是对象`);
  exactKeys(value, ["inputTokens", "outputTokens", "actualCost", "estimatedCost", "durationMs"], label);
  const actualCost = value.actualCost ?? value.estimatedCost;
  if (actualCost === undefined || typeof actualCost !== "number" || !Number.isFinite(actualCost) || actualCost < 0)
    throw new Error(`${label}.actualCost 必须是非负数字`);
  return {
    inputTokens: nonNegativeInteger(value.inputTokens, `${label}.inputTokens`),
    outputTokens: nonNegativeInteger(value.outputTokens, `${label}.outputTokens`),
    actualCost,
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: nonNegativeInteger(value.durationMs, `${label}.durationMs`) }),
  };
}

function parseOutput(value: unknown, label: string) {
  if (!isObject(value)) throw new Error(`${label}必须是对象`);
  exactKeys(value, ["issues"], label);
  if (!Array.isArray(value.issues)) throw new Error(`${label}.issues 必须是数组`);
  return {
    issues: value.issues.map((item, index) => {
      const issueLabel = `${label}.issues[${index}]`;
      if (!isObject(item)) throw new Error(`${issueLabel}必须是对象`);
      exactKeys(item, ["severity", "category", "message", "evidence"], issueLabel);
      const severity = requiredString(item.severity, `${issueLabel}.severity`);
      if (!severities.has(severity)) throw new Error(`${issueLabel}.severity 无效`);
      return {
        severity,
        category: requiredString(item.category, `${issueLabel}.category`),
        message: requiredString(item.message, `${issueLabel}.message`),
        evidence: requiredString(item.evidence, `${issueLabel}.evidence`),
      };
    }),
  };
}

export function benchmarkFixtures(
  input: readonly QualityBenchmarkFixture[] | readonly { fixture: QualityBenchmarkFixture }[] = QUALITY_BENCHMARK.cases,
) {
  return input.map((item) => ("fixture" in item ? item.fixture : item));
}

export function parseQualityBenchmarkRun(
  input: unknown,
  fixtures:
    | readonly QualityBenchmarkFixture[]
    | readonly { fixture: QualityBenchmarkFixture }[] = QUALITY_BENCHMARK.cases,
): QualityBenchmarkRun {
  const value =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input) as unknown;
          } catch {
            throw new Error("报告不是合法 JSON");
          }
        })()
      : input;
  if (!isObject(value)) throw new Error("质量评测报告必须是对象");
  exactKeys(value, ["runId", "model", "promptVersion", "corpusVersion", "cases"], "报告");
  const cases = benchmarkFixtures(fixtures);
  const fixtureIds = new Set(cases.map((fixture) => fixture.id));
  if (fixtureIds.size !== cases.length) throw new Error("评测 fixture 集合包含重复 ID");
  const expectedCorpus = QUALITY_BENCHMARK.corpusVersion;
  if (value.corpusVersion !== expectedCorpus) throw new Error(`corpusVersion 必须为 ${expectedCorpus}`);
  if (!Array.isArray(value.cases)) throw new Error("报告.cases 必须是数组");
  if (value.cases.length !== cases.length) throw new Error("报告必须为每个 fixture 提供且只提供一条结果");
  const seen = new Set<string>();
  const parsed = value.cases.map((item, index) => {
    const label = `报告.cases[${index}]`;
    if (!isObject(item)) throw new Error(`${label}必须是对象`);
    exactKeys(item, ["fixtureId", "output", "usage"], label);
    const fixtureId = requiredString(item.fixtureId, `${label}.fixtureId`);
    if (!fixtureIds.has(fixtureId)) throw new Error(`报告包含未知 fixture：${fixtureId}`);
    if (seen.has(fixtureId)) throw new Error(`报告包含重复 fixture：${fixtureId}`);
    seen.add(fixtureId);
    return {
      fixtureId,
      output: parseOutput(item.output, `${label}.output`),
      usage: parseUsage(item.usage, `${label}.usage`),
    };
  });
  if (seen.size !== fixtureIds.size) throw new Error("报告缺少 fixture 结果");
  return {
    runId: requiredString(value.runId, "报告.runId"),
    model: requiredString(value.model, "报告.model"),
    promptVersion: requiredString(value.promptVersion, "报告.promptVersion"),
    corpusVersion: requiredString(value.corpusVersion, "报告.corpusVersion"),
    cases: parsed,
  };
}

export function evaluateQualityBenchmarkRun(
  run: QualityBenchmarkRun,
  fixtures:
    | readonly QualityBenchmarkFixture[]
    | readonly { fixture: QualityBenchmarkFixture }[] = QUALITY_BENCHMARK.cases,
  minimumAverageScore = QUALITY_BENCHMARK.minimumAverageScore,
): EvaluatedQualityRun {
  const cases = benchmarkFixtures(fixtures);
  const byId = new Map(run.cases.map((item) => [item.fixtureId, item]));
  const scores = cases.map((fixture) => {
    const result = byId.get(fixture.id);
    if (!result) throw new Error(`运行报告缺少 fixture：${fixture.id}`);
    return evaluateQualityBenchmark(fixture, result.output);
  });
  const usage = run.cases.reduce(
    (sum, item) => ({
      inputTokens: sum.inputTokens + item.usage.inputTokens,
      outputTokens: sum.outputTokens + item.usage.outputTokens,
      actualCost: sum.actualCost + item.usage.actualCost,
      durationMs: sum.durationMs + (item.usage.durationMs ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, actualCost: 0, durationMs: 0 },
  );
  return { run, scores, summary: summarizeQualityBenchmark(scores, minimumAverageScore), usage };
}

export function compareQualityBenchmarkRuns(
  baseline: QualityBenchmarkRun,
  candidate: QualityBenchmarkRun,
  fixtures:
    | readonly QualityBenchmarkFixture[]
    | readonly { fixture: QualityBenchmarkFixture }[] = QUALITY_BENCHMARK.cases,
  minimumAverageScore = QUALITY_BENCHMARK.minimumAverageScore,
) {
  const baselineEvaluated = evaluateQualityBenchmarkRun(baseline, fixtures, minimumAverageScore);
  const candidateEvaluated = evaluateQualityBenchmarkRun(candidate, fixtures, minimumAverageScore);
  return {
    baseline: baselineEvaluated,
    candidate: candidateEvaluated,
    comparison: compareQualityBenchmarkVersions(baselineEvaluated.summary, candidateEvaluated.summary),
  };
}
