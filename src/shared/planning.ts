import type { PlanNode } from "./types";

export interface VolumeRange {
  plan: PlanNode;
  fromChapter: number;
  toChapter: number;
}

export function approvedVolumeRanges(plans: PlanNode[], wordsPerChapter = 2500): VolumeRange[] {
  if (!Number.isFinite(wordsPerChapter) || wordsPerChapter <= 0) throw new Error("每章目标字数必须是正数");
  let cursor = 1;
  return plans
    .filter((plan) => plan.kind === "分卷" && plan.status === "已批准")
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

export function findCurrentVolume(plans: PlanNode[], chapterNumber: number) {
  return approvedVolumeRanges(plans).find(
    (range) => chapterNumber >= range.fromChapter && chapterNumber <= range.toChapter,
  )?.plan;
}

export function volumeBoundaryChapters(plans: PlanNode[]) {
  return new Set(approvedVolumeRanges(plans).flatMap((range) => [range.fromChapter, range.toChapter]));
}
