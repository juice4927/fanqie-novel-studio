import { bootstrapConfidenceInterval } from "./quality-benchmark";

/** 首版只做三个维度；新增维度需同步更新本表并重新校准。 */
export const QUALITY_REPORT_DIMENSIONS = ["连贯", "人物一致", "文笔"] as const;

export interface QualityReportSample {
  dimension: string;
  score: number;
}

export interface QualityReportOptions {
  iterations?: number;
  confidence?: number;
  seed?: number;
}

export interface QualityPercentileDimension {
  name: string;
  /** 样本均分在 0–100 分位刻度上的位置（即均分本身），仅作观察。 */
  percentile: number;
  sampleCount: number;
  confidenceInterval: { lower: number; upper: number };
}

export interface QualityPercentileReport {
  dimensions: QualityPercentileDimension[];
  observational: true;
  note: string;
}

const OBSERVATIONAL_NOTE = "本报告为观察值，不参与通过/失败判定，仅供作者参考。";

/**
 * 按维度汇总人类/模型评分的分位与置信区间。
 * 只输出观察值：没有阈值、没有 passed 字段，调用方不得据此阻断流程（AGENTS.md 规则 7）。
 */
export function buildPercentileReport(
  samples: readonly QualityReportSample[],
  options: QualityReportOptions = {},
): QualityPercentileReport {
  const seed = Number.isFinite(options.seed) ? options.seed! : 42;
  const dimensions = QUALITY_REPORT_DIMENSIONS.map((name, index) => {
    const scores = samples
      .filter((sample) => sample.dimension === name && Number.isFinite(sample.score))
      .map((sample) => sample.score);
    // 每个维度用不同 seed 偏移，保证结果确定可复现又互不相关。
    const interval = bootstrapConfidenceInterval(scores, { ...options, seed: seed + index });
    return {
      name,
      percentile: scores.length ? interval.mean : 0,
      sampleCount: scores.length,
      confidenceInterval: { lower: interval.lower, upper: interval.upper },
    };
  });
  return { dimensions, observational: true, note: OBSERVATIONAL_NOTE };
}
