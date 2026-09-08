import { readFileSync } from "node:fs";
import path from "node:path";
import { compareQualityBenchmarkRuns, parseQualityBenchmarkRun } from "../src/shared/quality-benchmark-run";

function readReport(filePath: string) {
  const absolute = path.resolve(filePath);
  try {
    return parseQualityBenchmarkRun(readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}：${error instanceof Error ? error.message : String(error)}`);
  }
}

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error("用法：compare-quality-runs <baseline.json> <candidate.json>");
  process.exitCode = 2;
} else {
  try {
    const result = compareQualityBenchmarkRuns(readReport(baselinePath), readReport(candidatePath));
    // Deliberately omit model output正文; this is a score and cost report only.
    console.log(
      JSON.stringify(
        {
          baseline: {
            runId: result.baseline.run.runId,
            model: result.baseline.run.model,
            promptVersion: result.baseline.run.promptVersion,
            summary: result.baseline.summary,
            usage: result.baseline.usage,
            scores: result.baseline.scores,
          },
          candidate: {
            runId: result.candidate.run.runId,
            model: result.candidate.run.model,
            promptVersion: result.candidate.run.promptVersion,
            summary: result.candidate.summary,
            usage: result.candidate.usage,
            scores: result.candidate.scores,
          },
          comparison: result.comparison,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
