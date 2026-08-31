import { describe, expect, it } from "vitest";
import {
  buildProjectContextInput,
  type ContextCompilerInput,
  compileChapterContext,
  compileProjectChapterContext,
} from "../src/shared/context-compiler";
import type { Chapter, LedgerFact, PlanNode, ProjectDetail, StoryContract } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function chapter(number: number, patch: Partial<Chapter> = {}): Chapter {
  return {
    id: `chapter-${number}`,
    number,
    title: `第${number}章`,
    outline: `推进第${number}章目标`,
    content: `第${number}章正文`,
    wordCount: 1000,
    status: "草稿",
    batchMode: "逐章",
    isKeyChapter: false,
    chapterPromise: "推进调查",
    expectedPayoff: "取得线索",
    crisis: "证据即将销毁",
    endingExpectation: "线索指向内鬼",
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

const contract: StoryContract = {
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
  version: 1,
  approved: true,
  updatedAt: timestamp,
};

function input(patch: Partial<ContextCompilerInput> = {}): ContextCompilerInput {
  const current = chapter(10, { linkedExpectationIds: ["linked"] });
  return {
    summary: { genre: "都市脑洞", currentWords: 20_000, targetWords: 1_000_000 },
    contract,
    chapter: current,
    plans: [
      plan("volume", 1, { kind: "分卷", targetWords: 100_000 }),
      plan("approved", 10),
      plan("unapproved", 11, { status: "草稿" }),
      plan("too-far", 50),
    ],
    relevantFacts: [
      fact("active"),
      fact("future", { validFromChapter: 11 }),
      fact("expired", { validToChapter: 9 }),
      fact("ignored", { confidence: "已忽略" }),
    ],
    constraintFacts: [fact("conflict", { confidence: "有冲突" })],
    summaries: [
      {
        id: "summary-9",
        layer: "章节",
        title: "第9章摘要",
        fromChapter: 9,
        toChapter: 9,
        content: "摘要优先内容",
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
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `open-${index}`,
        title: `开放期待${index}`,
        description: "",
        sourceChapter: index + 1,
        expectedPayoffChapter: 20,
        actualPayoffChapter: null,
        status: "待兑现" as const,
        payoffResult: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ],
    recentChapters: [chapter(9), chapter(7), chapter(8), chapter(11, { content: "未来正文不得出现" })],
    styleSamples: ["短句。\n动作具体。"],
    ...patch,
  };
}

describe("context compiler", () => {
  it("selects approved plans, active facts and prior chapters deterministically", () => {
    const context = compileChapterContext(input());
    expect(context.rollingOutline).toContain("approved");
    expect(context.rollingOutline).not.toContain("unapproved");
    expect(context.rollingOutline).not.toContain("too-far");
    expect(context.relevantFacts).toContain("active");
    expect(context.relevantFacts).not.toContain("future");
    expect(context.relevantFacts).not.toContain("expired");
    expect(context.recentSummary).toContain("摘要优先内容");
    expect(context.recentSummary).not.toContain("未来正文不得出现");
    expect(context.estimatedTokens).toBeGreaterThan(0);
  });

  it("keeps all constraint facts for diagnostics when semantic facts are limited", () => {
    const context = compileChapterContext(input());
    expect(context.relevantFacts).not.toContain("conflict");
    expect(context.diagnostics?.warnings.join("\n")).toContain("状态账本存在 1 条冲突事实");
    expect(context.diagnostics?.warnings.join("\n")).toContain("硬性·状态冲突");
  });

  it("keeps linked expectations and caps unlinked open expectations", () => {
    const context = compileChapterContext(input());
    expect(context.expectationLedger).toContain("[本章承接] 关联期待");
    expect(context.expectationLedger.match(/\[待处理\]/g) ?? []).toHaveLength(20);
  });

  it("sorts recent chapters and uses only supplied style samples", () => {
    const context = compileChapterContext(
      input({
        summaries: [],
        styleSamples: ["短句。\n动作具体。"],
      }),
    );
    expect(context.recentSummary.indexOf("第7章")).toBeLessThan(context.recentSummary.indexOf("第8章"));
    expect(context.authorStyle).toContain("平均句长");
    expect(context.authorStyle).not.toContain("未来正文不得出现");
  });

  it("builds project context input with relevant facts and eligible style samples", () => {
    const current = chapter(30);
    const allFacts = [fact("constraint")];
    const relevantFacts = [fact("relevant")];
    const eligibleChapters = Array.from({ length: 22 }, (_, index) =>
      chapter(index + 1, {
        content: `样本-${index + 1}`,
        status: index % 2 ? "待发布" : "已定稿",
      }),
    );
    const project = {
      summary: {
        genre: "都市脑洞",
        currentWords: 20_000,
        targetWords: 1_000_000,
      },
      contract,
      plans: [],
      chapters: [
        ...eligibleChapters.reverse(),
        chapter(23, { content: "草稿不得采样", status: "草稿" }),
        chapter(31, { content: "未来不得采样", status: "已发布" }),
      ],
      facts: allFacts,
      summaries: [],
      expectations: [],
    } as unknown as ProjectDetail;

    const projectInput = buildProjectContextInput(project, current, relevantFacts);

    expect(projectInput.relevantFacts).toBe(relevantFacts);
    expect(projectInput.constraintFacts).toBe(allFacts);
    expect(projectInput.recentChapters).toBe(project.chapters);
    expect(projectInput.styleSamples).toHaveLength(20);
    expect(projectInput.styleSamples[0]).toBe("样本-3");
    expect(projectInput.styleSamples.at(-1)).toBe("样本-22");
    expect(projectInput.styleSamples).not.toContain("草稿不得采样");
    expect(projectInput.styleSamples).not.toContain("未来不得采样");
    expect(compileProjectChapterContext(project, current, relevantFacts).estimatedTokens).toBeGreaterThan(0);
  });
});
