import type { ReviewExperiment } from "./types";

interface PrepareReviewExperimentOptions {
  id: string;
  updatedAt: string;
}

export function prepareReviewExperiment(
  previous: ReviewExperiment | undefined,
  candidate: ReviewExperiment,
  options: PrepareReviewExperimentOptions,
): ReviewExperiment {
  const next: ReviewExperiment = {
    ...candidate,
    id: options.id,
    createdAt: previous?.createdAt ?? candidate.createdAt ?? options.updatedAt,
    updatedAt: options.updatedAt,
  };
  if (!next.title.trim() || !next.hypothesis.trim()) {
    throw new Error("实验标题和假设不能为空");
  }
  if (next.fromChapter > next.toChapter) {
    throw new Error("影响起始章不能晚于结束章");
  }
  if (next.baselineStart > next.baselineEnd || next.observationStart > next.observationEnd) {
    throw new Error("观察日期范围无效");
  }
  if (next.status === "已结论" && (!next.conclusion.trim() || !next.decision)) {
    throw new Error("结束实验必须填写结论和处理决定");
  }
  return next;
}
