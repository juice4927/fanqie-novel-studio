import type { Chapter, ChapterStatus, ChangeRequest, QualityIssue } from "./types";

const TRANSITIONS: Readonly<Partial<Record<ChapterStatus, readonly ChapterStatus[]>>> = {
  草稿: ["待质检"],
  待质检: ["待定稿"],
  待定稿: ["已定稿"],
  已定稿: ["待发布"],
  待发布: ["已发布"],
};

export const PROTECTED_CHAPTER_STATUSES: readonly ChapterStatus[] = ["已定稿", "待发布", "已发布"];

export function chapterContentChanged(previous: Chapter, next: Chapter) {
  const editable = (chapter: Chapter) => ({
    number: chapter.number,
    title: chapter.title,
    outline: chapter.outline,
    content: chapter.content,
    batchMode: chapter.batchMode,
    isKeyChapter: chapter.isKeyChapter,
    chapterPromise: chapter.chapterPromise,
    expectedPayoff: chapter.expectedPayoff,
    crisis: chapter.crisis,
    endingExpectation: chapter.endingExpectation,
    expectationTargetChapter: chapter.expectationTargetChapter,
    linkedExpectationIds: chapter.linkedExpectationIds,
  });
  return JSON.stringify(editable(previous)) !== JSON.stringify(editable(next));
}

export function isProtectedChapterEdit(previous: Chapter | undefined, next: Chapter) {
  return Boolean(previous && PROTECTED_CHAPTER_STATUSES.includes(previous.status) && chapterContentChanged(previous, next));
}

export function deriveChapterStatus(
  previous: Chapter | undefined,
  next: Chapter,
  options: { forcedStatus?: ChapterStatus; protectedEdit?: boolean } = {},
): ChapterStatus {
  if (options.forcedStatus) return options.forcedStatus;
  if (!previous) return next.content.trim() ? "草稿" : "章纲";
  if (options.protectedEdit) return next.content.trim() ? "待质检" : "章纲";
  if (previous.status === "章纲" && next.content.trim()) return "草稿";
  if (previous.content !== next.content && (previous.status === "待质检" || previous.status === "待定稿")) return "草稿";
  return previous.status;
}

export function assertChapterTransition(
  from: ChapterStatus,
  to: ChapterStatus,
  chapterId: string,
  issues: readonly QualityIssue[],
) {
  if (!TRANSITIONS[from]?.includes(to)) throw new Error(`不允许从“${from}”直接变为“${to}”`);
  if (
    (to === "待定稿" || to === "已定稿" || to === "待发布") &&
    issues.some((issue) => issue.chapterId === chapterId && issue.severity === "硬性" && issue.status !== "已解决")
  ) throw new Error("该章仍有未解决的硬性问题");
}

export function findMatchingApproval(
  changes: readonly ChangeRequest[],
  targetKind: ChangeRequest["targetKind"],
  targetId: string,
  baseVersion: number,
) {
  return changes.find((change) =>
    change.status === "已批准" && change.targetKind === targetKind &&
    change.targetId === targetId && change.baseVersion === baseVersion,
  );
}
