import type { QualityIssue } from "./types";

export interface QualityIssueSavePlan {
  upserts: QualityIssue[];
  forceSequentialReview: boolean;
}

export function prepareQualityIssueSave(
  existingIssues: readonly QualityIssue[],
  chapterId: string,
  incomingIssues: readonly QualityIssue[],
): QualityIssueSavePlan {
  const upserts = new Map<string, QualityIssue>();
  for (const issue of existingIssues) {
    if (issue.chapterId === chapterId && issue.status === "待处理") {
      upserts.set(issue.id, { ...issue, status: "已解决" });
    }
  }
  for (const issue of incomingIssues) {
    upserts.set(issue.id, { ...issue });
  }
  return {
    upserts: [...upserts.values()],
    forceSequentialReview: incomingIssues.some(
      (issue) => issue.severity === "硬性",
    ),
  };
}

export function resolveQualityIssue(
  issue: QualityIssue | undefined,
  status: QualityIssue["status"],
): QualityIssue {
  if (!issue) throw new Error("质检项不存在");
  if (issue.severity === "硬性" && status === "已忽略") {
    throw new Error("硬性质检项不能忽略，必须解决后才能继续");
  }
  return { ...issue, status };
}
