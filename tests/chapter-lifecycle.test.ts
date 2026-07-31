import { describe, expect, it } from "vitest";
import {
  assertChapterTransition,
  deriveChapterBatchMode,
  deriveChapterStatus,
  findMatchingApproval,
  isProtectedChapterEdit,
  prepareChapterSave,
} from "../src/shared/chapter-lifecycle";
import type {
  Chapter,
  ChangeRequest,
  LedgerFact,
  PlanNode,
  QualityIssue,
} from "../src/shared/types";

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
    const earlier = { ...approval, id: "earlier", createdAt: "2025-12-31T00:00:00.000Z" };
    const changes = [approval, earlier];
    expect(findMatchingApproval(changes, "章节", previous.id, 3)).toBe(earlier);
    expect(changes).toEqual([approval, earlier]);
  });

  it("derives one-chapter mode from every project-level gate", () => {
    const candidate = {
      ...chapter("章纲", ""),
      number: 2,
      batchMode: "五章批次" as const,
    };
    const context = {
      facts: [] as LedgerFact[],
      issues: [] as QualityIssue[],
      plans: [] as PlanNode[],
      genre: "都市脑洞" as const,
      majorStateChanges: { include: [], exclude: [] },
    };
    expect(deriveChapterBatchMode(candidate, context)).toBe("五章批次");
    expect(deriveChapterBatchMode({ ...candidate, isKeyChapter: true }, context)).toBe("逐章");
    expect(deriveChapterBatchMode(candidate, {
      ...context,
      facts: [{
        id: "fact-1", kind: "地点", subject: "林舟", predicate: "所在地",
        value: "旧城", validFromChapter: 1, validToChapter: null,
        evidenceChapter: 1, confidence: "有冲突", knowledgeScope: "所有人",
        updatedAt: candidate.updatedAt,
      }],
    })).toBe("逐章");
    expect(deriveChapterBatchMode(candidate, {
      ...context,
      issues: [{
        id: "issue-1", projectId: "project-1", chapterId: candidate.id,
        severity: "硬性", category: "设定", message: "冲突", evidence: "章纲",
        status: "待处理", createdAt: candidate.updatedAt,
      }],
    })).toBe("逐章");
    expect(deriveChapterBatchMode(candidate, {
      ...context,
      plans: [{
        id: "volume-1", kind: "分卷", title: "第一卷", ordinal: 1,
        goal: "推进", conflict: "阻力", outcome: "阶段完成", targetWords: 5_000,
        status: "已批准", parentId: null,
      }],
    })).toBe("逐章");
    expect(deriveChapterBatchMode({ ...candidate, outline: "主角身份揭露" }, context)).toBe("逐章");
  });

  it("prepares status, word count, revision, and normalized fields consistently", () => {
    const previous = chapter("章纲", "");
    const prepared = prepareChapterSave(
      { ...previous, content: "正文🙂 \n", batchMode: "五章批次" },
      {
        previous,
        protectedEdit: false,
        createRevision: true,
        chapterId: previous.id,
        endingExpectationId: null,
        batchMode: "五章批次",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    );

    expect(prepared).toMatchObject({
      status: "草稿",
      wordCount: 3,
      revision: 4,
      linkedExpectationIds: [],
      endingExpectationId: null,
      batchMode: "五章批次",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(prepareChapterSave(prepared, {
      previous: prepared,
      protectedEdit: false,
      createRevision: false,
      chapterId: prepared.id,
      endingExpectationId: null,
      batchMode: prepared.batchMode,
      updatedAt: "2026-02-01T00:01:00.000Z",
    }).revision).toBe(4);
  });
});
