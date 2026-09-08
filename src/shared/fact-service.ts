import type { LedgerFact } from "./types";

interface PrepareFactSaveOptions {
  factId: string;
  updatedAt: string;
}

export interface PreparedFactSave {
  fact: LedgerFact;
  replacement?: LedgerFact;
}

export function prepareFactSave(
  facts: readonly LedgerFact[],
  candidate: LedgerFact,
  options: PrepareFactSaveOptions,
): PreparedFactSave {
  const next = {
    ...candidate,
    id: options.factId,
    updatedAt: options.updatedAt,
  };
  const proposedReplacement = next.replacesFactId
    ? facts.find(
        (fact) =>
          fact.id === next.replacesFactId &&
          fact.confidence === "已确认" &&
          fact.subject === next.subject &&
          fact.predicate === next.predicate &&
          (fact.value !== next.value || fact.knowledgeScope !== next.knowledgeScope) &&
          fact.validFromChapter < next.validFromChapter &&
          (fact.validToChapter === null || fact.validToChapter >= next.validFromChapter),
      )
    : undefined;
  const hasConflict = facts.some(
    (fact) =>
      fact.id !== next.id &&
      fact.id !== proposedReplacement?.id &&
      fact.confidence !== "已忽略" &&
      fact.subject === next.subject &&
      fact.predicate === next.predicate &&
      fact.validToChapter === null &&
      next.validToChapter === null &&
      fact.value !== next.value,
  );
  if (next.confidence !== "已忽略" && hasConflict) {
    next.confidence = "有冲突";
  }
  // 降级为“有冲突”后不能再关闭旧事实，否则同一键会失去所有已确认值。
  const replacement =
    next.confidence === "已确认" && proposedReplacement
      ? {
          ...proposedReplacement,
          validToChapter: next.validFromChapter - 1,
          updatedAt: options.updatedAt,
        }
      : undefined;
  return { fact: next, replacement };
}

export type FactConflictResolution = "keep" | "ignore";

export interface FactConflictResolutionPlan {
  fact: LedgerFact;
  superseded: readonly LedgerFact[];
}

/**
 * 人工裁决一条“有冲突”的事实：保留当前值（更早的开放值按章关闭，更晚的开放值忽略），
 * 或直接忽略该条。冲突不裁决会一直阻断正文生成，因此必须存在界面出口。
 */
export function planFactConflictResolution(
  facts: readonly LedgerFact[],
  factId: string,
  resolution: FactConflictResolution,
  updatedAt: string,
): FactConflictResolutionPlan {
  const target = facts.find((fact) => fact.id === factId);
  if (!target) throw new Error("事实不存在");
  if (target.confidence !== "有冲突") throw new Error("只有“有冲突”的事实需要裁决");
  if (resolution === "ignore") {
    return { fact: { ...target, confidence: "已忽略", updatedAt }, superseded: [] };
  }
  const superseded = facts
    .filter(
      (fact) =>
        fact.id !== target.id &&
        fact.confidence !== "已忽略" &&
        fact.subject === target.subject &&
        fact.predicate === target.predicate &&
        fact.validToChapter === null &&
        fact.value !== target.value,
    )
    .map(
      (fact): LedgerFact =>
        fact.validFromChapter < target.validFromChapter
          ? { ...fact, validToChapter: target.validFromChapter - 1, updatedAt }
          : { ...fact, confidence: "已忽略", updatedAt },
    );
  return { fact: { ...target, confidence: "已确认", updatedAt }, superseded };
}
