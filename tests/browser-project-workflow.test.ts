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
