import { describe, expect, it, vi } from "vitest";
import { buildChapterBatchPreview } from "../src/shared/chapter-batch-service";
import type {
  Chapter,
  LedgerFact,
  PlanNode,
  ProjectDetail,
  QualityIssue,
  StoryContract,
} from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function createChapter(number: number): Chapter {
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
  };
}

function createFact(
  id: string,
  value: string,
  confidence: LedgerFact["confidence"] = "已确认",
): LedgerFact {
  return {
    id,
    kind: "人物",
    subject: "林舟",
    predicate: "所在地点",
    value,
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
    chapters: [1, 2, 3, 4, 5].map(createChapter),
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

type GateCase = {
  name: string;
  expectedReason: string;
  chapterId?: string;
  mutate?: (project: ProjectDetail) => void;
};

const gateCases: GateCase[] = [
  {
    name: "rejects a missing start chapter",
    chapterId: "missing",
    expectedReason: "章节不存在",
  },
  {
    name: "requires five-chapter mode on the start chapter",
    mutate: (project) => { project.chapters[0].batchMode = "逐章"; },
    expectedReason: "请先保存“五章批次”模式",
  },
  {
    name: "requires an approved contract",
    mutate: (project) => { project.contract.approved = false; },
    expectedReason: "创作契约审批后才能生成正文",
  },
  {
    name: "blocks unresolved ledger conflicts",
    mutate: (project) => { project.facts = [createFact("conflict", "医院", "有冲突")]; },
    expectedReason: "状态账本存在冲突事实，已自动恢复逐章模式",
  },
  {
    name: "requires five consecutive chapter numbers",
    mutate: (project) => { project.chapters[4].number = 6; },
    expectedReason: "需要从当前章开始预先建立连续五章及其章纲",
  },
  {
    name: "requires every selected chapter to stay in batch mode",
    mutate: (project) => { project.chapters[2].batchMode = "逐章"; },
    expectedReason: "第3章处于逐章模式",
  },
  {
    name: "blocks key chapters",
    mutate: (project) => { project.chapters[1].isKeyChapter = true; },
    expectedReason: "第2章是关键章，必须逐章审批",
  },
  {
    name: "blocks volume boundaries",
    mutate: (project) => {
      project.plans = [{
        id: "volume-1",
        kind: "分卷",
        title: "第一卷",
        ordinal: 1,
        goal: "建立规则",
        conflict: "资源不足",
        outcome: "进入下一阶段",
        targetWords: 12_500,
        status: "已批准",
        parentId: null,
      } satisfies PlanNode];
    },
    expectedReason: "第1章位于卷首或卷末，必须逐章审批",
  },
  {
    name: "blocks major state changes",
    mutate: (project) => { project.chapters[3].outline = "主角身份揭露"; },
    expectedReason: "第4章包含重大状态变化，必须逐章审批",
  },
  {
    name: "blocks active hard issues",
    mutate: (project) => {
      project.issues = [{
        id: "issue-1",
        projectId: project.summary.id,
        chapterId: "chapter-2",
        severity: "硬性",
        category: "连续性",
        message: "事实冲突",
        evidence: "",
        status: "待处理",
        createdAt: timestamp,
      } satisfies QualityIssue];
    },
    expectedReason: "第2章有未解决的硬性告警",
  },
  {
    name: "requires every outline",
    mutate: (project) => { project.chapters[2].outline = "  "; },
    expectedReason: "第3章尚未填写章纲",
  },
  {
    name: "blocks protected chapters",
    mutate: (project) => { project.chapters[1].status = "已定稿"; },
    expectedReason: "第2章已经定稿或进入发布流程",
  },
  {
    name: "blocks hard pre-writing constraints",
    mutate: (project) => {
      project.facts = [
        createFact("place-1", "医院"),
        createFact("place-2", "车站"),
      ];
    },
    expectedReason: "第1章写前约束失败：林舟 的“所在地点”在第1章同时存在多个已确认值",
  },
];

describe("chapter batch service", () => {
  it.each(gateCases)("$name", ({ chapterId, expectedReason, mutate }) => {
    const project = createProject();
    mutate?.(project);
    const estimateInputTokens = vi.fn(() => 100);

    const preview = buildChapterBatchPreview(
      project,
      { inputPricePerMillion: 2, outputPricePerMillion: 4 },
      chapterId ?? "chapter-1",
      estimateInputTokens,
    );

    expect(preview.canRun).toBe(false);
    expect(preview.blockingReason).toBe(expectedReason);
    expect(preview.inputTokens).toBe(0);
    expect(preview.outputTokens).toBe(0);
    expect(preview.estimatedCost).toBe(0);
    expect(estimateInputTokens).not.toHaveBeenCalled();
  });

  it("returns a priced preview after all shared gates pass", () => {
    const project = createProject();
    const estimateInputTokens = vi.fn(() => 100);

    const preview = buildChapterBatchPreview(
      project,
      { inputPricePerMillion: 2, outputPricePerMillion: 4 },
      "chapter-1",
      estimateInputTokens,
    );

    expect(preview).toMatchObject({
      canRun: true,
      blockingReason: null,
      inputTokens: 500,
      outputTokens: 10_400,
      chapters: project.chapters.map(({ id, number, title }) => ({
        id,
        number,
        title,
      })),
    });
    expect(preview.estimatedCost).toBeCloseTo(0.0426);
    expect(estimateInputTokens).toHaveBeenCalledTimes(5);
  });
});
