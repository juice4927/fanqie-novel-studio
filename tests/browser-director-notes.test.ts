import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

let storedState: string | null;

beforeEach(() => {
  storedState = null;
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => storedState),
    setItem: vi.fn((_key: string, value: string) => {
      storedState = value;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser director notes", () => {
  it("saves, reads, dedupes and prunes director notes per project", async () => {
    const api = createBrowserApi();
    const created = await api.createProject({
      title: "导演备注测试",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    await expect(api.getDirectorNotes(created.id)).resolves.toEqual([]);
    const saved = await api.saveDirectorNotes(created.id, ["开头别拖节奏", "别用“旋即”", "开头别拖节奏"]);
    expect(saved).toEqual(["开头别拖节奏", "别用“旋即”"]);
    await expect(api.getDirectorNotes(created.id)).resolves.toEqual(["开头别拖节奏", "别用“旋即”"]);
    // persisted across a reload of the demo state
    const reloaded = createBrowserApi();
    await expect(reloaded.getDirectorNotes(created.id)).resolves.toEqual(["开头别拖节奏", "别用“旋即”"]);
    await reloaded.saveDirectorNotes(created.id, ["开头别拖节奏"]);
    await expect(reloaded.getDirectorNotes(created.id)).resolves.toEqual(["开头别拖节奏"]);
  });
});

describe("browser generation quality tracking", () => {
  it("records accept/revert decisions and reports quality tier", async () => {
    const api = createBrowserApi();
    const created = await api.createProject({
      title: "质量跟踪测试",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    for (let index = 0; index < 9; index += 1)
      await api.recordGenerationDecision(created.id, `chapter-${index}`, "adopted");
    await api.recordGenerationDecision(created.id, "chapter-9", "reverted");
    const quality = await api.getGenerationQuality(created.id);
    expect(quality.total).toBe(10);
    expect(quality.adopted).toBe(9);
    expect(quality.reverted).toBe(1);
    expect(quality.tier).toBe("sample");
  });
});
