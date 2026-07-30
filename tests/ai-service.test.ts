import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableDelay, AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type { Chapter, ContextPackage, ProjectDetail, QualityIssue, ResearchBook } from "../src/shared/types";

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
    const service = new AiService(database, () => "secret", 10, 10);
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

describe("AI provider routing", () => {
  const chapter = {
    id: "chapter-routing", number: 1, title: "路由测试", outline: "测试模型路由", content: "林舟检查了门锁。", wordCount: 8,
    status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString(),
  } satisfies Chapter;
  const project = { summary: { id: "project-routing", genre: "都市脑洞" } } as unknown as ProjectDetail;
  const context = { contract: "", commercialGuidance: "", chapterIntent: "", expectationLedger: "", longTermMemory: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;
  const databaseFor = (model: string) => ({
    getAiSettings: () => ({ baseUrl: "https://api.example.com/v1", model, embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
    findAiJob: () => undefined, startAiJob: () => `job-${model}`, finishAiJob: vi.fn(),
  } as unknown as WorkspaceDatabase);

  it("uses the Responses request shape for GPT models", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ issues: [] }) }] }],
      usage: { input_tokens: 11, output_tokens: 3 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await new AiService(databaseFor("gpt-5.1"), () => "secret").reviewChapter(project, chapter, context);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/responses");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: "gpt-5.1", reasoning: { effort: "low" }, instructions: expect.any(String), input: expect.any(String), stream: true });
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "quality-review", strict: true, schema: { type: "object" } });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("response_format");
  });

  it("builds an aesthetic proposal from only the current project's contract, plans, and finalized prose", async () => {
    const suggestion = {
      profile: {
        narrativeDistance: "贴身", emotionalTemperature: "克制",
        proseTexture: "动作短句承压，关键处留白", dialogueStyle: "短句交锋，少作解释",
        emotionalExpression: "以身体反应和选择后果呈现，不替人物总结",
        signatureTechniques: ["动作后的短暂停顿", "以物件变化承接情绪"],
        avoidPatterns: ["连续抽象判断", "配角只负责递信息"],
      },
      diagnosis: "现有正文行动线清楚，但解释句容易削弱人物在场感。",
      rationale: ["契约强调守护与代价", "定稿样本已经形成短句行动节奏"],
    };
    const raw = JSON.stringify(suggestion);
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\ndata: [DONE]\n\n`;
    const fetchMock = vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fullProject = {
      summary: { id: "aesthetic-project", title: "只属于这本书", genre: "都市脑洞" },
      contract: {
        premise: "维修员用记忆换取救人的机会", protagonistDesire: "守住家人的记忆",
        readerPromise: "规则解谜与关系代价", coreEmotion: "守护", ending: "放弃能力",
        immutableRules: [], prohibitedPatterns: [], version: 1, approved: true, updatedAt: new Date().toISOString(),
      },
      plans: [{ kind: "分卷", title: "代价浮现", goal: "发现失忆", conflict: "救人与遗忘", outcome: "组成小队", status: "已批准" }],
      chapters: [{ number: 3, title: "雨夜", outline: "救人后遗忘", content: "雨落下来，他握住门把手，却想不起妹妹的名字。", status: "已定稿" }],
    } as unknown as ProjectDetail;

    const result = await new AiService(databaseFor("deepseek-chat"), () => "secret")
      .suggestAestheticProfile(fullProject);

    expect(result).toEqual(suggestion);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[1].content).toContain("只属于这本书");
    expect(body.messages[1].content).toContain("雨落下来");
    expect(body.messages[0].content).toContain("不套用全局风格模板");
  });

  it("keeps non-GPT models on the compatible chat request shape", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await new AiService(databaseFor("deepseek-chat"), () => "secret").reviewChapter(project, chapter, context);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages).toHaveLength(2);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("instructions");
  });

  it("does not retry permanent provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AiService(databaseFor("gpt-5.1"), () => "secret").reviewChapter(project, chapter, context))
      .rejects.toThrow("模型接口返回 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one total deadline across transient retries", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();

    await expect(new AiService(databaseFor("gpt-5.1"), () => "secret", 30, 30).reviewChapter(project, chapter, context))
      .rejects.toThrow("模型请求超时");
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("chapter draft streaming", () => {
  it("forwards decoded content deltas and records request telemetry", async () => {
    const finishAiJob = vi.fn();
    const updateAiJobTelemetry = vi.fn();
    const log = vi.fn();
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "deepseek-chat", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-stream", finishAiJob, updateAiJobTelemetry,
    } as unknown as WorkspaceDatabase;
    const content = "正文".repeat(1000);
    const raw = JSON.stringify({ title: "流式章节", content });
    const pieces = [raw.slice(0, 37), raw.slice(37, 190), raw.slice(190)];
    const sse = pieces.map((piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`).join("") + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const chapter = { id: "chapter-stream", number: 1, title: "待生成", outline: "完成流式生成", content: "", wordCount: 0, status: "章纲", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString() } satisfies Chapter;
    const context = { contract: "契约", commercialGuidance: "规则", chapterIntent: "意图", expectationLedger: "无", longTermMemory: "无", volumeGoal: "无", rollingOutline: "无", recentSummary: "无", relevantFacts: "无", forbiddenKnowledge: "无", authorStyle: "无", estimatedTokens: 10 } satisfies ContextPackage;
    const events: Array<{ type: string; delta?: string }> = [];

    const result = await new AiService(database, () => "secret", 120_000, 0, log).draftChapter("project", chapter, context, undefined, (event) => events.push(event));

    expect(result.content).toBe(content);
    expect(events.filter((event) => event.type === "delta").map((event) => event.delta).join("")).toBe(content);
    expect(events[0]).toMatchObject({ type: "attempt-start" });
    expect(events.at(-1)).toMatchObject({ type: "complete" });
    expect(updateAiJobTelemetry).toHaveBeenCalled();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({ chunkCount: 1, attemptCount: 1, headersAt: expect.any(String), firstTokenAt: expect.any(String), completedAt: expect.any(String) });
    expect(log).toHaveBeenCalledWith("info", "ai.request.first_content", expect.objectContaining({ attempt: 1 }));
  });
});

describe("AI deconstruction batching", () => {
  it("splits ten chapters into two cached-size batches before stage synthesis", async () => {
    let job = 0;
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined,
      startAiJob: () => `job-${++job}`,
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const insight = { audienceNeed: "需求", openingPromise: "承诺", conflictEngine: "冲突", emotionalRhythm: "节奏", retentionDevices: "留存", longFormEngine: "长篇", marketGap: "空位", risks: "风险", confidence: "中" as const };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const user = request.messages[1].content;
      const ordinals = [...user.matchAll(/【章节(\d+)】/g)].map((match) => Number(match[1]));
      const content = ordinals.length ? {
        chapters: ordinals.map((ordinal) => ({ ordinal, finding: "结构", conflict: "冲突", hook: "钩子", stateChange: "变化", risk: "风险", enteringExpectation: "进入", protagonistGoal: "目标", coreInterest: "利益", emotionalPayoff: "回报", payoffImpact: "影响", nextExpectation: "期待" })),
        synthesis: insight,
      } : insight;
      const payload = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }] });
      return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const book = { id: "book", title: "十章样本", author: "作者", genre: "都市脑洞", sourceType: "公开试读", chapterCount: 10, wordCount: 10000, rightsConfirmed: false, cloudConsent: true, importedAt: new Date().toISOString(), status: "待拆解" } satisfies ResearchBook;
    const chapters = Array.from({ length: 10 }, (_, index) => ({ ordinal: index + 1, title: `第${index + 1}章`, content: "章节正文。".repeat(100), wordCount: 500 }));

    const result = await new AiService(database, () => "secret").deconstruct(book, chapters);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ stream: true });
    expect(result.analyses.filter((item) => item.layer === "章节")).toHaveLength(10);
    expect(result.analyses.find((item) => item.layer === "十章阶段")).toMatchObject({ fromChapter: 1, toChapter: 10 });
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

  it("revises a chapter from pending issues and returns it to quality review", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0, longTaskTimeoutMinutes: 10 }),
      findAiJob: () => undefined, startAiJob: () => "job-revise-quality", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const revisedContent = "林舟先核对门禁记录，再依据已经掌握的线索进入机房。".repeat(30);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "核对之后", content: revisedContent }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-5", number: 5, title: "错误闯入", outline: "目标：进入机房；冲突：权限不足；结果：取得记录", content: "林舟直接说出未知密码后进入机房。".repeat(30), wordCount: 480, status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 3, updatedAt: new Date().toISOString() } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = { contract: "不得泄露未知信息", commercialGuidance: "", chapterIntent: "", expectationLedger: "", longTermMemory: "", volumeGoal: "", rollingOutline: "", recentSummary: "", relevantFacts: "", forbiddenKnowledge: "密码仅反派知晓", authorStyle: "", estimatedTokens: 10 } satisfies ContextPackage;
    const issue = { id: "issue-1", projectId: "project-1", chapterId: chapter.id, severity: "硬性", category: "知识边界", message: "角色使用了尚未知晓的信息", evidence: "林舟直接说出未知密码", status: "待处理", createdAt: new Date().toISOString() } satisfies QualityIssue;

    const revised = await service.reviseChapter(project, chapter, context, [issue]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

    expect(revised).toMatchObject({ title: "核对之后", content: revisedContent, status: "待质检", revision: 3 });
    expect(body).toMatchObject({ stream: true });
    expect(body.messages[1].content).toContain("角色使用了尚未知晓的信息");
  });
});

describe("chapter fact extraction", () => {
  it("keeps only evidence-backed state candidates pending human confirmation", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-facts", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: [
      { kind: "能力", subject: "林舟", predicate: "能力代价", value: "每次使用会失去一段近期记忆", knowledgeScope: "林舟", evidence: "每用一次能力，他就会失去一段近期记忆" },
      { kind: "资源", subject: "林舟", predicate: "余额", value: "一百万元", knowledgeScope: "公开", evidence: "正文没有这句话" },
    ] }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-8", number: 8, title: "能力代价", outline: "确认能力规则", content: "林舟终于确认：每用一次能力，他就会失去一段近期记忆。", wordCount: 30, status: "已定稿", batchMode: "逐章", isKeyChapter: false, revision: 2, updatedAt: new Date().toISOString() } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [] } as unknown as ProjectDetail;
    const facts = await service.extractChapterFacts(project, chapter);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "能力", subject: "林舟", confidence: "待确认", evidenceChapter: 8, genreDimension: "定稿自动候选" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ stream: true });
  });

  it("links a changed state to the active fact it should replace", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-replacement", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: [
      { kind: "地点", subject: "林舟", predicate: "所在地", value: "上海", knowledgeScope: "公开", evidence: "林舟已经抵达上海" },
    ] }) } }] }), { status: 200 })));
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-8", number: 8, title: "抵达", outline: "目标：抵达上海", content: "清晨，林舟已经抵达上海。", wordCount: 13, status: "已定稿", batchMode: "逐章", isKeyChapter: false, revision: 2, updatedAt: new Date().toISOString() } satisfies Chapter;
    const previous = { id: "fact-beijing", kind: "地点", subject: "林舟", predicate: "所在地", value: "北京", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: new Date().toISOString() } satisfies LedgerFact;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [previous] } as unknown as ProjectDetail;

    const facts = await service.extractChapterFacts(project, chapter);

    expect(facts[0]).toMatchObject({ confidence: "待确认", replacesFactId: previous.id, changeType: "状态替换", genreDimension: "定稿状态替换候选" });
  });

  it("classifies numeric resource deltas and knowledge-scope changes", async () => {
    const database = {
      getAiSettings: () => ({ baseUrl: "https://model.invalid/v1", model: "test", embeddingModel: "test", hasApiKey: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }),
      findAiJob: () => undefined, startAiJob: () => "job-change-types", finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: [
      { kind: "资源", subject: "林舟", predicate: "灵石余额", value: "70枚灵石", knowledgeScope: "公开", evidence: "只剩下七十枚灵石" },
      { kind: "秘密", subject: "仓库密钥", predicate: "真实位置", value: "藏在旧钟背面", knowledgeScope: "林舟、苏晚", evidence: "苏晚也知道密钥藏在旧钟背面" },
    ] }) } }] }), { status: 200 })));
    const service = new AiService(database, () => "secret");
    const chapter = { id: "chapter-9", number: 9, title: "清点", outline: "清点资源并共享秘密", content: "清点之后，只剩下七十枚灵石。苏晚也知道密钥藏在旧钟背面。", wordCount: 31, status: "已定稿", batchMode: "逐章", isKeyChapter: false, revision: 2, updatedAt: new Date().toISOString() } satisfies Chapter;
    const resource = { id: "fact-resource", kind: "资源", subject: "林舟", predicate: "灵石余额", value: "100枚灵石", validFromChapter: 2, validToChapter: null, evidenceChapter: 2, confidence: "已确认", knowledgeScope: "公开", updatedAt: new Date().toISOString() } satisfies LedgerFact;
    const secret = { id: "fact-secret", kind: "秘密", subject: "仓库密钥", predicate: "真实位置", value: "藏在旧钟背面", validFromChapter: 3, validToChapter: null, evidenceChapter: 3, confidence: "已确认", knowledgeScope: "林舟", updatedAt: new Date().toISOString() } satisfies LedgerFact;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [resource, secret] } as unknown as ProjectDetail;

    const facts = await service.extractChapterFacts(project, chapter);

    expect(facts[0]).toMatchObject({ changeType: "数值变化", numericDelta: -30, replacesFactId: resource.id });
    expect(facts[1]).toMatchObject({ changeType: "知情范围变更", numericDelta: null, replacesFactId: secret.id });
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

  it("splits thirty chapters into three persisted ten-chapter batches with continuity context", async () => {
    const requestedStarts: number[] = [];
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const user = body.messages[1].content;
      requests.push(user);
      const start = Number(user.match(/从第(\d+)章开始/)?.[1]);
      requestedStarts.push(start);
      const chapters = Array.from({ length: 10 }, (_, index) => ({
        title: `推进${start + index}`,
        goal: `完成第${start + index}个具体目标`,
        conflict: `面对第${start + index}个现实阻碍`,
        outcome: `产生第${start + index}个状态变化`,
        chapterPromise: `本章推进承诺${start + index}`,
        expectedPayoff: `可见回报${start + index}`,
        crisis: `限时危机${start + index}`,
        endingExpectation: `下一问题${start + index}`,
        payoffOffset: 2,
        isKeyChapter: false,
      }));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        batchGoal: `推进第${start}章批次的持续目标`,
        batchConflict: `第${start}章批次的阻力持续升级`,
        batchOutcome: `第${start}章批次产生明确状态变化`,
        chapters,
      }) } }] }), { status: 200 });
    }));
    const persisted: number[][] = [];

    const result = await new AiService(planningDatabase(), () => "secret").generatePlanning(
      planningProject,
      { mode: "后续章纲", fromChapter: 6, chapterCount: 30 },
      (batch) => { persisted.push(batch.chapters.map((chapter) => chapter.number)); },
    );

    expect(requestedStarts).toEqual([6, 16, 26]);
    expect(persisted).toEqual([
      Array.from({ length: 10 }, (_, index) => 6 + index),
      Array.from({ length: 10 }, (_, index) => 16 + index),
      Array.from({ length: 10 }, (_, index) => 26 + index),
    ]);
    expect(requests[0]).toContain("必须承接的章纲：[]");
    expect(requests[1]).toContain('"number":15');
    expect(requests[2]).toContain('"number":25');
    expect(result.chapters).toHaveLength(30);
    expect(result.plans).toHaveLength(123);
  });

  it("rejects an incomplete chapter batch before anything can be saved", async () => {
    const one = { title: "唯一一章", goal: "完成一个足够明确的目标", conflict: "面对一个足够明确的阻碍", outcome: "产生一个足够明确的变化", chapterPromise: "向读者提供明确推进", expectedPayoff: "完成一次可见兑现", crisis: "必须当天解决问题", endingExpectation: "新的问题即将到来", payoffOffset: 1, isKeyChapter: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ batchGoal: "建立首个可以持续运转的生产小组", batchConflict: "原料渠道与家庭阻力同时升级并形成选择", batchOutcome: "获得稳定订单并建立明确的合作规则", chapters: [one] }) } }] }), { status: 200 })));
    await expect(new AiService(planningDatabase(), () => "secret").generatePlanning(planningProject, { mode: "后续章纲", fromChapter: 6, chapterCount: 10 })).rejects.toThrow("预期 10 章");
  });
});
