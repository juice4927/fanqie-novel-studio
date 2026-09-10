import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-31T00:00:00.000Z");
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

describe("browser project workflow", () => {
  it("creates all planning levels through the last chapter and waits for author approval", async () => {
    const api = createBrowserApi();
    const input = {
      genre: "都市脑洞" as const,
      targetWords: 82_500,
      wordsPerChapter: 2500,
      updateCadence: "每日一章",
      seed: "职业调查",
    };
    const [concept] = await api.generateBookConcepts(input);
    const created = await api.createProjectFromConcept(input, concept);
    const draft = await api.getProject(created.id);
    expect(draft.chapters).toHaveLength(33);
    expect(new Set(draft.plans.map((plan) => plan.kind))).toEqual(
      new Set(["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"]),
    );
    expect(draft.plans.every((plan) => plan.status === "草稿")).toBe(true);
    expect(draft.contract.approved).toBe(false);
    expect(draft.chapters.every((chapter) => !chapter.content)).toBe(true);
    const resumed = await api.generateLaunchPack(created.id);
    expect(resumed.chapters).toBe(33);
    expect(resumed.plans).toBe(draft.plans.length);
    await api.approveLaunchPack(created.id);
    const approved = await api.getProject(created.id);
    expect(approved.contract.approved).toBe(true);
    expect(approved.plans.every((plan) => plan.status === "已批准")).toBe(true);
    expect(approved.launchPack?.status).toBe("已确认");
    expect(approved.chapters.every((chapter) => chapter.status === "章纲")).toBe(true);
  });

  it("uses shared creation defaults and update normalization", async () => {
    const api = createBrowserApi();
    const created = await api.createProject({
      title: "  新项目  ",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "  每日 1 章  ",
    });
    const detail = await api.getProject(created.id);

    expect(created).toMatchObject({
      title: "新项目",
      updateCadence: "每日 1 章",
      safeStockLine: 10,
    });
    expect(detail.contract).toMatchObject({
      audience: "",
      commercialHook: "",
      protagonistArc: "",
      majorStateChanges: { include: [], exclude: [] },
    });

    const updatedAt = "2026-08-01T00:00:00.000Z";
    vi.setSystemTime(updatedAt);
    const updated = await api.updateProject(created.id, {
      title: "   ",
      updateCadence: "  每周 5 章  ",
      safeStockLine: 15,
    });

    expect(updated).toMatchObject({
      title: "新项目",
      updateCadence: "每周 5 章",
      safeStockLine: 15,
      updatedAt,
    });
  });
});
