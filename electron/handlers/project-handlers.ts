import { aggregateCategoryTags } from "../../src/shared/category-tags";
import { missingContractApprovalFields } from "../../src/shared/contract-service";
import { assembleDashboard, localDayEndExclusive } from "../../src/shared/dashboard-policy";
import { getFanqieCategoryProfile } from "../../src/shared/fanqie-taxonomy";
import { positioningToConceptInput } from "../../src/shared/incubation";
import { analyzeMetrics, parseMetricsCsv } from "../../src/shared/metrics";
import type {
  BookConceptInput,
  BookConceptSkeleton,
  IncubationCandidate,
  LaunchPackProgress,
  LaunchPackResult,
  ProjectDetail,
  StoryContract,
} from "../../src/shared/types";
import { CHAPTER_PLANNING_BATCH_SIZE } from "../ai-definitions";
import type { AiService } from "../ai-service";
import type { WorkspaceDatabase } from "../database";
import type { RegisterHandler } from "./types";

/** 开书包粒度：结构 + 全书粗纲（每 10 章一条）+ 开局章纲；后续章纲在写作推进时自动续跑。 */
const LAUNCH_COARSE_BLOCK_CHAPTERS = 10;
/** 一次请求覆盖的粗纲批次数。 */
const LAUNCH_COARSE_REQUEST_BLOCKS = 10;
/** 开书包一次备好的章纲数。 */
const LAUNCH_INITIAL_HORIZON = 100;
/** 写作推进后自动保持的章纲前瞻。 */
const AUTO_CONTINUE_HORIZON = 100;

type ProjectDatabase = Pick<
  WorkspaceDatabase,
  | "attachInsights"
  | "approveContract"
  | "approvePlan"
  | "approveLaunchPack"
  | "createProject"
  | "createProjectFromConcept"
  | "deleteIncubation"
  | "deleteProject"
  | "getIncubation"
  | "getChapter"
  | "getDashboardActivity"
  | "getInsights"
  | "getProject"
  | "getProjectOverview"
  | "listIncubations"
  | "listProjectSignatures"
  | "listRankings"
  | "markIncubationPromoted"
  | "saveIncubation"
  | "saveMetrics"
  | "saveReviewExperiment"
  | "listProjects"
  | "listRevisions"
  | "resolveFactConflict"
  | "resolveIssue"
  | "restoreRevision"
  | "saveChangeRequest"
  | "saveChapter"
  | "saveContract"
  | "saveExpectation"
  | "saveStoryEntry"
  | "deleteStoryEntry"
  | "seedStoryEntries"
  | "saveAiFlavorWhitelist"
  | "saveFact"
  | "getDirectorNotes"
  | "saveDirectorNotes"
  | "getGenerationQuality"
  | "recordGenerationDecision"
  | "savePlan"
  | "saveLaunchPackBatch"
  | "saveLaunchPackProgress"
  | "saveSchedule"
  | "searchProject"
  | "updateProject"
  | "decideChangeRequest"
>;

type ProjectAi = Pick<
  AiService,
  "expandBookConcept" | "generateBookConcepts" | "generateLaunchPlanning" | "suggestAestheticProfile"
>;

function contractDraftFromConcept(
  input: BookConceptInput,
  concept: IncubationCandidate,
  skeleton: BookConceptSkeleton,
): Omit<StoryContract, "version" | "approved" | "updatedAt"> {
  return {
    premise: concept.premise,
    genreSubtype: concept.genreSubtype,
    fanqieCategoryKey: concept.fanqieCategoryKey || input.fanqieCategoryKey || "",
    lengthShape: input.lengthShape ?? "",
    secondaryGenres: concept.secondaryGenres,
    genreElements: concept.genreElements,
    customGenreDirection: input.customGenreDirection ?? "",
    audience: concept.audience,
    commercialHook: concept.commercialHook,
    openingMechanism: concept.openingMechanism,
    growthCarrier: concept.growthCarrier,
    primaryPayoff: concept.primaryPayoff,
    longFormEngine: concept.longFormEngine,
    protagonistDesire: concept.protagonistDesire,
    protagonistArc: skeleton.protagonistArc,
    keyRelationships: skeleton.keyRelationships,
    worldRules: skeleton.worldRules,
    majorForces: skeleton.majorForces,
    timelineAnchors: skeleton.timelineAnchors,
    genreSpecificSections: skeleton.genreSpecificSections ?? [],
    readerPromise: concept.readerPromise,
    coreEmotion: concept.coreEmotion,
    ending: concept.ending,
    immutableRules: concept.immutableRules,
    prohibitedPatterns: concept.prohibitedPatterns,
  };
}

export interface ProjectHandlerDependencies {
  register: RegisterHandler;
  database: ProjectDatabase;
  ai: ProjectAi;
  isGenerationActive: (projectId: string) => boolean;
  currentDate: () => Date;
}

export function registerProjectHandlers({
  register,
  database,
  ai,
  isGenerationActive,
  currentDate,
}: ProjectHandlerDependencies): void {
  const activeLaunchPacks = new Set<string>();
  const completedChapters = (project: ProjectDetail, target: number) =>
    new Set(project.chapters.filter((chapter) => chapter.number <= target).map((chapter) => chapter.number)).size;
  const launchResult = (project: ProjectDetail): LaunchPackResult => ({
    plans: project.plans.length,
    chapters: project.chapters.length,
    progress: project.launchPack,
  });
  const targetChapterCount = (project: ProjectDetail) =>
    Math.max(1, Math.ceil(project.summary.targetWords / (project.summary.wordsPerChapter || 2500)));
  const coarseBlockStarts = (targetChapters: number) => {
    const starts: number[] = [];
    for (let start = 1; start <= targetChapters; start += LAUNCH_COARSE_BLOCK_CHAPTERS) starts.push(start);
    return starts;
  };
  const coarseCompleted = (project: ProjectDetail, targetChapters: number) => {
    const covered = new Set(project.plans.filter((plan) => plan.kind === "粗纲").map((plan) => plan.ordinal));
    return coarseBlockStarts(targetChapters).filter((start) => covered.has(start)).length;
  };
  /** 一次生成调用后确认契约与目标篇幅没有被改动，避免用旧设定继续写。 */
  const assertSnapshotUnchanged = (projectId: string, contractSnapshot: string, targetSnapshot: string) => {
    const current = database.getProjectOverview(projectId);
    if (JSON.stringify(current.contract) !== contractSnapshot)
      throw new Error("生成期间设定已修改，请继续生成以使用最新设定");
    if (`${current.summary.targetWords}:${current.summary.wordsPerChapter || 2500}` !== targetSnapshot)
      throw new Error("生成期间目标字数或单章字数已修改，请从最新目标继续生成");
    return current;
  };
  /** 全书粗纲：每 10 章一条，一次请求覆盖若干条；已存在的批次跳过，支持续跑。 */
  const runCoarseBatches = async (
    projectId: string,
    targetChapters: number,
    targetSnapshot: string,
    progress: LaunchPackProgress,
    onProgress?: (next: LaunchPackProgress) => void,
  ): Promise<LaunchPackProgress> => {
    let current = progress;
    while (true) {
      const project = database.getProjectOverview(projectId);
      const covered = new Set(project.plans.filter((plan) => plan.kind === "粗纲").map((plan) => plan.ordinal));
      const fromChapter = coarseBlockStarts(targetChapters).find((start) => !covered.has(start));
      if (!fromChapter) return current;
      const chapterCount = Math.min(
        LAUNCH_COARSE_REQUEST_BLOCKS * LAUNCH_COARSE_BLOCK_CHAPTERS,
        targetChapters - fromChapter + 1,
      );
      const contractSnapshot = JSON.stringify(project.contract);
      const batch = await ai.generateLaunchPlanning(project, { mode: "全书粗纲", fromChapter, chapterCount });
      const refreshed = assertSnapshotUnchanged(projectId, contractSnapshot, targetSnapshot);
      const expectedStarts = coarseBlockStarts(fromChapter + chapterCount - 1).filter((start) => start >= fromChapter);
      if (
        batch.plans.length !== expectedStarts.length ||
        batch.plans.some((plan, index) => plan.ordinal !== expectedStarts[index])
      )
        throw new Error("模型返回的粗纲范围不完整，请继续生成重试当前批次");
      current = {
        ...current,
        phase: "全书粗纲",
        coarseCompleted: coarseCompleted(refreshed, targetChapters) + batch.plans.length,
        updatedAt: currentDate().toISOString(),
      };
      onProgress?.(current);
      database.saveLaunchPackBatch(projectId, batch, current);
    }
  };
  /** 逐章章纲：从第一个缺口补到目标前瞻章数，每批与进度原子落盘。 */
  const runChapterBatches = async (
    projectId: string,
    horizon: number,
    targetSnapshot: string,
    progress: LaunchPackProgress,
    onProgress?: (next: LaunchPackProgress) => void,
  ): Promise<LaunchPackProgress> => {
    let current = progress;
    while (true) {
      const project = database.getProjectOverview(projectId);
      const existing = new Set(project.chapters.map((chapter) => chapter.number));
      let fromChapter = 1;
      while (existing.has(fromChapter) && fromChapter <= horizon) fromChapter += 1;
      if (fromChapter > horizon) return current;
      let chapterCount = 1;
      while (
        chapterCount < CHAPTER_PLANNING_BATCH_SIZE &&
        fromChapter + chapterCount <= horizon &&
        !existing.has(fromChapter + chapterCount)
      )
        chapterCount += 1;
      const contractSnapshot = JSON.stringify(project.contract);
      const batch = await ai.generateLaunchPlanning(project, { mode: "后续章纲", fromChapter, chapterCount });
      const refreshed = assertSnapshotUnchanged(projectId, contractSnapshot, targetSnapshot);
      if (
        batch.chapters.length !== chapterCount ||
        batch.chapters.some((chapter, index) => chapter.number !== fromChapter + index)
      )
        throw new Error("模型返回的章纲范围不完整，请继续生成重试当前批次");
      current = {
        ...current,
        phase: "逐章规划",
        completedChapters: completedChapters(refreshed, horizon) + batch.chapters.length,
        updatedAt: currentDate().toISOString(),
      };
      onProgress?.(current);
      database.saveLaunchPackBatch(projectId, batch, current);
    }
  };
  const startLaunchPack = (projectId: string): LaunchPackResult => {
    const project = database.getProjectOverview(projectId);
    const targetChapters = targetChapterCount(project);
    const horizon = Math.min(targetChapters, LAUNCH_INITIAL_HORIZON);
    if (activeLaunchPacks.has(projectId)) return launchResult(project);
    if (
      project.launchPack?.status === "已确认" ||
      (project.launchPack?.status === "待确认" && project.launchPack.targetChapters === targetChapters)
    )
      return launchResult(project);
    if (isGenerationActive(projectId)) throw new Error("该作品仍有正文生成任务运行，暂时不能生成开书包");
    const missingContractFields = missingContractApprovalFields(project.contract);
    if (missingContractFields.length) throw new Error(`请先完善开书方向：${missingContractFields.join("、")}`);
    if (!project.launchPack && (project.plans.length || project.chapters.length)) {
      throw new Error("该项目已有规划或章节，不能覆盖现有内容生成开书包");
    }
    if (project.chapters.some((chapter) => chapter.number > targetChapters))
      throw new Error("已有章纲超出当前目标篇幅，请先调整目标或整理已有章纲");
    const targetSnapshot = `${project.summary.targetWords}:${project.summary.wordsPerChapter || 2500}`;
    const hasStructure = project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷");
    const hasCoarse = coarseCompleted(project, targetChapters) > 0;
    let progress: LaunchPackProgress = {
      status: "生成中",
      phase: !hasStructure ? "全书结构" : !hasCoarse ? "全书粗纲" : "逐章规划",
      targetChapters,
      horizonChapters: horizon,
      completedChapters: completedChapters(project, horizon),
      coarseCompleted: coarseCompleted(project, targetChapters),
      coarseTotal: coarseBlockStarts(targetChapters).length,
      updatedAt: currentDate().toISOString(),
    };
    database.saveLaunchPackProgress(projectId, progress);
    activeLaunchPacks.add(projectId);
    // 开书包只备好结构、全书粗纲和开局章纲；后续章纲在写作推进时自动续跑。
    const run = async () => {
      try {
        let current = database.getProjectOverview(projectId);
        if (!current.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷")) {
          const contractSnapshot = JSON.stringify(current.contract);
          const structure = await ai.generateLaunchPlanning(current, { mode: "全书结构" });
          current = assertSnapshotUnchanged(projectId, contractSnapshot, targetSnapshot);
          progress = { ...progress, phase: "全书粗纲", updatedAt: currentDate().toISOString() };
          database.saveLaunchPackBatch(projectId, structure, progress);
        }
        const track = (next: LaunchPackProgress) => {
          progress = next;
        };
        progress = await runCoarseBatches(projectId, targetChapters, targetSnapshot, progress, track);
        progress = await runChapterBatches(projectId, horizon, targetSnapshot, progress, track);
        progress = {
          ...progress,
          status: "待确认",
          phase: "完成",
          completedChapters: horizon,
          horizonChapters: horizon,
          updatedAt: currentDate().toISOString(),
        };
        database.saveLaunchPackProgress(projectId, progress);
      } catch (error) {
        database.saveLaunchPackProgress(projectId, {
          ...progress,
          status: "已暂停",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: currentDate().toISOString(),
        });
      } finally {
        activeLaunchPacks.delete(projectId);
      }
    };
    void run().catch((error) => console.error("开书包进度保存失败", { projectId, error }));
    return { ...launchResult(project), progress };
  };
  /** 写作推进后自动把章纲补到「当前章 + 前瞻」；已确认的创作包才续跑。 */
  const ensureOutlineHorizon = (projectId: string) => {
    if (activeLaunchPacks.has(projectId) || isGenerationActive(projectId)) return;
    const project = database.getProjectOverview(projectId);
    const progress = project.launchPack;
    if (progress?.status !== "已确认") return;
    const targetChapters = targetChapterCount(project);
    const written = project.chapters.filter((chapter) => chapter.content.trim()).map((chapter) => chapter.number);
    const currentChapter = written.length ? Math.max(...written) : 0;
    const horizon = Math.min(targetChapters, currentChapter + AUTO_CONTINUE_HORIZON);
    if (completedChapters(project, horizon) >= horizon) return;
    const targetSnapshot = `${project.summary.targetWords}:${project.summary.wordsPerChapter || 2500}`;
    activeLaunchPacks.add(projectId);
    database.saveLaunchPackProgress(projectId, { ...progress, autoContinuing: true });
    void (async () => {
      try {
        await runChapterBatches(projectId, horizon, targetSnapshot, { ...progress, autoContinuing: true });
      } catch (error) {
        console.error("章纲自动续跑失败", {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        const latest = database.getProjectOverview(projectId).launchPack;
        if (latest) database.saveLaunchPackProgress(projectId, { ...latest, autoContinuing: false });
        activeLaunchPacks.delete(projectId);
      }
    })();
  };
  register("getDashboard", () =>
    assembleDashboard(database.listProjects(), database.getDashboardActivity(localDayEndExclusive(currentDate()))),
  );
  register("listProjects", () => database.listProjects());
  register("createProject", (input) => database.createProject(input));
  register("generateBookConcepts", (input) =>
    ai.generateBookConcepts(
      input,
      input.evidenceInsightIds?.length ? database.getInsights(input.evidenceInsightIds) : [],
    ),
  );
  register("createProjectFromConcept", async (input, concept) => {
    const skeleton = await ai.expandBookConcept(input, concept);
    const project = database.createProjectFromConcept(
      {
        title: concept.title,
        genre: input.genre,
        targetWords: input.targetWords,
        wordsPerChapter: input.wordsPerChapter,
        safeStockLine: input.safeStockLine,
        updateCadence: input.updateCadence,
      },
      contractDraftFromConcept(input, concept, skeleton),
    );
    startLaunchPack(project.id);
    return project;
  });
  register("getCategoryTags", (categoryKey) => {
    const profile = getFanqieCategoryProfile(categoryKey);
    if (!profile) return [];
    return aggregateCategoryTags(database.listRankings(), profile.name, profile.channel);
  });
  register("generateLaunchPack", (projectId) => startLaunchPack(projectId));
  register("approveLaunchPack", (projectId) => database.approveLaunchPack(projectId));
  register("listIncubations", () => database.listIncubations());
  register("listProjectSignatures", () => database.listProjectSignatures());
  register("getIncubation", (draftId) => database.getIncubation(draftId));
  register("saveIncubation", (draft) => database.saveIncubation(draft));
  register("deleteIncubation", (draftId) => database.deleteIncubation(draftId));
  register("promoteIncubation", async (draftId) => {
    const draft = database.getIncubation(draftId);
    if (draft.createdProjectId) throw new Error("该立项草稿已经创建过作品");
    const concept = draft.candidates.find((item) => item.id === draft.selectedCandidateId);
    if (!concept) throw new Error("请先在立项草稿里选定一套方案");
    const input = positioningToConceptInput(draft.positioning, draft.seed);
    const skeleton = await ai.expandBookConcept(input, concept);
    const project = database.createProjectFromConcept(
      {
        title: concept.title,
        genre: input.genre,
        targetWords: input.targetWords,
        wordsPerChapter: input.wordsPerChapter,
        safeStockLine: input.safeStockLine,
        updateCadence: input.updateCadence,
      },
      contractDraftFromConcept(input, concept, skeleton),
    );
    database.markIncubationPromoted(draftId, project.id, currentDate().toISOString());
    startLaunchPack(project.id);
    return project;
  });
  register("deleteProject", (id, confirmationTitle) => {
    if (activeLaunchPacks.has(id)) throw new Error("该作品仍在生成完整开书包，暂时不能删除");
    if (isGenerationActive(id)) {
      throw new Error("该作品仍有正文生成任务运行，暂时不能删除");
    }
    return database.deleteProject(id, confirmationTitle);
  });
  register("getProject", (id) => {
    const project = database.getProjectOverview(id);
    if (project.launchPack?.status === "生成中" && !activeLaunchPacks.has(id)) {
      project.launchPack = database.saveLaunchPackProgress(id, {
        ...project.launchPack,
        status: "已暂停",
        error: "上次生成已中断，可从已保存进度继续",
        updatedAt: currentDate().toISOString(),
      });
    } else if (project.launchPack?.autoContinuing && !activeLaunchPacks.has(id)) {
      project.launchPack = database.saveLaunchPackProgress(id, {
        ...project.launchPack,
        autoContinuing: false,
      });
    }
    ensureOutlineHorizon(id);
    return project;
  });
  register("getChapter", (id, chapterId) => database.getChapter(id, chapterId));
  register("saveChapter", (id, chapter, mode) => {
    const saved = database.saveChapter(id, chapter, mode);
    ensureOutlineHorizon(id);
    return saved;
  });
  register("saveExpectation", (id, expectation) => database.saveExpectation(id, expectation));
  register("saveStoryEntry", (id, entry) => database.saveStoryEntry(id, entry));
  register("deleteStoryEntry", (id, entryId) => database.deleteStoryEntry(id, entryId));
  register("seedStoryEntries", (id) => database.seedStoryEntries(id));
  register("saveAiFlavorWhitelist", (id, terms) => database.saveAiFlavorWhitelist(id, terms));
  register("searchProject", (id, query, offset, limit) => database.searchProject(id, query, offset, limit));
  register("listRevisions", (id, collection, entityId) => database.listRevisions(id, collection, entityId));
  register("restoreRevision", (id, revisionId) => database.restoreRevision(id, revisionId));
  register("saveFact", (id, fact) => database.saveFact(id, fact));
  register("resolveFactConflict", (id, factId, resolution) => database.resolveFactConflict(id, factId, resolution));
  register("getDirectorNotes", (id) => database.getDirectorNotes(id));
  register("saveDirectorNotes", (id, notes) => database.saveDirectorNotes(id, notes));
  register("recordGenerationDecision", (id, chapterId, action) =>
    database.recordGenerationDecision(id, chapterId, action),
  );
  register("getGenerationQuality", (id) => database.getGenerationQuality(id));
  register("resolveIssue", (id, issueId, status) => database.resolveIssue(id, issueId, status));
  register("saveChangeRequest", (id, change) => database.saveChangeRequest(id, change));
  register("decideChangeRequest", (id, changeId, decision) => database.decideChangeRequest(id, changeId, decision));
  register("saveSchedule", (id, item) => database.saveSchedule(id, item));
  register("attachInsights", (id, insightIds) => database.attachInsights(id, insightIds));
  register("importMetricsCsv", (id, csvText) => {
    const metrics = parseMetricsCsv(csvText);
    database.saveMetrics(id, metrics);
    return metrics.length;
  });
  register("getReviewSuggestions", (id) => analyzeMetrics(database.getProject(id).metrics));
  register("saveReviewExperiment", (id, experiment) => database.saveReviewExperiment(id, experiment));
  register("updateProject", (id, patch) => database.updateProject(id, patch));
  register("saveContract", (id, contract) => database.saveContract(id, contract));
  register("suggestAestheticProfile", (id, contract) => {
    const project = database.getProject(id);
    return ai.suggestAestheticProfile({ ...project, contract });
  });
  register("approveContract", (id) => database.approveContract(id));
  register("savePlan", (id, plan) => database.savePlan(id, plan));
  register("approvePlan", (id, planId) => database.approvePlan(id, planId));
}
