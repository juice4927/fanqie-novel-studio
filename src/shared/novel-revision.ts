import type {
  Chapter,
  NovelChapterSnapshot,
  NovelContractField,
  NovelContractRepair,
  NovelPlanSnapshot,
  NovelTextRepair,
  PlanNode,
  StoryContract,
} from "./types";

const ARRAY_FIELDS = new Set<NovelContractField>([
  "worldRules",
  "keyRelationships",
  "majorForces",
  "timelineAnchors",
  "immutableRules",
  "prohibitedPatterns",
]);

export function contractFieldText(contract: StoryContract, field: NovelContractField) {
  const value = contract[field];
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

export function applyContractRepairs(contract: StoryContract, repairs: readonly NovelContractRepair[]) {
  const next = { ...contract } as StoryContract;
  for (const repair of repairs) {
    if (contractFieldText(next, repair.field) !== repair.before)
      throw new Error(`创作设定“${repair.label}”已变化，请重新分析修改意见`);
    const value = ARRAY_FIELDS.has(repair.field)
      ? repair.after
          .split(/\n+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : repair.after.trim();
    Object.assign(next, { [repair.field]: value });
  }
  return next;
}

export function planRevisionSnapshot(plan: PlanNode): NovelPlanSnapshot {
  return {
    title: plan.title,
    goal: plan.goal,
    conflict: plan.conflict,
    outcome: plan.outcome,
    targetWords: plan.targetWords,
  };
}

export function chapterRevisionSnapshot(chapter: Chapter): NovelChapterSnapshot {
  return {
    title: chapter.title,
    outline: chapter.outline,
    chapterFunction: chapter.chapterFunction,
    targetWords: chapter.targetWords,
    chapterPromise: chapter.chapterPromise,
    expectedPayoff: chapter.expectedPayoff,
    crisis: chapter.crisis,
    endingExpectation: chapter.endingExpectation,
    expectationTargetChapter: chapter.expectationTargetChapter,
  };
}

export function sameRevisionSnapshot(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyTextRepair(chapter: Chapter, repair: NovelTextRepair) {
  if (chapter.revision !== repair.baseRevision) throw new Error(`第${chapter.number}章版本已变化，请重新分析修改意见`);
  if (
    repair.start < 0 ||
    repair.end < repair.start ||
    repair.end > chapter.content.length ||
    chapter.content.slice(repair.start, repair.end) !== repair.before
  )
    throw new Error(`第${chapter.number}章修改位置已变化，请重新选择文字并分析`);
  return `${chapter.content.slice(0, repair.start)}${repair.after}${chapter.content.slice(repair.end)}`;
}
