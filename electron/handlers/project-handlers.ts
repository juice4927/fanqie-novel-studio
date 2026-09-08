import { aggregateCategoryTags } from "../../src/shared/category-tags";
import { assembleDashboard, localDayEndExclusive } from "../../src/shared/dashboard-policy";
import { getFanqieCategoryProfile } from "../../src/shared/fanqie-taxonomy";
import { positioningToConceptInput } from "../../src/shared/incubation";
import { analyzeMetrics, parseMetricsCsv } from "../../src/shared/metrics";
import type { BookConceptInput, BookConceptSkeleton, IncubationCandidate, StoryContract } from "../../src/shared/types";
import type { AiService } from "../ai-service";
import type { WorkspaceDatabase } from "../database";
import type { RegisterHandler } from "./types";

type ProjectDatabase = Pick<
  WorkspaceDatabase,
  | "attachInsights"
  | "approveContract"
  | "approvePlan"
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
  | "saveFact"
  | "getDirectorNotes"
  | "saveDirectorNotes"
  | "getGenerationQuality"
  | "recordGenerationDecision"
  | "savePlan"
  | "saveSchedule"
  | "searchProject"
  | "updateProject"
  | "decideChangeRequest"
>;

type ProjectAi = Pick<
  AiService,
  "expandBookConcept" | "generateBookConcepts" | "generatePlanning" | "suggestAestheticProfile"
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
    return database.createProjectFromConcept(
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
  });
  register("getCategoryTags", (categoryKey) => {
    const profile = getFanqieCategoryProfile(categoryKey);
    if (!profile) return [];
    return aggregateCategoryTags(database.listRankings(), profile.name);
  });
  register("generateLaunchPack", async (projectId, options) => {
    const project = database.getProjectOverview(projectId);
    if (!project.contract.approved) throw new Error("必须先审批创作契约，才能生成开书包");
    let plans = 0;
    let chapters = 0;
    if (options.withStructure) {
      const structure = await ai.generatePlanning(project, { mode: "全书结构" });
      for (const plan of structure.plans) database.savePlan(projectId, plan);
      plans += structure.plans.length;
    }
    if (options.withFirstChapters) {
      const refreshed = database.getProjectOverview(projectId);
      const result = await ai.generatePlanning(refreshed, { mode: "后续章纲", fromChapter: 1, chapterCount: 10 });
      for (const plan of result.plans) database.savePlan(projectId, plan);
      for (const chapter of result.chapters) database.saveChapter(projectId, chapter, "autosave");
      plans += result.plans.length;
      chapters += result.chapters.length;
    }
    return { plans, chapters };
  });
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
    return project;
  });
  register("deleteProject", (id, confirmationTitle) => {
    if (isGenerationActive(id)) {
      throw new Error("该作品仍有正文生成任务运行，暂时不能删除");
    }
    return database.deleteProject(id, confirmationTitle);
  });
  register("getProject", (id) => database.getProjectOverview(id));
  register("getChapter", (id, chapterId) => database.getChapter(id, chapterId));
  register("saveChapter", (id, chapter, mode) => database.saveChapter(id, chapter, mode));
  register("saveExpectation", (id, expectation) => database.saveExpectation(id, expectation));
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
