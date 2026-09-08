import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import type { IncubationDraft } from "../src/shared/types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-09-08T00:00:00.000Z");
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const draft = (candidateId: string): IncubationDraft => ({
  id: "draft-1",
  status: "孵化中",
  step: "体检",
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
  candidates: [],
  selectedCandidateId: candidateId,
  skeleton: null,
  review: { acknowledged: [] },
  createdProjectId: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
});

describe("browser incubation workflow", () => {
  it("generates candidates with the full incubation surface", async () => {
    const api = createBrowserApi();
    const candidates = await api.generateBookConcepts({
      genre: "都市脑洞",
      fanqieCategoryKey: "男频:262",
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      updateCadence: "每日 2 章",
      seed: "",
    });
    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) {
      expect(candidate.fanqieCategoryKey).toBe("男频:262");
      expect(candidate.titleOptions.length).toBeGreaterThanOrEqual(3);
      expect(candidate.escalationLadder.length).toBeGreaterThanOrEqual(3);
      expect(candidate.openingDesign.firstPayoffChapter).toBeGreaterThan(0);
      expect(candidate.differentiation.against.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("persists drafts and promotes the selected candidate once", async () => {
    const api = createBrowserApi();
    const candidates = await api.generateBookConcepts({
      genre: "都市脑洞",
      fanqieCategoryKey: "男频:262",
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      updateCadence: "每日 2 章",
      seed: "",
    });
    const saved = await api.saveIncubation({
      ...draft(candidates[0].id),
      candidates,
    });
    expect(saved.candidates).toHaveLength(3);
    expect(await api.listIncubations()).toHaveLength(1);
    expect((await api.getIncubation(saved.id)).selectedCandidateId).toBe(candidates[0].id);

    const project = await api.promoteIncubation(saved.id);
    expect(project.title).toBe(candidates[0].title);
    const promoted = await api.getIncubation(saved.id);
    expect(promoted.status).toBe("已立项");
    expect(promoted.createdProjectId).toBe(project.id);
    await expect(api.promoteIncubation(saved.id)).rejects.toThrow("已经创建过作品");

    await api.deleteIncubation(saved.id);
    expect(await api.listIncubations()).toHaveLength(0);
  });

  it("generates the launch pack only after the contract is approved", async () => {
    const api = createBrowserApi();
    const created = await api.createProject({
      title: "开书包测试",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日 2 章",
    });
    await expect(api.generateLaunchPack(created.id, { withStructure: true, withFirstChapters: true })).rejects.toThrow(
      "必须先审批创作契约",
    );

    await api.saveContract(created.id, {
      ...(await api.getProject(created.id)).contract,
      premise: "主角在旧城开了一家回收异常规则的店。",
      readerPromise: "规则收益持续改变现实处境。",
      ending: "主角查明规则来源并重建街区秩序。",
      openingMechanism: "旧货市场捡到规则回收机",
      growthCarrier: "规则组合与代价管理",
      primaryPayoff: "用规则解决现实困境",
      longFormEngine: "单点规则、规则组合与规则来源三轮升级。",
      protagonistArc: "从只想止损到愿意承担规则代价。",
      keyRelationships: ["搭档", "对手"],
      worldRules: ["规则收益必有代价", "规则一旦成立不可改"],
      majorForces: ["规则商店", "回收组织"],
      timelineAnchors: ["捡到机器", "规则扩散", "来源揭露"],
    });
    await api.approveContract(created.id);

    const result = await api.generateLaunchPack(created.id, { withStructure: true, withFirstChapters: true });
    expect(result.plans).toBeGreaterThanOrEqual(6);
    expect(result.chapters).toBe(10);
    const detail = await api.getProject(created.id);
    expect(detail.plans.every((plan) => plan.status === "草稿")).toBe(true);
    expect(detail.chapters).toHaveLength(10);
    expect(detail.chapters.every((chapter) => chapter.status === "章纲")).toBe(true);
  });
});
