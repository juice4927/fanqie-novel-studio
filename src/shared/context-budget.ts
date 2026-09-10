/**
 * 上下文预算：由所选模型的上下文窗口推导，而不是固定值或无限。
 * 云端模型按当前主流大模型窗口取值（1M）；本地端点受显存限制，按常见上限取值。
 * 这只是"未知窗口"时的兜底：探测结果或作者填写值优先。
 */
export const DEFAULT_CLOUD_CONTEXT_WINDOW = 1_000_000;
export const DEFAULT_LOCAL_CONTEXT_WINDOW = 32_000;

/** 为输出与推理预留的空间；目录给出 maxOutputTokens 时以它为准。 */
const OUTPUT_RESERVE_TOKENS = 8_000;
/** 系统提示、任务模板与输出 schema 的固定开销估算。 */
const FIXED_OVERHEAD_TOKENS = 6_000;
/** 估算器误差余量。 */
const SAFETY_MARGIN_TOKENS = 2_000;
/** 估算偏乐观，按比例打折后使用。 */
const BUDGET_RATIO = 0.75;

export const MIN_CONTEXT_BUDGET_TOKENS = 8_000;

export interface ContextWindowInput {
  /** 探测或作者填写的窗口；null/undefined 表示未知。 */
  contextWindow?: number | null;
  /** 本地模型端点：走受控直连的来源。 */
  localEndpoint?: boolean;
}

/** 未知窗口时按来源类型取默认值，不因为填错而牺牲装填量。 */
export function resolveContextWindow(input: ContextWindowInput = {}): number {
  const explicit = input.contextWindow;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return input.localEndpoint ? DEFAULT_LOCAL_CONTEXT_WINDOW : DEFAULT_CLOUD_CONTEXT_WINDOW;
}

export interface ContextBudgetOptions {
  /** 输出预留；缺省 8k。 */
  outputReserveTokens?: number;
  /** 固定开销；缺省 6k。 */
  fixedOverheadTokens?: number;
}

/**
 * 单次请求可用于上下文的 token 预算。
 * 预算只约束上下文正文，不包含系统提示、任务模板与输出 schema 的固定开销。
 */
export function contextBudgetTokens(contextWindow: number, options: ContextBudgetOptions = {}): number {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : DEFAULT_CLOUD_CONTEXT_WINDOW;
  const usable =
    window -
    (options.outputReserveTokens ?? OUTPUT_RESERVE_TOKENS) -
    (options.fixedOverheadTokens ?? FIXED_OVERHEAD_TOKENS) -
    SAFETY_MARGIN_TOKENS;
  return Math.max(MIN_CONTEXT_BUDGET_TOKENS, Math.floor(usable * BUDGET_RATIO));
}

/**
 * 各段配额缩放的校准基准：128k 窗口下的预算。
 * 与默认窗口解耦——默认窗口提到 1M 只影响"未知窗口"的装填量，
 * 已探测或已填写的小窗口模型仍按原基准收缩，不会因为改默认值被额外压缩。
 */
export const CONTEXT_REFERENCE_WINDOW = 128_000;
export const CONTEXT_REFERENCE_BUDGET_TOKENS = contextBudgetTokens(CONTEXT_REFERENCE_WINDOW);

/** 预算相对参考预算的比例，限制在 0.15–1，避免小窗口把每段压到 0。 */
export function contextScale(budgetTokens: number): number {
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) return 1;
  return Math.min(1, Math.max(0.15, budgetTokens / CONTEXT_REFERENCE_BUDGET_TOKENS));
}

/** 按预算比例收缩一个上限；下限保证小窗口下仍保留最小可用信息。 */
export function scaledCap(maximum: number, minimum: number, budgetTokens: number): number {
  return Math.max(minimum, Math.round(maximum * contextScale(budgetTokens)));
}
