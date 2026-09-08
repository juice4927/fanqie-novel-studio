import type { Chapter } from "../shared/types";

/** 新章沿用上一章的篇幅和章节功能；新章已有的显式设置优先。 */
export function inheritChapterDefaults(chapter: Chapter, chapters: readonly Chapter[]): Chapter {
  const previous = chapters.find((item) => item.number === chapter.number - 1);
  if (!previous) return chapter;
  return {
    ...chapter,
    targetWords: chapter.targetWords ?? previous.targetWords,
    chapterFunction: chapter.chapterFunction ?? previous.chapterFunction,
  };
}

/** 上一章的“结尾期待”就是下一章的“本章承诺”。 */
export function previousEndingExpectation(chapter: Chapter, chapters: readonly Chapter[]): string {
  return chapters.find((item) => item.number === chapter.number - 1)?.endingExpectation?.trim() ?? "";
}
