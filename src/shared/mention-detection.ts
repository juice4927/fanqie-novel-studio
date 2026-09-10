import type { StoryEntry } from "./types";

export type MentionSource = "章纲" | "上章末尾" | "草稿";

export interface MentionSegment {
  source: MentionSource;
  text: string;
}

export interface MentionHit {
  entryId: string;
  /** 命中的原始词形（主名或别名）。 */
  matchedTerm: string;
  matchedIn: MentionSource;
  /** 首次命中位置，用于界面高亮。 */
  position: number;
  /** 该条目在全部扫描段中的命中次数，用于注入排序。 */
  count: number;
}

interface NormalizedTerm {
  normalized: string;
  original: string;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && otherStart < end;
}

/**
 * 归一化：去空白、全角转半角、英文小写。
 * 中文没有词边界，因此不做整词匹配（SillyTavern 文档同样建议 CJK 关闭整词匹配）。
 */
export function normalizeMentionText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

function matchTerms(entry: StoryEntry): NormalizedTerm[] {
  const seen = new Set<string>();
  const terms: NormalizedTerm[] = [];
  for (const raw of [entry.name, ...entry.aliases]) {
    const original = raw.trim();
    const normalized = normalizeMentionText(original);
    if ([...normalized].length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push({ normalized, original });
  }
  return terms;
}

function exclusionRanges(entry: StoryEntry, text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const raw of entry.exclusionTerms) {
    const exclusion = normalizeMentionText(raw);
    if (!exclusion) continue;
    let index = text.indexOf(exclusion);
    while (index >= 0) {
      ranges.push({ start: index, end: index + exclusion.length });
      index = text.indexOf(exclusion, index + 1);
    }
  }
  return ranges;
}

/**
 * 确定性提及检测：主名或任一别名作为子串出现即命中。
 * 与命中区间重叠的排除词会丢弃该次命中；同一位置只计一次。
 */
export function detectMentions(entries: readonly StoryEntry[], segments: readonly MentionSegment[]): MentionHit[] {
  const normalizedSegments = segments
    .filter((segment) => segment.text.trim())
    .map((segment) => ({ source: segment.source, text: normalizeMentionText(segment.text) }));
  const hits: MentionHit[] = [];
  for (const entry of entries) {
    const terms = matchTerms(entry);
    if (!terms.length) continue;
    let firstPosition = -1;
    let firstTerm = "";
    let firstSource: MentionSource | null = null;
    let count = 0;
    for (const segment of normalizedSegments) {
      const excluded = exclusionRanges(entry, segment.text);
      for (const term of terms) {
        let index = segment.text.indexOf(term.normalized);
        while (index >= 0) {
          const end = index + term.normalized.length;
          if (!excluded.some((range) => overlaps(index, end, range.start, range.end))) {
            count += 1;
            if (firstPosition < 0) {
              firstPosition = index;
              firstTerm = term.original;
              firstSource = segment.source;
            }
          }
          index = segment.text.indexOf(term.normalized, index + 1);
        }
      }
    }
    if (count > 0 && firstSource) {
      hits.push({
        entryId: entry.id,
        matchedTerm: firstTerm,
        matchedIn: firstSource,
        position: firstPosition,
        count,
      });
    }
  }
  return hits;
}
