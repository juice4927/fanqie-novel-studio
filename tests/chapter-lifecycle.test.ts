import { describe, expect, it } from "vitest";
import {
  assertChapterTransition,
  deriveChapterStatus,
  findMatchingApproval,
  isProtectedChapterEdit,
} from "../src/shared/chapter-lifecycle";
import type { Chapter, ChangeRequest, QualityIssue } from "../src/shared/types";

const chapter = (status: Chapter["status"], content = "正文"): Chapter => ({
  id: "chapter-1", number: 1, title: "第一章", outline: "目标：推进", content,
  wordCount: content.length, status, batchMode: "逐章", isKeyChapter: false,
  revision: 3, updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("shared chapter lifecycle", () => {
  it("derives editing status without accepting status injection", () => {
    expect(deriveChapterStatus(undefined, chapter("已发布"))).toBe("草稿");
    expect(deriveChapterStatus(chapter("章纲", ""), chapter("已发布"))).toBe("草稿");
    expect(deriveChapterStatus(chapter("待质检"), chapter("待质检", "修改正文"))).toBe("草稿");
    expect(deriveChapterStatus(chapter("已定稿"), chapter("已定稿", "修改正文"), { protectedEdit: true })).toBe("待质检");
  });

  it("enforces ordered transitions and unresolved hard issue gates", () => {
    expect(() => assertChapterTransition("草稿", "已定稿", "chapter-1", [])).toThrow("不允许");
    const issue: QualityIssue = {
      id: "issue-1", projectId: "project-1", chapterId: "chapter-1", severity: "硬性",
      category: "设定", message: "冲突", evidence: "正文", status: "待处理", createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => assertChapterTransition("待质检", "待定稿", "chapter-1", [issue])).toThrow("硬性问题");
    expect(() => assertChapterTransition("草稿", "待质检", "chapter-1", [issue])).not.toThrow();
  });

  it("detects protected field changes and binds approvals to target versions", () => {
    const previous = chapter("已定稿");
    expect(isProtectedChapterEdit(previous, { ...previous, outline: "新章纲" })).toBe(true);
    expect(isProtectedChapterEdit(previous, { ...previous, updatedAt: "later" })).toBe(false);
    const approval: ChangeRequest = {
      id: "change-1", targetKind: "章节", targetId: previous.id, baseVersion: previous.revision,
      title: "修改", reason: "复核", beforeValue: "旧", afterValue: "新", impact: "本章",
      rollback: "恢复", status: "已批准", createdAt: previous.updatedAt,
    };
    expect(findMatchingApproval([approval], "章节", previous.id, 3)).toBe(approval);
    expect(findMatchingApproval([approval], "章节", previous.id, 4)).toBeUndefined();
  });
});
