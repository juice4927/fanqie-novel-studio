import { describe, expect, it } from "vitest";
import { getFanqieCategoryProfile, getFanqieSubGenreProfile } from "../src/shared/fanqie-taxonomy";
import {
  acknowledgeFinding,
  advanceIncubationStep,
  type IncubationDraft,
  missingIncubationFields,
  positioningToConceptInput,
  selectCandidate,
  toIncubationSummary,
} from "../src/shared/incubation";
import {
  blockingFindings,
  canPromote,
  reviewIncubationCandidate,
  summarizeFindings,
} from "../src/shared/incubation-review";
import type { IncubationCandidate } from "../src/shared/types";

const category = getFanqieCategoryProfile("男频:262")!;

const candidate = (overrides: Partial<IncubationCandidate> = {}): IncubationCandidate => ({
  id: "candidate",
  title: "规则回收站",
  premise: "主角在旧货市场捡到一台能回收异常规则的机器，用来解决城市里的现实困境。",
  genreSubtype: "系统成长",
  secondaryGenres: ["成长", "冒险"],
  genreElements: ["现代都市", "系统"],
  openingMechanism: "旧货市场捡到规则回收机",
  growthCarrier: "规则组合与代价管理",
  primaryPayoff: "用规则解决现实困境并改变处境",
  protagonistDesire: "查明规则来源并守住自己的小店",
  readerPromise: "持续提供规则试验、处境改变与关系变化的回报。",
  coreEmotion: "清醒的掌控感",
  ending: "主角查明规则来源，用规则重建小店与街区秩序。",
  immutableRules: ["规则收益必须付出代价", "规则一旦成立不可更改"],
  prohibitedPatterns: ["围观震惊替代结果", "规则临时改写"],
  audience: "偏好快节奏与强钩子的都市读者",
  commercialHook: "旧货市场开局，规则收益立刻改变现实处境。",
  longFormEngine: "单点规则、规则组合与规则来源三轮升级。",
  fanqieCategoryKey: "男频:262",
  subGenreIds: [],
  titleOptions: [
    { title: "规则回收站", rationale: "直接点出核心机制", tags: ["系统流", "都市"] },
    { title: "我在旧货市场修规则", rationale: "突出身份与反差", tags: ["系统流", "脑洞"] },
    { title: "异常规则收购指南", rationale: "强调经营感", tags: ["系统流", "经营"] },
  ],
  openingDesign: {
    chapter1Hook:
      "主角在旧货市场买到一台能回收异常规则的机器，当天就用它解决了小店的欠租危机，但机器记下了他的一笔代价。",
    firstThreeChaptersPromise: "前三章给出规则边界、代价和第一个现实收益。",
    firstPayoffChapter: 2,
    retentionAnchors: ["规则来源是什么", "代价会怎么结算", "谁在追踪这台机器"],
  },
  escalationLadder: [
    {
      stage: "单点规则",
      conflict: "规则只解决一次困境",
      expansionAxis: "资源",
      payoff: "解决欠租危机",
      cost: "留下一笔未结代价",
    },
    {
      stage: "规则组合",
      conflict: "组合规则互相冲突",
      expansionAxis: "关系",
      payoff: "建立稳定的规则生意",
      cost: "与合作者产生分歧",
    },
    {
      stage: "规则来源",
      conflict: "规则开始反噬",
      expansionAxis: "规则",
      payoff: "查明来源并重写规则",
      cost: "失去部分记忆",
    },
  ],
  sustainability: { fatiguePoint: "连续两轮只换规则名词", shiftPlan: "把回报从个人收益升级为关系与秩序变化" },
  differentiation: {
    against: ["代价当场结算而非延后", "对手也研究规则", "回报改变关系而非只改数字"],
    originalityRisk: "低",
    riskNotes: "原创机制。",
  },
  suggestedTags: ["系统流", "脑洞", "都市", "经营"],
  ...overrides,
});

const review = (overrides: Partial<IncubationCandidate> = {}, skeleton: null = null) =>
  reviewIncubationCandidate({
    candidate: candidate(overrides),
    targetWords: 1_000_000,
    wordsPerChapter: 2500,
    genreElements: candidate(overrides).genreElements,
    category,
    subGenres: [],
    skeleton,
    tagStats: category.tags,
  });

describe("incubation review", () => {
  it("passes a well-formed candidate without blocking findings", () => {
    const findings = review();
    expect(findings.every((item) => item.level !== "阻断")).toBe(true);
    expect(canPromote(findings, [])).toBe(true);
  });

  it("blocks when the escalation ladder cannot carry the target length", () => {
    const findings = review({ escalationLadder: candidate().escalationLadder.slice(0, 2) });
    const blocking = blockingFindings(findings, []);
    expect(blocking.map((item) => item.id)).toContain("escalation-ladder");
    expect(canPromote(findings, [])).toBe(false);
  });

  it("blocks a late first payoff and clears it after human acknowledgement", () => {
    const findings = review({
      openingDesign: { ...candidate().openingDesign, firstPayoffChapter: 12 },
    });
    const blocking = blockingFindings(findings, []);
    expect(blocking.map((item) => item.id)).toContain("first-payoff-window");
    expect(canPromote(findings, ["first-payoff-window"])).toBe(true);
  });

  it("blocks mutually exclusive elements and high originality risk", () => {
    const findings = review({
      genreElements: ["无CP", "先婚后爱"],
      differentiation: { ...candidate().differentiation, originalityRisk: "高" },
    });
    const ids = blockingFindings(findings, []).map((item) => item.id);
    expect(ids).toContain("element-overload");
    expect(ids).toContain("originality-risk");
  });

  it("warns on vague opening hooks and non-actionable desires", () => {
    const findings = review({
      openingDesign: { ...candidate().openingDesign, chapter1Hook: "主角觉醒命运之力。" },
      protagonistDesire: "成为一个厉害的人。",
    });
    const ids = findings.filter((item) => item.level === "警告").map((item) => item.id);
    expect(ids).toContain("opening-concrete");
    expect(ids).toContain("protagonist-desire");
  });

  it("only reports contract completeness once the skeleton exists", () => {
    expect(review().find((item) => item.id === "contract-complete")?.level).toBe("提示");
    const withSkeleton = review({}, null);
    expect(withSkeleton.find((item) => item.id === "contract-complete")?.level).toBe("提示");
    const incomplete = reviewIncubationCandidate({
      candidate: candidate(),
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      genreElements: candidate().genreElements,
      category,
      skeleton: {
        protagonistArc: "弧光",
        keyRelationships: ["关系一"],
        worldRules: ["规则一"],
        majorForces: ["势力一"],
        timelineAnchors: ["锚点一"],
      },
    });
    expect(incomplete.find((item) => item.id === "contract-complete")?.level).toBe("阻断");
  });

  it("warns when the opening collides with a sibling category", () => {
    const findings = review({ openingMechanism: "首章给出可复核异常证据" });
    const warning = findings.find((item) => item.id === "sibling-confusion");
    expect(warning?.level).toBe("警告");
    expect(warning?.detail).toContain("悬疑脑洞");
  });

  it("warns when an existing project already uses the same premise", () => {
    const findings = reviewIncubationCandidate({
      candidate: candidate(),
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      genreElements: candidate().genreElements,
      category,
      existingContracts: [
        { title: "旧作", premise: candidate().premise, openingMechanism: candidate().openingMechanism },
      ],
    });
    const warning = findings.find((item) => item.id === "homogeneity");
    expect(warning?.level).toBe("警告");
    expect(warning?.detail).toContain("旧作");
  });

  it("summarizes findings by level", () => {
    const summary = summarizeFindings(review());
    expect(summary.blocked).toBe(0);
    expect(summary.passed).toBeGreaterThan(0);
  });
});

describe("incubation draft", () => {
  const draft = (): IncubationDraft => ({
    id: "draft",
    status: "孵化中",
    step: "定位",
    positioning: {
      genre: "都市脑洞",
      fanqieCategoryKey: "男频:262",
      subGenreIds: [],
      openingArchetype: "系统降临",
      lengthShape: "长线连续",
      narrativePerson: "第三人称限知",
      protagonistRoles: ["店主/创业者"],
      toneTags: ["热血"],
      secondaryGenres: ["成长"],
      genreElements: ["现代都市", "系统"],
      customGenreDirection: "",
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      updateCadence: "每日 2 章",
      safeStockLine: 10,
      readerPersona: "18–35 岁",
      readerPromise: "规则改写现实",
      commercialBoundary: "",
    },
    evidence: { insightIds: [], marketOpportunityKeys: [], categoryTags: [], skipped: true },
    seed: "",
    candidates: [candidate()],
    selectedCandidateId: null,
    skeleton: null,
    review: { acknowledged: [] },
    createdProjectId: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  });

  it("requires category, target words and cadence before generating", () => {
    expect(missingIncubationFields(draft().positioning)).toEqual([]);
    expect(
      missingIncubationFields({ ...draft().positioning, fanqieCategoryKey: "", targetWords: 0, updateCadence: "" }),
    ).toEqual(["番茄分类", "目标字数", "更新节奏"]);
  });

  it("builds a concept input from positioning and seed", () => {
    const input = positioningToConceptInput(draft().positioning, "灵感");
    expect(input).toMatchObject({
      genre: "都市脑洞",
      fanqieCategoryKey: "男频:262",
      openingArchetype: "系统降临",
      wordsPerChapter: 2500,
      seed: "灵感",
    });
  });

  it("resets skeleton and review acknowledgements when a new candidate is selected", () => {
    const next = selectCandidate(
      { ...draft(), review: { acknowledged: ["category-taboo"] }, skeleton: candidate() as never },
      "candidate",
      "2026-09-08T01:00:00.000Z",
    );
    expect(next.selectedCandidateId).toBe("candidate");
    expect(next.review.acknowledged).toEqual([]);
    expect(next.skeleton).toBeNull();
  });

  it("records acknowledgements once and advances steps", () => {
    const once = acknowledgeFinding(draft(), "category-taboo", "2026-09-08T01:00:00.000Z");
    const twice = acknowledgeFinding(once, "category-taboo", "2026-09-08T02:00:00.000Z");
    expect(twice.review.acknowledged).toEqual(["category-taboo"]);
    expect(advanceIncubationStep(twice, "候选", "2026-09-08T02:00:00.000Z").step).toBe("候选");
  });

  it("summarizes a draft for the draft list", () => {
    const summary = toIncubationSummary({ ...draft(), selectedCandidateId: "candidate" }, category.name);
    expect(summary).toMatchObject({ title: "规则回收站", categoryName: "都市脑洞", candidateCount: 1 });
  });
});

describe("subgenre lookup", () => {
  it("resolves a subgenre by id", () => {
    const subGenre = getFanqieSubGenreProfile("m-eastern-fantasy");
    expect(subGenre?.name).toBe("东方玄幻");
    expect(subGenre?.parentCategoryKeys).toEqual(["男频:258"]);
  });
});
