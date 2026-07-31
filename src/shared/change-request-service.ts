import type { ChangeRequest } from "./types";

interface ChangeTargetVersions {
  contractVersion: number;
  planVersion: (targetId: string) => number | undefined;
  chapterVersion: (targetId: string) => number | undefined;
}

export function resolveChangeTargetVersion(
  targetKind: ChangeRequest["targetKind"],
  targetId: string,
  versions: ChangeTargetVersions,
) {
  if (targetKind === "创作契约") {
    if (targetId !== "contract") throw new Error("创作契约目标无效");
    return versions.contractVersion;
  }
  if (targetKind === "规划") {
    const version = versions.planVersion(targetId);
    if (version === undefined) throw new Error("变更目标规划不存在");
    return version;
  }
  const version = versions.chapterVersion(targetId);
  if (version === undefined) throw new Error("变更目标章节不存在");
  return version;
}

export function prepareChangeRequest(
  change: ChangeRequest,
  options: { id: string; baseVersion: number; createdAt: string },
): ChangeRequest {
  return {
    ...change,
    id: options.id,
    baseVersion: options.baseVersion,
    createdAt: options.createdAt,
    status: "待审批",
  };
}

export function decideChangeRequest(
  change: ChangeRequest | undefined,
  decision: "批准" | "拒绝",
): ChangeRequest {
  if (!change) throw new Error("变更单不存在");
  return {
    ...change,
    status: decision === "批准" ? "已批准" : "已拒绝",
  };
}
