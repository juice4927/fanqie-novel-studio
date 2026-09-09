// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectModal } from "../src/components/NewProjectModal";
import type { IncubationDraft } from "../src/shared/incubation";
import type { AppApi, IncubationCandidate } from "../src/shared/types";

afterEach(cleanup);

const candidate = (id: string, title: string): IncubationCandidate =>
  ({
    id,
    title,
    premise: "主角用规则回收机解决现实困境。",
    genreSubtype: "系统成长",
    secondaryGenres: ["成长"],
    genreElements: ["现代都市"],
    openingMechanism: "旧货市场捡到规则回收机",
    growthCarrier: "规则组合",
    primaryPayoff: "解决现实困境",
    protagonistDesire: "查明规则来源",
    readerPromise: "持续提供规则试验与处境改变。",
    coreEmotion: "掌控感",
    ending: "重建街区秩序。",
    immutableRules: [],
    prohibitedPatterns: [],
    audience: "都市读者",
    commercialHook: "开局即改变处境。",
    longFormEngine: "三轮升级。",
    fanqieCategoryKey: "男频:262",
    subGenreIds: [],
    titleOptions: [],
    openingDesign: {
      chapter1Hook: "当天解决欠租危机。",
      firstThreeChaptersPromise: "前三章给出规则边界。",
      firstPayoffChapter: 2,
      retentionAnchors: [],
    },
    escalationLadder: [],
    sustainability: { fatiguePoint: "", shiftPlan: "" },
    differentiation: { against: [], originalityRisk: "低", referenceWorks: [] },
    suggestedTags: [],
  }) as unknown as IncubationCandidate;

const draft = (): IncubationDraft =>
  ({
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
      genreElements: ["现代都市"],
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
  }) as unknown as IncubationDraft;

describe("new project modal", () => {
  it("keeps generated candidates when a non-generation field changes", () => {
    const api = {
      getCategoryTags: vi.fn(async () => []),
      listInsights: vi.fn(async () => []),
      listProjectSignatures: vi.fn(async () => []),
      getRankingAnalytics: vi.fn(async () => ({ marketOpportunities: [] })),
    } as unknown as AppApi;
    render(
      <NewProjectModal
        api={api}
        initialDraft={draft()}
        onClose={vi.fn()}
        onCreated={vi.fn(async () => undefined)}
        notify={vi.fn()}
      />,
    );

    expect(screen.getByText("方案甲")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("安全存稿线"), { target: { value: "20" } });

    expect(screen.getByText("方案甲")).toBeTruthy();
    expect(screen.getByText("方案乙")).toBeTruthy();
  });
});
