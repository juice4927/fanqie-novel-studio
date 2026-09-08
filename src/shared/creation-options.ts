import { getFanqieCategoryProfile, getFanqieSubGenreProfile } from "./fanqie-taxonomy";
import type { BookConceptInput } from "./types";

export const OPENING_ARCHETYPES = [
  "重生",
  "穿越",
  "系统降临",
  "能力觉醒",
  "继承/获得",
  "契约绑定",
  "日常切入",
  "灾变爆发",
  "悬案介入",
  "被逐/退婚",
  "回归/重逢",
  "失忆/身份未知",
] as const;
export type OpeningArchetype = (typeof OPENING_ARCHETYPES)[number];

export const LENGTH_SHAPES = [
  { name: "长线连续", detail: "单主线持续推进，适合 200–300 万字" },
  { name: "单元剧", detail: "单元闭环 + 主线谜团，适合快穿/无限流" },
  { name: "多卷史诗", detail: "多势力多视角，适合群像/争霸" },
  { name: "日常经营", detail: "低强度长线，靠生活与经营回报" },
] as const;
export type LengthShape = (typeof LENGTH_SHAPES)[number]["name"];

export const NARRATIVE_PERSONS = ["第三人称限知", "第一人称", "多视角切换"] as const;
export type NarrativePerson = (typeof NARRATIVE_PERSONS)[number];

export const PROTAGONIST_ROLES = [
  "学生",
  "职场新人",
  "店主/创业者",
  "医生",
  "教师",
  "军人",
  "警察/调查员",
  "艺人/主播",
  "匠人",
  "继承人",
] as const;
export type ProtagonistRole = (typeof PROTAGONIST_ROLES)[number];

export const TONE_TAGS = ["热血", "轻松", "甜宠", "虐恋", "悬疑紧张", "治愈", "沙雕", "冷峻"] as const;
export type ToneTag = (typeof TONE_TAGS)[number];

export const DEFAULT_WORDS_PER_CHAPTER = 2500;
export const MIN_WORDS_PER_CHAPTER = 1800;
export const MAX_WORDS_PER_CHAPTER = 4000;

export function normalizeWordsPerChapter(value: number | undefined) {
  if (value === undefined) return DEFAULT_WORDS_PER_CHAPTER;
  if (!Number.isInteger(value) || value < MIN_WORDS_PER_CHAPTER || value > MAX_WORDS_PER_CHAPTER) {
    throw new Error(`单章目标字数必须是 ${MIN_WORDS_PER_CHAPTER} 至 ${MAX_WORDS_PER_CHAPTER} 的整数`);
  }
  return value;
}

/**
 * 把定位面板的全部勾选压缩成一段不超过 400 字的定位卡。
 * 提示词只消费定位卡，原始结构化选项留在记录里供体检使用。
 */
export function compilePositioningCard(input: BookConceptInput) {
  const category = getFanqieCategoryProfile(input.fanqieCategoryKey);
  const subGenres = (input.subGenreIds ?? [])
    .map((id) => getFanqieSubGenreProfile(id)?.name)
    .filter((name): name is string => Boolean(name));
  const clip = (value: string | undefined, max: number) => {
    const text = value?.trim() ?? "";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };
  const parts = [
    `频道：${category?.channel ?? "未指定"}`,
    `番茄分类：${category ? `${category.channel}·${category.name}` : "未指定"}`,
    subGenres.length ? `二级流派：${subGenres.join("、")}` : "",
    `主题材：${input.genre}`,
    input.openingArchetype ? `开局形态：${input.openingArchetype}` : "",
    input.lengthShape ? `篇幅形态：${input.lengthShape}` : "",
    input.narrativePerson ? `视角：${input.narrativePerson}` : "",
    input.protagonistRoles?.length ? `主角身份：${input.protagonistRoles.join("、")}` : "",
    input.toneTags?.length ? `情绪基调：${input.toneTags.join("、")}` : "",
    input.secondaryGenres?.length ? `叙事主轴：${input.secondaryGenres.join(" + ")}` : "",
    input.genreElements?.length ? `题材元素：${input.genreElements.join("、")}` : "",
    `目标字数：${input.targetWords}，单章约 ${input.wordsPerChapter ?? DEFAULT_WORDS_PER_CHAPTER} 字`,
    `更新节奏：${input.updateCadence}`,
    clip(input.readerPersona, 40) ? `读者画像：${clip(input.readerPersona, 40)}` : "",
    clip(input.readerPromise, 60) ? `读者承诺：${clip(input.readerPromise, 60)}` : "",
    clip(input.commercialBoundary, 60) ? `商业边界：${clip(input.commercialBoundary, 60)}` : "",
    input.customGenreDirection?.trim() ? `自定义方向：${clip(input.customGenreDirection, 60)}` : "",
    input.evidenceNotes?.length ? `市场证据：${clip(input.evidenceNotes.join("；"), 80)}` : "",
  ].filter(Boolean);
  return parts.join("；");
}
