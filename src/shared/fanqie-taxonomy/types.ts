import type { NarrativeGenre } from "../genre-composition";
import type { Genre } from "../types";

export type FanqieChannel = "男频" | "女频";
export type FanqieRankKind = "阅读榜" | "新书榜";

/**
 * 分类对主题材基线的覆盖。只允许覆盖正向字段：
 * 禁忌类字段仍由分类自己的 taboo 承担，避免出现没有正向替代的孤立禁令。
 */
export interface CategoryBaselineDelta {
  readerPromise?: string;
  coreFantasies?: string[];
  conflictEngines?: string[];
  rewardLadder?: string[];
}

export interface FanqieCategoryProfile {
  key: string;
  channel: FanqieChannel;
  categoryId: string;
  name: string;
  genre: Genre;
  recommendedSubtype: string;
  coreFantasy: string;
  audience: string;
  openingFocus: string;
  taboo: string;
  conflictEngine: string;
  payoffPattern: string;
  expansionAxis: string;
  fatigueSignal: string;
  qualityChecks: string[];
  narrativeGenres: NarrativeGenre[];
  genreElements: string[];
  expansionRoutes: string[];
  /** 分类常见标签/流派，人工维护 + 榜单聚合校对 */
  tags: string[];
  /** 容易与本书分类混淆的兄弟分类 key */
  siblingCategories: string[];
  readerAgeBand: string;
  chapterHookStyle: string;
  firstPayoffWindow: [number, number];
  payoffCadence: string;
  typicalChapterWords: [number, number];
  commonOpenings: string[];
  clicheTraps: string[];
  differentiationAngles: string[];
  baselineDelta?: CategoryBaselineDelta;
  profileVersion: string;
}

export interface FanqieSubGenreProfile {
  id: string;
  name: string;
  channel: FanqieChannel;
  parentCategoryKeys: string[];
  genre: Genre;
  coreFantasy: string;
  openingFocus: string;
  commonOpenings: string[];
  clicheTraps: string[];
  differentiationAngles: string[];
  typicalTags: string[];
  typicalChapterWords: [number, number];
  firstPayoffWindow: [number, number];
  source: "人工维护" | "榜单聚合";
  updatedAt: string;
}

export type SubGenreSeed = Omit<FanqieSubGenreProfile, "genre">;

export const FANQIE_PROFILE_VERSION = "2026-09.v1";
