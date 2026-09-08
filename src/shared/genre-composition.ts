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
  "职场",
  "家庭",
  "养成",
  "探案",
  "建设",
  "争霸",
  "救赎",
  "日常",
] as const;

export type NarrativeGenre = (typeof NARRATIVE_GENRES)[number];

export const GENRE_ELEMENT_GROUPS = [
  {
    label: "世界与时代",
    elements: [
      "现代都市",
      "古代",
      "民国",
      "年代",
      "校园",
      "职场",
      "娱乐圈",
      "乡村",
      "末世",
      "星际",
      "架空王朝",
      "江湖",
      "修仙界",
      "异世界",
    ],
  },
  {
    label: "故事机制",
    elements: [
      "重生",
      "穿越",
      "系统",
      "签到",
      "直播",
      "模拟器",
      "回收站",
      "神豪",
      "探案",
      "规则怪谈",
      "无限流",
      "种田",
      "经商",
      "无CP",
      "先婚后爱",
      "多主角",
      "单元剧",
      "日常",
    ],
  },
  {
    label: "人物关系",
    elements: ["师徒", "兄弟", "家族", "群像", "双强", "契约关系", "破镜重圆", "养成", "宿敌", "搭档"],
  },
  {
    label: "情绪基调",
    elements: ["热血", "轻松", "甜宠", "虐恋", "悬疑紧张", "治愈", "沙雕", "冷峻"],
  },
  {
    label: "主角身份",
    elements: ["学生", "职场新人", "店主/创业者", "医生", "教师", "军人", "警察/调查员", "艺人/主播", "匠人", "继承人"],
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
