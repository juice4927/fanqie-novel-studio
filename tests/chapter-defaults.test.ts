import { describe, expect, it } from "vitest";
import { inheritChapterDefaults, previousEndingExpectation } from "../src/lib/chapter-defaults";
import type { Chapter } from "../src/shared/types";

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: "chapter-1",
  number: 1,
  title: "",
  outline: "",
  content: "",
  wordCount: 0,
  status: "章纲",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 0,
  updatedAt: "2026-09-08T00:00:00.000Z",
  ...overrides,
});

describe("inheritChapterDefaults", () => {
  it("沿用上一章的目标字数和章节功能", () => {
    const previous = chapter({ number: 3, targetWords: 2600, chapterFunction: "揭秘" });
    const next = inheritChapterDefaults(chapter({ number: 4 }), [previous]);
    expect(next.targetWords).toBe(2600);
    expect(next.chapterFunction).toBe("揭秘");
  });

  it("没有上一章时保持新章原样", () => {
    const next = inheritChapterDefaults(chapter({ number: 1 }), []);
    expect(next.targetWords).toBeUndefined();
    expect(next.chapterFunction).toBeUndefined();
  });

  it("不覆盖新章已有的显式设置", () => {
    const previous = chapter({ number: 1, targetWords: 2600, chapterFunction: "揭秘" });
    const next = inheritChapterDefaults(chapter({ number: 2, targetWords: 1800, chapterFunction: "过渡" }), [previous]);
    expect(next.targetWords).toBe(1800);
    expect(next.chapterFunction).toBe("过渡");
  });
});

describe("previousEndingExpectation", () => {
  it("返回上一章的结尾期待并去掉首尾空白", () => {
    const previous = chapter({ number: 2, endingExpectation: "  主角欠下人情  " });
    expect(previousEndingExpectation(chapter({ number: 3 }), [previous])).toBe("主角欠下人情");
  });

  it("上一章没有结尾期待时返回空串", () => {
    expect(previousEndingExpectation(chapter({ number: 3 }), [chapter({ number: 2 })])).toBe("");
  });

  it("只认紧邻的上一章", () => {
    const earlier = chapter({ number: 1, endingExpectation: "旧期待" });
    expect(previousEndingExpectation(chapter({ number: 3 }), [earlier])).toBe("");
  });
});
