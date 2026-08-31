import { describe, expect, it } from "vitest";
import { qualityCheck } from "../electron/worker";
import type { Chapter, StoryContract } from "../src/shared/types";

const chapter = (number: number, expectedPayoff: string): Chapter => ({
  id: `chapter-${number}`,
  number,
  title: `第${number}章`,
  outline: `目标：推进；反馈：围观震惊后获得现实资源`,
  content: "主角完成了行动，局势发生变化！",
  wordCount: 1600,
  status: "待质检",
  batchMode: "逐章",
  isKeyChapter: false,
  expectedPayoff,
  revision: 1,
  updatedAt: new Date().toISOString(),
});

const contract: StoryContract = {
  premise: "能力进入现实",
  protagonistDesire: "改变处境",
  readerPromise: "规则成长",
  coreEmotion: "获得感",
  ending: "完成选择",
  immutableRules: [],
  prohibitedPatterns: [],
  version: 1,
  approved: true,
  updatedAt: new Date().toISOString(),
};

describe("genre-specific local quality checks", () => {
  it("detects repeated genre payoff mechanisms across recent chapters", () => {
    const current = chapter(4, "围观震惊并打脸");
    const issues = qualityCheck({
      projectId: "project",
      chapter: current,
      previousChapter: chapter(3, "围观震惊"),
      recentChapters: [chapter(2, "围观震惊"), chapter(3, "打脸围观")],
      facts: [],
      contract,
      genre: "都市脑洞",
      originalityMatches: [],
    });
    expect(issues.some((issue) => issue.category === "重复疲劳" && issue.message.includes("震惊循环"))).toBe(true);
  });

  it("warns when a long chapter reads like a disembodied report", () => {
    const current = chapter(5, "核清田亩差额");
    current.content = "沈青禾翻开田册，逐项核对田亩与户数，随后把结果记入新册。".repeat(70);
    current.wordCount = current.content.length;

    const issues = qualityCheck({
      projectId: "project",
      chapter: current,
      recentChapters: [],
      facts: [],
      contract,
      genre: "玄幻/仙侠",
      originalityMatches: [],
    });

    expect(issues.some((issue) => issue.category === "叙事温度" && issue.severity === "警告")).toBe(true);
  });
});
