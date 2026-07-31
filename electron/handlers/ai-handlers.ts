import type {
  Chapter,
  PlanningGenerationResult,
  PlanningRepairInput,
} from "../../src/shared/types";
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
  | "getProject"
  | "listAiJobs"
  | "saveChapter"
  | "saveAiSettings"
  | "savePlan"
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
  ai: Pick<AiService, "cancelJob" | "generatePlanning" | "reviewPlanning">;
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
  register("generatePlanningDraft", async (id, input) => {
    const project = database.getProject(id);
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    if (
      input.mode === "全书结构" &&
      project.plans.some(
        (plan) => plan.kind === "宏观阶段" || plan.kind === "分卷",
      )
    ) {
      throw new Error("当前已有宏观阶段或分卷；为避免重复，AI 不会覆盖现有结构");
    }
    const fromChapter =
      input.fromChapter ??
      Math.max(
        1,
        ...project.chapters.map((chapter) => chapter.number + 1),
      );
    const count = input.mode === "后续章纲" ? input.chapterCount ?? 10 : 0;
    if (
      input.mode === "后续章纲" &&
      project.chapters.some(
        (chapter) =>
          chapter.number >= fromChapter &&
          chapter.number < fromChapter + count,
      )
    ) {
      throw new Error(
        `第${fromChapter}–${fromChapter + count - 1}章范围内已有章节，AI 不会覆盖`,
      );
    }
    const savedPlans: PlanningGenerationResult["plans"] = [];
    const savedChapters: PlanningGenerationResult["chapters"] = [];
    try {
      const generated = await ai.generatePlanning(
        project,
        { ...input, fromChapter },
        (batch) => {
          const latest = database.getProject(id);
          if (
            batch.chapters.some((chapter) =>
              latest.chapters.some(
                (existing) => existing.number === chapter.number,
              ),
            )
          ) {
            throw new Error(
              "生成期间章节范围发生变化，本批结果未保存，请重新生成",
            );
          }
          savedPlans.push(
            ...batch.plans.map((plan) => database.savePlan(id, plan)),
          );
          savedChapters.push(
            ...batch.chapters.map((chapter) =>
              database.saveChapter(id, chapter),
            ),
          );
        },
      );
      if (!generated.chapters.length) {
        savedPlans.push(
          ...generated.plans.map((plan) => database.savePlan(id, plan)),
        );
      }
      return {
        ...generated,
        plans: savedPlans,
        chapters: savedChapters,
      };
    } catch (error) {
      if (!savedChapters.length) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `已保存第${savedChapters[0].number}–${savedChapters.at(-1)!.number}章；后续批次生成失败：${message}`,
      );
    }
  });
  register("reviewPlanning", (id, input) =>
    ai.reviewPlanning(database.getProject(id), input),
  );
  register("applyPlanningRepairs", (id, input: PlanningRepairInput) => {
    const project = database.getProject(id);
    const plansById = new Map(project.plans.map((plan) => [plan.id, plan]));
    const chaptersById = new Map(
      project.chapters.map((chapter) => [chapter.id, chapter]),
    );
    if (!input.plans.length && !input.chapters.length) {
      throw new Error("没有可应用的规划修复");
    }
    if (
      new Set(input.plans.map((item) => item.targetId)).size !==
        input.plans.length ||
      new Set(input.chapters.map((item) => item.targetId)).size !==
        input.chapters.length
    ) {
      throw new Error("修复提案包含重复目标");
    }
    for (const repair of input.plans) {
      const current = plansById.get(repair.targetId);
      if (!current) throw new Error(`规划修复目标不存在：${repair.targetId}`);
      if (current.status === "已批准") {
        throw new Error(
          `规划“${current.title}”已经批准，需先建立并批准改纲变更单`,
        );
      }
    }
    for (const repair of input.chapters) {
      const current = chaptersById.get(repair.targetId);
      if (!current) throw new Error(`章节修复目标不存在：${repair.targetId}`);
      if (["已定稿", "待发布", "已发布"].includes(current.status)) {
        throw new Error(
          `第${current.number}章已受保护，需先建立并批准章节变更单`,
        );
      }
    }
    const appliedPlanIds = input.plans.map(
      (repair) =>
        database.savePlan(id, {
          ...plansById.get(repair.targetId)!,
          ...repair.after,
        }).id,
    );
    const appliedChapterIds = input.chapters.map((repair) => {
      const definedAfter = Object.fromEntries(
        Object.entries(repair.after).filter(([, value]) => value !== undefined),
      );
      return database.saveChapter(id, {
        ...chaptersById.get(repair.targetId)!,
        ...definedAfter,
      }).id;
    });
    return { appliedPlanIds, appliedChapterIds };
  });
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
