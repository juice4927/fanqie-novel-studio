import { normalizeProviderUrl } from "../src/shared/ai/provider-url";
import type { AiProtocol } from "../src/shared/types";

export {
  classifyProviderError,
  type ProviderErrorClassification,
  type ProviderErrorInput,
  type ProviderErrorKind,
  providerError,
} from "../src/shared/ai/errors";
export { normalizeProviderUrl } from "../src/shared/ai/provider-url";
export { JsonPathStreamExtractor, JsonStringFieldExtractor } from "../src/shared/ai/stream-json";
export { parseAnthropicOutput, readAnthropicStream } from "./ai/drivers/anthropic-messages";
export { readChatCompletionStream } from "./ai/drivers/openai-chat";
export {
  parseResponsesOutput,
  parseResponsesRefusal,
  readResponsesStream,
  rejectsNativeStructuredOutput,
  rejectsResponsesApi,
} from "./ai/drivers/openai-responses";
export { type ProviderUsage, parseProviderUsage } from "./ai/drivers/usage";

export interface ProviderCapabilities {
  jsonMode: boolean;
}

export function inferProviderCapabilities(baseUrl: string): ProviderCapabilities {
  const host = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.endsWith("openai.com") || host.includes("deepseek") || host.includes("dashscope")) return { jsonMode: true };
  return { jsonMode: true };
}

export function rejectsJsonMode(status: number, detail: string) {
  return status === 400 && /response.?format|json.?mode|unsupported/i.test(detail);
}

export function rejectsStreaming(status: number, detail: string) {
  return status === 400 && /stream(?:ing)?[^\n]{0,80}(?:unsupported|not supported|不支持|invalid)/i.test(detail);
}

/** 输出上限被供应商拒绝：请求的 max_tokens / max_output_tokens 超过模型能力。 */
export function rejectsOutputTokenLimit(status: number, detail: string) {
  return status === 400 && /max[_\s-]?(?:output[_\s-]?)?tokens?/i.test(detail);
}

/** 输入超长：窗口未知或估算偏差时，调用方应降低预算重试一次。 */
export function rejectsContextLength(status: number, detail: string) {
  if (status !== 400 && status !== 413) return false;
  return /(?:context length|context_length|maximum context|too many tokens|prompt is too long|input is too long|exceeds? (?:the )?(?:maximum )?(?:context|token)|上下文长度|超出.{0,10}(?:长度|上限))/i.test(
    detail,
  );
}

export function usesResponsesApi(model: string) {
  return /^gpt(?:-|$)/i.test(model.trim());
}

export function supportsReasoning(model: string) {
  return /^(?:gpt-(?:5|6)|o\d)/i.test(model.trim());
}

export function aiEndpoint(
  baseUrl: string,
  model: string,
  useResponses = usesResponsesApi(model),
  protocol: AiProtocol = "openai-compatible",
) {
  const base = normalizeProviderUrl(baseUrl);
  if (protocol === "anthropic-messages") {
    const url = new URL(base);
    if (url.hostname.toLowerCase() === "api.anthropic.com" && url.pathname === "/") return `${base}/v1/messages`;
    return base.endsWith("/messages") ? base : `${base}/messages`;
  }
  return `${base}/${useResponses ? "responses" : "chat/completions"}`;
}
