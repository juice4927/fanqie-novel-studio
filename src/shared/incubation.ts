import { compilePositioningCard } from "./creation-options";
import type { BookConceptInput, BookConceptSkeleton, Genre, IncubationCandidate, NarrativeGenre } from "./types";

export const INCUBATION_STEPS = ["定位", "证据", "候选", "体检", "骨架", "开书包"] as const;
export type IncubationStep = (typeof INCUBATION_STEPS)[number];

/** 开书路径：作者带多少信息进来，决定候选数量与实际步骤。 */
export const INCUBATION_PATHS = ["探索", "定向", "直达"] as const;
export type IncubationPath = (typeof INCUBATION_PATHS)[number];

export const PATH_CANDIDATE_COUNTS: Record<IncubationPath, number> = { 探索: 3, 定向: 2, 直达: 1 };

const PATH_STEPS: Record<IncubationPath, readonly IncubationStep[]> = {
  探索: INCUBATION_STEPS,
  定向: ["定位", "证据", "候选", "体检", "骨架"],
  直达: ["定位", "骨架", "体检"],
};

/** 步骤条只显示这条路径实际会走的步骤；旧草稿没有 path 时退回完整步骤。 */
export function stepsForPath(path?: IncubationPath): readonly IncubationStep[] {
  return path ? PATH_STEPS[path] : INCUBATION_STEPS;
}

export function candidateCountForPath(path: IncubationPath) {
  return PATH_CANDIDATE_COUNTS[path];
}

export const INCUBATION_STATUSES = ["孵化中", "已立项", "已放弃"] as const;
export type IncubationStatus = (typeof INCUBATION_STATUSES)[number];

export interface IncubationPositioning {
  genre: Genre;
  fanqieCategoryKey: string;
  subGenreIds: string[];
  openingArchetype: string;
  lengthShape: string;
  narrativePerson: string;
  protagonistRoles: string[];
  toneTags: string[];
  secondaryGenres: NarrativeGenre[];
  genreElements: string[];
  customGenreDirection: string;
  targetWords: number;
  wordsPerChapter: number;
  updateCadence: string;
  safeStockLine: number;
  readerPersona: string;
  readerPromise: string;
  commercialBoundary: string;
}

export interface IncubationEvidenceRefs {
  insightIds: string[];
  marketOpportunityKeys: string[];
  categoryTags: string[];
  skipped: boolean;
}

export interface IncubationReviewState {
  acknowledged: string[];
}

export interface IncubationDraft {
  id: string;
  status: IncubationStatus;
  step: IncubationStep;
  /** 旧草稿缺省视为探索路径。 */
  path?: IncubationPath;
  positioning: IncubationPositioning;
  evidence: IncubationEvidenceRefs;
  seed: string;
  candidates: IncubationCandidate[];
  selectedCandidateId: string | null;
  skeleton: BookConceptSkeleton | null;
  review: IncubationReviewState;
  createdProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncubationSummary {
  id: string;
  status: IncubationStatus;
  step: IncubationStep;
  title: string;
  categoryName: string;
  genre: Genre;
  candidateCount: number;
  projectId: string | null;
  updatedAt: string;
}

export function positioningToConceptInput(
  positioning: IncubationPositioning,
  seed: string,
  evidence: { insightIds?: string[]; notes?: string[] } = {},
  candidateCount = PATH_CANDIDATE_COUNTS.探索,
): BookConceptInput {
  return {
    genre: positioning.genre,
    fanqieCategoryKey: positioning.fanqieCategoryKey,
    subGenreIds: positioning.subGenreIds,
    openingArchetype: positioning.openingArchetype,
    lengthShape: positioning.lengthShape,
    narrativePerson: positioning.narrativePerson,
    protagonistRoles: positioning.protagonistRoles,
    toneTags: positioning.toneTags,
    evidenceInsightIds: evidence.insightIds ?? [],
    evidenceNotes: evidence.notes ?? [],
    candidateCount,
    readerPersona: positioning.readerPersona,
    readerPromise: positioning.readerPromise,
    commercialBoundary: positioning.commercialBoundary,
    secondaryGenres: positioning.secondaryGenres,
    genreElements: positioning.genreElements,
    customGenreDirection: positioning.customGenreDirection,
    targetWords: positioning.targetWords,
    wordsPerChapter: positioning.wordsPerChapter,
    updateCadence: positioning.updateCadence,
    safeStockLine: positioning.safeStockLine,
    seed,
  };
}

export function missingIncubationFields(positioning: IncubationPositioning) {
  const missing: string[] = [];
  if (!positioning.fanqieCategoryKey.trim()) missing.push("番茄分类");
  if (!Number.isInteger(positioning.targetWords) || positioning.targetWords < 10_000) missing.push("目标字数");
  if (!positioning.updateCadence.trim()) missing.push("更新节奏");
  return missing;
}

export function describeIncubationPositioning(positioning: IncubationPositioning) {
  return compilePositioningCard(positioningToConceptInput(positioning, ""));
}

export function toIncubationSummary(draft: IncubationDraft, categoryName: string): IncubationSummary {
  return {
    id: draft.id,
    status: draft.status,
    step: draft.step,
    title: draft.candidates.find((candidate) => candidate.id === draft.selectedCandidateId)?.title ?? "未命名立项",
    categoryName,
    genre: draft.positioning.genre,
    candidateCount: draft.candidates.length,
    projectId: draft.createdProjectId,
    updatedAt: draft.updatedAt,
  };
}

/** 人工确认某条体检结论后，把它记入留痕，阻断项据此解除。 */
export function acknowledgeFinding(draft: IncubationDraft, findingId: string, updatedAt: string): IncubationDraft {
  if (draft.review.acknowledged.includes(findingId)) return draft;
  return {
    ...draft,
    review: { acknowledged: [...draft.review.acknowledged, findingId] },
    updatedAt,
  };
}

export function selectCandidate(draft: IncubationDraft, candidateId: string, updatedAt: string): IncubationDraft {
  if (!draft.candidates.some((candidate) => candidate.id === candidateId)) throw new Error("候选方案不存在，无法选定");
  return {
    ...draft,
    selectedCandidateId: candidateId,
    skeleton: null,
    review: { acknowledged: [] },
    updatedAt,
  };
}

export function advanceIncubationStep(
  draft: IncubationDraft,
  step: IncubationStep,
  updatedAt: string,
): IncubationDraft {
  if (!INCUBATION_STEPS.includes(step)) throw new Error(`未知的立项步骤：${step}`);
  return { ...draft, step, updatedAt };
}
