import { hasMajorStateChange } from "./major-state-change";
import { volumeBoundaryChapters } from "./planning";
import { evaluateStoryConstraints } from "./story-constraints";
import { estimateChapterOutputTokens } from "./token-estimator";
import type { AiSettings, BatchGenerationPreview, Chapter, ProjectDetail } from "./types";

type ChapterBatchProject = Pick<ProjectDetail, "summary" | "contract" | "plans" | "chapters" | "facts" | "issues">;

type ChapterBatchPricing = Pick<AiSettings, "inputPricePerMillion" | "outputPricePerMillion">;

export function buildChapterBatchPreview(
  project: ChapterBatchProject,
  settings: ChapterBatchPricing,
  chapterId: string,
  estimateInputTokens: (chapter: Chapter) => number,
): BatchGenerationPreview {
  const blocked = (reason: string, chapters: BatchGenerationPreview["chapters"] = []): BatchGenerationPreview => ({
    chapters,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    canRun: false,
    blockingReason: reason,
  });
  const start = project.chapters.find((chapter) => chapter.id === chapterId);
  if (!start) return blocked("章节不存在");
  if (start.batchMode !== "五章批次") return blocked("请先保存“五章批次”模式");
  if (!project.contract.approved) return blocked("创作契约审批后才能生成正文");
  if (project.facts.some((fact) => fact.confidence === "有冲突"))
    return blocked("状态账本存在冲突事实，已自动恢复逐章模式");

  const ordered = project.chapters
    .filter((chapter) => chapter.number >= start.number && chapter.number < start.number + 5)
    .sort((left, right) => left.number - right.number);
  const chapterSummaries = ordered.map((chapter) => ({
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
  }));
  if (ordered.length !== 5 || ordered.some((chapter, index) => chapter.number !== start.number + index)) {
    return blocked("需要从当前章开始预先建立连续五章及其章纲");
  }

  const boundaries = volumeBoundaryChapters(project.plans);
  const activeHardIssues = new Set(
    project.issues
      .filter((issue) => issue.severity === "硬性" && issue.status === "待处理")
      .map((issue) => issue.chapterId),
  );
  for (const chapter of ordered) {
    if (chapter.batchMode !== "五章批次") return blocked(`第${chapter.number}章处于逐章模式`, chapterSummaries);
    if (chapter.isKeyChapter) return blocked(`第${chapter.number}章是关键章，必须逐章审批`, chapterSummaries);
    if (boundaries.has(chapter.number))
      return blocked(`第${chapter.number}章位于卷首或卷末，必须逐章审批`, chapterSummaries);
    if (hasMajorStateChange(chapter.outline, project.summary.genre, project.contract.majorStateChanges)) {
      return blocked(`第${chapter.number}章包含重大状态变化，必须逐章审批`, chapterSummaries);
    }
    if (activeHardIssues.has(chapter.id)) return blocked(`第${chapter.number}章有未解决的硬性告警`, chapterSummaries);
    if (!chapter.outline.trim()) return blocked(`第${chapter.number}章尚未填写章纲`, chapterSummaries);
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      return blocked(`第${chapter.number}章已经定稿或进入发布流程`, chapterSummaries);
    const hardConstraint = evaluateStoryConstraints(project.facts, chapter).find(
      (finding) => finding.severity === "硬性",
    );
    if (hardConstraint) {
      return blocked(`第${chapter.number}章写前约束失败：${hardConstraint.message}`, chapterSummaries);
    }
  }

  const inputTokens = ordered.reduce((sum, chapter) => sum + estimateInputTokens(chapter), 0);
  const outputTokens = ordered.reduce(
    (sum, chapter) => sum + estimateChapterOutputTokens(chapter.targetWords ?? 2300),
    0,
  );
  return {
    chapters: chapterSummaries,
    inputTokens,
    outputTokens,
    estimatedCost:
      (inputTokens / 1_000_000) * (settings.inputPricePerMillion ?? 0) +
      (outputTokens / 1_000_000) * (settings.outputPricePerMillion ?? 0),
    canRun: true,
    blockingReason: null,
  };
}
