import type { ContextPackage } from "./types";

/**
 * 提示词引导化改造的度量工具：纯函数，供测试与 scripts 复用。
 * 指标口径必须稳定，否则跨版本对比没有意义。
 */

const PROHIBITION_MARKERS = [
  "不得",
  "不要",
  "禁止",
  "不能",
  "避免",
  "不许",
  "不准",
  "切勿",
  "不套用",
  "不自行",
  "不引入",
  "不泄露",
] as const;

const POSITIVE_MARKERS = [
  "优先",
  "可以",
  "建议",
  "允许",
  "保持",
  "尝试",
  "让",
  "展示",
  "完成",
  "延续",
  "以",
  "如果",
] as const;

export interface DirectiveCounts {
  /** 非空白字符数，作为密度的分母。 */
  characters: number;
  prohibitions: number;
  positives: number;
  checklistItems: number;
}

const compactLength = (text: string) => [...text.replace(/\s+/g, "")].length;

export function countDirectives(text: string): DirectiveCounts {
  return {
    characters: compactLength(text),
    prohibitions: PROHIBITION_MARKERS.reduce(
      (sum, marker) => sum + (text.match(new RegExp(marker, "g"))?.length ?? 0),
      0,
    ),
    positives: POSITIVE_MARKERS.reduce((sum, marker) => sum + (text.match(new RegExp(marker, "g"))?.length ?? 0), 0),
    checklistItems: (text.match(/^\s*(?:[-•]|\d+[.、])\s+/gm) ?? []).length,
  };
}

/** 每千个非空白字符中的否定式指令数量。 */
export function constraintDensity(text: string): number {
  const { characters, prohibitions } = countDirectives(text);
  return characters ? Math.round((prohibitions / characters) * 1000 * 100) / 100 : 0;
}

/** 正向指令与否定指令的比值；没有否定指令时返回 positives。 */
export function positiveGuidanceRatio(text: string): number {
  const { positives, prohibitions } = countDirectives(text);
  return prohibitions ? Math.round((positives / prohibitions) * 100) / 100 : positives;
}

const CONTEXT_STRING_KEYS = [
  "contract",
  "commercialGuidance",
  "chapterIntent",
  "expectationLedger",
  "longTermMemory",
  "volumeGoal",
  "rollingOutline",
  "recentSummary",
  "relevantFacts",
  "forbiddenKnowledge",
  "authorStyle",
] as const satisfies ReadonlyArray<keyof ContextPackage>;

export type ContextStringKey = (typeof CONTEXT_STRING_KEYS)[number];

export interface ContextComposition {
  sections: Record<ContextStringKey, number>;
  total: number;
  /** 通用商业知识占上下文的比例。 */
  commercialShare: number;
  /** 本章具体任务占上下文的比例。 */
  intentShare: number;
  /** 本章意图字符数 ÷ 商业知识字符数；商业知识为空时返回 1。 */
  intentToGuidanceRatio: number;
}

export function contextComposition(context: Pick<ContextPackage, ContextStringKey>): ContextComposition {
  const sections = Object.fromEntries(
    CONTEXT_STRING_KEYS.map((key) => [key, compactLength(context[key] ?? "")]),
  ) as Record<ContextStringKey, number>;
  const total = Object.values(sections).reduce((sum, value) => sum + value, 0);
  const guidance = sections.commercialGuidance;
  return {
    sections,
    total,
    commercialShare: total ? Math.round((guidance / total) * 1000) / 1000 : 0,
    intentShare: total ? Math.round((sections.chapterIntent / total) * 1000) / 1000 : 0,
    intentToGuidanceRatio: guidance ? Math.round((sections.chapterIntent / guidance) * 100) / 100 : 1,
  };
}
