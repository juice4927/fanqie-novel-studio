import { describe, expect, it } from "vitest";
import {
  prepareQualityIssueSave,
  resolveQualityIssue,
} from "../src/shared/quality-issue-service";
import type { QualityIssue } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function issue(
  id: string,
  overrides: Partial<QualityIssue> = {},
): QualityIssue {
  return {
    id,
    projectId: "project-1",
    chapterId: "chapter-1",
    severity: "警告",
    category: "连续性",
    message: id,
    evidence: "证据",
    status: "待处理",
    createdAt: timestamp,
    ...overrides,
  };
}

describe("quality issue save rules", () => {
  it("resolves only pending issues from the checked chapter", () => {
    const target = issue("target");
    const resolved = issue("resolved", { status: "已解决" });
    const otherChapter = issue("other", { chapterId: "chapter-2" });
    const existing = [target, resolved, otherChapter];

    const plan = prepareQualityIssueSave(existing, "chapter-1", []);

    expect(plan.upserts).toEqual([{ ...target, status: "已解决" }]);
    expect(plan.forceSequentialReview).toBe(false);
    expect(existing).toEqual([target, resolved, otherChapter]);
  });

  it("upserts incoming issues without duplicate ids", () => {
    const previous = issue("same");
    const incoming = issue("same", {
      severity: "硬性",
      message: "新的硬性问题",
    });

    const plan = prepareQualityIssueSave(
      [previous],
      "chapter-1",
      [incoming],
    );

    expect(plan.upserts).toEqual([incoming]);
    expect(plan.forceSequentialReview).toBe(true);
    expect(plan.upserts[0]).not.toBe(incoming);
  });

  it("resolves valid issue transitions without mutating the source", () => {
    const source = issue("normal");

    expect(resolveQualityIssue(source, "已忽略")).toEqual({
      ...source,
      status: "已忽略",
    });
    expect(source.status).toBe("待处理");
  });

  it("rejects missing issues and ignored hard issues", () => {
    expect(() => resolveQualityIssue(undefined, "已解决"))
      .toThrow("质检项不存在");
    expect(() =>
      resolveQualityIssue(issue("hard", { severity: "硬性" }), "已忽略"),
    ).toThrow("硬性质检项不能忽略，必须解决后才能继续");
  });
});
