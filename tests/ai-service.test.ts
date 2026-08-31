import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiService,
  abortableDelay,
  authorRequestsDebtAccounting,
  conceptDefaultMotifIssues,
  conceptDiversityIssues,
} from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import type {
  BookConceptCandidate,
  BookConceptInput,
  Chapter,
  ContextPackage,
  ProjectDetail,
  QualityIssue,
  ResearchBook,
} from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());

describe("book concept diversity", () => {
  const concept = (
    overrides: Partial<{
      genreSubtype: string;
      secondaryGenres: Array<"成长" | "悬疑" | "经营">;
      openingMechanism: string;
      growthCarrier: string;
      primaryPayoff: string;
      premise: string;
      longFormEngine: string;
    }> = {},
  ) => ({
    genreSubtype: "职业成长",
    secondaryGenres: ["成长"] as Array<"成长" | "悬疑" | "经营">,
    openingMechanism: "职业事故迫使主角调查",
    growthCarrier: "专业能力和同行网络",
    primaryPayoff: "解决事故并获得职业认可",
    premise: "主角从一次职业事故中发现长期隐患并主动调查。",
    longFormEngine: "案件、关系和职业责任分三轮升级。",
    ...overrides,
  });

  it("rejects three renamed variants of the same route", () => {
    const repeated = [concept(), concept({ genreSubtype: "职场成长" }), concept({ genreSubtype: "现实成长" })];
    expect(conceptDiversityIssues(repeated, true)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("开局机制"),
        expect.stringContaining("首要叙事主轴"),
        expect.stringContaining("故事前提"),
      ]),
    );
  });

  it("accepts structurally distinct routes", () => {
    const candidates = [
      concept(),
      concept({
        genreSubtype: "规则探案",
        secondaryGenres: ["悬疑"],
        openingMechanism: "死者留下互相矛盾的证词",
        growthCarrier: "证据链和推理同盟",
        primaryPayoff: "还原真相并改变案件定性",
        premise: "法医发现证词与尸检结果矛盾，决定追查被掩盖的真相。",
        longFormEngine: "单案证据、组织阻挠和旧案真相逐层展开。",
      }),
      concept({
        genreSubtype: "灾后经营",
        secondaryGenres: ["经营"],
        openingMechanism: "安全区断粮迫使主角组织交换",
        growthCarrier: "生产方法和社区契约",
        primaryPayoff: "建立可持续供给并重建信任",
        premise: "灾后社区即将断粮，主角尝试用有限资源恢复生产。",
        longFormEngine: "生产、分配和社区治理形成三轮冲突。",
      }),
    ];
    expect(conceptDiversityIssues(candidates, true)).toEqual([]);
  });

  it("rejects lightly rewritten versions of the same structure", () => {
    const candidates = [
      concept(),
      concept({
        genreSubtype: "职场逆袭",
        secondaryGenres: ["悬疑"],
        openingMechanism: "一场严重职业事故迫使主角开始调查",
        growthCarrier: "专业能力积累以及同行关系网络",
        primaryPayoff: "彻底解决事故并赢得业内职业认可",
        premise: "主角遭遇职业事故后发现长期隐患，因此决定主动展开调查。",
        longFormEngine: "事故调查、同行关系与职业责任依次形成三轮升级。",
      }),
      concept({
        genreSubtype: "灾后经营",
        secondaryGenres: ["经营"],
        openingMechanism: "安全区断粮",
        growthCarrier: "生产和社区契约",
        primaryPayoff: "恢复供给",
        premise: "灾后社区即将断粮，主角恢复生产。",
        longFormEngine: "生产、分配和治理逐层冲突。",
      }),
    ];
    expect(conceptDiversityIssues(candidates, false)).toEqual(
      expect.arrayContaining([expect.stringContaining("方案1与方案2")]),
    );
  });
});

describe("book concept default motifs", () => {
  const concept = (overrides: Partial<BookConceptCandidate> = {}) =>
    ({
      id: "concept",
      title: "废站重启计划",
      premise: "检修员进入停运车站，依靠工程能力恢复避难通道。",
      genreSubtype: "城市生存",
      secondaryGenres: ["生存"],
      genreElements: ["现代都市", "工程维修"],
      openingMechanism: "停电事故封锁换乘站",
      growthCarrier: "工程能力与协作网络",
      primaryPayoff: "恢复设施并救出乘客",
      protagonistDesire: "带领被困者离开车站",
      readerPromise: "以真实行动持续改变城市生存局势",
      coreEmotion: "绝境中的可靠感",
      ending: "主角恢复城市交通网络并建立公共应急体系",
      immutableRules: ["材料必须来自现场", "修复需要真实操作"],
      prohibitedPatterns: ["凭空获得资源", "反派无故降智"],
      audience: "偏好职业成长和城市生存的读者",
      commercialHook: "普通检修员用专业能力重启瘫痪城市",
      longFormEngine: "车站、街区与城区三轮恢复逐级展开",
      ...overrides,
    }) satisfies BookConceptCandidate;

  it("rejects debt and accounting as an unsolicited default conflict", () => {
    expect(
      conceptDefaultMotifIssues([concept({ premise: "宗门灵田枯萎，主角还要面对欠债山门与三日清算令。" })]),
    ).toEqual([expect.stringContaining("作者未指定")]);
  });

  it("accepts neutral conflicts and author-requested debt stories", () => {
    const candidate = concept({ premise: "宗门灵田枯萎，弟子必须在妖潮抵达前恢复护山阵。" });
    expect(conceptDefaultMotifIssues([candidate])).toEqual([]);
    expect(conceptDefaultMotifIssues([concept({ premise: "主角接手欠款纠纷，追查伪造合同。" })], true)).toEqual([]);
  });

  it("does not treat generic state ledgers as permission for debt plots", () => {
    const input = (direction: string) =>
      ({
        genre: "玄幻/仙侠",
        targetWords: 1000000,
        updateCadence: "每日2章",
        seed: "",
        genreElements: [direction],
        customGenreDirection: "",
      }) satisfies BookConceptInput;
    expect(authorRequestsDebtAccounting(input("战力账本"))).toBe(false);
    expect(authorRequestsDebtAccounting(input("状态账本"))).toBe(false);
    expect(authorRequestsDebtAccounting(input("欠款追讨与合同调查"))).toBe(true);
    expect(authorRequestsDebtAccounting({ ...input("都市经营"), customGenreDirection: "禁止债务和旧账" })).toBe(false);
  });
});

describe("selected concept expansion", () => {
  it("builds a complete character and world skeleton only after selection", async () => {
    const requests: string[] = [];
    const skeleton = {
      protagonistArc: "主角从只想独自止损，走到愿意建立合作规则并承担团队失败的责任，最终以公开制度守住共同事业。",
      keyRelationships: [
        "主角与老采购员从互相防备到共同恢复渠道，双方对经营路线有不同立场",
        "主角与前夫家代表围绕资产控制持续对抗，对方掌握旧合同",
      ],
      worldRules: [
        "每次采购和运输都必须符合真实经营周期，经营成果不能凭空出现",
        "团队扩张会同步增加供应风险和分配责任",
      ],
      majorForces: ["供销社经营团队掌握基层渠道和社区信任", "旧利益网络掌握合同漏洞和地方人情关系"],
      timelineAnchors: [
        "开局前主角长期替家人承担损失",
        "开局当天主角接手濒临倒闭的供销社",
        "中期分配矛盾引发团队路线分裂",
        "终局重组供应体系并建立共同治理制度",
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(String(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(skeleton) } }] }), {
          status: 200,
        });
      }),
    );
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-skeleton",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const input = {
      genre: "年代重生",
      targetWords: 1000000,
      updateCadence: "每日2章",
      seed: "",
      secondaryGenres: ["经营", "群像"],
      genreElements: ["年代", "经商"],
      customGenreDirection: "不要系统",
    } satisfies BookConceptInput;
    const concept = {
      id: "concept",
      title: "离婚当天，我接手了倒闭供销社",
      premise: "基层职员接手濒临倒闭的供销社，用异常进货单串起女性互助生意。",
      genreSubtype: "年代经营",
      secondaryGenres: ["经营", "群像"],
      genreElements: ["年代", "经商"],
      openingMechanism: "接手即将倒闭的供销社",
      growthCarrier: "商品渠道与女性互助团队",
      primaryPayoff: "经营成果改变个人和社区处境",
      protagonistDesire: "夺回人生选择权并建立事业",
      readerPromise: "持续提供经营成果和关系成长",
      coreEmotion: "治愈与重建",
      ending: "建立可持续事业并完成平等关系选择",
      immutableRules: ["经营结果必须有过程", "关系变化必须有行动"],
      prohibitedPatterns: ["反派无故降智", "连续误会拖延"],
      audience: "偏好现实经营与女性成长的读者",
      commercialHook: "低谷接手倒闭资产并逆转经营",
      longFormEngine: "个人止损、团队经营和区域产业三轮扩张",
    } satisfies BookConceptCandidate;
    await expect(new AiService(database, () => "secret").expandBookConcept(input, concept)).resolves.toEqual(skeleton);
    expect(requests[0]).toContain("离婚当天，我接手了倒闭供销社");
    expect(requests[0]).toContain("不要系统");
  });
});

describe("AI request timeout", () => {
  it("aborts a hung request and records the failed job", async () => {
    const finished: Array<{ output: string; error?: string }> = [];
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-1",
      finishAiJob: (_id: string, output: string, error?: string) => finished.push({ output, error }),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      ),
    );
    const service = new AiService(database, () => "secret", 10, 10);
    const book: ResearchBook = {
      id: "book",
      title: "测试书",
      author: "作者",
      genre: "都市脑洞",
      sourceType: "TXT",
      chapterCount: 1,
      wordCount: 1000,
      rightsConfirmed: true,
      cloudConsent: true,
      importedAt: new Date().toISOString(),
      status: "待拆解",
    };

    await expect(
      service.deconstruct(book, [
        { ordinal: 1, title: "第一章", content: "沈砚走进云港市。".repeat(100), wordCount: 900 },
      ]),
    ).rejects.toThrow("模型请求超时");
    expect(finished).toEqual([{ output: "", error: expect.stringContaining("模型请求超时") }]);
  });
});

describe("AI provider routing", () => {
  const chapter = {
    id: "chapter-routing",
    number: 1,
    title: "路由测试",
    outline: "测试模型路由",
    content: "林舟检查了门锁。",
    wordCount: 8,
    status: "待质检",
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 1,
    updatedAt: new Date().toISOString(),
  } satisfies Chapter;
  const project = { summary: { id: "project-routing", genre: "都市脑洞" } } as unknown as ProjectDetail;
  const context = {
    contract: "",
    commercialGuidance: "",
    chapterIntent: "",
    expectationLedger: "",
    longTermMemory: "",
    volumeGoal: "",
    rollingOutline: "",
    recentSummary: "",
    relevantFacts: "",
    forbiddenKnowledge: "",
    authorStyle: "",
    estimatedTokens: 10,
  } satisfies ContextPackage;
  const databaseFor = (
    model: string,
    protocol: "openai-compatible" | "anthropic-messages" = "openai-compatible",
    baseUrl = "https://api.example.com/v1",
  ) =>
    ({
      getAiSettings: () => ({
        protocol,
        baseUrl,
        model,
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => `job-${model}`,
      finishAiJob: vi.fn(),
    }) as unknown as WorkspaceDatabase;

  it("uses the Responses request shape for GPT models", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: "output_text", text: JSON.stringify({ issues: [] }) }] }],
            usage: { input_tokens: 11, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new AiService(databaseFor("gpt-5.1"), () => "secret").reviewChapter(project, chapter, context);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/responses");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "gpt-5.1",
      reasoning: { effort: "low" },
      instructions: expect.any(String),
      input: expect.any(String),
      stream: true,
    });
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "quality-review",
      strict: true,
      schema: { type: "object" },
    });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("response_format");
  });

  it("falls back to chat completions when a GPT-compatible endpoint lacks Responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unknown endpoint /responses", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [] }) } }] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(databaseFor("gpt-5.1"), () => "secret").reviewChapter(project, chapter, context),
    ).resolves.toEqual([]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.com/v1/responses",
      "https://api.example.com/v1/chat/completions",
    ]);
  });

  it("does not retry a paid model response when AI audit persistence fails", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [] }) } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const database = databaseFor("test-model");
    vi.mocked(database.finishAiJob).mockImplementation(() => {
      throw new Error("disk full");
    });

    await expect(new AiService(database, () => "secret").reviewChapter(project, chapter, context)).rejects.toThrow(
      "审计落库失败",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accumulates usage and cost when structured validation retries succeed", async () => {
    const finishAiJob = vi.fn();
    const log = vi.fn();
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://api.example.com/v1",
        model: "gpt-5.1",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 2,
        outputPricePerMillion: 5,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-usage-retry",
      finishAiJob,
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({ issues: "invalid" }),
            usage: { input_tokens: 100, output_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({ issues: [] }),
            usage: { input_tokens: 40, output_tokens: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(database, () => "secret", 120_000, 0, log).reviewChapter(project, chapter, context),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(finishAiJob).toHaveBeenCalledOnce();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({ inputTokens: 140, outputTokens: 30, attemptCount: 2 });
    expect(finishAiJob.mock.calls[0][3].actualCost).toBeCloseTo(0.00043);
    expect(log).toHaveBeenCalledWith(
      "error",
      "ai.request.attempt_failed",
      expect.objectContaining({
        attemptInputTokens: 100,
        attemptOutputTokens: 20,
        cumulativeInputTokens: 100,
        cumulativeOutputTokens: 20,
      }),
    );
    expect(log).toHaveBeenCalledWith(
      "info",
      "ai.request.attempt_completed",
      expect.objectContaining({
        attemptInputTokens: 40,
        attemptOutputTokens: 10,
        cumulativeInputTokens: 140,
        cumulativeOutputTokens: 30,
      }),
    );
  });

  it("keeps cumulative usage and cost when every structured response fails", async () => {
    const finishAiJob = vi.fn();
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://api.example.com/v1",
        model: "gpt-5.1",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 3,
        outputPricePerMillion: 7,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-usage-failed",
      finishAiJob,
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output_text: JSON.stringify({ issues: "invalid" }),
              usage: { input_tokens: 10, output_tokens: 4 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(new AiService(database, () => "secret").reviewChapter(project, chapter, context)).rejects.toThrow();

    expect(finishAiJob).toHaveBeenCalledOnce();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({
      status: "失败",
      inputTokens: 30,
      outputTokens: 12,
      attemptCount: 3,
    });
    expect(finishAiJob.mock.calls[0][3].actualCost).toBeCloseTo(0.000174);
  });

  it("preserves prior attempt usage when a structured retry is cancelled", async () => {
    const finishAiJob = vi.fn();
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://api.example.com/v1",
        model: "gpt-5.1",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 4,
        outputPricePerMillion: 6,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-usage-cancelled",
      finishAiJob,
    } as unknown as WorkspaceDatabase;
    let requestCount = 0;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output_text: JSON.stringify({ issues: "invalid" }),
              usage: { input_tokens: 25, output_tokens: 5 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");

    const running = service.reviewChapter(project, chapter, context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(service.cancelJob("job-usage-cancelled")).toBe(true);
    await expect(running).rejects.toThrow("任务已取消");

    expect(finishAiJob).toHaveBeenCalledOnce();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({
      status: "已取消",
      inputTokens: 25,
      outputTokens: 5,
      attemptCount: 2,
    });
    expect(finishAiJob.mock.calls[0][3].actualCost).toBeCloseTo(0.00013);
  });

  it("builds an aesthetic proposal from only the current project's contract, plans, and finalized prose", async () => {
    const suggestion = {
      profile: {
        narrativeDistance: "贴身",
        emotionalTemperature: "克制",
        proseTexture: "动作短句承压，关键处留白",
        dialogueStyle: "短句交锋，少作解释",
        emotionalExpression: "以身体反应和选择后果呈现，不替人物总结",
        signatureTechniques: ["动作后的短暂停顿", "以物件变化承接情绪"],
        avoidPatterns: ["连续抽象判断", "配角只负责递信息"],
      },
      diagnosis: "现有正文行动线清楚，但解释句容易削弱人物在场感。",
      rationale: ["契约强调守护与代价", "定稿样本已经形成短句行动节奏"],
    };
    const raw = JSON.stringify(suggestion);
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\ndata: [DONE]\n\n`;
    const fetchMock = vi.fn(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fullProject = {
      summary: { id: "aesthetic-project", title: "只属于这本书", genre: "都市脑洞" },
      contract: {
        premise: "维修员用记忆换取救人的机会",
        protagonistDesire: "守住家人的记忆",
        readerPromise: "规则解谜与关系代价",
        coreEmotion: "守护",
        ending: "放弃能力",
        immutableRules: [],
        prohibitedPatterns: [],
        version: 1,
        approved: true,
        updatedAt: new Date().toISOString(),
      },
      plans: [
        {
          kind: "分卷",
          title: "代价浮现",
          goal: "发现失忆",
          conflict: "救人与遗忘",
          outcome: "组成小队",
          status: "已批准",
        },
      ],
      chapters: [
        {
          number: 3,
          title: "雨夜",
          outline: "救人后遗忘",
          content: "雨落下来，他握住门把手，却想不起妹妹的名字。",
          status: "已定稿",
        },
      ],
    } as unknown as ProjectDetail;

    const result = await new AiService(databaseFor("deepseek-chat"), () => "secret").suggestAestheticProfile(
      fullProject,
    );

    expect(result).toEqual(suggestion);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[1].content).toContain("只属于这本书");
    expect(body.messages[1].content).toContain("雨落下来");
    expect(body.messages[0].content).toContain("不套用全局风格模板");
  });

  it("keeps non-GPT models on the compatible chat request shape", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new AiService(databaseFor("deepseek-chat"), () => "secret").reviewChapter(project, chapter, context);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages).toHaveLength(2);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("instructions");
  });

  it("uses Anthropic Messages only when that protocol is selected", async () => {
    const startAiJob = vi.fn((..._args: unknown[]) => "job-anthropic");
    const finishAiJob = vi.fn();
    const baseDatabase = databaseFor("claude-sonnet-4-20250514", "anthropic-messages", "https://api.anthropic.com/v1");
    const database = {
      ...baseDatabase,
      getAiSettings: () => ({ ...baseDatabase.getAiSettings(), inputPricePerMillion: 2, outputPricePerMillion: 5 }),
      startAiJob,
      finishAiJob,
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify({ issues: [] }) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 13, output_tokens: 4 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(database, () => "sk-ant-secret").reviewChapter(project, chapter, context),
    ).resolves.toEqual([]);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      "x-api-key": "sk-ant-secret",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
    expect(headers).not.toHaveProperty("Authorization");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      stream: true,
      system: expect.stringContaining("只返回合法 JSON"),
      messages: [{ role: "user", content: expect.any(String) }],
    });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("stream_options");
    expect(body).not.toHaveProperty("reasoning");
    expect(startAiJob.mock.calls[0][4]).toBe("anthropic:https://api.anthropic.com/v1");
    expect(startAiJob.mock.calls[0][5]).toBe("claude-sonnet-4-20250514");
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({ inputTokens: 13, outputTokens: 4 });
    expect(finishAiJob.mock.calls[0][3].actualCost).toBeCloseTo(0.000046);
  });

  it("keeps Claude model names on Chat Completions behind compatible gateways", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new AiService(databaseFor("claude-via-proxy"), () => "secret").reviewChapter(project, chapter, context);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
  });

  it("does not repay for an Anthropic response truncated at max_tokens", async () => {
    const finishAiJob = vi.fn();
    const database = {
      ...databaseFor("claude-model", "anthropic-messages", "https://api.anthropic.com/v1"),
      finishAiJob,
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"issues":[' }],
            stop_reason: "max_tokens",
            usage: { input_tokens: 20, output_tokens: 8192 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AiService(database, () => "secret").reviewChapter(project, chapter, context)).rejects.toThrow(
      "max_tokens",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(finishAiJob).toHaveBeenCalledOnce();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({
      status: "失败",
      inputTokens: 20,
      outputTokens: 8192,
      attemptCount: 1,
    });
  });

  it("does not retry permanent provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiService(databaseFor("gpt-5.1"), () => "secret").reviewChapter(project, chapter, context),
    ).rejects.toThrow("模型接口返回 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one total deadline across transient retries", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();

    await expect(
      new AiService(databaseFor("gpt-5.1"), () => "secret", 30, 30).reviewChapter(project, chapter, context),
    ).rejects.toThrow("模型请求超时");
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("chapter draft streaming", () => {
  const draftChapter = {
    id: "chapter-start",
    number: 1,
    title: "待生成",
    outline: "完成任务句柄测试",
    content: "",
    wordCount: 0,
    status: "章纲",
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 3,
    updatedAt: new Date().toISOString(),
  } satisfies Chapter;
  const draftContext = {
    contract: "契约",
    commercialGuidance: "规则",
    chapterIntent: "意图",
    expectationLedger: "无",
    longTermMemory: "无",
    volumeGoal: "无",
    rollingOutline: "无",
    recentSummary: "无",
    relevantFacts: "无",
    forbiddenKnowledge: "无",
    authorStyle: "无",
    estimatedTokens: 10,
  } satisfies ContextPackage;

  it("returns the new job id before the network request completes", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const startAiJob = vi.fn(() => "job-started");
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "deepseek-chat",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: vi.fn(() => undefined),
      startAiJob,
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const service = new AiService(database, () => "secret");
    let completed = false;

    const task = service.startDraftChapter("project", draftChapter, draftContext);
    void task.completion.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );

    expect(task).toMatchObject({ jobId: "job-started", source: "network" });
    expect(startAiJob).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(completed).toBe(false);

    const content = "正文".repeat(1000);
    resolveResponse(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "新章节", content }) } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    await expect(task.completion).resolves.toMatchObject({ title: "新章节", content });
    expect(completed).toBe(true);
  });

  it("uses successful cache entries normally but bypasses them for an explicit retry", async () => {
    const cachedContent = "缓存正文".repeat(700);
    const networkContent = "网络正文".repeat(700);
    const findAiJob = vi.fn(() => JSON.stringify({ title: "缓存章节", content: cachedContent }));
    const startAiJob = vi.fn(() => "job-bypass");
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "deepseek-chat",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob,
      startAiJob,
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ title: "网络章节", content: networkContent }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");

    const cached = service.startDraftChapter("project", draftChapter, draftContext);
    expect(cached).toMatchObject({ jobId: null, source: "cache" });
    await expect(cached.completion).resolves.toMatchObject({ title: "缓存章节", content: cachedContent });
    expect(startAiJob).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    findAiJob.mockClear();
    const retried = service.startDraftChapter("project", draftChapter, draftContext, { cachePolicy: "bypass" });
    expect(retried).toMatchObject({ jobId: "job-bypass", source: "network" });
    expect(findAiJob).not.toHaveBeenCalled();
    expect(startAiJob).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(retried.completion).resolves.toMatchObject({ title: "网络章节", content: networkContent });
  });

  it("forwards decoded content deltas and records request telemetry", async () => {
    const finishAiJob = vi.fn();
    const updateAiJobTelemetry = vi.fn();
    const log = vi.fn();
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "deepseek-chat",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-stream",
      finishAiJob,
      updateAiJobTelemetry,
    } as unknown as WorkspaceDatabase;
    const content = "正文".repeat(1000);
    const raw = JSON.stringify({ title: "流式章节", content });
    const pieces = [raw.slice(0, 37), raw.slice(37, 190), raw.slice(190)];
    const sse =
      pieces.map((piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`).join("") +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    const chapter = {
      id: "chapter-stream",
      number: 1,
      title: "待生成",
      outline: "完成流式生成",
      content: "",
      wordCount: 0,
      status: "章纲",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 1,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const context = {
      contract: "契约",
      commercialGuidance: "规则",
      chapterIntent: "意图",
      expectationLedger: "无",
      longTermMemory: "无",
      volumeGoal: "无",
      rollingOutline: "无",
      recentSummary: "无",
      relevantFacts: "无",
      forbiddenKnowledge: "无",
      authorStyle: "无",
      estimatedTokens: 10,
    } satisfies ContextPackage;
    const events: Array<{ type: string; delta?: string }> = [];

    const result = await new AiService(database, () => "secret", 120_000, 0, log).draftChapter(
      "project",
      chapter,
      context,
      undefined,
      (event) => events.push(event),
    );

    expect(result.content).toBe(content);
    expect(
      events
        .filter((event) => event.type === "delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe(content);
    expect(events[0]).toMatchObject({ type: "attempt-start" });
    expect(events.at(-1)).toMatchObject({ type: "complete" });
    expect(updateAiJobTelemetry).toHaveBeenCalled();
    expect(finishAiJob.mock.calls[0][3]).toMatchObject({
      chunkCount: 1,
      attemptCount: 1,
      headersAt: expect.any(String),
      firstTokenAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(log).toHaveBeenCalledWith("info", "ai.request.first_content", expect.objectContaining({ attempt: 1 }));
  });
});

describe("AI deconstruction batching", () => {
  it("splits ten chapters into two cached-size batches before stage synthesis", async () => {
    let job = 0;
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => `job-${++job}`,
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const insight = {
      audienceNeed: "需求",
      openingPromise: "承诺",
      conflictEngine: "冲突",
      emotionalRhythm: "节奏",
      retentionDevices: "留存",
      longFormEngine: "长篇",
      marketGap: "空位",
      risks: "风险",
      confidence: "中" as const,
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const user = request.messages[1].content;
      const ordinals = [...user.matchAll(/【章节(\d+)】/g)].map((match) => Number(match[1]));
      const content = ordinals.length
        ? {
            chapters: ordinals.map((ordinal) => ({
              ordinal,
              finding: "结构",
              conflict: "冲突",
              hook: "钩子",
              stateChange: "变化",
              risk: "风险",
              enteringExpectation: "进入",
              protagonistGoal: "目标",
              coreInterest: "利益",
              emotionalPayoff: "回报",
              payoffImpact: "影响",
              nextExpectation: "期待",
            })),
            synthesis: insight,
          }
        : insight;
      const payload = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }] });
      return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const book = {
      id: "book",
      title: "十章样本",
      author: "作者",
      genre: "都市脑洞",
      sourceType: "公开试读",
      chapterCount: 10,
      wordCount: 10000,
      rightsConfirmed: false,
      cloudConsent: true,
      importedAt: new Date().toISOString(),
      status: "待拆解",
    } satisfies ResearchBook;
    const chapters = Array.from({ length: 10 }, (_, index) => ({
      ordinal: index + 1,
      title: `第${index + 1}章`,
      content: "章节正文。".repeat(100),
      wordCount: 500,
    }));

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
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-backoff",
      finishAiJob: (_id: string, _output: string, _error?: string, usage?: { status?: string }) =>
        finished.push({ status: usage?.status }),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 })),
    );
    const service = new AiService(database, () => "secret");
    const book = {
      id: "book",
      title: "测试书",
      author: "作者",
      genre: "都市脑洞",
      sourceType: "TXT",
      chapterCount: 1,
      wordCount: 1000,
      rightsConfirmed: true,
      cloudConsent: true,
      importedAt: new Date().toISOString(),
      status: "待拆解",
    } satisfies ResearchBook;
    const running = service.deconstruct(book, [
      { ordinal: 1, title: "第一章", content: "正文".repeat(100), wordCount: 200 },
    ]);
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
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-quality",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      issues: [
                        {
                          severity: "硬性",
                          category: "知识边界",
                          message: "角色使用了尚未知晓的信息",
                          evidence: "林舟直接说出了密码",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-3",
      number: 3,
      title: "错误的密码",
      outline: "目标：进入机房",
      content: "林舟直接说出了密码。",
      wordCount: 10,
      status: "待质检",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 1,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = {
      contract: "",
      commercialGuidance: "",
      chapterIntent: "",
      expectationLedger: "",
      longTermMemory: "",
      volumeGoal: "",
      rollingOutline: "",
      recentSummary: "",
      relevantFacts: "",
      forbiddenKnowledge: "密码仅反派知晓",
      authorStyle: "",
      estimatedTokens: 10,
    } satisfies ContextPackage;

    const issues = await service.reviewChapter(project, chapter, context);

    expect(issues).toMatchObject([
      { projectId: "project-1", chapterId: "chapter-3", severity: "硬性", category: "知识边界", status: "待处理" },
    ]);
    expect(issues[0].id).toBeTruthy();
  });

  it("does not let unsupported model claims become hard gates", async () => {
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-unsupported",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      issues: [
                        {
                          severity: "硬性",
                          category: "设定冲突",
                          message: "模型推测出的冲突",
                          evidence: "正文和账本中不存在的句子",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-4",
      number: 4,
      title: "正常章节",
      outline: "目标：继续调查",
      content: "林舟检查了门锁。",
      wordCount: 8,
      status: "待质检",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 1,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = {
      contract: "",
      commercialGuidance: "",
      chapterIntent: "",
      expectationLedger: "",
      longTermMemory: "",
      volumeGoal: "",
      rollingOutline: "",
      recentSummary: "",
      relevantFacts: "",
      forbiddenKnowledge: "",
      authorStyle: "",
      estimatedTokens: 10,
    } satisfies ContextPackage;

    expect((await service.reviewChapter(project, chapter, context))[0].severity).toBe("警告");
  });

  it("revises a chapter from pending issues and returns it to quality review", async () => {
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        longTaskTimeoutMinutes: 10,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-revise-quality",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const revisedContent = "林舟先核对门禁记录，再依据已经掌握的线索进入机房。".repeat(30);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ title: "核对之后", content: revisedContent }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-5",
      number: 5,
      title: "错误闯入",
      outline: "目标：进入机房；冲突：权限不足；结果：取得记录",
      content: "林舟直接说出未知密码后进入机房。".repeat(30),
      wordCount: 480,
      status: "待质检",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 3,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" } } as unknown as ProjectDetail;
    const context = {
      contract: "不得泄露未知信息",
      commercialGuidance: "",
      chapterIntent: "",
      expectationLedger: "",
      longTermMemory: "",
      volumeGoal: "",
      rollingOutline: "",
      recentSummary: "",
      relevantFacts: "",
      forbiddenKnowledge: "密码仅反派知晓",
      authorStyle: "",
      estimatedTokens: 10,
    } satisfies ContextPackage;
    const issue = {
      id: "issue-1",
      projectId: "project-1",
      chapterId: chapter.id,
      severity: "硬性",
      category: "知识边界",
      message: "角色使用了尚未知晓的信息",
      evidence: "林舟直接说出未知密码",
      status: "待处理",
      createdAt: new Date().toISOString(),
    } satisfies QualityIssue;

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
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-facts",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    facts: [
                      {
                        kind: "能力",
                        subject: "林舟",
                        predicate: "能力代价",
                        value: "每次使用会失去一段近期记忆",
                        knowledgeScope: "林舟",
                        evidence: "每用一次能力，他就会失去一段近期记忆",
                      },
                      {
                        kind: "资源",
                        subject: "林舟",
                        predicate: "余额",
                        value: "一百万元",
                        knowledgeScope: "公开",
                        evidence: "正文没有这句话",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-8",
      number: 8,
      title: "能力代价",
      outline: "确认能力规则",
      content: "林舟终于确认：每用一次能力，他就会失去一段近期记忆。",
      wordCount: 30,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 2,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [] } as unknown as ProjectDetail;
    const facts = await service.extractChapterFacts(project, chapter);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: "能力",
      subject: "林舟",
      confidence: "待确认",
      evidenceChapter: 8,
      genreDimension: "定稿自动候选",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ stream: true });
  });

  it("links a changed state to the active fact it should replace", async () => {
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-replacement",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      facts: [
                        {
                          kind: "地点",
                          subject: "林舟",
                          predicate: "所在地",
                          value: "上海",
                          knowledgeScope: "公开",
                          evidence: "林舟已经抵达上海",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-8",
      number: 8,
      title: "抵达",
      outline: "目标：抵达上海",
      content: "清晨，林舟已经抵达上海。",
      wordCount: 13,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 2,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const previous = {
      id: "fact-beijing",
      kind: "地点",
      subject: "林舟",
      predicate: "所在地",
      value: "北京",
      validFromChapter: 1,
      validToChapter: null,
      evidenceChapter: 1,
      confidence: "已确认",
      knowledgeScope: "公开",
      updatedAt: new Date().toISOString(),
    } satisfies LedgerFact;
    const project = { summary: { id: "project-1", genre: "都市脑洞" }, facts: [previous] } as unknown as ProjectDetail;

    const facts = await service.extractChapterFacts(project, chapter);

    expect(facts[0]).toMatchObject({
      confidence: "待确认",
      replacesFactId: previous.id,
      changeType: "状态替换",
      genreDimension: "定稿状态替换候选",
    });
  });

  it("classifies numeric resource deltas and knowledge-scope changes", async () => {
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-change-types",
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      facts: [
                        {
                          kind: "资源",
                          subject: "林舟",
                          predicate: "灵石余额",
                          value: "70枚灵石",
                          knowledgeScope: "公开",
                          evidence: "只剩下七十枚灵石",
                        },
                        {
                          kind: "秘密",
                          subject: "仓库密钥",
                          predicate: "真实位置",
                          value: "藏在旧钟背面",
                          knowledgeScope: "林舟、苏晚",
                          evidence: "苏晚也知道密钥藏在旧钟背面",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const service = new AiService(database, () => "secret");
    const chapter = {
      id: "chapter-9",
      number: 9,
      title: "清点",
      outline: "清点资源并共享秘密",
      content: "清点之后，只剩下七十枚灵石。苏晚也知道密钥藏在旧钟背面。",
      wordCount: 31,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 2,
      updatedAt: new Date().toISOString(),
    } satisfies Chapter;
    const resource = {
      id: "fact-resource",
      kind: "资源",
      subject: "林舟",
      predicate: "灵石余额",
      value: "100枚灵石",
      validFromChapter: 2,
      validToChapter: null,
      evidenceChapter: 2,
      confidence: "已确认",
      knowledgeScope: "公开",
      updatedAt: new Date().toISOString(),
    } satisfies LedgerFact;
    const secret = {
      id: "fact-secret",
      kind: "秘密",
      subject: "仓库密钥",
      predicate: "真实位置",
      value: "藏在旧钟背面",
      validFromChapter: 3,
      validToChapter: null,
      evidenceChapter: 3,
      confidence: "已确认",
      knowledgeScope: "林舟",
      updatedAt: new Date().toISOString(),
    } satisfies LedgerFact;
    const project = {
      summary: { id: "project-1", genre: "都市脑洞" },
      facts: [resource, secret],
    } as unknown as ProjectDetail;

    const facts = await service.extractChapterFacts(project, chapter);

    expect(facts[0]).toMatchObject({ changeType: "数值变化", numericDelta: -30, replacesFactId: resource.id });
    expect(facts[1]).toMatchObject({ changeType: "知情范围变更", numericDelta: null, replacesFactId: secret.id });
  });
});

describe("AI planning", () => {
  const planningProject = {
    summary: { id: "project-plan", title: "测试长篇", genre: "年代重生", targetWords: 1000000, currentWords: 10000 },
    contract: {
      approved: true,
      genreSubtype: "创业致富",
      fanqieCategoryKey: "女频:79",
      premise: "女主凭手艺创业",
      protagonistDesire: "建立工厂",
      readerPromise: "事业与关系共同成长",
      coreEmotion: "被尊重",
      ending: "建立品牌",
      immutableRules: [],
      prohibitedPatterns: [],
    },
    plans: [],
    chapters: [],
    facts: [],
  } as unknown as ProjectDetail;
  const planningDatabase = () =>
    ({
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "test",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }),
      findAiJob: () => undefined,
      startAiJob: () => "job-plan",
      finishAiJob: vi.fn(),
    }) as unknown as WorkspaceDatabase;
  const plannedChapter = (number: number, overrides: Record<string, unknown> = {}) => {
    const route = number % 3;
    const chapterFunction = route === 1 ? "关系" : route === 2 ? "调查" : "行动";
    const sceneCount = route === 1 ? 1 : route === 2 ? 2 : 3;
    const targetWords = route === 1 ? 1600 : route === 2 ? 2200 : 2800;
    return {
      title: `推进${number}`,
      goal: `完成第${number}个具体目标`,
      conflict: `面对第${number}个现实阻碍`,
      outcome: `产生第${number}个状态变化`,
      chapterFunction,
      targetWords,
      chapterPromise: `本章推进承诺${number}`,
      expectedPayoff: `可见回报${number}`,
      crisis: `当前张力${number}`,
      endingExpectation: `下一问题${number}`,
      payoffOffset: 2,
      isKeyChapter: false,
      scenes: Array.from({ length: sceneCount }, (_, index) => ({
        title: `具体事件${number}-${index + 1}`,
        goal: `推进场景目标${index + 1}`,
        conflict: `形成场景张力${index + 1}`,
        outcome: `得到场景结果${index + 1}`,
        targetWords: sceneCount === 1 ? 1600 : index === 1 ? 1000 : 900,
      })),
      ...overrides,
    };
  };

  it("maps a continuous chapter proposal to rough plans, detailed plans and chapter intents", async () => {
    const chapters = Array.from({ length: 10 }, (_, index) => plannedChapter(index + 1, { isKeyChapter: index === 9 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      batchGoal: "建立首个可以持续运转的生产小组",
                      batchConflict: "原料渠道与家庭阻力同时升级并形成选择",
                      batchOutcome: "获得稳定订单并建立明确的合作规则",
                      chapters,
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await new AiService(planningDatabase(), () => "secret").generatePlanning(planningProject, {
      mode: "后续章纲",
      fromChapter: 6,
      chapterCount: 10,
    });
    expect(result.chapters).toHaveLength(10);
    expect(result.plans).toHaveLength(30);
    expect(result.chapters[0]).toMatchObject({
      number: 6,
      status: "章纲",
      expectationTargetChapter: 8,
      chapterFunction: "关系",
      targetWords: 1600,
    });
    expect(result.chapters[9]).toMatchObject({ number: 15, isKeyChapter: true, batchMode: "逐章" });
    expect(result.plans[0]).toMatchObject({ kind: "粗纲", ordinal: 6, status: "草稿" });
    expect(result.plans.filter((plan) => plan.kind === "细纲")).toHaveLength(10);
    expect(result.plans.filter((plan) => plan.kind === "场景卡")).toHaveLength(19);
    expect(result.plans.find((plan) => plan.kind === "场景卡")).toMatchObject({
      parentId: result.plans[1].id,
      status: "草稿",
    });
    const firstDetail = result.plans.find((plan) => plan.kind === "细纲" && plan.ordinal === 6)!;
    const secondDetail = result.plans.find((plan) => plan.kind === "细纲" && plan.ordinal === 7)!;
    expect(result.plans.filter((plan) => plan.kind === "场景卡" && plan.parentId === firstDetail.id)).toHaveLength(1);
    expect(result.plans.filter((plan) => plan.kind === "场景卡" && plan.parentId === secondDetail.id)).toHaveLength(2);
  });

  it("splits thirty chapters into three persisted ten-chapter batches with continuity context", async () => {
    const requestedStarts: number[] = [];
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
        const user = body.messages[1].content;
        requests.push(user);
        const start = Number(user.match(/从第(\d+)章开始/)?.[1]);
        requestedStarts.push(start);
        const chapters = Array.from({ length: 10 }, (_, index) => plannedChapter(start + index));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    batchGoal: `推进第${start}章批次的持续目标`,
                    batchConflict: `第${start}章批次的阻力持续升级`,
                    batchOutcome: `第${start}章批次产生明确状态变化`,
                    chapters,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const persisted: number[][] = [];

    const result = await new AiService(planningDatabase(), () => "secret").generatePlanning(
      planningProject,
      { mode: "后续章纲", fromChapter: 6, chapterCount: 30 },
      (batch) => {
        persisted.push(batch.chapters.map((chapter) => chapter.number));
      },
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
    expect(result.plans).toHaveLength(93);
  });

  it("rejects an incomplete chapter batch before anything can be saved", async () => {
    const one = plannedChapter(1, { title: "唯一一章", payoffOffset: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      batchGoal: "建立首个可以持续运转的生产小组",
                      batchConflict: "原料渠道与家庭阻力同时升级并形成选择",
                      batchOutcome: "获得稳定订单并建立明确的合作规则",
                      chapters: [one],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      new AiService(planningDatabase(), () => "secret").generatePlanning(planningProject, {
        mode: "后续章纲",
        fromChapter: 6,
        chapterCount: 10,
      }),
    ).rejects.toThrow("预期 10 章");
  });

  it("reviews planning with evidence and blocks protected repair targets", async () => {
    const approvedPlan = {
      id: "plan-approved",
      kind: "宏观阶段",
      title: "旧城封锁",
      ordinal: 1,
      goal: "查清封锁原因",
      conflict: "资源持续减少",
      outcome: "找到离城路线",
      targetWords: 100000,
      status: "已批准",
      parentId: null,
    } as const;
    const draftPlan = {
      ...approvedPlan,
      id: "plan-draft",
      kind: "细纲" as const,
      title: "检查旧站",
      ordinal: 3,
      status: "草稿" as const,
    };
    const protectedChapter = {
      id: "chapter-final",
      number: 3,
      title: "旧站",
      outline: "直接找到出口",
      content: "已定稿正文",
      wordCount: 5,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 2,
      updatedAt: new Date().toISOString(),
    } as const;
    const project = {
      ...planningProject,
      plans: [approvedPlan, draftPlan],
      chapters: [protectedChapter],
      facts: [],
      expectations: [],
    } as unknown as ProjectDetail;
    const response = {
      summary: "第三章缺少从检查旧站到找到出口的因果步骤，需要补充证据获取过程。",
      verdict: "存在硬伤",
      issues: [
        {
          severity: "硬性",
          category: "因果",
          targetType: "章节",
          targetId: "chapter-final",
          location: "第3章",
          message: "结果缺少行动依据",
          evidence: "直接找到出口",
          repairSummary: "增加检查记录与验证路线",
        },
        {
          severity: "警告",
          category: "结构覆盖",
          targetType: "规划",
          targetId: "plan-approved",
          location: "旧城封锁",
          message: "阶段结果跳过验证",
          evidence: "找到离城路线",
          repairSummary: "把结果改为待验证路线",
        },
        {
          severity: "警告",
          category: "因果",
          targetType: "规划",
          targetId: "plan-draft",
          location: "检查旧站",
          message: "目标与结果之间缺少核对过程",
          evidence: "检查旧站",
          repairSummary: "增加记录核对步骤",
        },
        {
          severity: "建议",
          category: "设定",
          targetType: "规划",
          targetId: "forged",
          location: "伪造节点",
          message: "不应保留",
          evidence: "虚构证据",
          repairSummary: "无需处理该项",
        },
      ],
      planRepairs: [
        {
          targetId: "plan-approved",
          after: {
            title: "旧城封锁",
            goal: "通过旧站记录查清封锁原因",
            conflict: "资源减少且记录残缺",
            outcome: "确认一条待验证路线",
            targetWords: 100000,
          },
        },
        {
          targetId: "plan-draft",
          after: {
            title: "核对旧站记录",
            goal: "取得并核对路线记录",
            conflict: "记录缺页且时间有限",
            outcome: "得到可验证的出口坐标",
            targetWords: 2400,
          },
        },
        {
          targetId: "forged",
          after: { title: "伪造", goal: "伪造目标", conflict: "伪造冲突", outcome: "伪造结果", targetWords: 1000 },
        },
      ],
      chapterRepairs: [
        {
          targetId: "chapter-final",
          after: {
            title: "旧站记录",
            outline: "先取得维修记录，再交叉验证出口坐标",
            chapterFunction: "调查",
            targetWords: 2200,
            chapterPromise: "确认路线真实性",
            expectedPayoff: "获得可信坐标",
            crisis: "封锁即将收紧",
            endingExpectation: "坐标指向禁区",
            expectationTargetChapter: 5,
          },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), {
            status: 200,
          }),
      ),
    );
    const result = await new AiService(planningDatabase(), () => "secret").reviewPlanning(project, {
      fromChapter: 1,
      chapterCount: 10,
    });
    expect(result.issues).toHaveLength(3);
    expect(result.planRepairs.map((item) => item.targetId)).toEqual(["plan-approved", "plan-draft"]);
    expect(result.planRepairs[0].blockedReason).toContain("已批准");
    expect(result.planRepairs[1].blockedReason).toBeNull();
    expect(result.chapterRepairs[0].blockedReason).toContain("已定稿");
  });
});
