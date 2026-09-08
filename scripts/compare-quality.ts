import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { QUALITY_BENCHMARK } from "../src/shared/quality-benchmark-corpus";
import { compareQualityRuns } from "../src/shared/quality-run";

const fixtures = QUALITY_BENCHMARK.cases.map((item) => item.fixture);
// Bind runs to both source material and the expected grading criteria.
const corpusHash = createHash("sha256").update(JSON.stringify(fixtures)).digest("hex");

function readRun(filename: string) {
  if (statSync(filename).size > 10 * 1024 * 1024) throw new Error("评测输入文件不能超过 10 MiB");
  try {
    return JSON.parse(readFileSync(filename, "utf8").replace(/^\uFEFF/, "")) as unknown;
  } catch {
    throw new Error("无法读取评测 JSON 文件，请检查编码与格式");
  }
}

function main(args: string[]) {
  if (args.length === 2 && args[0] === "--template") {
    writeFileSync(
      args[1],
      `${JSON.stringify(
        {
          schemaVersion: 1,
          corpusHash,
          model: "",
          promptVersion: "",
          capturedAt: "",
          parameters: {},
          results: fixtures.map((fixture) => ({
            fixtureId: fixture.id,
            output: null,
            durationMs: null,
            usage: null,
            cost: null,
          })),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", encoding: "utf8" },
    );
    process.stdout.write("已创建空评测模板；填入实际模型输出与运行信息后才能比较。\n");
    return;
  }
  if (args.length === 2 && args[0] === "--fixtures") {
    writeFileSync(
      args[1],
      `${JSON.stringify(
        {
          corpusHash,
          fixtures: fixtures.map(({ id, title, genre, stage, chapter, contextEvidence }) => ({
            id,
            title,
            genre,
            stage,
            chapter,
            contextEvidence,
          })),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", encoding: "utf8" },
    );
    process.stdout.write("已导出评测材料，不包含标准答案。\n");
    return;
  }
  if (args.length !== 2 || args.some((arg) => arg.startsWith("--"))) {
    process.stdout.write(
      "用法：npm run quality:compare -- <baseline.json> <candidate.json>\n" +
        "      npm run quality:compare -- --template <new-file.json>\n" +
        "      npm run quality:compare -- --fixtures <new-file.json>\n",
    );
    process.exitCode = args.includes("--help") ? 0 : 2;
    return;
  }
  const report = compareQualityRuns(
    readRun(args[0]),
    readRun(args[1]),
    fixtures,
    corpusHash,
    QUALITY_BENCHMARK.minimumAverageScore,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.comparison.regressed ? 1 : 0;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "评测比较失败"}\n`);
  process.exitCode = 2;
}
