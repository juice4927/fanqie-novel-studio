import { buildChapterBatchPreview } from "../src/shared/chapter-batch-service";
import { assertNoHardStoryConstraint, evaluateStoryConstraints } from "../src/shared/story-constraints";
import type {
  BatchGenerationPreview,
  Chapter,
  ChapterDraftStreamEvent,
  ContextPackage,
  ProjectDetail,
} from "../src/shared/types";
import { createChapterGenerationGuard, serializeChapterAiRetryContext } from "./ai-retry";
import type { AiCachePolicy, AiService, StartedAiTask } from "./ai-service";
import type { WorkspaceDatabase } from "./database";

export type ChapterGenerationDatabase = Pick<
  WorkspaceDatabase,
  "getAiSettings" | "getProject" | "saveGeneratedChapter" | "searchRelevantFacts"
> &
  Partial<Pick<WorkspaceDatabase, "markAiJobApplicationFailed">>;

export type ChapterGenerationAi = Pick<AiService, "draftChapter" | "startDraftChapter">;

export interface ChapterGenerationDependencies {
  database: ChapterGenerationDatabase;
  ai: ChapterGenerationAi;
  getApiKey: () => string;
  compileContext: (
    project: ProjectDetail,
    chapter: Chapter,
    relevantFacts?: ReadonlyArray<ProjectDetail["facts"][number]>,
  ) => ContextPackage;
}

export interface ChapterGenerationCoordinator {
  isActive(projectId: string): boolean;
  markActive(projectId: string): void;
  markIdle(projectId: string): void;
  previewBatch(
    project: ProjectDetail,
    settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
    chapterId: string,
  ): BatchGenerationPreview;
  startOne(
    projectId: string,
    chapterId: string,
    onStream?: (event: ChapterDraftStreamEvent) => void,
    cachePolicy?: AiCachePolicy,
  ): StartedAiTask<Chapter>;
  generateOne(
    projectId: string,
    chapterId: string,
    onStream?: (event: ChapterDraftStreamEvent) => void,
  ): Promise<Chapter>;
  generateBatch(projectId: string, chapterId: string): Promise<Chapter[]>;
}

export function createChapterGenerationCoordinator({
  database,
  ai,
  getApiKey,
  compileContext,
}: ChapterGenerationDependencies): ChapterGenerationCoordinator {
  const activeProjects = new Set<string>();

  const isActive = (projectId: string) => activeProjects.has(projectId);
  const markActive = (projectId: string) => {
    activeProjects.add(projectId);
  };
  const markIdle = (projectId: string) => {
    activeProjects.delete(projectId);
  };

  const previewBatch: ChapterGenerationCoordinator["previewBatch"] = (project, settings, chapterId) =>
    buildChapterBatchPreview(
      project,
      settings,
      chapterId,
      (chapter) => compileContext(project, chapter).estimatedTokens,
    );

  const startOne: ChapterGenerationCoordinator["startOne"] = (projectId, chapterId, onStream, cachePolicy = "use") => {
    if (isActive(projectId)) throw new Error("该作品已有正文生成任务正在运行");
    const project = database.getProject(projectId);
    if (!project.contract.approved) throw new Error("创作契约审批后才能生成正文");
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (!chapter.outline.trim()) throw new Error("请先填写本章章纲");
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      throw new Error("已定稿或进入发布流程的章节不能由 AI 覆写");
    assertNoHardStoryConstraint(evaluateStoryConstraints(project.facts, chapter));
    if (!getApiKey()) throw new Error("尚未配置 AI API 密钥");

    markActive(projectId);
    try {
      const facts = database.searchRelevantFacts(projectId, `${chapter.title} ${chapter.outline}`, chapter.number);
      const generationGuard = createChapterGenerationGuard(chapter);
      const task = ai.startDraftChapter(projectId, chapter, compileContext(project, chapter, facts), {
        retryContext: serializeChapterAiRetryContext("chapter", projectId, chapter),
        onStream,
        cachePolicy,
      });
      return {
        ...task,
        completion: task.completion
          .then((generated) => {
            try {
              return database.saveGeneratedChapter(projectId, generated, generationGuard);
            } catch (error) {
              if (task.jobId) {
                const message = error instanceof Error ? error.message : String(error);
                database.markAiJobApplicationFailed?.(task.jobId, `模型输出未应用：${message}`);
              }
              throw error;
            }
          })
          .finally(() => markIdle(projectId)),
      };
    } catch (error) {
      markIdle(projectId);
      throw error;
    }
  };

  const generateOne: ChapterGenerationCoordinator["generateOne"] = (projectId, chapterId, onStream) =>
    startOne(projectId, chapterId, onStream).completion;

  const generateBatch: ChapterGenerationCoordinator["generateBatch"] = async (projectId, chapterId) => {
    if (isActive(projectId)) throw new Error("该作品已有正文生成任务正在运行");
    const preview = previewBatch(database.getProject(projectId), database.getAiSettings(), chapterId);
    if (!preview.canRun) throw new Error(preview.blockingReason ?? "当前不能执行五章批次");

    markActive(projectId);
    try {
      const generated: Chapter[] = [];
      for (const candidate of preview.chapters) {
        const project = database.getProject(projectId);
        const chapter = project.chapters.find((item) => item.id === candidate.id);
        if (!chapter) throw new Error(`第${candidate.number}章不存在`);
        if (chapter.content.trim()) {
          generated.push(chapter);
          continue;
        }
        assertNoHardStoryConstraint(evaluateStoryConstraints(project.facts, chapter));
        const facts = database.searchRelevantFacts(projectId, `${chapter.title} ${chapter.outline}`, chapter.number);
        const generationGuard = createChapterGenerationGuard(chapter);
        const draft = await ai.draftChapter(
          projectId,
          chapter,
          compileContext(project, chapter, facts),
          serializeChapterAiRetryContext("batch", projectId, chapter),
        );
        generated.push(database.saveGeneratedChapter(projectId, draft, generationGuard));
      }
      return generated;
    } finally {
      markIdle(projectId);
    }
  };

  return {
    isActive,
    markActive,
    markIdle,
    previewBatch,
    startOne,
    generateOne,
    generateBatch,
  };
}
