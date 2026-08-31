import { describe, expect, it } from "vitest";
import { applyContractRepairs, applyTextRepair, chapterRevisionSnapshot } from "../src/shared/novel-revision";
import type { Chapter, NovelContractRepair, StoryContract } from "../src/shared/types";

const chapter: Chapter = {
  id: "chapter-1",
  number: 1,
  title: "起点",
  outline: "主角进入车站",
  content: "他推开门。灯忽然亮了。",
  wordCount: 12,
  status: "草稿",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 3,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("novel revision safeguards", () => {
  it("applies array contract fields as trimmed lines", () => {
    const contract = {
      worldRules: ["旧规则"],
      version: 2,
      approved: true,
    } as StoryContract;
    const repair = {
      id: "contract:worldRules",
      field: "worldRules",
      label: "世界规则",
      before: "旧规则",
      after: "新规则一\n\n 新规则二 ",
      reason: "同步正文",
      risk: "高",
    } satisfies NovelContractRepair;
    expect(applyContractRepairs(contract, [repair]).worldRules).toEqual(["新规则一", "新规则二"]);
  });

  it("rejects a contract proposal when its source value changed", () => {
    const contract = { premise: "已经修改", version: 2, approved: true } as StoryContract;
    const repair = {
      id: "contract:premise",
      field: "premise",
      label: "故事前提",
      before: "原前提",
      after: "新前提",
      reason: "同步正文",
      risk: "高",
    } satisfies NovelContractRepair;
    expect(() => applyContractRepairs(contract, [repair])).toThrow("已变化");
  });

  it("replaces only the analyzed text range and rejects stale positions", () => {
    const start = chapter.content.indexOf("灯");
    const repair = {
      id: "text:chapter-1",
      targetId: chapter.id,
      baseRevision: 3,
      start,
      end: chapter.content.length,
      before: "灯忽然亮了。",
      after: "应急灯一盏盏亮起。",
      reason: "增强画面",
      risk: "低",
    } as const;
    expect(applyTextRepair(chapter, repair)).toBe("他推开门。应急灯一盏盏亮起。");
    expect(() => applyTextRepair({ ...chapter, content: "他推开门。四周仍然漆黑。" }, repair)).toThrow(
      "修改位置已变化",
    );
    expect(() =>
      applyTextRepair(chapter, {
        ...repair,
        start: chapter.content.length + 1,
        end: chapter.content.length + 1,
        before: "",
      }),
    ).toThrow("修改位置已变化");
  });

  it("creates stable editable chapter snapshots", () => {
    expect(chapterRevisionSnapshot(chapter)).toMatchObject({ title: "起点", outline: "主角进入车站" });
    expect(chapterRevisionSnapshot(chapter)).not.toHaveProperty("content");
  });
});
