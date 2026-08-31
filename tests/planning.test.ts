import { describe, expect, it } from "vitest";
import { approvedVolumeRanges, findCurrentVolume } from "../src/shared/planning";
import type { PlanNode } from "../src/shared/types";

const volume = (id: string, ordinal: number, targetWords: number): PlanNode => ({
  id, kind: "分卷", title: id, ordinal, goal: `${id}目标`, conflict: "冲突", outcome: "结果",
  targetWords, status: "已批准", parentId: null,
});

describe("approved volume ranges", () => {
  it("selects the volume containing the current chapter", () => {
    const plans = [volume("第二卷", 2, 100_000), volume("第一卷", 1, 150_000)];
    expect(approvedVolumeRanges(plans).map((item) => [item.fromChapter, item.toChapter])).toEqual([[1, 60], [61, 100]]);
    expect(findCurrentVolume(plans, 12)?.id).toBe("第一卷");
    expect(findCurrentVolume(plans, 75)?.id).toBe("第二卷");
    expect(findCurrentVolume(plans, 101)).toBeUndefined();
  });

  it("rejects corrupt legacy target word values", () => {
    expect(() => approvedVolumeRanges([volume("坏数据", 1, Number.NaN)])).toThrow("目标字数无效");
  });
});
