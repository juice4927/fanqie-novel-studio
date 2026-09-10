import { BASE_MAJOR_STATE_KEYWORDS } from "./major-state-change";
import type { LedgerFact, LedgerKind, StorySummary, SummaryLayer } from "./types";

/**
 * 记忆检索按查询打分（NOVEL_ENGINE_OPTIMIZATION_PLAN 阶段三）。
 *
 * 纯函数模块：不依赖 electron / React，渲染进程与主进程可共用（AGENTS.md 规则 4）。
 * 打分沿用 Generative Agents 的思路，但只做确定性字符串匹配，不引入向量与第三方依赖：
 *   score = RELEVANCE_WEIGHT * relevance + IMPORTANCE_WEIGHT * importance + RECENCY_WEIGHT * recency
 * 每个分量都归一化到 [0,1]，因此 score 也落在 [0,1]。
 */

export interface MemoryBrief {
  chapterNumber: number;
  /** 章纲 + 承诺 + 回报 + 危机 + 结尾期待。 */
  text: string;
  /** 复用阶段二的别名表与专名提取。 */
  properNouns: readonly string[];
}

export interface RankedSummaryNode {
  summary: StorySummary;
  score: number;
  relevance: number;
  importance: number;
  recency: number;
}

export interface MemoryRetrievalOptions {
  /** 记忆半衰期（章）；缺省 {@link DEFAULT_HALF_LIFE}。 */
  halfLife?: number;
}

/** 相关性权重：查询专名与关键词命中。 */
export const RELEVANCE_WEIGHT = 0.5;
/** 重要度权重：层级 / 重大状态变化 / 伏笔回收标记。 */
export const IMPORTANCE_WEIGHT = 0.3;
/** 时间近因权重：越靠近当前章越值钱。 */
export const RECENCY_WEIGHT = 0.2;

/** 默认半衰期：40 章后近因权重衰减到约 0.37。 */
export const DEFAULT_HALF_LIFE = 40;
/** 缺少层级 / 类型信号时的中性重要度。 */
export const NEUTRAL_IMPORTANCE = 0.5;

/**
 * 摘要层级的基础重要度：章节层取中性默认 0.5，其余层按信息密度上下浮动。
 * 场景只是一段正文，重要度最低；全书 / 分卷承载主线约束，重要度最高。
 */
export const SUMMARY_LAYER_IMPORTANCE: Readonly<Record<SummaryLayer, number>> = {
  场景: 0.4,
  章节: 0.5,
  十章阶段: 0.6,
  分卷: 0.7,
  全书: 0.8,
};

/**
 * 事实类型的基础重要度：秘密 / 伏笔关系到后续兑现，权重最高；
 * 地点 / 时间线 / 资源属于背景信息，权重最低。
 */
export const FACT_KIND_IMPORTANCE: Readonly<Record<LedgerKind, number>> = {
  人物: 0.6,
  关系: 0.6,
  能力: 0.55,
  资源: 0.5,
  地点: 0.5,
  时间线: 0.5,
  秘密: 0.7,
  承诺: 0.6,
  伏笔: 0.7,
  支线: 0.55,
  事件: 0.6,
};

/** 命中重大状态变化关键词（major-state-change.ts 的通用表）的加权。 */
const MAJOR_STATE_BONUS = 0.1;
/** 命中伏笔 / 揭示 / 高潮等回收标记的加权。 */
const KEY_MARKER_BONUS = 0.1;
/** 已确认事实比待确认更值得注入。 */
const CONFIRMED_FACT_BONUS = 0.1;
/** 有冲突的事实需要被看见，轻微加权。 */
const CONFLICTED_FACT_BONUS = 0.05;
/** 已忽略的事实降权，但不清零，避免调用方过滤遗漏时彻底丢失。 */
const IGNORED_FACT_PENALTY = 0.15;

const KEY_MARKERS = ["伏笔", "揭示", "真相", "高潮", "转折", "回收", "兑现"] as const;
/** 中文无词边界，用二字滑窗近似词语（与阶段二"最短命中长度 2"一致）。 */
const CJK_NGRAM = 2;
/** 拉丁字母 / 数字片段的最短长度，过滤 a / 1 这类噪声。 */
const MIN_LATIN_TERM = 2;
const TERM_PATTERN = /([a-z0-9]+)|([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)/g;

interface QueryProfile {
  properNouns: readonly string[];
  terms: ReadonlyMap<string, number>;
  totalTermWeight: number;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 全角转半角 + 小写 + 空白折叠；英文名大小写不敏感。 */
function normalizeText(value: string) {
  return value
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalizedText: string) {
  const terms: string[] = [];
  for (const match of normalizedText.matchAll(TERM_PATTERN)) {
    const latin = match[1];
    if (latin) {
      if (latin.length >= MIN_LATIN_TERM) terms.push(latin);
      continue;
    }
    const cjk = match[2] ?? "";
    for (let index = 0; index + CJK_NGRAM <= cjk.length; index += 1) {
      terms.push(cjk.slice(index, index + CJK_NGRAM));
    }
  }
  return terms;
}

function countTerms(terms: readonly string[]) {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function buildQuery(brief: MemoryBrief): QueryProfile {
  const properNouns = [...new Set(brief.properNouns.map(normalizeText).filter((term) => term.length >= CJK_NGRAM))];
  const terms = countTerms(tokenize(normalizeText(brief.text)));
  let totalTermWeight = 0;
  for (const weight of terms.values()) totalTermWeight += weight;
  return { properNouns, terms, totalTermWeight };
}

/** 专名命中率：brief 中的专名有多少出现在目标文本里。 */
function properNounScore(properNouns: readonly string[], normalizedTarget: string) {
  if (!properNouns.length) return 0;
  let hits = 0;
  for (const term of properNouns) {
    if (normalizedTarget.includes(term)) hits += 1;
  }
  return hits / properNouns.length;
}

/** TF 简版：按 brief 中的词频加权，统计有多少词重出现在目标文本里。 */
function termOverlap(query: QueryProfile, normalizedTarget: string) {
  if (query.totalTermWeight <= 0) return 0;
  const targetTerms = new Set(tokenize(normalizedTarget));
  if (!targetTerms.size) return 0;
  let matched = 0;
  for (const [term, weight] of query.terms) {
    if (targetTerms.has(term)) matched += weight;
  }
  return clamp01(matched / query.totalTermWeight);
}

function relevanceScore(query: QueryProfile, normalizedTarget: string) {
  return clamp01(properNounScore(query.properNouns, normalizedTarget) + termOverlap(query, normalizedTarget));
}

function resolveHalfLife(halfLife: number | undefined) {
  return halfLife !== undefined && Number.isFinite(halfLife) && halfLife > 0 ? halfLife : DEFAULT_HALF_LIFE;
}

/** 近因：exp(-(当前章 - 锚点章) / halfLife)，未来节点按最新记忆处理并截断到 [0,1]。 */
function recencyScore(chapterNumber: number, anchorChapter: number, halfLife: number) {
  const age = Math.max(0, chapterNumber - anchorChapter);
  return clamp01(Math.exp(-age / halfLife));
}

function summaryImportance(summary: StorySummary) {
  const base = SUMMARY_LAYER_IMPORTANCE[summary.layer] ?? NEUTRAL_IMPORTANCE;
  const text = `${summary.title}\n${summary.content}`;
  let importance = base;
  if (BASE_MAJOR_STATE_KEYWORDS.some((keyword) => text.includes(keyword))) importance += MAJOR_STATE_BONUS;
  if (KEY_MARKERS.some((keyword) => text.includes(keyword))) importance += KEY_MARKER_BONUS;
  return clamp01(importance);
}

function factImportance(fact: LedgerFact) {
  const base = FACT_KIND_IMPORTANCE[fact.kind] ?? NEUTRAL_IMPORTANCE;
  let importance = base;
  if (fact.confidence === "已确认") importance += CONFIRMED_FACT_BONUS;
  else if (fact.confidence === "有冲突") importance += CONFLICTED_FACT_BONUS;
  else if (fact.confidence === "已忽略") importance -= IGNORED_FACT_PENALTY;
  return clamp01(importance);
}

function compareIds(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSummariesChronologically(left: StorySummary, right: StorySummary) {
  return left.fromChapter - right.fromChapter || left.toChapter - right.toChapter || compareIds(left.id, right.id);
}

/** 稳定排序：分数降序 → 覆盖到更晚的章 → 起始章更早 → id 升序。 */
function compareRankedSummaries(left: RankedSummaryNode, right: RankedSummaryNode) {
  return (
    right.score - left.score ||
    right.summary.toChapter - left.summary.toChapter ||
    left.summary.fromChapter - right.summary.fromChapter ||
    compareIds(left.summary.id, right.summary.id)
  );
}

export function rankSummaryNodes(
  nodes: readonly StorySummary[],
  brief: MemoryBrief,
  options: MemoryRetrievalOptions = {},
): RankedSummaryNode[] {
  const query = buildQuery(brief);
  const halfLife = resolveHalfLife(options.halfLife);
  return nodes
    .map((summary) => {
      const relevance = relevanceScore(query, normalizeText(`${summary.title}\n${summary.content}`));
      const importance = summaryImportance(summary);
      const recency = recencyScore(brief.chapterNumber, summary.toChapter, halfLife);
      return {
        summary,
        relevance,
        importance,
        recency,
        score: RELEVANCE_WEIGHT * relevance + IMPORTANCE_WEIGHT * importance + RECENCY_WEIGHT * recency,
      };
    })
    .sort(compareRankedSummaries);
}

/**
 * collapsed-tree 选节点：先按分数排序，再贪心装入字符预算（单个节点装不下就跳过，
 * 继续尝试更小的节点），最后按 fromChapter 还原时间顺序。
 */
export function selectSummaryNodes(
  nodes: readonly StorySummary[],
  brief: MemoryBrief,
  maxCharacters: number,
  options: MemoryRetrievalOptions = {},
): { selected: StorySummary[]; omitted: number } {
  const ranked = rankSummaryNodes(nodes, brief, options);
  const budget = Number.isFinite(maxCharacters) ? Math.max(0, Math.floor(maxCharacters)) : 0;
  if (budget <= 0) return { selected: [], omitted: nodes.length };
  const selected: StorySummary[] = [];
  let used = 0;
  for (const node of ranked) {
    const cost = node.summary.content.length;
    if (used + cost > budget) continue;
    selected.push(node.summary);
    used += cost;
  }
  selected.sort(compareSummariesChronologically);
  return { selected, omitted: nodes.length - selected.length };
}

interface ScoredFact {
  fact: LedgerFact;
  score: number;
}

/** 稳定排序：分数降序 → validFromChapter 降序（更晚的优先）→ id 升序。 */
function compareRankedFacts(left: ScoredFact, right: ScoredFact) {
  return (
    right.score - left.score ||
    right.fact.validFromChapter - left.fact.validFromChapter ||
    compareIds(left.fact.id, right.fact.id)
  );
}

export function rankFacts(
  facts: readonly LedgerFact[],
  brief: MemoryBrief,
  options: MemoryRetrievalOptions = {},
): LedgerFact[] {
  const query = buildQuery(brief);
  const halfLife = resolveHalfLife(options.halfLife);
  return facts
    .map((fact) => {
      const relevance = relevanceScore(query, normalizeText(`${fact.subject}｜${fact.predicate}｜${fact.value}`));
      const importance = factImportance(fact);
      const recency = recencyScore(brief.chapterNumber, fact.validFromChapter, halfLife);
      return {
        fact,
        score: RELEVANCE_WEIGHT * relevance + IMPORTANCE_WEIGHT * importance + RECENCY_WEIGHT * recency,
      };
    })
    .sort(compareRankedFacts)
    .map((item) => item.fact);
}

/**
 * `buildLongTermMemory` 提供 selection 时的渲染：按时间顺序输出，
 * 层级决定预算，标题尽量沿用固定三层时期的写法，减少 prompt 抖动。
 */
export function renderSelectedSummarySections(
  selection: readonly StorySummary[],
  chapterNumber: number,
  budgets: { book: number; volume: number; stage: number },
  bounded: (content: string, budget: number) => string,
) {
  return [...selection].sort(compareSummariesChronologically).map((summary) => {
    const budget = selectedBudget(summary.layer, budgets);
    return `${selectedSummaryHeader(summary, chapterNumber)}\n${bounded(summary.content, budget)}`;
  });
}

/** 检索命中节点沿用固定三层的预算档位：全书 / 分卷 / 其余（阶段、章节、场景）。 */
function selectedBudget(layer: SummaryLayer, budgets: { book: number; volume: number; stage: number }) {
  if (layer === "全书") return budgets.book;
  if (layer === "分卷") return budgets.volume;
  return budgets.stage;
}

function selectedSummaryHeader(summary: StorySummary, chapterNumber: number) {
  switch (summary.layer) {
    case "全书":
      return "【全书进展】";
    case "分卷":
      // 只有覆盖当前章的分卷才叫"当前分卷"，其余是检索命中的历史卷。
      return summary.fromChapter <= chapterNumber && summary.toChapter >= chapterNumber
        ? "【当前分卷记忆】"
        : `【分卷记忆 ${summary.fromChapter}-${summary.toChapter}】`;
    case "十章阶段":
      return summary.toChapter < chapterNumber
        ? `【近期阶段 ${summary.fromChapter}-${summary.toChapter}】`
        : `【阶段记忆 ${summary.fromChapter}-${summary.toChapter}】`;
    case "章节":
      return `【章节记忆 第${summary.fromChapter}章】`;
    case "场景":
      return `【场景记忆 第${summary.fromChapter}章】`;
  }
}
