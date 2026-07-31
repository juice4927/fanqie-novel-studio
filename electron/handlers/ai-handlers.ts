import type { Chapter } from "../../src/shared/types";
import {
  assertChapterRetrySnapshot,
  validateChapterAiRetrySource,
} from "../ai-retry";
import type { AiService, StartedAiTask } from "../ai-service";
import type { WorkspaceDatabase } from "../database";
import type { RegisterHandler } from "./types";

type AiDatabase = Pick<
  WorkspaceDatabase,
  | "getAiJob"
  | "getAiJobRetryContext"
  | "getAiSettings"
  | "getChapter"
  | "listAiJobs"
  | "saveAiSettings"
>;

interface RetryFailureDetails {
  sourceJobId: string;
  retryJobId: string | null;
  projectId: string;
  chapterId: string;
  error: string;
}

export interface AiHandlerDependencies {
  register: RegisterHandler;
  database: AiDatabase;
  ai: Pick<AiService, "cancelJob">;
  getApiKey: () => string;
  saveApiKey: (apiKey: string) => Promise<void>;
  startChapterRetry: (
    projectId: string,
    chapterId: string,
  ) => StartedAiTask<Chapter>;
  logRetryFailure: (details: RetryFailureDetails) => void;
}

export function registerAiHandlers({
  register,
  database,
  ai,
  getApiKey,
  saveApiKey,
  startChapterRetry,
  logRetryFailure,
}: AiHandlerDependencies): void {
  register("getAiSettings", () => ({
    ...database.getAiSettings(),
    hasApiKey: Boolean(getApiKey()),
  }));
  register("saveAiSettings", async (settings, apiKey) => {
    if (apiKey) await saveApiKey(apiKey);
    return {
      ...database.saveAiSettings(settings),
      hasApiKey: Boolean(getApiKey()),
    };
  });
  register("listAiJobs", (projectId) => database.listAiJobs(projectId));
  register("cancelAiJob", (id) => ai.cancelJob(id));
  register("retryAiJob", async (id) => {
    const sourceJob = database.getAiJob(id);
    if (!sourceJob) throw new Error("AI 任务不存在");
    const context = validateChapterAiRetrySource(
      sourceJob,
      database.getAiJobRetryContext(id),
    );
    assertChapterRetrySnapshot(
      context,
      database.getChapter(context.projectId, context.chapterId),
    );
    const task = startChapterRetry(context.projectId, context.chapterId);
    if (!task.jobId || task.source !== "network") {
      await task.completion;
      throw new Error("重试没有创建新的 AI 任务，请返回章节工作区重新生成");
    }
    void task.completion
      .catch((error) => {
        logRetryFailure({
          sourceJobId: id,
          retryJobId: task.jobId,
          projectId: context.projectId,
          chapterId: context.chapterId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .catch(() => {});
    const retryJob = database.getAiJob(task.jobId);
    if (!retryJob) {
      throw new Error("AI 重试任务已启动，但审计记录不可用");
    }
    return retryJob;
  });
}
