import type { AiService } from "../ai-service";
import type { WorkspaceDatabase } from "../database";
import {
  assembleDashboard,
  localDayEndExclusive,
} from "../../src/shared/dashboard-policy";
import { analyzeMetrics, parseMetricsCsv } from "../../src/shared/metrics";
import type { RegisterHandler } from "./types";

type ProjectDatabase = Pick<
  WorkspaceDatabase,
  | "attachInsights"
  | "approveContract"
  | "approvePlan"
  | "createProject"
  | "createProjectFromConcept"
  | "decideChangeRequest"
  | "deleteProject"
  | "getChapter"
  | "getDashboardActivity"
  | "getProject"
  | "getProjectOverview"
  | "saveMetrics"
  | "saveReviewExperiment"
  | "listProjects"
  | "listRevisions"
  | "resolveIssue"
  | "restoreRevision"
  | "saveChangeRequest"
  | "saveChapter"
  | "saveContract"
  | "saveExpectation"
  | "saveFact"
  | "savePlan"
  | "saveSchedule"
  | "searchProject"
  | "updateProject"
>;

type ProjectAi = Pick<
  AiService,
  | "expandBookConcept"
  | "generateBookConcepts"
  | "suggestAestheticProfile"
>;

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
    assembleDashboard(
      database.listProjects(),
      database.getDashboardActivity(
        localDayEndExclusive(currentDate()),
      ),
    ),
  );
  register("listProjects", () => database.listProjects());
  register("createProject", (input) => database.createProject(input));
  register("generateBookConcepts", (input) => ai.generateBookConcepts(input));
  register("createProjectFromConcept", async (input, concept) => {
    const skeleton = await ai.expandBookConcept(input, concept);
    return database.createProjectFromConcept(
      {
        title: concept.title,
        genre: input.genre,
        targetWords: input.targetWords,
        updateCadence: input.updateCadence,
      },
      {
        premise: concept.premise,
        genreSubtype: concept.genreSubtype,
        fanqieCategoryKey: "",
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
        readerPromise: concept.readerPromise,
        coreEmotion: concept.coreEmotion,
        ending: concept.ending,
        immutableRules: concept.immutableRules,
        prohibitedPatterns: concept.prohibitedPatterns,
      },
    );
  });
  register("deleteProject", (id, confirmationTitle) => {
    if (isGenerationActive(id)) {
      throw new Error("该作品仍有正文生成任务运行，暂时不能删除");
    }
    return database.deleteProject(id, confirmationTitle);
  });
  register("getProject", (id) => database.getProjectOverview(id));
  register("getChapter", (id, chapterId) => database.getChapter(id, chapterId));
  register("saveChapter", (id, chapter, mode) =>
    database.saveChapter(id, chapter, mode),
  );
  register("saveExpectation", (id, expectation) =>
    database.saveExpectation(id, expectation),
  );
  register("searchProject", (id, query, offset, limit) =>
    database.searchProject(id, query, offset, limit),
  );
  register("listRevisions", (id, collection, entityId) =>
    database.listRevisions(id, collection, entityId),
  );
  register("restoreRevision", (id, revisionId) =>
    database.restoreRevision(id, revisionId),
  );
  register("saveFact", (id, fact) => database.saveFact(id, fact));
  register("resolveIssue", (id, issueId, status) =>
    database.resolveIssue(id, issueId, status),
  );
  register("saveChangeRequest", (id, change) =>
    database.saveChangeRequest(id, change),
  );
  register("decideChangeRequest", (id, changeId, decision) =>
    database.decideChangeRequest(id, changeId, decision),
  );
  register("saveSchedule", (id, item) => database.saveSchedule(id, item));
  register("attachInsights", (id, insightIds) =>
    database.attachInsights(id, insightIds),
  );
  register("importMetricsCsv", (id, csvText) => {
    const metrics = parseMetricsCsv(csvText);
    database.saveMetrics(id, metrics);
    return metrics.length;
  });
  register("getReviewSuggestions", (id) =>
    analyzeMetrics(database.getProject(id).metrics),
  );
  register("saveReviewExperiment", (id, experiment) =>
    database.saveReviewExperiment(id, experiment),
  );
  register("updateProject", (id, patch) => database.updateProject(id, patch));
  register("saveContract", (id, contract) =>
    database.saveContract(id, contract),
  );
  register("suggestAestheticProfile", (id, contract) => {
    const project = database.getProject(id);
    return ai.suggestAestheticProfile({ ...project, contract });
  });
  register("approveContract", (id) => database.approveContract(id));
  register("savePlan", (id, plan) => database.savePlan(id, plan));
  register("approvePlan", (id, planId) => database.approvePlan(id, planId));
}
