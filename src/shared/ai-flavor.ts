import { AI_FLAVOR_FEATURES, type AiFlavorFeature } from "./ai-flavor-lexicon";

export interface AiFlavorHit {
  featureId: string;
  label: string;
  severity: "blocking" | "advisory";
  count: number;
  perThousand: number;
  positions: number[];
}

export interface AiFlavorReport {
  characters: number;
  hits: AiFlavorHit[];
  blockingCount: number;
  advisoryCount: number;
  densityPerThousand: number;
  risk: "低" | "中" | "高";
}

export interface AiFlavorWhitelistRange {
  start: number;
  end: number;
}

export interface AiFlavorOptions {
  whitelist?: ReadonlyArray<{ start: number; end: number }>;
  lexicon?: readonly AiFlavorFeature[];
}

interface NormalizedRange {
  start: number;
  end: number;
}

// 正则统一带 gmu：g 用于遍历，m 让 ^ 在每段行首生效，u 保证中文与代理对处理一致。
const REGEXP_FLAGS = "gmu";
// 风险阈值以「每千字命中数」定义：0–2 低、3–5 中、>5 高。加极小容差抵消浮点误差。
const DENSITY_MEDIUM = 3;
const DENSITY_HIGH = 5;
const DENSITY_EPSILON = 1e-9;
const WHITESPACE = /\s/;

function normalizeRanges(
  ranges: ReadonlyArray<{ start: number; end: number }> | undefined,
  length: number,
): NormalizedRange[] {
  if (!ranges?.length) return [];
  const normalized: NormalizedRange[] = [];
  for (const range of ranges) {
    if (!range) continue;
    const start = Math.max(0, Math.floor(Number(range.start)));
    const end = Math.min(length, Math.ceil(Number(range.end)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    normalized.push({ start, end });
  }
  normalized.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: NormalizedRange[] = [];
  for (const range of normalized) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function intersects(ranges: readonly NormalizedRange[], start: number, end: number): boolean {
  for (const range of ranges) {
    if (range.start >= end) break;
    if (start < range.end && end > range.start) return true;
  }
  return false;
}

// 白名单区间只影响统计口径：命中落点与区间相交则不计，有效字数也扣除区间内字符。
// 匹配仍在原文上运行，避免把白名单切掉后把前后文拼接出新的误命中。
function stripRanges(text: string, ranges: readonly NormalizedRange[]): string {
  if (ranges.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.join("");
}

function countCharacters(text: string): number {
  let count = 0;
  for (const char of text) {
    if (!WHITESPACE.test(char)) count += 1;
  }
  return count;
}

function compileFeature(feature: AiFlavorFeature): RegExp | null {
  if (!feature.isRegExp) return null;
  try {
    return new RegExp(feature.pattern, REGEXP_FLAGS);
  } catch {
    // 自定义词表里出现非法正则时跳过该项，绝不让统计抛错。
    return null;
  }
}

function evaluateFeature(
  text: string,
  feature: AiFlavorFeature,
  whitelist: readonly NormalizedRange[],
  scale: number,
): AiFlavorHit | null {
  const positions: number[] = [];
  if (feature.isRegExp) {
    const regex = compileFeature(feature);
    if (!regex) return null;
    for (const match of text.matchAll(regex)) {
      const index = match.index;
      const matched = match[0];
      if (typeof index !== "number" || matched.length === 0) continue;
      if (!intersects(whitelist, index, index + matched.length)) positions.push(index);
    }
  } else {
    if (!feature.pattern) return null;
    let index = text.indexOf(feature.pattern);
    while (index !== -1) {
      if (!intersects(whitelist, index, index + feature.pattern.length)) positions.push(index);
      index = text.indexOf(feature.pattern, index + feature.pattern.length);
    }
  }
  if (positions.length === 0) return null;
  return {
    featureId: feature.id,
    label: feature.label,
    severity: feature.severity,
    count: positions.length,
    perThousand: scale > 0 ? positions.length / scale : 0,
    positions,
  };
}

function resolveRisk(densityPerThousand: number): AiFlavorReport["risk"] {
  if (densityPerThousand > DENSITY_HIGH + DENSITY_EPSILON) return "高";
  if (densityPerThousand >= DENSITY_MEDIUM - DENSITY_EPSILON) return "中";
  return "低";
}

function summarizeHits(
  hits: readonly AiFlavorHit[],
  characters: number,
): Pick<AiFlavorReport, "blockingCount" | "advisoryCount" | "densityPerThousand" | "risk"> {
  let blockingCount = 0;
  let advisoryCount = 0;
  for (const hit of hits) {
    if (hit.severity === "blocking") blockingCount += hit.count;
    else advisoryCount += hit.count;
  }
  // 命中数不直接用绝对值分级，而是先按有效字数折算成每千字频率（scale = 有效字数 / 1000），
  // 这样 300 字短章与 3000 字长章可以直接比较；文本越短频率估计越不稳定，面板应同时展示绝对次数。
  const scale = characters > 0 ? characters / 1000 : 0;
  const densityPerThousand = scale > 0 ? (blockingCount + advisoryCount) / scale : 0;
  return { blockingCount, advisoryCount, densityPerThousand, risk: resolveRisk(densityPerThousand) };
}

export function analyzeAiFlavor(text: string, options: AiFlavorOptions = {}): AiFlavorReport {
  const source = typeof text === "string" ? text : "";
  const lexicon = Array.isArray(options?.lexicon) ? options.lexicon : AI_FLAVOR_FEATURES;
  const whitelist = normalizeRanges(options?.whitelist, source.length);
  const characters = countCharacters(stripRanges(source, whitelist));
  const scale = characters > 0 ? characters / 1000 : 0;
  const hits: AiFlavorHit[] = [];
  for (const feature of lexicon) {
    if (!feature || typeof feature.id !== "string" || typeof feature.pattern !== "string") continue;
    const hit = evaluateFeature(source, feature, whitelist, scale);
    if (hit) hits.push(hit);
  }
  return { characters, hits, ...summarizeHits(hits, characters) };
}

export function mergeAiFlavorReports(reports: readonly AiFlavorReport[]): AiFlavorReport {
  const order: string[] = [];
  const totals = new Map<string, { label: string; severity: "blocking" | "advisory"; count: number }>();
  let characters = 0;
  for (const report of reports ?? []) {
    if (!report) continue;
    characters += Number.isFinite(report.characters) ? report.characters : 0;
    for (const hit of report.hits ?? []) {
      const existing = totals.get(hit.featureId);
      if (existing) {
        existing.count += hit.count;
      } else {
        order.push(hit.featureId);
        totals.set(hit.featureId, { label: hit.label, severity: hit.severity, count: hit.count });
      }
    }
  }
  const scale = characters > 0 ? characters / 1000 : 0;
  const hits: AiFlavorHit[] = order.map((featureId) => {
    const total = totals.get(featureId)!;
    return {
      featureId,
      label: total.label,
      severity: total.severity,
      count: total.count,
      perThousand: scale > 0 ? total.count / scale : 0,
      // 跨章节合并后偏移量不再指向同一段文本，位置一律清空。
      positions: [],
    };
  });
  return { characters, hits, ...summarizeHits(hits, characters) };
}

export function formatAiFlavorReport(report: AiFlavorReport): string {
  const hits = Array.isArray(report.hits) ? report.hits : [];
  const total = report.blockingCount + report.advisoryCount;
  const segments = [
    `AI 味观察：${report.characters} 字，命中 ${total} 次（${report.densityPerThousand.toFixed(1)} 次/千字），风险${report.risk}`,
  ];
  if (report.blockingCount > 0) segments.push(`一级禁用 ${report.blockingCount} 次`);
  if (report.advisoryCount > 0) segments.push(`观察项 ${report.advisoryCount} 次`);
  const top = [...hits]
    .sort(
      (left, right) =>
        right.count - left.count || (left.featureId < right.featureId ? -1 : left.featureId > right.featureId ? 1 : 0),
    )
    .slice(0, 3);
  if (top.length > 0) {
    segments.push(`主要命中：${top.map((hit) => `${hit.label} ${hit.count} 次`).join("、")}`);
  }
  return `${segments.join("；")}。`;
}

/**
 * 把白名单词条在正文中的出现位置展开成区间（半开区间 [start, end)）。
 * 词条按字面量匹配，不做正则；同一词条多次出现全部展开。
 */
export function whitelistRangesFor(text: string, terms: readonly string[]): AiFlavorWhitelistRange[] {
  const ranges: AiFlavorWhitelistRange[] = [];
  for (const term of terms) {
    const needle = term.trim();
    if (!needle) continue;
    let index = text.indexOf(needle);
    while (index >= 0) {
      ranges.push({ start: index, end: index + needle.length });
      index = text.indexOf(needle, index + needle.length);
    }
  }
  return ranges;
}
