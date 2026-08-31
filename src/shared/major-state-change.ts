import type { Genre, MajorStateChangeRules } from "./types";

export const BASE_MAJOR_STATE_KEYWORDS = [
  "死亡",
  "牺牲",
  "突破",
  "晋级",
  "身份揭露",
  "身份暴露",
  "决裂",
  "成婚",
  "离婚",
  "重生",
  "穿越",
  "失忆",
  "叛变",
  "真相揭晓",
  "终局",
] as const;

export const GENRE_MAJOR_STATE_KEYWORDS: Partial<Record<Genre, readonly string[]>> = {
  "玄幻/仙侠": ["陨落", "渡劫", "飞升", "废除修为"],
  现言甜宠: ["分手", "退婚", "订婚", "复合", "怀孕"],
  古言宅斗: ["赐婚", "和离", "休妻", "流产", "抄家"],
  "历史/架空": ["登基", "兵变", "灭国", "割地"],
  年代重生: ["下乡", "返城", "断亲", "恢复高考"],
};

export function resolveMajorStateKeywords(genre: Genre, rules?: MajorStateChangeRules) {
  const excluded = new Set(normalizeKeywords(rules?.exclude));
  return normalizeKeywords([
    ...BASE_MAJOR_STATE_KEYWORDS,
    ...(GENRE_MAJOR_STATE_KEYWORDS[genre] ?? []),
    ...(rules?.include ?? []),
  ]).filter((keyword) => !excluded.has(keyword));
}

export function findMajorStateChange(text: string, genre: Genre, rules?: MajorStateChangeRules) {
  return resolveMajorStateKeywords(genre, rules).find((keyword) => text.includes(keyword));
}

export function hasMajorStateChange(text: string, genre: Genre, rules?: MajorStateChangeRules) {
  return Boolean(findMajorStateChange(text, genre, rules));
}

function normalizeKeywords(values: readonly string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
