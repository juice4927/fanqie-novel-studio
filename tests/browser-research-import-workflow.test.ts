import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import type { ImportPreview } from "../src/shared/types";

const preview = {
  fileName: "sample.txt",
  sourceType: "TXT",
  detectedEncoding: "UTF-8",
  chapters: [],
  totalWords: 0,
  warnings: [],
} satisfies ImportPreview;

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

describe("browser research import workflow", () => {
  it("rejects private material until usage rights are confirmed", async () => {
    const api = createBrowserApi();
    const booksBefore = await api.listResearchBooks();

    await expect(
      api.importResearchBook(preview, "都市脑洞", false, false),
    ).rejects.toThrow("必须确认拥有材料的合法使用权");

    expect(await api.listResearchBooks()).toEqual(booksBefore);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("keeps local usage rights independent from cloud consent", async () => {
    const api = createBrowserApi();

    const imported = await api.importResearchBook(
      preview,
      "都市脑洞",
      true,
      false,
    );

    expect(imported).toMatchObject({
      rightsConfirmed: true,
      cloudConsent: false,
      status: "待拆解",
    });
    expect(await api.listResearchBooks()).toContainEqual(imported);
    expect(localStorage.setItem).toHaveBeenCalledOnce();
  });
});
