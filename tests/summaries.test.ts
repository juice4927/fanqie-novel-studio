import { describe, expect, it } from "vitest";
import {
  aggregateStorySummaries,
  buildChapterSummary,
  buildLongTermMemory,
  prepareFinalizedChapterSummaries,
} from "../src/shared/summaries";
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

  it("keeps book, current volume and recent stages in a bounded long-term memory", () => {
    const summary = (id: string, layer: StorySummary["layer"], fromChapter: number, toChapter: number, content: string): StorySummary => ({ id, layer, title: id, fromChapter, toChapter, content, version: 1, updatedAt: new Date().toISOString() });
    const summaries = [
      summary("book", "全书", 1, 500, `核心终局与身份秘密。${"全书状态".repeat(900)}`),
      summary("volume", "分卷", 401, 600, `当前卷目标：夺回北仓。${"分卷状态".repeat(700)}`),
      ...Array.from({ length: 50 }, (_, index) => summary(`stage-${index}`, "十章阶段", index * 10 + 1, index * 10 + 10, `阶段${index}：${"变化".repeat(400)}`)),
    ];
    const result = buildLongTermMemory(summaries, 505, 12000);
    expect(result).toContain("【全书进展】");
    expect(result).toContain("核心终局与身份秘密");
    expect(result).toContain("当前卷目标：夺回北仓");
    expect(result).toContain("近期阶段 491-500");
    expect(result).not.toContain("近期阶段 11-20");
    expect(result.length).toBeLessThanOrEqual(12000);
  });

  it("prepares versioned layered summaries without mutating project state", () => {
    const current = chapter(
      "林舟获得门禁卡。\n\n真正的密码仍未找到，巡逻队即将抵达！",
    );
    const existing: StorySummary[] = [
      {
        id: `chapter:${current.id}`,
        layer: "章节",
        title: "旧章节摘要",
        fromChapter: 1,
        toChapter: 1,
        content: "旧内容",
        version: 2,
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "stage:1",
        layer: "十章阶段",
        title: "旧阶段摘要",
        fromChapter: 1,
        toChapter: 1,
        content: "旧内容",
        version: 4,
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "book",
        layer: "全书",
        title: "旧全书摘要",
        fromChapter: 1,
        toChapter: 1,
        content: "旧内容",
        version: 7,
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ];
    const project = {
      chapters: [current],
      plans: [{
        id: "volume-1",
        kind: "分卷" as const,
        title: "第一卷",
        ordinal: 1,
        goal: "取得第一份证据",
        conflict: "封锁升级",
        outcome: "进入旧城",
        targetWords: 150_000,
        status: "已批准" as const,
        parentId: null,
      }],
      summaries: existing,
    };
    const snapshot = structuredClone(project);

    const updates = prepareFinalizedChapterSummaries(
      project,
      current,
      "2026-07-31T00:00:00.000Z",
    );

    expect(updates.map((item) => item.layer)).toEqual([
      "场景",
      "场景",
      "章节",
      "十章阶段",
      "分卷",
      "全书",
    ]);
    expect(updates.find((item) => item.layer === "章节")?.version).toBe(3);
    expect(updates.find((item) => item.layer === "十章阶段")?.version).toBe(5);
    expect(updates.find((item) => item.layer === "全书")?.version).toBe(8);
    expect(updates.find((item) => item.layer === "分卷")?.content)
      .toContain("取得第一份证据");
    expect(project).toEqual(snapshot);
  });
});
