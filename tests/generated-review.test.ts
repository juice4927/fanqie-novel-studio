import { describe, expect, it } from "vitest";
import {
  canAcceptGeneratedDraft,
  hasMeaningfulDraft,
  summarizeDraftChange,
  summarizeQualityOverview,
} from "../src/shared/generated-review";

describe("generated draft review helpers", () => {
  it("reports character and paragraph deltas between previous and generated content", () => {
    const stats = summarizeDraftChange("旧的短稿", "新的正文段落。\n\n第二段补充内容。");
    expect(stats.previousCharacters).toBe(4);
    expect(stats.generatedCharacters).toBeGreaterThan(4);
    expect(stats.addedCharacters).toBe(stats.generatedCharacters - stats.previousCharacters);
    expect(stats.previousParagraphs).toBe(1);
    expect(stats.generatedParagraphs).toBe(2);
  });

  it("counts quality issues by severity and flags hard issues for human judgment", () => {
    const overview = summarizeQualityOverview([{ severity: "硬性" }, { severity: "警告" }, { severity: "建议" }]);
    expect(overview).toMatchObject({ hard: 1, warning: 1, suggestion: 1, total: 3, needsHumanJudgment: true });
    expect(summarizeQualityOverview([{ severity: "警告" }])).toMatchObject({
      hard: 0,
      needsHumanJudgment: false,
    });
  });

  it("only allows accepting a draft without hard issues", () => {
    expect(canAcceptGeneratedDraft([{ severity: "警告" }, { severity: "建议" }])).toBe(true);
    expect(canAcceptGeneratedDraft([{ severity: "硬性" }])).toBe(false);
  });

  it("treats very short output as not a meaningful draft", () => {
    expect(hasMeaningfulDraft("很短。")).toBe(false);
    expect(
      hasMeaningfulDraft(
        "这是一段用于判断是否为有效草稿的正文内容，需要足够长才能算作一章，因此重复到超过两百字符以确保判断正确。".repeat(
          6,
        ),
      ),
    ).toBe(true);
  });
});
