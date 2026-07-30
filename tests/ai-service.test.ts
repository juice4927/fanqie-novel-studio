import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableDelay, AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { Chapter, ContextPackage, ProjectDetail, ResearchBook } from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());

describe("AI request timeout", () => {
  it("aborts a hung request and records the failed job", async () => {
    const finished: Array<{ output: string; error?: string }> = [];
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined,
      startAiJob: () => "job-1",
      finishAiJob: (_id: string, output: string, error?: string) => finished.push({ output, error }),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const service = new AiService(database, () => "secret", 10);
    const book: ResearchBook = {
      id: "book", title: "测试书", author: "作者", genre: "都市脑洞", sourceType: "TXT",
      chapterCount: 1, wordCount: 1000, rightsConfirmed: true, cloudConsent: true,
      importedAt: new Date().toISOString(), status: "待拆解",
    };

    await expect(service.deconstruct(book, [{ ordinal: 1, title: "第一章", content: "沈砚走进云港市。".repeat(100), wordCount: 900 }]))
      .rejects.toThrow("模型请求超时");
    expect(finished).toEqual([{ output: "", error: expect.stringContaining("模型请求超时") }]);
  });
});

describe("AI cancellation", () => {
  it("interrupts retry backoff immediately", async () => {
    const finished: Array<{ status?: string }> = [];
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-backoff",
      finishAiJob: (_id: string, _output: string, _error?: string, usage?: { status?: string }) => finished.push({ status: usage?.status }),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    const service = new AiService(database, () => "secret");
    const book = { id: "book", title: "测试书", author: "作者", genre: "都市脑洞", sourceType: "TXT", chapterCount: 1, wordCount: 1000, rightsConfirmed: true, cloudConsent: true, importedAt: new Date().toISOString(), status: "待拆解" } satisfies ResearchBook;
    const running = service.deconstruct(book, [{ ordinal: 1, title: "第一章", content: "正文".repeat(100), wordCount: 200 }]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(service.cancelJob("job-backoff")).toBe(true);
    await expect(running).rejects.toThrow("任务已取消");
    expect(finished.at(-1)).toEqual({ status: "已取消" });
  });

  it("rejects immediately when a delay starts with an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow("任务已取消");
  });
});

describe("semantic quality review", () => {
  it("maps evidence-backed model findings to auditable quality issues", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined,
      startAiJob: () => "job-quality",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ severity: "硬性", category: "知识边界", message: "角色使用了尚未知晓的信息", evidence: "林舟直接说出了密码" }] }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-3", number: 3, title: "错误的密码", outline: "目标：进入机房", content: "林舟直接说出了密码。", wordCount: 10,
      status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = { contract: "", commercialGuidance: "", chapterIntent: "", expectationLedger: "", longTermMemory: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "密码仅反派知晓", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;

    const issues = await service.reviewChapter(project, chapter, context);

    expect(issues).toMatchObject([{ projectId: "project-1", chapterId: "chapter-3", severity: "硬性", category: "知识边界", status: "待处理" }]);
    expect(issues[0].id).toBeTruthy();
  });

  it("does not let unsupported model claims become hard gates", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-unsupported", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ severity: "硬性", category: "设定冲突", message: "模型推测出的冲突", evidence: "正文和账本中不存在的句子" }] }) } }] }), { status: 200 })));
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-4", number: 4, title: "正常章节", outline: "目标：继续调查", content: "林舟检查了门锁。", wordCount: 8, status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString() } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = { contract: "", commercialGuidance: "", chapterIntent: "", expectationLedger: "", longTermMemory: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;

    expect((await service.reviewChapter(project, chapter, context))[0].severity).toBe("警告");
  });
});

describe("chapter fact extraction", () => {
  it("keeps only evidence-backed state candidates pending human confirmation", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-facts", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: [
      { kind: "能力", subject: "林舟", predicate: "能力代价", value: "每次使用会失去一段近期记忆", knowledgeScope: "林舟", evidence: "每用一次能力，他就会失去一段近期记忆" },
      { kind: "资源", subject: "林舟", predicate: "余额", value: "一百万元", knowledgeScope: "公开", evidence: "正文没有这句话" },
    ] }) } }] }), { status: 200 })));
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-8", number: 8, title: "能力代价", outline: "确认能力规则", content: "林舟终于确认：每用一次能力，他就会失去一段近期记忆。", wordCount: 30, status: "已定稿", batchMode: "逐章", isKeyChapter: false, revision: 2, updatedAt: new Date().toISOString() } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [] } as unknown as ProjectDetail;
    const facts = await service.extractChapterFacts(project, chapter);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "能力", subject: "林舟", confidence: "待确认", evidenceChapter: 8, genreDimension: "定稿自动候选" });
  });
});

describe("AI planning", () => {
  const planningProject = {
    summary: { id: "project-plan", title: "测试长篇", genre: "年代重生", targetWords: 1000000, currentWords: 10000 },
    contract: { approved: true, genreSubtype: "创业致富", fanqieCategoryKey: "女频:79", premise: "女主凭手艺创业", protagonistDesire: "建立工厂", readerPromise: "事业与关系共同成长", coreEmotion: "被尊重", ending: "建立品牌", immutableRules: [], prohibitedPatterns: [] },
    plans: [], chapters: [], facts: [],
  } as unknown as ProjectDetail;
  const planningDatabase = () => ({
    getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
    findAiJob: () => undefined, startAiJob: () => "job-plan", finishAiJob: vi.fn(),
  } as unknown as WorkspaceDatabase);

  it("maps a continuous chapter proposal to rough plans, detailed plans and chapter intents", async () => {
    const chapters = Array.from({ length: 10 }, (_, index) => ({ title: `推进${index + 1}`, goal: `完成第${index + 1}个具体目标`, conflict: `面对第${index + 1}个现实阻碍`, outcome: `产生第${index + 1}个状态变化`, chapterPromise: `本章推进承诺${index + 1}`, expectedPayoff: `可见回报${index + 1}`, crisis: `限时危机${index + 1}`, endingExpectation: `下一问题${index + 1}`, payoffOffset: 2, isKeyChapter: index === 9 }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ batchGoal: "建立首个可以持续运转的生产小组", batchConflict: "原料渠道与家庭阻力同时升级并形成选择", batchOutcome: "获得稳定订单并建立明确的合作规则", chapters }) } }] }), { status: 200 })));
    const result = await new AiService(planningDatabase(), () => "secret").generatePlanning(planningProject, { mode: "后续章纲", fromChapter: 6, chapterCount: 10 });
    expect(result.chapters).toHaveLength(10);
    expect(result.plans).toHaveLength(41);
    expect(result.chapters[0]).toMatchObject({ number: 6, status: "章纲", expectationTargetChapter: 8 });
    expect(result.chapters[9]).toMatchObject({ number: 15, isKeyChapter: true, batchMode: "逐章" });
    expect(result.plans[0]).toMatchObject({ kind: "粗纲", ordinal: 6, status: "草稿" });
    expect(result.plans.filter((plan) => plan.kind === "细纲")).toHaveLength(10);
    expect(result.plans.filter((plan) => plan.kind === "场景卡")).toHaveLength(30);
    expect(result.plans.find((plan) => plan.kind === "场景卡")).toMatchObject({ parentId: result.plans[1].id, status: "草稿" });
  });

  it("rejects an incomplete chapter batch before anything can be saved", async () => {
    const one = { title: "唯一一章", goal: "完成一个足够明确的目标", conflict: "面对一个足够明确的阻碍", outcome: "产生一个足够明确的变化", chapterPromise: "向读者提供明确推进", expectedPayoff: "完成一次可见兑现", crisis: "必须当天解决问题", endingExpectation: "新的问题即将到来", payoffOffset: 1, isKeyChapter: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ batchGoal: "建立首个可以持续运转的生产小组", batchConflict: "原料渠道与家庭阻力同时升级并形成选择", batchOutcome: "获得稳定订单并建立明确的合作规则", chapters: [one] }) } }] }), { status: 200 })));
    await expect(new AiService(planningDatabase(), () => "secret").generatePlanning(planningProject, { mode: "后续章纲", fromChapter: 6, chapterCount: 10 })).rejects.toThrow("预期 10 章");
  });
});
