import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiJobRecord, Chapter } from "../src/shared/types";

const ChapterAiRetryContextSchema = z.object({
  kind: z.enum(["chapter", "batch"]),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ChapterAiRetryContext = z.infer<typeof ChapterAiRetryContextSchema>;

export interface ChapterGenerationGuard {
  revision: number;
  fingerprint: string;
}

export function chapterGenerationFingerprint(chapter: Chapter) {
  const generationInput = [
    chapter.id,
    chapter.number,
    chapter.title,
    chapter.outline,
    chapter.content,
    chapter.status,
    chapter.batchMode,
    chapter.isKeyChapter,
    chapter.chapterFunction ?? null,
    chapter.targetWords ?? null,
    chapter.chapterPromise ?? "",
    chapter.expectedPayoff ?? "",
    chapter.crisis ?? "",
    chapter.endingExpectation ?? "",
    chapter.expectationTargetChapter ?? null,
    chapter.endingExpectationId ?? null,
    chapter.linkedExpectationIds ?? [],
  ];
  return createHash("sha256").update(JSON.stringify(generationInput)).digest("hex");
}

export function createChapterGenerationGuard(chapter: Chapter): ChapterGenerationGuard {
  return { revision: chapter.revision, fingerprint: chapterGenerationFingerprint(chapter) };
}

export function serializeChapterAiRetryContext(
  kind: ChapterAiRetryContext["kind"],
  projectId: string,
  chapter: Chapter,
) {
  const guard = createChapterGenerationGuard(chapter);
  return JSON.stringify({ kind, projectId, chapterId: chapter.id, ...guard });
}

export function validateChapterAiRetrySource(
  sourceJob: Pick<AiJobRecord, "projectId" | "taskType" | "retryable">,
  rawContext: string | null,
): ChapterAiRetryContext {
  if (!sourceJob.retryable) throw new Error("该 AI 任务当前不可重试");
  if (sourceJob.taskType !== "draft-chapter") throw new Error("只支持重试章节正文生成任务");
  if (!rawContext) throw new Error("该任务没有可安全重放的上下文，请返回原操作重试");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContext);
  } catch {
    throw new Error("该任务的重试上下文已损坏，请返回原操作重试");
  }
  const result = ChapterAiRetryContextSchema.safeParse(parsed);
  if (!result.success)
    throw new Error("该任务使用旧版或无效的重试上下文，请返回原操作重试");
  if (sourceJob.projectId !== result.data.projectId)
    throw new Error("AI 任务与重试项目不匹配，请返回原操作重试");
  return result.data;
}

export function assertChapterRetrySnapshot(context: ChapterAiRetryContext, chapter: Chapter) {
  if (chapter.id !== context.chapterId) throw new Error("重试目标章节不匹配");
  if (
    chapter.revision !== context.revision ||
    chapterGenerationFingerprint(chapter) !== context.fingerprint
  ) {
    throw new Error("该章节自任务失败后已被修改，为避免覆盖新版本，请从章节工作区重新生成");
  }
}
