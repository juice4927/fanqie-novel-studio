import type { PlanNode, StoryContract } from "./types";

function planContent(plan: PlanNode) {
  const { status: _status, ...content } = plan;
  return content;
}

export interface PreparedPlanSave {
  plan: PlanNode;
  protectedEdit: boolean;
  noOp: boolean;
}

export function preparePlanSave(
  previous: PlanNode | undefined,
  candidate: PlanNode,
  planId: string,
): PreparedPlanSave {
  const next: PlanNode = {
    ...candidate,
    id: planId,
    status:
      previous?.status ??
      (candidate.status === "待审批" ? "待审批" : "草稿"),
  };
  const contentChanged = previous
    ? JSON.stringify(planContent(next)) !==
      JSON.stringify(planContent(previous))
    : true;
  const protectedEdit = previous?.status === "已批准" && contentChanged;
  if (protectedEdit) next.status = "待审批";
  return {
    plan: next,
    protectedEdit,
    noOp: previous?.status === "已批准" && !contentChanged,
  };
}

export function approvePlanDraft(
  plan: PlanNode | undefined,
  contract: Pick<StoryContract, "approved">,
) {
  if (!plan) throw new Error("规划节点不存在");
  if (!contract.approved) throw new Error("必须先审批创作契约");
  return { ...plan, status: "已批准" as const };
}
