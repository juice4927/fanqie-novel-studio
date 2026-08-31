import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import type { ReviewExperiment } from "../src/shared/types";

const initialTime = "2026-07-31T00:00:00.000Z";

function experiment(overrides: Partial<ReviewExperiment> = {}): ReviewExperiment {
  return {
    id: "",
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
    createdAt: initialTime,
    updatedAt: initialTime,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser review experiment workflow", () => {
  it("enforces date ranges and updates project activity", async () => {
    const api = createBrowserApi();
    const [summary] = await api.listProjects();
    await expect(
      api.saveReviewExperiment(
        summary.id,
        experiment({
          observationStart: "2026-07-15",
          observationEnd: "2026-07-14",
        }),
      ),
    ).rejects.toThrow("观察日期范围无效");

    const updatedAt = "2026-08-05T01:00:00.000Z";
    vi.setSystemTime(updatedAt);
    const saved = await api.saveReviewExperiment(summary.id, experiment());
    const project = await api.getProject(summary.id);

    expect(saved).toMatchObject({ updatedAt, createdAt: initialTime });
    expect(project.summary.updatedAt).toBe(updatedAt);
  });
});
