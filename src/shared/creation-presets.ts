import {
  LENGTH_SHAPES,
  type LengthShape,
  NARRATIVE_PERSONS,
  type NarrativePerson,
  OPENING_ARCHETYPES,
  type OpeningArchetype,
  PROTAGONIST_ROLES,
  type ProtagonistRole,
  TONE_TAGS,
  type ToneTag,
} from "./creation-options";
import { type FanqieSubGenreProfile, getFanqieCategoryProfile, getFanqieSubGenreProfile } from "./fanqie-taxonomy";

/** 开书面板的目标字数档位；定位面板与预设校验共用。 */
export const TARGET_WORD_PRESETS = [1_000_000, 1_500_000, 3_000_000] as const;

export interface StructurePreset {
  stages: readonly [number, number];
  volumes: readonly [number, number];
  scenesPerChapter: readonly [number, number];
  chapterWords: readonly [number, number];
  firstPayoffWindow: readonly [number, number];
}

export interface CreationPreset {
  categoryKey: string | null;
  openingArchetypes: OpeningArchetype[];
  lengthShape: LengthShape;
  narrativePerson: NarrativePerson;
  toneTags: ToneTag[];
  protagonistRoles: ProtagonistRole[];
  targetWords: number;
  updateCadence: string;
  structure: StructurePreset;
}

/**
 * 结构骨架由篇幅形态决定，分类只提供单章字数与回报窗口这类硬参数。
 * 这样避免维护 37×4 的矩阵；某个分类确有需要时再加显式覆盖。
 */
const LENGTH_SHAPE_STRUCTURE: Record<LengthShape, { stages: [number, number]; volumes: [number, number] }> = {
  长线连续: { stages: [5, 8], volumes: [3, 5] },
  单元剧: { stages: [4, 6], volumes: [4, 6] },
  多卷史诗: { stages: [5, 8], volumes: [5, 8] },
  日常经营: { stages: [4, 6], volumes: [3, 5] },
};

/** 未知分类时的全局兜底，等于改造前的固定默认值。 */
export const DEFAULT_CREATION_PRESET: CreationPreset = {
  categoryKey: null,
  openingArchetypes: [OPENING_ARCHETYPES[0]],
  lengthShape: LENGTH_SHAPES[0].name,
  narrativePerson: NARRATIVE_PERSONS[0],
  toneTags: [],
  protagonistRoles: [],
  targetWords: TARGET_WORD_PRESETS[0],
  updateCadence: "每日 2 章",
  structure: {
    stages: [4, 8],
    volumes: [3, 6],
    scenesPerChapter: [1, 5],
    chapterWords: [1400, 3500],
    firstPayoffWindow: [1, 3],
  },
};

const isLengthShape = (value: string): value is LengthShape => LENGTH_SHAPES.some((item) => item.name === value);
const isNarrativePerson = (value: string): value is NarrativePerson =>
  NARRATIVE_PERSONS.includes(value as NarrativePerson);
const pickOpenings = (values: readonly string[]) =>
  values.filter((value): value is OpeningArchetype => OPENING_ARCHETYPES.includes(value as OpeningArchetype));
const pickTones = (values: readonly string[]) =>
  values.filter((value): value is ToneTag => TONE_TAGS.includes(value as ToneTag));
const pickRoles = (values: readonly string[]) =>
  values.filter((value): value is ProtagonistRole => PROTAGONIST_ROLES.includes(value as ProtagonistRole));

/** 单章字数越宽，场景越可能多；避免所有分类都用同一个 1–5。 */
function scenesForChapterWords([, max]: readonly [number, number]): [number, number] {
  if (max <= 2200) return [1, 3];
  if (max <= 3000) return [1, 4];
  return [2, 5];
}

/** 更新节奏只是推荐值，作者随时可改；按单章字数给一个合理起点。 */
function cadenceForChapterWords([min, max]: readonly [number, number]) {
  const average = (min + max) / 2;
  if (average >= 2800) return "每日 1 章";
  if (average < 2200) return "每日 3 章";
  return "每日 2 章";
}

/** 二级流派只做区间窄化；交集为空时保留分类原区间，避免出现非法范围。 */
function narrowRange(
  base: readonly [number, number],
  candidates: ReadonlyArray<readonly [number, number]>,
): [number, number] {
  let [low, high] = base;
  for (const [nextLow, nextHigh] of candidates) {
    const merged: [number, number] = [Math.max(low, nextLow), Math.min(high, nextHigh)];
    if (merged[0] <= merged[1]) [low, high] = merged;
  }
  return [low, high];
}

/**
 * 解析某个分类（可带二级流派）的开书预设。
 * 手写值来自 `FANQIE_CREATION_PRESETS`，结构区间由画像与篇幅形态派生。
 */
export function resolveCreationPreset(input: {
  categoryKey?: string;
  subGenreIds?: readonly string[];
}): CreationPreset {
  const profile = getFanqieCategoryProfile(input.categoryKey);
  const seed = profile?.creationPreset;
  if (!profile || !seed) {
    return { ...DEFAULT_CREATION_PRESET, structure: { ...DEFAULT_CREATION_PRESET.structure } };
  }
  const subGenres = (input.subGenreIds ?? [])
    .map((id) => getFanqieSubGenreProfile(id))
    .filter((item): item is FanqieSubGenreProfile => Boolean(item));
  const chapterWords = narrowRange(
    profile.typicalChapterWords,
    subGenres.map((item) => item.typicalChapterWords),
  );
  const firstPayoffWindow = narrowRange(
    profile.firstPayoffWindow,
    subGenres.map((item) => item.firstPayoffWindow),
  );
  const lengthShape = isLengthShape(seed.lengthShape) ? seed.lengthShape : DEFAULT_CREATION_PRESET.lengthShape;
  const openings = pickOpenings(seed.openingArchetypes);
  return {
    categoryKey: profile.key,
    openingArchetypes: openings.length ? openings : [DEFAULT_CREATION_PRESET.openingArchetypes[0]],
    lengthShape,
    narrativePerson: isNarrativePerson(seed.narrativePerson)
      ? seed.narrativePerson
      : DEFAULT_CREATION_PRESET.narrativePerson,
    toneTags: pickTones(seed.toneTags),
    protagonistRoles: pickRoles(seed.protagonistRoles),
    targetWords: (TARGET_WORD_PRESETS as readonly number[]).includes(seed.targetWords)
      ? seed.targetWords
      : DEFAULT_CREATION_PRESET.targetWords,
    updateCadence: cadenceForChapterWords(chapterWords),
    structure: {
      ...LENGTH_SHAPE_STRUCTURE[lengthShape],
      scenesPerChapter: scenesForChapterWords(chapterWords),
      chapterWords,
      firstPayoffWindow,
    },
  };
}

/** 每种篇幅形态下，一级升级阶梯大致能承载的章节量，用于容量体检。 */
export const CHAPTERS_PER_LADDER_LEVEL: Record<LengthShape, number> = {
  长线连续: 60,
  单元剧: 45,
  多卷史诗: 70,
  日常经营: 50,
};

export function isLengthShapeName(value: string | undefined): value is LengthShape {
  return Boolean(value) && LENGTH_SHAPES.some((item) => item.name === value);
}

/** 章纲字数区间：以本书单章目标为中心 ±30%，再夹回平台可接受区间。 */
export function chapterPlanningRange(wordsPerChapter: number | undefined): [number, number] {
  const center = wordsPerChapter && wordsPerChapter > 0 ? wordsPerChapter : 2500;
  const low = Math.max(1400, Math.round(center * 0.7));
  const high = Math.max(low, Math.min(3500, Math.round(center * 1.3)));
  return [low, high];
}

/**
 * 规划期使用的结构预设：分类给单章字数与回报窗口，篇幅形态给阶段/卷区间。
 * 作者在故事圣经里改过篇幅形态时以作者选择为准。
 */
export function resolveStructurePreset(input: {
  categoryKey?: string;
  subGenreIds?: readonly string[];
  lengthShape?: string;
  wordsPerChapter?: number;
}): StructurePreset {
  const base = resolveCreationPreset({ categoryKey: input.categoryKey, subGenreIds: input.subGenreIds }).structure;
  const chapterWords =
    input.wordsPerChapter && input.wordsPerChapter > 0
      ? chapterPlanningRange(input.wordsPerChapter)
      : base.chapterWords;
  return {
    ...base,
    ...(isLengthShapeName(input.lengthShape) ? LENGTH_SHAPE_STRUCTURE[input.lengthShape] : {}),
    chapterWords,
    scenesPerChapter: scenesForChapterWords(chapterWords),
  };
}
