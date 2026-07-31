import { describe, expect, it, vi } from "vitest";
import {
  registerProjectHandlers,
  type ProjectHandlerDependencies,
} from "../electron/handlers/project-handlers";
import type { RegisterHandler } from "../electron/handlers/types";
import { localDayEndExclusive } from "../src/shared/dashboard-policy";
import type {
  BookConceptCandidate,
  BookConceptInput,
  BookConceptSkeleton,
  ProjectSummary,
  StoryContract,
} from "../src/shared/types";

const project: ProjectSummary = {
  id: "project-1",
  title: "旧城回声",
  genre: "都市脑洞",
  status: "连载准备",
  targetWords: 1_000_000,
  currentWords: 10_000,
  chapterCount: 5,
  stockChapters: 2,
  safeStockLine: 10,
  updateCadence: "每日1章",
  nextPublishAt: null,
  riskLevel: "正常",
  updatedAt: "2026-07-31T08:00:00.000Z",
};

const conceptInput: BookConceptInput = {
  genre: "都市脑洞",
  targetWords: 1_000_000,
  updateCadence: "每日1章",
  seed: "旧城事故",
  secondaryGenres: ["悬疑"],
  genreElements: ["调查"],
  customGenreDirection: "职业调查",
};

const concept: BookConceptCandidate = {
  id: "concept-1",
  title: "旧城回声",
  premise: "主角追查重复发生的旧城事故",
  genreSubtype: "都市悬疑",
  secondaryGenres: ["悬疑"],
  genreElements: ["调查"],
  openingMechanism: "异常事故重演",
  growthCarrier: "证据网络",
  primaryPayoff: "还原真相",
  protagonistDesire: "洗清错误定责",
  readerPromise: "持续验证线索",
  coreEmotion: "责任与救赎",
  ending: "公开真相并重建规则",
  immutableRules: ["证据必须交叉验证"],
  prohibitedPatterns: ["无理由降智"],
  audience: "都市悬疑读者",
  commercialHook: "事故因果断点",
  longFormEngine: "事故、组织和规则逐层升级",
};

const skeleton: BookConceptSkeleton = {
  protagonistArc: "从逃避责任到主动承担调查代价",
  keyRelationships: ["调查搭档", "职业对手"],
  worldRules: ["证据可验证", "调查有代价"],
  majorForces: ["调查团队", "利益组织"],
  timelineAnchors: ["旧事故", "事故重演", "真相公开"],
};

function createDependencies(activeProjectId = "") {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    if (handlers.has(channel)) throw new Error(`重复注册：${channel}`);
    handlers.set(channel, callback);
  };
  const database = {
    attachInsights: vi.fn(),
    approveContract: vi.fn(),
    approvePlan: vi.fn(),
    createProject: vi.fn(() => project),
    createProjectFromConcept: vi.fn(() => project),
    decideChangeRequest: vi.fn(),
    deleteProject: vi.fn(() => "已删除"),
    getChapter: vi.fn(),
    getDashboardActivity: vi.fn(() => ({
      dueToday: [],
      activeAlerts: [],
      pendingIssues: 0,
    })),
    getProject: vi.fn(() => ({ summary: project, contract: {}, metrics: [] })),
    getProjectOverview: vi.fn(),
    listProjects: vi.fn(() => [project]),
    listRevisions: vi.fn(),
    resolveIssue: vi.fn(),
    restoreRevision: vi.fn(),
    saveChangeRequest: vi.fn(),
    saveChapter: vi.fn(),
    saveContract: vi.fn(),
    saveExpectation: vi.fn(),
    saveFact: vi.fn(),
    saveMetrics: vi.fn(),
    savePlan: vi.fn(),
    saveReviewExperiment: vi.fn(),
    saveSchedule: vi.fn(),
    searchProject: vi.fn(),
    updateProject: vi.fn(),
  };
  const ai = {
    expandBookConcept: vi.fn(async () => skeleton),
    generateBookConcepts: vi.fn(),
    suggestAestheticProfile: vi.fn(),
  };
  const currentDate = new Date(2026, 6, 31, 0, 30);
  const dependencies = {
    register,
    database,
    ai,
    isGenerationActive: (projectId: string) => projectId === activeProjectId,
    currentDate: () => currentDate,
  } as unknown as ProjectHandlerDependencies;
  return { handlers, database, ai, dependencies, currentDate };
}

describe("project handlers", () => {
  it("registers the complete project lifecycle surface", () => {
    const { dependencies, handlers } = createDependencies();
    registerProjectHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "approveContract",
      "approvePlan",
      "attachInsights",
      "createProject",
      "createProjectFromConcept",
      "decideChangeRequest",
      "deleteProject",
      "generateBookConcepts",
      "getChapter",
      "getDashboard",
      "getProject",
      "getReviewSuggestions",
      "importMetricsCsv",
      "listProjects",
      "listRevisions",
      "resolveIssue",
      "restoreRevision",
      "saveChangeRequest",
      "saveChapter",
      "saveContract",
      "saveExpectation",
      "saveFact",
      "savePlan",
      "saveReviewExperiment",
      "saveSchedule",
      "searchProject",
      "suggestAestheticProfile",
      "updateProject",
    ]);
  });

  it("parses metric imports and forwards review experiment persistence", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerProjectHandlers(dependencies);
    const csv = [
      "date,chapter,exposure,reads,retention,follows,revenue,comments",
      "2026-07-31,3,1000,600,42,120,9.5,第三章回落",
    ].join("\n");
    const experiment = { id: "experiment-1", title: "缩短开篇铺垫" };

    expect(handlers.get("importMetricsCsv")!(project.id, csv)).toBe(1);
    expect(database.saveMetrics).toHaveBeenCalledWith(
      project.id,
      [
        expect.objectContaining({
          chapterNumber: 3,
          exposure: 1000,
          reads: 600,
          retention: 42,
          follows: 120,
          revenue: 9.5,
          comments: "第三章回落",
        }),
      ],
    );
    expect(handlers.get("getReviewSuggestions")!(project.id)).toEqual([
      expect.objectContaining({
        id: "data-volume",
        category: "数据质量",
      }),
    ]);
    handlers.get("saveReviewExperiment")!(project.id, experiment);
    expect(database.saveReviewExperiment).toHaveBeenCalledWith(
      project.id,
      experiment,
    );
  });

  it("forwards project records and revision operations without reshaping arguments", () => {
    const { dependencies, handlers, database } = createDependencies();
    registerProjectHandlers(dependencies);
    const expectation = { id: "expectation-1" };
    const fact = { id: "fact-1" };
    const change = { id: "change-1" };
    const schedule = { id: "schedule-1" };

    handlers.get("saveChapter")!(project.id, { id: "chapter-1" }, "manual");
    handlers.get("saveExpectation")!(project.id, expectation);
    handlers.get("searchProject")!(project.id, "线索", 10, 20);
    handlers.get("listRevisions")!(project.id, "chapters", "chapter-1");
    handlers.get("restoreRevision")!(project.id, "revision-1");
    handlers.get("saveFact")!(project.id, fact);
    handlers.get("resolveIssue")!(project.id, "issue-1", "已解决");
    handlers.get("saveChangeRequest")!(project.id, change);
    handlers.get("decideChangeRequest")!(project.id, "change-1", "批准");
    handlers.get("saveSchedule")!(project.id, schedule);
    handlers.get("attachInsights")!(project.id, ["insight-1"]);

    expect(database.saveChapter).toHaveBeenCalledWith(
      project.id,
      { id: "chapter-1" },
      "manual",
    );
    expect(database.saveExpectation).toHaveBeenCalledWith(project.id, expectation);
    expect(database.searchProject).toHaveBeenCalledWith(project.id, "线索", 10, 20);
    expect(database.listRevisions).toHaveBeenCalledWith(
      project.id,
      "chapters",
      "chapter-1",
    );
    expect(database.restoreRevision).toHaveBeenCalledWith(project.id, "revision-1");
    expect(database.saveFact).toHaveBeenCalledWith(project.id, fact);
    expect(database.resolveIssue).toHaveBeenCalledWith(
      project.id,
      "issue-1",
      "已解决",
    );
    expect(database.saveChangeRequest).toHaveBeenCalledWith(project.id, change);
    expect(database.decideChangeRequest).toHaveBeenCalledWith(
      project.id,
      "change-1",
      "批准",
    );
    expect(database.saveSchedule).toHaveBeenCalledWith(project.id, schedule);
    expect(database.attachInsights).toHaveBeenCalledWith(project.id, ["insight-1"]);
  });

  it("assembles the dashboard with the injected local date", () => {
    const { dependencies, handlers, database, currentDate } =
      createDependencies();
    registerProjectHandlers(dependencies);

    const dashboard = handlers.get("getDashboard")!();

    expect(database.getDashboardActivity).toHaveBeenCalledWith(
      localDayEndExclusive(currentDate),
    );
    expect(dashboard).toMatchObject({
      projects: [project],
      totals: { activeBooks: 1, totalWords: 10_000 },
    });
  });

  it("expands a concept before creating its project contract", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerProjectHandlers(dependencies);

    await handlers.get("createProjectFromConcept")!(conceptInput, concept);

    expect(ai.expandBookConcept).toHaveBeenCalledWith(conceptInput, concept);
    expect(database.createProjectFromConcept).toHaveBeenCalledWith(
      expect.objectContaining({ title: concept.title, genre: conceptInput.genre }),
      expect.objectContaining({
        premise: concept.premise,
        customGenreDirection: "职业调查",
        protagonistArc: skeleton.protagonistArc,
        keyRelationships: skeleton.keyRelationships,
      }),
    );
  });

  it("keeps overview reads lightweight and overlays aesthetic candidates", () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerProjectHandlers(dependencies);

    handlers.get("getProject")!(project.id);
    expect(database.getProjectOverview).toHaveBeenCalledWith(project.id);
    expect(database.getProject).not.toHaveBeenCalled();

    const candidate = {
      premise: "候选契约覆盖内容",
    } as StoryContract;
    handlers.get("suggestAestheticProfile")!(project.id, candidate);
    expect(ai.suggestAestheticProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: project,
        contract: candidate,
      }),
    );
  });

  it("blocks deletion while chapter generation is active", () => {
    const { dependencies, handlers, database } = createDependencies("busy");
    registerProjectHandlers(dependencies);

    expect(() => handlers.get("deleteProject")!("busy", "作品"))
      .toThrow("正文生成任务运行");
    expect(database.deleteProject).not.toHaveBeenCalled();
    expect(handlers.get("deleteProject")!("idle", "作品")).toBe("已删除");
  });
});
