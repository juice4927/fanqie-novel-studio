import { detectMentions, type MentionHit, type MentionSegment } from "./mention-detection";
import type { SkeletonSection, StoryContract, StoryEntry, StoryEntryKind } from "./types";

export const STORY_ENTRY_KINDS: readonly StoryEntryKind[] = ["人物", "地点", "物品", "势力", "设定", "伏笔"];

export const STORY_ENTRY_AI_CONTEXT_LABELS: Record<StoryEntry["aiContext"], string> = {
  always: "常驻注入",
  detected: "命中才注入",
  detected_excluded: "命中时排除",
  never: "永不注入",
};

export interface StoryEntrySaveContext {
  id: string;
  updatedAt: string;
}

function cleanList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))];
}

export function prepareStoryEntrySave(
  previous: StoryEntry | undefined,
  candidate: StoryEntry,
  context: StoryEntrySaveContext,
): StoryEntry {
  const effectiveFrom = Math.max(1, Math.floor(candidate.effectiveFrom || 1));
  const effectiveTo =
    candidate.effectiveTo === null || candidate.effectiveTo === undefined
      ? null
      : Math.max(effectiveFrom, Math.floor(candidate.effectiveTo));
  const revealChapter =
    candidate.revealChapter === null || candidate.revealChapter === undefined
      ? null
      : Math.max(1, Math.floor(candidate.revealChapter));
  const name = candidate.name.trim();
  return {
    ...candidate,
    id: context.id,
    name,
    aliases: cleanList(candidate.aliases).filter((alias) => alias !== name),
    summary: candidate.summary.trim(),
    detail: candidate.detail.trim(),
    effectiveFrom,
    effectiveTo,
    revealChapter,
    knownBy: cleanList(candidate.knownBy),
    exclusionTerms: cleanList(candidate.exclusionTerms),
    pinned: Boolean(candidate.pinned),
    sourceContractItem: candidate.sourceContractItem ?? previous?.sourceContractItem ?? null,
    updatedAt: context.updatedAt,
  };
}

export function isStoryEntryEffective(entry: StoryEntry, chapterNumber: number): boolean {
  return entry.effectiveFrom <= chapterNumber && (entry.effectiveTo === null || chapterNumber <= entry.effectiveTo);
}

/** 全书专名表，供记忆检索的相关性打分使用。 */
export function storyEntryProperNouns(entries: readonly StoryEntry[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => [entry.name, ...entry.aliases].map((term) => term.trim())).filter(Boolean)),
  ];
}

interface SeedSource {
  kind: StoryEntryKind;
  label: string;
  aiContext: StoryEntry["aiContext"];
  items: readonly string[] | undefined;
}

/** 从条目文本里取一个可用于提及匹配的短名；没有分隔符时取前 16 字兜底，保证条目不丢。 */
function seedName(item: string): string {
  const trimmed = item.trim();
  const match = trimmed.match(/^([^：:，,。；;｜|、\s]{2,16})/);
  return (match?.[1] ?? trimmed.slice(0, 16)).trim();
}

function seedSources(contract: StoryContract): SeedSource[] {
  return [
    { kind: "人物", label: "keyRelationships", aiContext: "detected", items: contract.keyRelationships },
    // 世界规则与时间锚点属于全书硬约束，默认常驻，避免"没提到就不给"导致规则被违反。
    { kind: "设定", label: "worldRules", aiContext: "always", items: contract.worldRules },
    { kind: "势力", label: "majorForces", aiContext: "detected", items: contract.majorForces },
    { kind: "设定", label: "timelineAnchors", aiContext: "always", items: contract.timelineAnchors },
    ...(contract.genreSpecificSections ?? []).map((section: SkeletonSection, index: number) => ({
      kind: "设定" as StoryEntryKind,
      label: `genreSpecificSections:${index}`,
      aiContext: "detected" as StoryEntry["aiContext"],
      items: section.items,
    })),
  ];
}

/**
 * 把契约长列表转成设定条目种子。幂等：同一来源重复调用生成同样的 id，
 * 已存在同 id 条目时由调用方跳过，不覆盖作者编辑过的内容。
 */
export function seedStoryEntriesFromContract(contract: StoryContract, updatedAt: string): StoryEntry[] {
  const entries: StoryEntry[] = [];
  for (const source of seedSources(contract)) {
    (source.items ?? []).forEach((item, index) => {
      const name = seedName(item);
      if ([...name].length < 2) return;
      const detail = item.trim();
      entries.push({
        id: `seed:${source.label}:${index}`,
        kind: source.kind,
        name,
        aliases: [],
        summary: detail.slice(0, 120),
        detail,
        aiContext: source.aiContext,
        effectiveFrom: 1,
        effectiveTo: null,
        revealChapter: null,
        knownBy: [],
        exclusionTerms: [],
        sourceContractItem: source.label,
        pinned: false,
        updatedAt,
      });
    });
  }
  return entries;
}

export interface SelectedStoryEntry {
  entry: StoryEntry;
  hit?: MentionHit;
  /** 未到揭示章：只注入摘要，不注入详述。 */
  revealHidden: boolean;
}

export interface StoryEntrySelection {
  selected: SelectedStoryEntry[];
  omitted: number;
  total: number;
}

/**
 * 本章注入的设定条目。
 *
 * 策略与 Novelcrafter Codex 对齐：
 * - always / pinned：无条件注入；
 * - detected：命中才注入；
 * - detected_excluded：命中时反而排除（正文已经写过，重复注入没有价值）；
 * - never：永不注入。
 */
export function selectStoryEntriesForChapter(input: {
  entries: readonly StoryEntry[];
  chapterNumber: number;
  segments: readonly MentionSegment[];
  limit: number;
  /** 条目段字符预算；按优先级累计，超出后剩余条目计入 omitted。 */
  maxCharacters?: number;
}): StoryEntrySelection {
  const active = input.entries.filter((entry) => isStoryEntryEffective(entry, input.chapterNumber));
  const hits = new Map(detectMentions(active, input.segments).map((hit) => [hit.entryId, hit]));
  const candidates = active
    .filter((entry) => {
      if (entry.aiContext === "never") return false;
      if (entry.aiContext === "detected_excluded") return !hits.has(entry.id);
      if (entry.pinned || entry.aiContext === "always") return true;
      return hits.has(entry.id);
    })
    .map((entry) => ({
      entry,
      hit: hits.get(entry.id),
      revealHidden: entry.revealChapter !== null && entry.revealChapter > input.chapterNumber,
      pinned: entry.pinned || entry.aiContext === "always",
    }))
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        (right.hit?.count ?? 0) - (left.hit?.count ?? 0) ||
        left.entry.name.localeCompare(right.entry.name, "zh-CN"),
    );
  const countLimit = Math.max(0, input.limit);
  const maxCharacters = input.maxCharacters ?? Number.POSITIVE_INFINITY;
  const kept: SelectedStoryEntry[] = [];
  let used = 0;
  let omitted = 0;
  for (const candidate of candidates) {
    if (kept.length >= countLimit) {
      omitted += 1;
      continue;
    }
    const item: SelectedStoryEntry = {
      entry: candidate.entry,
      hit: candidate.hit,
      revealHidden: candidate.revealHidden,
    };
    const cost = renderStoryEntryLine(item).length + 1;
    // 至少保留一条：即使首条就超出字符预算，也不返回空段。
    if (kept.length > 0 && used + cost > maxCharacters) {
      omitted += 1;
      continue;
    }
    used += cost;
    kept.push(item);
  }
  return { selected: kept, omitted, total: active.length };
}

/** 单条详述注入上限：超出时截断，避免一条长设定挤掉整段预算。 */
export const STORY_ENTRY_DETAIL_LIMIT = 600;

export function renderStoryEntryLine(item: SelectedStoryEntry, options: { detailLimit?: number } = {}): string {
  const detailLimit = Math.max(1, options.detailLimit ?? STORY_ENTRY_DETAIL_LIMIT);
  const { entry, hit, revealHidden } = item;
  const tag = entry.pinned || entry.aiContext === "always" ? "常驻" : "提及";
  const reason = hit ? `（命中：${hit.matchedIn}·${hit.matchedTerm}）` : "";
  const knowledge = entry.knownBy.length ? `（知情：${entry.knownBy.join("、")}）` : "";
  const rawBody = revealHidden ? entry.summary || "（尚未揭示）" : entry.detail || entry.summary;
  const body = rawBody.length > detailLimit ? `${rawBody.slice(0, detailLimit)}…` : rawBody;
  const revealNote = revealHidden ? "（未到揭示章，仅给摘要）" : "";
  return `[${tag}] ${entry.name}（${entry.kind}）${knowledge}${reason}：${body}${revealNote}`;
}
