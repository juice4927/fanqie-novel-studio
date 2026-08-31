import { assertChapterTransition } from "./chapter-lifecycle";
import { assertSchedulePublishAt } from "./dashboard-policy";
import type { Chapter, ChapterStatus, QualityIssue, ScheduleItem } from "./types";

type ScheduleTransitionStatus = Extract<ChapterStatus, "待发布" | "已发布">;

interface PrepareScheduleSaveOptions {
  scheduleId: string;
  projectId: string;
  projectTitle: string;
  chapter: Chapter | undefined;
  issues: readonly QualityIssue[];
}

export interface ScheduleSavePlan {
  schedule: ScheduleItem;
  transitionTo: ScheduleTransitionStatus | null;
}

export function prepareScheduleSave(candidate: ScheduleItem, options: PrepareScheduleSaveOptions): ScheduleSavePlan {
  assertSchedulePublishAt(candidate.publishAt);
  const chapter = options.chapter;
  if (!chapter) throw new Error("排期章节不存在");

  const targetStatus: ScheduleTransitionStatus | null =
    candidate.status === "已发布" ? "已发布" : candidate.status === "待发布" ? "待发布" : null;
  const transitionTo = chapter.status === targetStatus ? null : targetStatus;
  if (transitionTo) {
    assertChapterTransition(chapter.status, transitionTo, chapter.id, options.issues);
  }
  if (!targetStatus && !["已定稿", "待发布"].includes(chapter.status)) {
    throw new Error("只有已定稿或待发布章节可以安排发布");
  }

  return {
    schedule: {
      ...candidate,
      id: options.scheduleId,
      projectId: options.projectId,
      projectTitle: options.projectTitle,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
    },
    transitionTo,
  };
}
