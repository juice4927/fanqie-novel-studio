export const NARRATIVE_GENRES = [
  "成长",
  "悬疑",
  "冒险",
  "经营",
  "恋爱",
  "权谋",
  "竞技",
  "生存",
  "复仇",
  "群像",
] as const;

export type NarrativeGenre = (typeof NARRATIVE_GENRES)[number];

export const GENRE_ELEMENT_GROUPS = [
  {
    label: "世界与时代",
    elements: ["现代都市", "古代", "民国", "年代", "校园", "职场", "娱乐圈", "乡村", "末世", "星际"],
  },
  {
    label: "故事机制",
    elements: ["重生", "穿越", "系统", "探案", "规则怪谈", "无限流", "种田", "经商", "无CP", "先婚后爱", "多主角"],
  },
] as const;

export const GENRE_ELEMENTS = GENRE_ELEMENT_GROUPS.flatMap((group) => group.elements);

export interface GenreComposition {
  secondaryGenres?: NarrativeGenre[];
  genreElements?: string[];
  customGenreDirection?: string;
}

export function compileGenreComposition(composition?: GenreComposition) {
  const secondaryGenres = composition?.secondaryGenres?.filter(Boolean) ?? [];
  const genreElements = composition?.genreElements?.filter(Boolean) ?? [];
  const customDirection = composition?.customGenreDirection?.trim() ?? "";

  if (!secondaryGenres.length && !genreElements.length && !customDirection) {
    return "复合题材：未配置；以主题材为商业基线，但允许根据创作契约自然变体。";
  }

  return [
    `复合叙事类型：${secondaryGenres.join(" + ") || "未指定"}`,
    `题材元素：${genreElements.join("、") || "未指定"}`,
    `自定义创作方向：${customDirection || "未指定"}`,
    "组合原则：主题材只提供商业基线；复合类型负责主要冲突与情绪变化，题材元素按需出现，不要求每章覆盖。自定义创作方向优先于题材惯例，但不得破坏创作契约和事实。",
  ].join("\n");
}
