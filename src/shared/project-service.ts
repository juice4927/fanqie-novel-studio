import { normalizeAestheticProfile } from "./aesthetic-profile";
import type { CreateProjectInput, ProjectPatch, ProjectSummary, StoryContract } from "./types";

interface PrepareProjectCreationOptions {
  projectId: string;
  updatedAt: string;
}

export interface PreparedProjectCreation {
  summary: ProjectSummary;
  contract: StoryContract;
}

function normalizeTitle(value: string, fallback?: string) {
  const title = value.trim() || fallback;
  if (!title) throw new Error("作品名称不能为空");
  if (title.length > 100) throw new Error("作品名称不能超过 100 个字符");
  return title;
}

function normalizeCadence(value: string, fallback?: string) {
  const cadence = value.trim() || fallback;
  if (!cadence) throw new Error("更新频率不能为空");
  if (cadence.length > 100) throw new Error("更新频率不能超过 100 个字符");
  return cadence;
}

function assertProjectNumbers(targetWords: number, safeStockLine: number) {
  if (!Number.isInteger(targetWords) || targetWords < 10_000 || targetWords > 20_000_000) {
    throw new Error("目标字数必须是 10000 至 20000000 的整数");
  }
  if (!Number.isInteger(safeStockLine) || safeStockLine < 0 || safeStockLine > 1000) {
    throw new Error("安全存稿线必须是 0 至 1000 的整数");
  }
}

export function prepareProjectCreation(
  input: CreateProjectInput,
  options: PrepareProjectCreationOptions,
): PreparedProjectCreation {
  const title = normalizeTitle(input.title);
  const updateCadence = normalizeCadence(input.updateCadence);
  const safeStockLine = input.safeStockLine ?? 10;
  assertProjectNumbers(input.targetWords, safeStockLine);
  return {
    summary: {
      id: options.projectId,
      title,
      genre: input.genre,
      status: "候选立项",
      targetWords: input.targetWords,
      currentWords: 0,
      chapterCount: 0,
      stockChapters: 0,
      safeStockLine,
      updateCadence,
      nextPublishAt: null,
      riskLevel: "正常",
      updatedAt: options.updatedAt,
    },
    contract: {
      premise: "",
      genreSubtype: "",
      fanqieCategoryKey: "",
      secondaryGenres: [...(input.secondaryGenres ?? [])],
      genreElements: [...(input.genreElements ?? [])],
      customGenreDirection: input.customGenreDirection ?? "",
      audience: "",
      commercialHook: "",
      openingMechanism: "",
      growthCarrier: "",
      primaryPayoff: "",
      longFormEngine: "",
      protagonistDesire: "",
      protagonistArc: "",
      keyRelationships: [],
      worldRules: [],
      majorForces: [],
      timelineAnchors: [],
      readerPromise: "",
      coreEmotion: "",
      ending: "",
      immutableRules: [],
      prohibitedPatterns: [],
      majorStateChanges: { include: [], exclude: [] },
      aestheticProfile: normalizeAestheticProfile(),
      version: 1,
      approved: false,
      updatedAt: options.updatedAt,
    },
  };
}

export function prepareProjectUpdate(current: ProjectSummary, patch: ProjectPatch, updatedAt: string): ProjectSummary {
  const targetWords = patch.targetWords ?? current.targetWords;
  const safeStockLine = patch.safeStockLine ?? current.safeStockLine;
  assertProjectNumbers(targetWords, safeStockLine);
  return {
    ...current,
    title: patch.title === undefined ? current.title : normalizeTitle(patch.title, current.title),
    status: patch.status ?? current.status,
    targetWords,
    updateCadence:
      patch.updateCadence === undefined
        ? current.updateCadence
        : normalizeCadence(patch.updateCadence, current.updateCadence),
    safeStockLine,
    updatedAt,
  };
}
