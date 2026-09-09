// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncubationWorkspace } from "../src/pages/IncubationWorkspace";
import type { IncubationDraft } from "../src/shared/incubation";
import type { AppApi, IncubationCandidate } from "../src/shared/types";

afterEach(cleanup);

const candidate = (id: string, title: string): IncubationCandidate => ({
  id,
  title,
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
    { title, rationale: "直接点出核心机制", tags: ["系统流", "都市"] },
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
    referenceWorks: [],
  },
  suggestedTags: ["系统流", "都市", "经营"],
});

const draft = (): IncubationDraft => ({
  id: "draft",
  status: "孵化中",
  step: "候选",
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
  candidates: [candidate("a", "方案甲"), candidate("b", "方案乙")],
  selectedCandidateId: "a",
  skeleton: null,
  review: { acknowledged: [] },
  createdProjectId: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
});

function createApi() {
  return {
    listProjectSignatures: vi.fn(async () => []),
    saveIncubation: vi.fn(async (next: IncubationDraft) => next),
    promoteIncubation: vi.fn(async () => ({ id: "project-1", title: "方案乙" })),
    deleteIncubation: vi.fn(async () => undefined),
  } as unknown as AppApi;
}

describe("incubation workspace", () => {
  it("keeps the switched candidate in local state and persists it on promote", async () => {
    const api = createApi();
    render(
      <IncubationWorkspace
        api={api}
        drafts={[draft()]}
        reload={vi.fn(async () => undefined)}
        notify={vi.fn()}
        onEdit={vi.fn()}
        onOpenProject={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const second = await screen.findByRole("button", { name: "方案乙" });
    fireEvent.click(second);

    await waitFor(() => expect(second.className).toContain("selected"));
    expect(api.saveIncubation).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCandidateId: "b", review: { acknowledged: [] } }),
    );

    const promote = screen.getByRole("button", { name: "采用并创建作品" }) as HTMLButtonElement;
    expect(promote.disabled).toBe(false);
    fireEvent.click(promote);

    await waitFor(() => expect(api.promoteIncubation).toHaveBeenCalledWith("draft"));
    expect(api.saveIncubation).toHaveBeenLastCalledWith(expect.objectContaining({ selectedCandidateId: "b" }));
  });
});
