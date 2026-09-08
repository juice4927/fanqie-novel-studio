import { afterEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../electron/ai-service";
import type { WorkspaceDatabase } from "../electron/database";
import { compileChapterGuidance } from "../src/shared/commercial-knowledge";
import {
  type ContextCompilerInput,
  compileChapterContext,
  renderContextForPrompt,
} from "../src/shared/context-compiler";
import { FANQIE_CATEGORY_PROFILES } from "../src/shared/fanqie-taxonomy";
import { constraintDensity, contextComposition, countDirectives } from "../src/shared/guidance-metrics";
import type { Chapter, ContextPackage, LedgerFact, PlanNode, StoryContract } from "../src/shared/types";

const timestamp = "2026-09-08T00:00:00.000Z";

function chapter(number: number, patch: Partial<Chapter> = {}): Chapter {
  return {
    id: `chapter-${number}`,
    number,
    title: `第${number}章`,
    outline: `推进第${number}章目标`,
    content: `第${number}章正文`,
    wordCount: 2300,
    status: "草稿",
    batchMode: "逐章",
    isKeyChapter: false,
    chapterFunction: "行动",
    chapterPromise: "林舟要拿到门禁记录并确认内鬼身份",
    expectedPayoff: "取得门禁记录，锁定一名可疑人员",
    crisis: "记录可能已被远程清除，时间只剩两小时",
    endingExpectation: "记录指向一个他不想怀疑的人",
    linkedExpectationIds: [],
    revision: 1,
    updatedAt: timestamp,
    ...patch,
  };
}

function fact(id: string, patch: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id,
    kind: "人物",
    subject: "林舟",
    predicate: "身份",
    value: id,
    validFromChapter: 1,
    validToChapter: null,
    evidenceChapter: 1,
    confidence: "已确认",
    knowledgeScope: "公开",
    updatedAt: timestamp,
    ...patch,
  };
}

function plan(id: string, ordinal: number, patch: Partial<PlanNode> = {}): PlanNode {
  return {
    id,
    kind: "细纲",
    title: id,
    ordinal,
    goal: `${id}目标`,
    conflict: `${id}冲突`,
    outcome: `${id}结果`,
    targetWords: 2500,
    status: "已批准",
    parentId: null,
    ...patch,
  };
}

function contract(patch: Partial<StoryContract> = {}): StoryContract {
  return {
    premise: "调查城市事故",
    protagonistDesire: "还原真相",
    readerPromise: "持续获得可靠线索",
    coreEmotion: "信任",
    ending: "公开真相",
    immutableRules: ["证据必须交叉验证"],
    prohibitedPatterns: [],
    aestheticProfile: {
      narrativeDistance: "贴身",
      emotionalTemperature: "均衡",
      proseTexture: "动作具体",
      dialogueStyle: "短促",
      emotionalExpression: "克制",
      signatureTechniques: [],
      avoidPatterns: [],
    },
    genreSubtype: "都市异能",
    fanqieCategoryKey: FANQIE_CATEGORY_PROFILES[0].key,
    version: 1,
    approved: true,
    updatedAt: timestamp,
    ...patch,
  };
}

function input(patch: Partial<ContextCompilerInput> = {}): ContextCompilerInput {
  return {
    summary: { genre: "都市脑洞", currentWords: 20_000, targetWords: 1_000_000 },
    contract: contract(),
    chapter: chapter(10, { linkedExpectationIds: ["linked"] }),
    plans: [plan("volume", 1, { kind: "分卷", targetWords: 100_000 }), plan("approved", 10), plan("approved-2", 11)],
    relevantFacts: Array.from({ length: 40 }, (_, index) =>
      fact(`f${index}`, { subject: `角色${index}`, predicate: "持有物品", value: `物品${index}` }),
    ),
    constraintFacts: [],
    summaries: [
      {
        id: "summary-9",
        layer: "章节",
        title: "第9章摘要",
        fromChapter: 9,
        toChapter: 9,
        content: "摘要内容",
        version: 1,
        updatedAt: timestamp,
      },
    ],
    expectations: [
      {
        id: "linked",
        title: "关联期待",
        description: "",
        sourceChapter: 2,
        expectedPayoffChapter: 10,
        actualPayoffChapter: null,
        status: "待兑现",
        payoffResult: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    recentChapters: [chapter(9), chapter(8), chapter(7), chapter(6), chapter(5)],
    styleSamples: ["短句。\n动作具体。".repeat(30)],
    directorNotes: ["别用旋即", "开头三章别拖节奏"],
    ...patch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chapter context guidance", () => {
  it("keeps generic guidance small relative to the chapter intent", () => {
    const context = compileChapterContext(input());
    const composition = contextComposition(context);
    expect(composition.total).toBeLessThanOrEqual(2500);
    expect(composition.commercialShare).toBeLessThanOrEqual(0.2);
    expect(composition.intentToGuidanceRatio).toBeGreaterThanOrEqual(0.25);
    expect(context.guidanceMode).toBe("均衡");
  });

  it("injects no standing genre block, and loads the full reference only in 严谨", () => {
    const free = compileChapterContext(input({ contract: contract({ guidanceMode: "自由" }) }));
    const balanced = compileChapterContext(input({ contract: contract({ guidanceMode: "均衡" }) }));
    const strict = compileChapterContext(input({ contract: contract({ guidanceMode: "严谨" }) }));
    expect(free.commercialGuidance).toBe("");
    expect(balanced.commercialGuidance).toBe("");
    expect(strict.commercialGuidance.length).toBeGreaterThan(1000);
    expect(strict.commercialGuidance).toContain("题材质量检查");
  });

  it("renders the chapter task before the generic reference", () => {
    const context = compileChapterContext(input());
    const rendered = renderContextForPrompt(context);
    expect(rendered.startsWith("## 本章任务")).toBe(true);
    expect(rendered).not.toContain("commercialGuidance");
    expect(rendered.length).toBeLessThan(JSON.stringify(context).length);
  });

  it("trims low-priority sections to honor a token budget and never drops hard boundaries", () => {
    const context = compileChapterContext(input(), { budgetTokens: 400 });
    expect(context.authorStyle).toBe("");
    expect(context.contract).toContain("不可破坏规则");
    expect(context.chapterIntent).not.toBe("");
    expect(context.diagnostics?.warnings.some((warning) => warning.includes("已按 token 预算裁剪"))).toBe(true);
  });

  it("keeps the full reference positive-first for the strict mode", () => {
    const guidance = compileChapterGuidance("都市脑洞", 10, { currentWords: 20_000, targetWords: 1_000_000 }, "严谨");
    expect(guidance).toContain("正向边界");
    expect(guidance).toContain("禁止的反面");
    expect(countDirectives(guidance).prohibitions).toBeLessThanOrEqual(10);
  });
});

describe("draft prompt guidance", () => {
  const draftChapter = {
    id: "chapter-10",
    number: 10,
    title: "门禁记录",
    outline: "林舟调取门禁记录并确认内鬼",
    content: "",
    wordCount: 0,
    status: "章纲",
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 1,
    updatedAt: timestamp,
  } satisfies Chapter;

  function serviceWith(settings: Record<string, unknown> = {}) {
    const database = {
      getAiSettings: () => ({
        baseUrl: "https://model.invalid/v1",
        model: "deepseek-chat",
        embeddingModel: "test",
        hasApiKey: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        ...settings,
      }),
      findAiJob: vi.fn(() => undefined),
      startAiJob: vi.fn(() => "job-1"),
      finishAiJob: vi.fn(),
    } as unknown as WorkspaceDatabase;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ title: "门禁记录", content: "正文".repeat(500) }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return { service: new AiService(database, () => "secret"), fetchMock };
  }

  function draftContext(guidanceMode: ContextPackage["guidanceMode"]): ContextPackage {
    return {
      contract: "故事前提：调查事故",
      commercialGuidance: "题材承诺：高概念进入现实后的快速反馈",
      chapterIntent: "本章承诺：拿到门禁记录",
      expectationLedger: "无",
      longTermMemory: "无",
      volumeGoal: "无",
      rollingOutline: "第10章 门禁记录",
      recentSummary: "无",
      relevantFacts: "无",
      forbiddenKnowledge: "密码仅反派知晓",
      authorStyle: "无",
      guidanceMode,
      estimatedTokens: 10,
    };
  }

  async function draftUserPrompt(mode: ContextPackage["guidanceMode"], settings: Record<string, unknown> = {}) {
    const { service, fetchMock } = serviceWith(settings);
    await service.draftChapter("project", draftChapter, draftContext(mode));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    return { body, user: body.messages[1].content };
  }

  it("leads with the chapter task and keeps the prohibition density low", async () => {
    const { user } = await draftUserPrompt("均衡");
    expect(user).toContain("【本章】");
    expect(user.indexOf("【本章】")).toBeLessThan(user.indexOf("【写作上下文】"));
    expect(user).toContain("【推进建议】");
    expect(user).toContain("【长度参考】");
    expect(user).not.toContain("不得为了显得刺激");
    expect(constraintDensity(user)).toBeLessThanOrEqual(5);
  });

  it("maps the guidance mode to sampling temperature and honors a global override", async () => {
    expect((await draftUserPrompt("自由")).body.temperature).toBe(0.95);
    expect((await draftUserPrompt("均衡")).body.temperature).toBe(0.85);
    expect((await draftUserPrompt("严谨")).body.temperature).toBe(0.7);
    expect((await draftUserPrompt("均衡", { temperatureOverride: 0.5 })).body.temperature).toBe(0.5);
  });
});
