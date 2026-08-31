import { describe, expect, it } from "vitest";
import { prepareReviewExperiment } from "../src/shared/review-experiment-service";
import type { ReviewExperiment } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function experiment(overrides: Partial<ReviewExperiment> = {}): ReviewExperiment {
  return {
    id: "experiment-1",
    title: "调整回报类型",
    hypothesis: "减少重复回报会提高追读率",
    changeSummary: "第10至15章调整回报类型",
    fromChapter: 10,
    toChapter: 15,
    baselineStart: "2026-07-01",
    baselineEnd: "2026-07-07",
    observationStart: "2026-07-08",
    observationEnd: "2026-07-14",
    primaryMetric: "追读率",
    successCriteria: "提高2个百分点",
    confounders: "推荐量、发布时间",
    status: "观察中",
    conclusion: "",
    decision: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("review experiment rules", () => {
  it("preserves creation time and owns update metadata", () => {
    const previous = experiment();
    const updatedAt = "2026-08-05T00:00:00.000Z";
    const prepared = prepareReviewExperiment(
      previous,
      { ...previous, title: "调整阶段回报类型", createdAt: "forged" },
      { id: previous.id, updatedAt },
    );

    expect(prepared).toMatchObject({
      id: previous.id,
      title: "调整阶段回报类型",
      createdAt: timestamp,
      updatedAt,
    });
  });

  it("rejects invalid chapter and date ranges", () => {
    expect(() =>
      prepareReviewExperiment(
        undefined,
        experiment({
          fromChapter: 16,
          toChapter: 15,
        }),
        { id: "new", updatedAt: timestamp },
      ),
    ).toThrow("影响起始章不能晚于结束章");
    expect(() =>
      prepareReviewExperiment(
        undefined,
        experiment({
          baselineStart: "2026-07-08",
          baselineEnd: "2026-07-01",
        }),
        { id: "new", updatedAt: timestamp },
      ),
    ).toThrow("观察日期范围无效");
    expect(() =>
      prepareReviewExperiment(
        undefined,
        experiment({
          observationStart: "2026-07-15",
          observationEnd: "2026-07-14",
        }),
        { id: "new", updatedAt: timestamp },
      ),
    ).toThrow("观察日期范围无效");
  });

  it("requires a conclusion and decision before closing", () => {
    expect(() =>
      prepareReviewExperiment(
        undefined,
        experiment({
          status: "已结论",
          conclusion: " ",
          decision: null,
        }),
        { id: "new", updatedAt: timestamp },
      ),
    ).toThrow("结束实验必须填写结论和处理决定");
  });
});
