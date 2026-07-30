import { describe, expect, it } from "vitest";
import { aggregateStorySummaries, buildChapterSummary } from "../src/shared/summaries";
import type { Chapter, StorySummary } from "../src/shared/types";

function chapter(content: string): Chapter {
  return {
    id: "chapter-1", number: 1, title: "停电后的线索",
    outline: "目标：找到失踪的维修员；冲突：封锁区禁止进入；结果：取得门禁卡。",
    content, wordCount: content.length, status: "已定稿", batchMode: "逐章",
    isKeyChapter: false, revision: 2, updatedAt: new Date().toISOString(),
  };
}

describe("structured story summaries", () => {
  it("keeps outcomes, state changes, open loops and ending momentum", () => {
    const result = buildChapterSummary(chapter(
      "林舟决定潜入封锁区。他获得了旧门禁卡，却发现维修员留下的线索。真正的开门密码仍未找到，巡逻队即将抵达！",
    ));
    expect(result).toContain("目标：找到失踪的维修员");
    expect(result).toContain("冲突：封锁区禁止进入");
    expect(result).toContain("结果：取得门禁卡");
    expect(result).toMatch(/状态变化：.*获得/);
    expect(result).toMatch(/未解决事项：.*仍未找到/);
    expect(result).toContain("章末推进：");
  });

  it("uses the newest actionable summaries within a fixed context budget", () => {
    const summaries: StorySummary[] = Array.from({ length: 8 }, (_, index) => ({
      id: `chapter:${index + 1}`, layer: "章节", title: `第${index + 1}章`,
      fromChapter: index + 1, toChapter: index + 1,
      content: `目标：推进\n结果：结果${index + 1}\n状态变化：状态${index + 1}\n未解决事项：问题${index + 1}\n章末推进：推进${index + 1}`,
      version: 1, updatedAt: new Date().toISOString(),
    }));
    const result = aggregateStorySummaries(summaries, 220);
    expect(result).toContain("第8章");
    expect(result).toContain("问题8");
    expect(result.length).toBeLessThanOrEqual(220);
  });
});
