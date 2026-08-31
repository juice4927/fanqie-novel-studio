import { describe, expect, it } from "vitest";
import { prepareProjectCreation, prepareProjectUpdate } from "../src/shared/project-service";

const timestamp = "2026-07-31T00:00:00.000Z";

function creation(overrides = {}) {
  return prepareProjectCreation(
    {
      title: "  旧城回声  ",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "  每日 2 章  ",
      secondaryGenres: ["悬疑"],
      genreElements: ["探案"],
      ...overrides,
    },
    { projectId: "project-1", updatedAt: timestamp },
  );
}

describe("project preparation rules", () => {
  it("normalizes creation metadata and builds a complete contract", () => {
    const prepared = creation();

    expect(prepared.summary).toMatchObject({
      id: "project-1",
      title: "旧城回声",
      updateCadence: "每日 2 章",
      safeStockLine: 10,
      currentWords: 0,
      chapterCount: 0,
      updatedAt: timestamp,
    });
    expect(prepared.contract).toMatchObject({
      audience: "",
      commercialHook: "",
      protagonistArc: "",
      secondaryGenres: ["悬疑"],
      genreElements: ["探案"],
      majorStateChanges: { include: [], exclude: [] },
      approved: false,
      version: 1,
      updatedAt: timestamp,
    });
  });

  it.each([
    [{ title: "   " }, "作品名称不能为空"],
    [{ updateCadence: "   " }, "更新频率不能为空"],
    [{ targetWords: 9_999 }, "目标字数"],
    [{ safeStockLine: 1_001 }, "安全存稿线"],
  ])("rejects invalid creation metadata", (overrides, message) => {
    expect(() => creation(overrides)).toThrow(message as string);
  });

  it("normalizes patches while preserving blank protected values", () => {
    const current = creation().summary;
    const updated = prepareProjectUpdate(
      current,
      {
        title: "   ",
        updateCadence: "  每周 5 章  ",
        safeStockLine: 15,
        status: "连载准备",
      },
      "2026-08-01T00:00:00.000Z",
    );

    expect(updated).toMatchObject({
      title: current.title,
      updateCadence: "每周 5 章",
      safeStockLine: 15,
      status: "连载准备",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(current.updatedAt).toBe(timestamp);
  });
});
