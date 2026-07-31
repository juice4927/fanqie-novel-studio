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
          (fact.value !== next.value ||
            fact.knowledgeScope !== next.knowledgeScope) &&
          fact.validFromChapter < next.validFromChapter &&
          (fact.validToChapter === null ||
            fact.validToChapter >= next.validFromChapter),
      )
    : undefined;
  const replacement =
    next.confidence === "已确认" && proposedReplacement
      ? {
          ...proposedReplacement,
          validToChapter: next.validFromChapter - 1,
          updatedAt: options.updatedAt,
        }
      : undefined;
  const hasConflict = facts.some(
    (fact) =>
      fact.id !== next.id &&
      fact.id !== proposedReplacement?.id &&
      fact.subject === next.subject &&
      fact.predicate === next.predicate &&
      fact.validToChapter === null &&
      next.validToChapter === null &&
      fact.value !== next.value,
  );
  if (next.confidence !== "已忽略" && hasConflict) {
    next.confidence = "有冲突";
  }
  return { fact: next, replacement };
}
