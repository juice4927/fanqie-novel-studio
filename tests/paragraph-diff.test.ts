import { describe, expect, it } from "vitest";
import { diffParagraphs } from "../src/shared/paragraph-diff";

describe("paragraph diff", () => {
  it("marks inserted, removed and unchanged paragraphs in reading order", () => {
    const result = diffParagraphs("第一段\n\n旧第二段\n\n结尾", "第一段\n\n新第二段\n\n结尾\n\n新增尾声");
    expect(result).toEqual([
      { kind: "未变", text: "第一段" },
      { kind: "新增", text: "新第二段" },
      { kind: "删除", text: "旧第二段" },
      { kind: "未变", text: "结尾" },
      { kind: "新增", text: "新增尾声" },
    ]);
  });
});
