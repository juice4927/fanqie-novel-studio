import { z } from "zod";
import {
  compareQualityBenchmarkVersions,
  evaluateQualityBenchmark,
  type QualityBenchmarkFixture,
  summarizeQualityBenchmark,
} from "./quality-benchmark";

const NonNegative = z.number().finite().nonnegative();
const QualityRunSchema = z.object({
  schemaVersion: z.literal(1),
  corpusHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  capturedAt: z.iso.datetime({ offset: true }),
  parameters: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
  results: z
    .array(
      z.object({
        fixtureId: z.string().min(1),
        output: z.object({
          issues: z.array(
            z.object({
              severity: z.enum(["硬性", "警告", "建议"]),
              category: z.string().trim().min(1),
              message: z.string().trim().min(1),
              evidence: z.string().trim().min(1),
            }),
          ),
        }),
        durationMs: NonNegative,
        usage: z.object({ inputTokens: NonNegative.int(), outputTokens: NonNegative.int() }).nullable(),
        cost: NonNegative.nullable(),
      }),
    )
    .min(1),
});

export type QualityRun = z.infer<typeof QualityRunSchema>;

/** 费用按 6 位小数归一，避免浮点累加产生 0.060000000000000005 之类的误差。 */
const roundCost = (value: number) => Math.round(value * 1e6) / 1e6;

export function evaluateQualityRun(
  input: unknown,
  fixtures: readonly QualityBenchmarkFixture[],
  corpusHash: string,
  minimumAverageScore = 90,
) {
  const parsed = QualityRunSchema.safeParse(input);
  if (!parsed.success) {
    // Report paths only: malformed model responses must not be echoed into logs.
    throw new Error(`评测文件格式无效：${parsed.error.issues.map((issue) => issue.path.join(".")).join("、")}`);
  }
  const run = parsed.data;
  if (run.corpusHash !== corpusHash) throw new Error("评测语料指纹不匹配，请用当前语料重新评测");
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  if (!fixtureIds.size || fixtureIds.size !== fixtures.length) throw new Error("评测语料为空或案例 ID 重复");
  const resultsById = new Map(run.results.map((result) => [result.fixtureId, result]));
  if (resultsById.size !== run.results.length) throw new Error("评测结果包含重复案例");
  if (resultsById.size !== fixtureIds.size || [...resultsById.keys()].some((id) => !fixtureIds.has(id)))
    throw new Error("评测结果必须完整覆盖当前语料，不能遗漏或添加案例");

  const scores = fixtures.map((fixture) => evaluateQualityBenchmark(fixture, resultsById.get(fixture.id)!.output));
  const summary = summarizeQualityBenchmark(scores, minimumAverageScore);
  const usageComplete = run.results.every((result) => result.usage !== null);
  const costComplete = run.results.every((result) => result.cost !== null);
  return {
    metadata: {
      model: run.model,
      promptVersion: run.promptVersion,
      capturedAt: run.capturedAt,
      parameters: run.parameters,
      corpusHash: run.corpusHash,
    },
    summary,
    scores,
    measurements: {
      durationMs: run.results.reduce((sum, result) => sum + result.durationMs, 0),
      inputTokens: usageComplete ? run.results.reduce((sum, result) => sum + result.usage!.inputTokens, 0) : null,
      outputTokens: usageComplete ? run.results.reduce((sum, result) => sum + result.usage!.outputTokens, 0) : null,
      cost: costComplete ? roundCost(run.results.reduce((sum, result) => sum + result.cost!, 0)) : null,
      missingUsageCases: run.results.filter((result) => result.usage === null).map((result) => result.fixtureId),
      missingCostCases: run.results.filter((result) => result.cost === null).map((result) => result.fixtureId),
    },
  };
}

export function compareQualityRuns(
  baselineInput: unknown,
  candidateInput: unknown,
  fixtures: readonly QualityBenchmarkFixture[],
  corpusHash: string,
  minimumAverageScore = 90,
) {
  const baseline = evaluateQualityRun(baselineInput, fixtures, corpusHash, minimumAverageScore);
  const candidate = evaluateQualityRun(candidateInput, fixtures, corpusHash, minimumAverageScore);
  return {
    baseline,
    candidate,
    comparison: compareQualityBenchmarkVersions(baseline.summary, candidate.summary),
  };
}
