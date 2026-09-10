import type { PlanNode } from "./types";

/** 全书粗纲的批次粒度：每 10 章一条。 */
export const COARSE_BLOCK_CHAPTERS = 10;

export interface VolumeRange {
  plan: PlanNode;
  fromChapter: number;
  toChapter: number;
}

/** 按顺序折算每卷的章号区间；statuses 为 null 时包含全部状态（开书包草稿阶段需要）。 */
export function volumeRanges(
  plans: PlanNode[],
  wordsPerChapter = 2500,
  statuses: readonly PlanNode["status"][] | null = ["已批准"],
): VolumeRange[] {
  if (!Number.isFinite(wordsPerChapter) || wordsPerChapter <= 0) throw new Error("每章目标字数必须是正数");
  let cursor = 1;
  return plans
    .filter((plan) => plan.kind === "分卷" && (!statuses || statuses.includes(plan.status)))
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((plan) => {
      if (!Number.isFinite(plan.targetWords) || plan.targetWords < 0)
        throw new Error(`分卷“${plan.title}”目标字数无效`);
      const chapterCount = Math.max(1, Math.ceil(plan.targetWords / wordsPerChapter));
      const range = { plan, fromChapter: cursor, toChapter: cursor + chapterCount - 1 };
      cursor = range.toChapter + 1;
      return range;
    });
}

export function approvedVolumeRanges(plans: PlanNode[], wordsPerChapter = 2500): VolumeRange[] {
  return volumeRanges(plans, wordsPerChapter, ["已批准"]);
}

export function findCurrentVolume(plans: PlanNode[], chapterNumber: number, wordsPerChapter = 2500) {
  return approvedVolumeRanges(plans, wordsPerChapter).find(
    (range) => chapterNumber >= range.fromChapter && chapterNumber <= range.toChapter,
  )?.plan;
}

export function volumeBoundaryChapters(plans: PlanNode[], wordsPerChapter = 2500) {
  return new Set(approvedVolumeRanges(plans, wordsPerChapter).flatMap((range) => [range.fromChapter, range.toChapter]));
}
