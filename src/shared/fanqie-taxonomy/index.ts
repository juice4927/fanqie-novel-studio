import { FEMALE_CATEGORY_PROFILES } from "./female";
import { MALE_CATEGORY_PROFILES } from "./male";
import { FANQIE_SUBGENRE_SEEDS } from "./subgenres";
import type { FanqieCategoryProfile, FanqieChannel, FanqieRankKind, FanqieSubGenreProfile } from "./types";

export * from "./types";

/** 番茄榜单分类（categoryId 与线上公开榜单页核对一致）。 */
export const FANQIE_CATEGORY_PROFILES: FanqieCategoryProfile[] = [
  ...MALE_CATEGORY_PROFILES,
  ...FEMALE_CATEGORY_PROFILES,
];

const categoryByKey = new Map(FANQIE_CATEGORY_PROFILES.map((profile) => [profile.key, profile]));

export function getFanqieCategoryProfile(key?: string) {
  return key ? categoryByKey.get(key) : undefined;
}

/**
 * 二级流派：读者找书的口径，用于立项定位与提示词。
 * 归属分类必须存在，`genre` 统一由归属分类派生，避免两处不一致。
 */
export const FANQIE_SUBGENRE_PROFILES: FanqieSubGenreProfile[] = FANQIE_SUBGENRE_SEEDS.map((seed) => {
  const parentKey = seed.parentCategoryKeys[0];
  const parent = categoryByKey.get(parentKey);
  if (!parent) throw new Error(`二级流派 ${seed.id} 的归属分类不存在：${parentKey}`);
  return { ...seed, genre: parent.genre };
});

const subGenreById = new Map(FANQIE_SUBGENRE_PROFILES.map((profile) => [profile.id, profile]));

export function getFanqieSubGenreProfile(id?: string) {
  return id ? subGenreById.get(id) : undefined;
}

export function listFanqieSubGenres(categoryKey: string) {
  return FANQIE_SUBGENRE_PROFILES.filter((profile) => profile.parentCategoryKeys.includes(categoryKey));
}

/** 榜单采集用的分类列表；由分类画像派生，保持单一数据源。 */
export const FANQIE_CATEGORIES: Record<FanqieChannel, ReadonlyArray<readonly [string, string]>> = {
  男频: FANQIE_CATEGORY_PROFILES.filter((profile) => profile.channel === "男频").map(
    (profile) => [profile.categoryId, profile.name] as const,
  ),
  女频: FANQIE_CATEGORY_PROFILES.filter((profile) => profile.channel === "女频").map(
    (profile) => [profile.categoryId, profile.name] as const,
  ),
};

export function fanqieRankUrl(channel: FanqieChannel, kind: FanqieRankKind, categoryId: string) {
  return `https://fanqienovel.com/rank/${channel === "男频" ? 1 : 0}_${kind === "阅读榜" ? 2 : 1}_${categoryId}`;
}
