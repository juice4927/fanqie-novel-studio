import { describe, expect, it, vi } from "vitest";
import { createChapterGenerationGuard } from "../electron/ai-retry";
import {
  type ChapterGenerationAi,
  type ChapterGenerationDatabase,
  createChapterGenerationCoordinator,
} from "../electron/chapter-generation-service";
import type {
  AiSettings,
  Chapter,
  ContextPackage,
  LedgerFact,
  ProjectDetail,
  StoryContract,
} from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function createChapter(number: number, overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: `chapter-${number}`,
    number,
    title: `第${number}章`,
    outline: `推进第${number}章冲突`,
    content: "",
    wordCount: 0,
    status: "章纲",
    batchMode: "五章批次",
    isKeyChapter: false,
    targetWords: 2_000,
    revision: 1,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createFact(id: string, confidence: LedgerFact["confidence"] = "已确认"): LedgerFact {
  return {
    id,
    kind: "人物",
    subject: "林舟",
    predicate: "所在地点",
    value: "旧城",
    validFromChapter: 1,
    validToChapter: null,
    evidenceChapter: 1,
    confidence,
    knowledgeScope: "所有人",
    updatedAt: timestamp,
  };
}

function createProject(): ProjectDetail {
  const contract: StoryContract = {
    premise: "主角追查旧城事故",
    protagonistDesire: "查明真相",
    readerPromise: "持续调查与兑现",
    coreEmotion: "责任",
    ending: "真相公开",
    immutableRules: [],
    prohibitedPatterns: [],
    majorStateChanges: { include: [], exclude: [] },
    version: 1,
    approved: true,
    updatedAt: timestamp,
  };
  return {
    summary: {
      id: "project-1",
      title: "旧城回声",
      genre: "都市脑洞",
      status: "连载准备",
      targetWords: 1_000_000,
      currentWords: 0,
      chapterCount: 5,
      stockChapters: 0,
      safeStockLine: 10,
      updateCadence: "日更",
      nextPublishAt: null,
      riskLevel: "正常",
      updatedAt: timestamp,
    },
    contract,
    plans: [],
    chapters: [1, 2, 3, 4, 5].map((number) => createChapter(number)),
    facts: [],
    issues: [],
    changes: [],
    schedule: [],
    metrics: [],
    experiments: [],
    insightIds: [],
    summaries: [],
    expectations: [],
  };
}

const settings: AiSettings = {
  protocol: "openai-compatible",
  baseUrl: "https://model.invalid/v1",
  model: "test-model",
  embeddingModel: "test-embedding",
  hasApiKey: true,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
  longTaskTimeoutMinutes: 10,
};

const context: ContextPackage = {
  contract: "contract",
  commercialGuidance: "commercial",
  chapterIntent: "intent",
  expectationLedger: "expectations",
  longTermMemory: "memory",
  volumeGoal: "volume",
  rollingOutline: "outline",
  recentSummary: "recent",
  relevantFacts: "facts",
  forbiddenKnowledge: "knowledge",
  authorStyle: "style",
  estimatedTokens: 100,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(options: { project?: ProjectDetail; apiKey?: string; startCompletion?: Promise<Chapter> } = {}) {
  const project = options.project ?? createProject();
  let apiKey = options.apiKey ?? "secret";
  const relevantFacts = [createFact("fact-relevant")];
  const generatedChapter = {
    ...project.chapters[0],
    content: "AI 生成正文",
    wordCount: 6,
  };
  const getProject = vi.fn(() => project);
  const getAiSettings = vi.fn(() => settings);
  const searchRelevantFacts = vi.fn(() => relevantFacts);
  const saveGeneratedChapter = vi.fn((_projectId: string, chapter: Chapter) => chapter);
  const markAiJobApplicationFailed = vi.fn();
  const startDraftChapter = vi.fn((_projectId: string, _chapter: Chapter) => ({
    jobId: "job-1",
    source: "network" as const,
    completion: options.startCompletion ?? Promise.resolve(generatedChapter),
  }));
  const draftChapter = vi.fn(async (_projectId: string, chapter: Chapter) => ({
    ...chapter,
    content: `AI 正文 ${chapter.number}`,
    wordCount: 7,
  }));
  const compileContext = vi.fn(() => context);
  const database: ChapterGenerationDatabase = {
    getProject,
    getAiSettings,
    searchRelevantFacts,
    saveGeneratedChapter,
    markAiJobApplicationFailed,
  };
  const ai: ChapterGenerationAi = {
    startDraftChapter,
    draftChapter,
  };
  const coordinator = createChapterGenerationCoordinator({
    database,
    ai,
    getApiKey: () => apiKey,
    compileContext,
  });
  return {
    coordinator,
    project,
    relevantFacts,
    generatedChapter,
    getProject,
    searchRelevantFacts,
    saveGeneratedChapter,
    markAiJobApplicationFailed,
    startDraftChapter,
    draftChapter,
    compileContext,
    setApiKey: (value: string) => {
      apiKey = value;
    },
  };
}

describe("chapter generation coordinator", () => {
  it.each([
    {
      name: "unapproved contract",
      message: "创作契约审批后才能生成正文",
      chapterId: "chapter-1",
      mutate: (project: ProjectDetail) => {
        project.contract.approved = false;
      },
    },
    {
      name: "missing chapter",
      message: "章节不存在",
      chapterId: "missing",
      mutate: () => {},
    },
    {
      name: "empty outline",
      message: "请先填写本章章纲",
      chapterId: "chapter-1",
      mutate: (project: ProjectDetail) => {
        project.chapters[0].outline = " ";
      },
    },
    {
      name: "finalized chapter",
      message: "已定稿或进入发布流程的章节不能由 AI 覆写",
      chapterId: "chapter-1",
      mutate: (project: ProjectDetail) => {
        project.chapters[0].status = "已定稿";
      },
    },
    {
      name: "hard story constraint",
      message: "写前状态约束未通过",
      chapterId: "chapter-1",
      mutate: (project: ProjectDetail) => {
        project.facts.push(createFact("fact-conflict", "有冲突"));
      },
    },
  ])("blocks $name before starting AI", ({ chapterId, message, mutate }) => {
    const harness = createHarness();
    mutate(harness.project);

    expect(() => harness.coordinator.startOne("project-1", chapterId)).toThrow(message);
    expect(harness.coordinator.isActive("project-1")).toBe(false);
    expect(harness.startDraftChapter).not.toHaveBeenCalled();
  });

  it("requires an API key before taking the project lock", () => {
    const harness = createHarness({ apiKey: "" });

    expect(() => harness.coordinator.startOne("project-1", "chapter-1")).toThrow("尚未配置 AI API 密钥");
    expect(harness.coordinator.isActive("project-1")).toBe(false);
    expect(harness.searchRelevantFacts).not.toHaveBeenCalled();
  });

  it("passes relevant facts into context and saves with the source guard", async () => {
    const harness = createHarness();
    const onStream = vi.fn();
    const sourceChapter = harness.project.chapters[0];

    const task = harness.coordinator.startOne("project-1", sourceChapter.id, onStream, "bypass");

    expect(task.jobId).toBe("job-1");
    expect(harness.coordinator.isActive("project-1")).toBe(true);
    expect(harness.searchRelevantFacts).toHaveBeenCalledWith(
      "project-1",
      `${sourceChapter.title} ${sourceChapter.outline}`,
      sourceChapter.number,
    );
    expect(harness.compileContext).toHaveBeenCalledWith(harness.project, sourceChapter, harness.relevantFacts);
    expect(harness.startDraftChapter).toHaveBeenCalledWith(
      "project-1",
      sourceChapter,
      context,
      expect.objectContaining({
        onStream,
        cachePolicy: "bypass",
        retryContext: expect.stringContaining('"kind":"chapter"'),
      }),
    );

    await expect(task.completion).resolves.toBe(harness.generatedChapter);
    expect(harness.saveGeneratedChapter).toHaveBeenCalledWith(
      "project-1",
      harness.generatedChapter,
      createChapterGenerationGuard(sourceChapter),
    );
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });

  it("rejects concurrent generation until the first task settles", async () => {
    const pending = deferred<Chapter>();
    const harness = createHarness({ startCompletion: pending.promise });
    const task = harness.coordinator.startOne("project-1", "chapter-1");

    expect(() => harness.coordinator.startOne("project-1", "chapter-2")).toThrow("该作品已有正文生成任务正在运行");

    pending.resolve(harness.generatedChapter);
    await task.completion;
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });

  it("releases the lock when AI startup throws synchronously", () => {
    const harness = createHarness();
    harness.startDraftChapter.mockImplementationOnce(() => {
      throw new Error("startup failed");
    });

    expect(() => harness.coordinator.startOne("project-1", "chapter-1")).toThrow("startup failed");
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });

  it("releases the lock when asynchronous generation fails", async () => {
    const pending = deferred<Chapter>();
    const harness = createHarness({ startCompletion: pending.promise });
    const task = harness.coordinator.startOne("project-1", "chapter-1");

    pending.reject(new Error("generation failed"));
    await expect(task.completion).rejects.toThrow("generation failed");
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });

  it("marks a successful AI job failed when its chapter result cannot be applied", async () => {
    const harness = createHarness();
    harness.saveGeneratedChapter.mockImplementationOnce(() => {
      throw new Error("章节在 AI 生成期间已被修改，旧生成结果未保存");
    });

    const task = harness.coordinator.startOne("project-1", "chapter-1");
    await expect(task.completion).rejects.toThrow("旧生成结果未保存");
    expect(harness.markAiJobApplicationFailed).toHaveBeenCalledWith("job-1", expect.stringContaining("模型输出未应用"));
  });

  it("generates a five-chapter batch in order and skips existing content", async () => {
    const project = createProject();
    project.chapters[1].content = "已有正文";
    project.chapters[1].wordCount = 4;
    const harness = createHarness({ project });

    const generated = await harness.coordinator.generateBatch("project-1", "chapter-1");

    expect(generated).toHaveLength(5);
    expect(generated[1]).toBe(project.chapters[1]);
    expect(harness.draftChapter.mock.calls.map((call) => call[1].number)).toEqual([1, 3, 4, 5]);
    expect(harness.saveGeneratedChapter).toHaveBeenCalledTimes(4);
    expect(harness.compileContext).toHaveBeenCalledWith(project, project.chapters[0], harness.relevantFacts);
    expect(harness.draftChapter.mock.calls[0][3]).toContain('"kind":"batch"');
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });

  it("releases the batch lock after a mid-run failure", async () => {
    const harness = createHarness();
    harness.draftChapter
      .mockResolvedValueOnce({
        ...harness.project.chapters[0],
        content: "第一章正文",
      })
      .mockRejectedValueOnce(new Error("batch failed"));

    await expect(harness.coordinator.generateBatch("project-1", "chapter-1")).rejects.toThrow("batch failed");
    expect(harness.saveGeneratedChapter).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.isActive("project-1")).toBe(false);
  });
});
