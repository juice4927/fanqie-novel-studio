import { describe, expect, it } from "vitest";
import { prepareScheduleSave } from "../src/shared/schedule-service";
import type { Chapter, QualityIssue, ScheduleItem } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function chapter(status: Chapter["status"] = "已定稿"): Chapter {
  return {
    id: "chapter-1",
    number: 7,
    title: "真实标题",
    outline: "推进冲突",
    content: "正文",
    wordCount: 2,
    status,
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 4,
    updatedAt: timestamp,
  };
}

function schedule(status: ScheduleItem["status"] = "待发布"): ScheduleItem {
  return {
    id: "",
    projectId: "forged-project",
    projectTitle: "伪造书名",
    chapterId: "chapter-1",
    chapterNumber: 999,
    chapterTitle: "伪造标题",
    publishAt: "2026-08-01T08:00:00.000Z",
    status,
  };
}

function prepare(candidate: ScheduleItem, currentChapter: Chapter | undefined, issues: QualityIssue[] = []) {
  return prepareScheduleSave(candidate, {
    scheduleId: candidate.id || "schedule-1",
    projectId: "project-1",
    projectTitle: "真实书名",
    chapter: currentChapter,
    issues,
  });
}

describe("schedule save rules", () => {
  it("rebuilds trusted fields and requests a real chapter transition", () => {
    const candidate = schedule();

    const plan = prepare(candidate, chapter());

    expect(plan).toEqual({
      schedule: {
        ...candidate,
        id: "schedule-1",
        projectId: "project-1",
        projectTitle: "真实书名",
        chapterId: "chapter-1",
        chapterNumber: 7,
        chapterTitle: "真实标题",
      },
      transitionTo: "待发布",
    });
    expect(candidate).toEqual(schedule());
  });

  it.each([
    ["待发布", "待发布"],
    ["已发布", "已发布"],
  ] as const)("does not repeat an existing %s chapter transition", (scheduleStatus, chapterStatus) => {
    expect(prepare(schedule(scheduleStatus), chapter(chapterStatus)).transitionTo).toBeNull();
  });

  it("allows a finalized chapter to remain waiting for scheduling", () => {
    expect(prepare(schedule("待排期"), chapter("已定稿")).transitionTo).toBeNull();
  });

  it("rejects invalid timestamps, missing chapters, and invalid jumps", () => {
    expect(() => prepare({ ...schedule(), publishAt: "2026-08-01T08:00:00" }, chapter())).toThrow("带时区");
    expect(() => prepare(schedule(), undefined)).toThrow("排期章节不存在");
    expect(() => prepare(schedule("已发布"), chapter("已定稿"))).toThrow("不允许");
    expect(() => prepare(schedule("待排期"), chapter("已发布"))).toThrow("只有已定稿或待发布章节可以安排发布");
  });

  it("applies unresolved hard-issue gates to publication transitions", () => {
    const hardIssue: QualityIssue = {
      id: "issue-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      severity: "硬性",
      category: "连续性",
      message: "事实冲突",
      evidence: "证据",
      status: "待处理",
      createdAt: timestamp,
    };

    expect(() => prepare(schedule(), chapter(), [hardIssue])).toThrow("未解决的硬性问题");
  });
});
