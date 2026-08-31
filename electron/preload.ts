import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, ChapterDraftStreamEvent, ChapterFactsExtractionEvent } from "../src/shared/types";

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`studio:${channel}`, ...args) as Promise<T>;

const api: AppApi = {
  getDashboard: () => invoke("getDashboard"),
  listProjects: () => invoke("listProjects"),
  createProject: (input) => invoke("createProject", input),
  generateBookConcepts: (input) => invoke("generateBookConcepts", input),
  createProjectFromConcept: (input, concept) => invoke("createProjectFromConcept", input, concept),
  deleteProject: (id, confirmationTitle) => invoke("deleteProject", id, confirmationTitle),
  getProject: (id) => invoke("getProject", id),
  getChapter: (id, chapterId) => invoke("getChapter", id, chapterId),
  updateProject: (id, patch) => invoke("updateProject", id, patch),
  saveContract: (id, contract) => invoke("saveContract", id, contract),
  suggestAestheticProfile: (id, contract) => invoke("suggestAestheticProfile", id, contract),
  approveContract: (id) => invoke("approveContract", id),
  savePlan: (id, plan) => invoke("savePlan", id, plan),
  approvePlan: (id, planId) => invoke("approvePlan", id, planId),
  generatePlanningDraft: (id, input) => invoke("generatePlanningDraft", id, input),
  reviewPlanning: (id, input) => invoke("reviewPlanning", id, input),
  applyPlanningRepairs: (id, input) => invoke("applyPlanningRepairs", id, input),
  analyzeNovelRevision: (id, input) => invoke("analyzeNovelRevision", id, input),
  applyNovelRevision: (id, proposal, selectedRepairIds) =>
    invoke("applyNovelRevision", id, proposal, selectedRepairIds),
  saveChapter: (id, chapter, mode) => invoke("saveChapter", id, chapter, mode),
  saveExpectation: (id, expectation) => invoke("saveExpectation", id, expectation),
  transitionChapter: (id, chapterId, status) => invoke("transitionChapter", id, chapterId, status),
  onChapterFactsExtracted: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ChapterFactsExtractionEvent) => listener(payload);
    ipcRenderer.on("studio:chapter-facts-extracted", wrapped);
    return () => ipcRenderer.removeListener("studio:chapter-facts-extracted", wrapped);
  },
  compileContext: (id, chapterId) => invoke("compileContext", id, chapterId),
  searchProject: (id, query, offset, limit) => invoke("searchProject", id, query, offset, limit),
  listRevisions: (id, collection, entityId) => invoke("listRevisions", id, collection, entityId),
  restoreRevision: (id, revisionId) => invoke("restoreRevision", id, revisionId),
  runQualityCheck: (id, chapterId) => invoke("runQualityCheck", id, chapterId),
  reviseChapterFromQuality: (id, chapterId) => invoke("reviseChapterFromQuality", id, chapterId),
  extractChapterFacts: (id, chapterId) => invoke("extractChapterFacts", id, chapterId),
  saveFact: (id, fact) => invoke("saveFact", id, fact),
  resolveIssue: (id, issueId, status) => invoke("resolveIssue", id, issueId, status),
  saveChangeRequest: (id, change) => invoke("saveChangeRequest", id, change),
  decideChangeRequest: (id, changeId, decision) => invoke("decideChangeRequest", id, changeId, decision),
  saveSchedule: (id, item) => invoke("saveSchedule", id, item),
  listRankings: () => invoke("listRankings"),
  importRankingCsv: (csvText, listName) => invoke("importRankingCsv", csvText, listName),
  capturePublicRanking: (url, listName) => invoke("capturePublicRanking", url, listName),
  listRankingSchedules: () => invoke("listRankingSchedules"),
  saveRankingSchedule: (input) => invoke("saveRankingSchedule", input),
  runRankingSchedule: (id) => invoke("runRankingSchedule", id),
  deleteRankingSchedule: (id) => invoke("deleteRankingSchedule", id),
  getRankingAnalytics: () => invoke("getRankingAnalytics"),
  listResearchBooks: () => invoke("listResearchBooks"),
  previewResearchFile: () => invoke("previewResearchFile"),
  importResearchBook: (preview, genre, rightsConfirmed, cloudConsent) =>
    invoke("importResearchBook", preview, genre, rightsConfirmed, cloudConsent),
  importPublicResearchSample: (sourceUrl, genre, cloudConsent) =>
    invoke("importPublicResearchSample", sourceUrl, genre, cloudConsent),
  listInsights: () => invoke("listInsights"),
  createInsight: (input) => invoke("createInsight", input),
  deconstructResearchBook: (bookId) => invoke("deconstructResearchBook", bookId),
  listResearchAnalyses: (bookId) => invoke("listResearchAnalyses", bookId),
  attachInsights: (id, insightIds) => invoke("attachInsights", id, insightIds),
  generateConcepts: (id) => invoke("generateConcepts", id),
  generateChapterDraft: async (id, chapterId, onStream) => {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { streamId: string; event: ChapterDraftStreamEvent },
    ) => {
      if (payload.streamId === streamId) onStream?.(payload.event);
    };
    ipcRenderer.on("studio:chapter-draft-stream", listener);
    try {
      return await invoke("generateChapterDraft", id, chapterId, streamId);
    } finally {
      ipcRenderer.removeListener("studio:chapter-draft-stream", listener);
    }
  },
  previewChapterBatch: (id, chapterId) => invoke("previewChapterBatch", id, chapterId),
  generateChapterBatch: (id, chapterId) => invoke("generateChapterBatch", id, chapterId),
  getAiSettings: () => invoke("getAiSettings"),
  saveAiSettings: (settings, apiKey) => invoke("saveAiSettings", settings, apiKey),
  listAiJobs: (projectId) => invoke("listAiJobs", projectId),
  cancelAiJob: (id) => invoke("cancelAiJob", id),
  retryAiJob: (id) => invoke("retryAiJob", id),
  exportProject: (id, format) => invoke("exportProject", id, format),
  importMetricsCsv: (id, csvText) => invoke("importMetricsCsv", id, csvText),
  getReviewSuggestions: (id) => invoke("getReviewSuggestions", id),
  saveReviewExperiment: (id, experiment) => invoke("saveReviewExperiment", id, experiment),
  createBackup: (password) => invoke("createBackup", password),
  restoreBackup: (password) => invoke("restoreBackup", password),
  getAutoBackupSettings: () => invoke("getAutoBackupSettings"),
  saveAutoBackupSettings: (input, password) => invoke("saveAutoBackupSettings", input, password),
  runAutoBackup: () => invoke("runAutoBackup"),
  runSystemHealthCheck: () => invoke("runSystemHealthCheck"),
  startSystemHealthCheck: () => invoke("startSystemHealthCheck"),
  getSystemHealthCheck: (id) => invoke("getSystemHealthCheck", id),
  cancelSystemHealthCheck: (id) => invoke("cancelSystemHealthCheck", id),
  rebuildSearchIndexes: (projectId) => invoke("rebuildSearchIndexes", projectId),
  exportDiagnosticBundle: () => invoke("exportDiagnosticBundle"),
  getWorkspacePath: () => invoke("getWorkspacePath"),
};

contextBridge.exposeInMainWorld("novelStudio", api);
