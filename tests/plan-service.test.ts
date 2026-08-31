import { describe, expect, it } from "vitest";
import { approvePlanDraft, preparePlanSave } from "../src/shared/plan-service";
import type { PlanNode } from "../src/shared/types";

function plan(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: "plan-1",
    kind: "分卷",
    title: "第一卷",
    ordinal: 1,
    goal: "建立规则",
    conflict: "资源有限",
    outcome: "完成阶段目标",
    targetWords: 150_000,
    status: "已批准",
    parentId: null,
    ...overrides,
  };
}

describe("plan workflow rules", () => {
  it("keeps an unchanged approved plan as a no-op", () => {
    const previous = plan();
    const prepared = preparePlanSave(previous, { ...previous }, previous.id);

    expect(prepared).toEqual({
      plan: previous,
      protectedEdit: false,
      noOp: true,
    });
  });

  it("returns an edited approved plan to pending approval", () => {
    const previous = plan();
    const prepared = preparePlanSave(previous, { ...previous, goal: "建立并验证规则" }, previous.id);

    expect(prepared).toMatchObject({
      protectedEdit: true,
      noOp: false,
      plan: { goal: "建立并验证规则", status: "待审批" },
    });
  });

  it("normalizes new plan status and enforces approval gates", () => {
    const draft = preparePlanSave(undefined, plan({ id: "", status: "已批准" }), "new-plan").plan;
    expect(draft).toMatchObject({ id: "new-plan", status: "草稿" });
    expect(() => approvePlanDraft(undefined, { approved: true })).toThrow("规划节点不存在");
    expect(() => approvePlanDraft(draft, { approved: false })).toThrow("必须先审批创作契约");
    expect(approvePlanDraft(draft, { approved: true }).status).toBe("已批准");
  });
});
