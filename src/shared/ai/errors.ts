import { AppError } from "../error-codes";

/** 供应商错误的语义分类，供重试、降档与提示文案复用。 */
export type ProviderErrorKind =
  | "auth"
  | "permission"
  | "quota"
  | "rate_limit"
  | "context_length"
  | "content_filter"
  | "model_not_found"
  | "invalid_request"
  | "unsupported_capability"
  | "server"
  | "network"
  | "timeout"
  | "cancelled";

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface ProviderErrorInput {
  status?: number;
  code?: string;
  detail?: string;
  retryAfter?: string | null;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

const CAPABILITY_HINTS =
  /(unsupported|not supported|unknown|not found|does not exist|invalid|cannot|can't|no such|method not allowed|不支持|未实现)/i;
const CAPABILITY_TARGETS =
  /(responses(?:\s+api)?|\/responses|response.?format|json.?mode|stream(?:ing)?|stream.?options|include.?usage|max[_\s-]?(?:output[_\s-]?)?tokens?|endpoint|route|url)/i;
const CONTEXT_HINTS =
  /(context.?(?:length|window)|too many tokens|maximum context|token.{0,20}(?:exceed|limit)|上下文|超出.{0,6}长度)/i;
const CONTENT_FILTER_HINTS = /(content.?filter|content.?policy|safety|moderation|违规|内容政策|内容安全)/i;
const QUOTA_HINTS = /(quota|insufficient|balance|余额|额度|欠费)/i;
const MODEL_HINTS =
  /(model_not_found|unknown model|no such model|model.{0,20}(?:not found|does not exist|not exist|unsupported|下线|不存在))/i;
const TIMEOUT_HINTS = /(timed?\s*out|etimedout|econnreset|abort_?err|超时)/i;
const CANCEL_HINTS = /(task_cancelled|任务已取消)/i;

export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10 * 60_000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(at - Date.now(), 0), 10 * 60_000);
}

export function classifyProviderError(input: ProviderErrorInput): ProviderErrorClassification {
  const status = input.status;
  const detail = input.detail ?? "";
  const code = input.code ?? "";
  const retryAfterMs = parseRetryAfterMs(input.retryAfter);

  if (CANCEL_HINTS.test(code) || CANCEL_HINTS.test(detail)) return { kind: "cancelled", retryable: false };
  if (status === 408 || TIMEOUT_HINTS.test(code) || TIMEOUT_HINTS.test(detail))
    return { kind: "timeout", retryable: true };
  if (status === 401) return { kind: "auth", retryable: false };
  if (status === 403) return { kind: "permission", retryable: false };
  if (status === 402 || (status === 429 && QUOTA_HINTS.test(detail)) || QUOTA_HINTS.test(detail))
    return { kind: "quota", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true, retryAfterMs };
  if (status === 404 && MODEL_HINTS.test(detail)) return { kind: "model_not_found", retryable: false };
  if (MODEL_HINTS.test(detail)) return { kind: "model_not_found", retryable: false };
  if (CONTEXT_HINTS.test(detail)) return { kind: "context_length", retryable: false };
  if (CONTENT_FILTER_HINTS.test(detail)) return { kind: "content_filter", retryable: false };
  if (
    (status === 400 || status === 404 || status === 405 || status === 422) &&
    CAPABILITY_TARGETS.test(detail) &&
    CAPABILITY_HINTS.test(detail)
  )
    return { kind: "unsupported_capability", retryable: false };
  if (status !== undefined && status >= 500) return { kind: "server", retryable: RETRYABLE_STATUSES.has(status) };
  if (status === undefined) return { kind: "network", retryable: true };
  return { kind: "invalid_request", retryable: false };
}

/** 构造与既有审计/UI 兼容的供应商错误；分类结果决定可重试性。 */
export function providerError(status: number, detail: string): AppError {
  const compact = detail.replace(/\s+/g, " ").slice(0, 300);
  const retryable = RETRYABLE_STATUSES.has(status);
  return new AppError(
    retryable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_HTTP_ERROR",
    retryable ? `模型服务暂时不可用 ${status}: ${compact}` : `模型接口返回 ${status}: ${compact}`,
    { retryable },
  );
}
