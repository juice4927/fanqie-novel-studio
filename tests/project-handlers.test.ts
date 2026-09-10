import { describe, expect, it, vi } from "vitest";
import { type ProjectHandlerDependencies, registerProjectHandlers } from "../electron/handlers/project-handlers";
import type { RegisterHandler } from "../electron/handlers/types";
import { localDayEndExclusive } from "../src/shared/dashboard-policy";
import type {
  BookConceptCandidate,
  BookConceptInput,
  BookConceptSkeleton,
  LaunchPackProgress,
  PlanningGenerationResult,
  ProjectDetail,
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
  // biome-ignore lint/suspicious/noExplicitAny: 测试桩回调参数宽松
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    if (handlers.has(channel)) throw new Error(`重复注册：${channel}`);
    handlers.set(channel, callback);
  };
  const overview = {
    summary: { ...project, targetWords: 25_000, wordsPerChapter: 2500 },
    contract: { ...concept, ...skeleton, approved: false },
    plans: [],
    chapters: [],
  } as unknown as ProjectDetail;
  const database = {
    attachInsights: vi.fn(),
    approveContract: vi.fn(),
    approvePlan: vi.fn(),
    approveLaunchPack: vi.fn(),
    createProject: vi.fn(() => project),
    createProjectFromConcept: vi.fn(() => project),
    decideChangeRequest: vi.fn(),
    deleteIncubation: vi.fn(),
    deleteProject: vi.fn(() => "已删除"),
    getChapter: vi.fn(),
    getDirectorNotes: vi.fn(() => []),
    getGenerationQuality: vi.fn(() => ({ total: 0, adopted: 0, reverted: 0, revertRate: 0, tier: "scrutiny" })),
    getDashboardActivity: vi.fn(() => ({
      dueToday: [],
      activeAlerts: [],
      pendingIssues: 0,
    })),
    getIncubation: vi.fn(),
    getInsights: vi.fn(() => []),
    getProject: vi.fn(() => ({ summary: project, contract: {}, metrics: [] })),
    getProjectOverview: vi.fn(() => overview),
    listIncubations: vi.fn(() => []),
    listProjectSignatures: vi.fn(() => []),
    listProjects: vi.fn(() => [project]),
    listRankings: vi.fn(() => []),
    listRevisions: vi.fn(),
    markIncubationPromoted: vi.fn(),
    recordGenerationDecision: vi.fn(),
    resolveIssue: vi.fn(),
    restoreRevision: vi.fn(),
    saveChangeRequest: vi.fn(),
    saveChapter: vi.fn(),
    saveContract: vi.fn(),
    saveExpectation: vi.fn(),
    saveDirectorNotes: vi.fn((_id: string, notes: string[]) => notes),
    saveFact: vi.fn(),
    resolveFactConflict: vi.fn(),
    saveIncubation: vi.fn((draft) => draft),
    saveMetrics: vi.fn(),
    savePlan: vi.fn(),
    saveLaunchPackProgress: vi.fn((_id: string, progress: LaunchPackProgress) => {
      overview.launchPack = progress;
      return progress;
    }),
    saveLaunchPackBatch: vi.fn((_id: string, batch: PlanningGenerationResult, progress: LaunchPackProgress) => {
      overview.plans.push(...batch.plans);
      overview.chapters.push(...batch.chapters);
      overview.launchPack = progress;
    }),
    saveReviewExperiment: vi.fn(),
    saveSchedule: vi.fn(),
    searchProject: vi.fn(),
    updateProject: vi.fn(),
  };
  const ai = {
    expandBookConcept: vi.fn(async () => skeleton),
    generateBookConcepts: vi.fn(),
    generateLaunchPlanning: vi.fn(
      async (
        _project: ProjectDetail,
        input: { mode: string; fromChapter?: number; chapterCount?: number },
      ): Promise<PlanningGenerationResult> => {
        if (input.mode === "全书结构")
          return {
            startChapter: 1,
            chapters: [],
            plans: [{ id: "structure-1", kind: "分卷", status: "草稿" }] as PlanningGenerationResult["plans"],
          };
        if (input.mode === "全书粗纲") {
          const from = input.fromChapter ?? 1;
          const count = input.chapterCount ?? 10;
          const starts: number[] = [];
          for (let number = from; number < from + count; number += 10) starts.push(number);
          return {
            startChapter: from,
            chapters: [],
            plans: starts.map((ordinal) => ({
              id: `coarse-${ordinal}`,
              kind: "粗纲",
              ordinal,
              status: "草稿",
            })) as PlanningGenerationResult["plans"],
          };
        }
        return {
          startChapter: input.fromChapter ?? 1,
          plans: [],
          chapters: Array.from({ length: input.chapterCount ?? 10 }, (_, index) => ({
            id: `chapter-${(input.fromChapter ?? 1) + index}`,
            number: (input.fromChapter ?? 1) + index,
            content: "",
            status: "章纲",
          })) as PlanningGenerationResult["chapters"],
        };
      },
    ),
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
  return { handlers, database, ai, dependencies, currentDate, overview };
}

describe("project handlers", () => {
  it("registers the complete project lifecycle surface", () => {
    const { dependencies, handlers } = createDependencies();
    registerProjectHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "approveContract",
      "approveLaunchPack",
      "approvePlan",
      "attachInsights",
      "createProject",
      "createProjectFromConcept",
      "decideChangeRequest",
      "deleteIncubation",
      "deleteProject",
      "deleteStoryEntry",
      "generateBookConcepts",
      "generateLaunchPack",
      "getCategoryTags",
      "getChapter",
      "getDashboard",
      "getDirectorNotes",
      "getGenerationQuality",
      "getIncubation",
      "getProject",
      "getReviewSuggestions",
      "importMetricsCsv",
      "listIncubations",
      "listProjectSignatures",
      "listProjects",
      "listRevisions",
      "promoteIncubation",
      "recordGenerationDecision",
      "resolveFactConflict",
      "resolveIssue",
      "restoreRevision",
      "saveAiFlavorWhitelist",
      "saveChangeRequest",
      "saveChapter",
      "saveContract",
      "saveDirectorNotes",
      "saveExpectation",
      "saveFact",
      "saveIncubation",
      "savePlan",
      "saveReviewExperiment",
      "saveSchedule",
      "saveStoryEntry",
      "searchProject",
      "seedStoryEntries",
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
    expect(database.saveMetrics).toHaveBeenCalledWith(project.id, [
      expect.objectContaining({
        chapterNumber: 3,
        exposure: 1000,
        reads: 600,
        retention: 42,
        follows: 120,
        revenue: 9.5,
        comments: "第三章回落",
      }),
    ]);
    expect(handlers.get("getReviewSuggestions")!(project.id)).toEqual([
      expect.objectContaining({
        id: "data-volume",
        category: "数据质量",
      }),
    ]);
    handlers.get("saveReviewExperiment")!(project.id, experiment);
    expect(database.saveReviewExperiment).toHaveBeenCalledWith(project.id, experiment);
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

    expect(database.saveChapter).toHaveBeenCalledWith(project.id, { id: "chapter-1" }, "manual");
    expect(database.saveExpectation).toHaveBeenCalledWith(project.id, expectation);
    expect(database.searchProject).toHaveBeenCalledWith(project.id, "线索", 10, 20);
    expect(database.listRevisions).toHaveBeenCalledWith(project.id, "chapters", "chapter-1");
    expect(database.restoreRevision).toHaveBeenCalledWith(project.id, "revision-1");
    expect(database.saveFact).toHaveBeenCalledWith(project.id, fact);
    expect(database.resolveIssue).toHaveBeenCalledWith(project.id, "issue-1", "已解决");
    expect(database.saveChangeRequest).toHaveBeenCalledWith(project.id, change);
    expect(database.decideChangeRequest).toHaveBeenCalledWith(project.id, "change-1", "批准");
    expect(database.saveSchedule).toHaveBeenCalledWith(project.id, schedule);
    expect(database.attachInsights).toHaveBeenCalledWith(project.id, ["insight-1"]);
  });

  it("assembles the dashboard with the injected local date", () => {
    const { dependencies, handlers, database, currentDate } = createDependencies();
    registerProjectHandlers(dependencies);

    const dashboard = handlers.get("getDashboard")!();

    expect(database.getDashboardActivity).toHaveBeenCalledWith(localDayEndExclusive(currentDate));
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

  it("passes selected desensitized insights into concept generation", async () => {
    const { dependencies, handlers, database, ai } = createDependencies();
    registerProjectHandlers(dependencies);
    const insight = { id: "insight-1", name: "读者需求" };
    database.getInsights = vi.fn(() => [insight]);

    await handlers.get("generateBookConcepts")!({ ...conceptInput, evidenceInsightIds: ["insight-1"] });

    expect(database.getInsights).toHaveBeenCalledWith(["insight-1"]);
    expect(ai.generateBookConcepts).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceInsightIds: ["insight-1"] }),
      [insight],
    );
  });

  it("generates the entire book from a draft contract in durable batches without approving it", async () => {
    const { dependencies, handlers, database, ai, overview } = createDependencies();
    overview.summary.targetWords = 82_500;
    registerProjectHandlers(dependencies);

    const result = handlers.get("generateLaunchPack")!(project.id);
    expect(result).toMatchObject({ progress: { status: "生成中", targetChapters: 33 } });
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("待确认"));
    expect(overview.chapters.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 33 }, (_, index) => index + 1),
    );
    expect(
      ai.generateLaunchPlanning.mock.calls
        .slice(1)
        .map(([, input]) => [input.mode, input.fromChapter, input.chapterCount]),
    ).toEqual([
      ["全书粗纲", 1, 33],
      ["后续章纲", 1, 10],
      ["后续章纲", 11, 10],
      ["后续章纲", 21, 10],
      ["后续章纲", 31, 3],
    ]);
    expect(database.saveLaunchPackBatch).toHaveBeenCalledTimes(6);
    expect(overview.contract.approved).toBe(false);
    expect(database.approveContract).not.toHaveBeenCalled();
    expect(database.approvePlan).not.toHaveBeenCalled();
    handlers.get("generateLaunchPack")!(project.id);
    expect(ai.generateLaunchPlanning).toHaveBeenCalledTimes(6);
    handlers.get("approveLaunchPack")!(project.id);
    expect(database.approveLaunchPack).toHaveBeenCalledWith(project.id);
  });

  it("preserves completed batches after an error and resumes from the first missing chapter", async () => {
    const { dependencies, handlers, ai, overview } = createDependencies();
    overview.summary.targetWords = 55_000;
    const implementation = ai.generateLaunchPlanning.getMockImplementation()!;
    ai.generateLaunchPlanning
      .mockImplementationOnce(implementation)
      .mockImplementationOnce(implementation)
      .mockImplementationOnce(implementation)
      .mockRejectedValueOnce(new Error("网络中断"));
    registerProjectHandlers(dependencies);

    handlers.get("generateLaunchPack")!(project.id);
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("已暂停"));
    expect(overview.launchPack).toMatchObject({ completedChapters: 10, error: "网络中断" });
    const firstIds = overview.chapters.map((chapter) => chapter.id);
    handlers.get("generateLaunchPack")!(project.id);
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("待确认"));
    expect(overview.chapters).toHaveLength(22);
    expect(overview.chapters.slice(0, 10).map((chapter) => chapter.id)).toEqual(firstIds);
    expect(ai.generateLaunchPlanning.mock.calls.map(([, input]) => [input.mode, input.fromChapter])).toEqual([
      ["全书结构", undefined],
      ["全书粗纲", 1],
      ["后续章纲", 1],
      ["后续章纲", 11],
      ["后续章纲", 11],
      ["后续章纲", 21],
    ]);
  });

  it("continues chapter outlines in the background once writing moves past the prepared horizon", async () => {
    const { dependencies, handlers, ai, overview } = createDependencies();
    overview.summary.targetWords = 300_000;
    overview.launchPack = {
      status: "已确认",
      phase: "完成",
      targetChapters: 120,
      horizonChapters: 100,
      completedChapters: 100,
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    overview.chapters = Array.from({ length: 100 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      number: index + 1,
      title: `已备章纲${index + 1}`,
      content: index === 0 ? "第一章正文" : "",
      status: "章纲",
    })) as ProjectDetail["chapters"];
    registerProjectHandlers(dependencies);

    handlers.get("saveChapter")!(project.id, overview.chapters[0], "autosave");
    await vi.waitFor(() => expect(overview.chapters.some((chapter) => chapter.number === 101)).toBe(true));
    expect(
      ai.generateLaunchPlanning.mock.calls.map(([, input]) => [input.mode, input.fromChapter, input.chapterCount]),
    ).toEqual([["后续章纲", 101, 1]]);
    expect(overview.launchPack?.status).toBe("已确认");
    await vi.waitFor(() => expect(overview.launchPack?.autoContinuing).toBe(false));
  });

  it("clears a stale auto-continuation flag when no generation is running", () => {
    const { dependencies, handlers, overview } = createDependencies();
    overview.summary.targetWords = 300_000;
    overview.launchPack = {
      status: "已确认",
      phase: "完成",
      targetChapters: 120,
      horizonChapters: 100,
      completedChapters: 100,
      autoContinuing: true,
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    overview.chapters = Array.from({ length: 100 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      number: index + 1,
      title: `已备章纲${index + 1}`,
      content: "",
      status: "章纲",
    })) as ProjectDetail["chapters"];
    registerProjectHandlers(dependencies);
    handlers.get("getProject")!(project.id);
    expect(overview.launchPack?.autoContinuing).toBe(false);
  });

  it("does not continue outlines before the pack is confirmed", async () => {
    const { dependencies, handlers, ai, overview } = createDependencies();
    overview.summary.targetWords = 300_000;
    overview.launchPack = {
      status: "待确认",
      phase: "完成",
      targetChapters: 120,
      horizonChapters: 100,
      completedChapters: 100,
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    registerProjectHandlers(dependencies);
    handlers.get("getProject")!(project.id);
    expect(ai.generateLaunchPlanning).not.toHaveBeenCalled();
  });

  it("does not duplicate concurrent launch requests or overwrite an unrelated outline", async () => {
    const { dependencies, handlers, ai, overview } = createDependencies();
    let release: (() => void) | undefined;
    const implementation = ai.generateLaunchPlanning.getMockImplementation()!;
    ai.generateLaunchPlanning.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return implementation(...args);
    });
    registerProjectHandlers(dependencies);
    handlers.get("generateLaunchPack")!(project.id);
    handlers.get("generateLaunchPack")!(project.id);
    expect(ai.generateLaunchPlanning).toHaveBeenCalledTimes(1);
    expect(() => handlers.get("deleteProject")!(project.id, project.title)).toThrow("完整开书包");
    release!();
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("待确认"));
    overview.launchPack = undefined;
    expect(() => handlers.get("generateLaunchPack")!(project.id)).toThrow("不能覆盖现有内容");
  });

  it("pauses when the target word budget changes while a batch is in flight", async () => {
    const { dependencies, handlers, ai, overview } = createDependencies();
    let release: (() => void) | undefined;
    const implementation = ai.generateLaunchPlanning.getMockImplementation()!;
    ai.generateLaunchPlanning.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return implementation(...args);
    });
    registerProjectHandlers(dependencies);
    handlers.get("generateLaunchPack")!(project.id);
    overview.summary.targetWords = 35_000;
    release!();
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("已暂停"));
    expect(overview.launchPack?.error).toContain("目标字数");
    expect(overview.chapters).toHaveLength(0);
  });

  it("discards a batch if the contract is edited before the model returns", async () => {
    const { dependencies, handlers, database, ai, overview } = createDependencies();
    let release: (() => void) | undefined;
    const implementation = ai.generateLaunchPlanning.getMockImplementation()!;
    ai.generateLaunchPlanning.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return implementation(...args);
    });
    registerProjectHandlers(dependencies);
    handlers.get("generateLaunchPack")!(project.id);
    overview.contract.premise = "作者在生成途中调整了故事前提";
    release!();
    await vi.waitFor(() => expect(overview.launchPack?.status).toBe("已暂停"));
    expect(overview.launchPack?.error).toContain("设定已修改");
    expect(database.saveLaunchPackBatch).not.toHaveBeenCalled();
  });

  it("keeps a blank legacy project intact instead of inventing a direction", () => {
    const { dependencies, handlers, database, ai, overview } = createDependencies();
    overview.contract = { ...overview.contract, premise: "", readerPromise: "", openingMechanism: "" };
    registerProjectHandlers(dependencies);
    expect(() => handlers.get("generateLaunchPack")!(project.id)).toThrow("请先完善开书方向");
    expect(ai.generateLaunchPlanning).not.toHaveBeenCalled();
    expect(database.saveLaunchPackProgress).not.toHaveBeenCalled();
    expect(overview.plans).toHaveLength(0);
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

    expect(() => handlers.get("deleteProject")!("busy", "作品")).toThrow("正文生成任务运行");
    expect(database.deleteProject).not.toHaveBeenCalled();
    expect(handlers.get("deleteProject")!("idle", "作品")).toBe("已删除");
  });
});
