import { AppError } from "../src/shared/error-codes";
import type { AiProtocol } from "../src/shared/types";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

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

export function parseProviderUsage(body: unknown): ProviderUsage {
  const usage = (body as { usage?: Record<string, unknown> })?.usage ?? {};
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
  };
}

export function rejectsJsonMode(status: number, detail: string) {
  return status === 400 && /response.?format|json.?mode|unsupported/i.test(detail);
}

export function rejectsStreaming(status: number, detail: string) {
  return status === 400 && /stream(?:ing)?[^\n]{0,80}(?:unsupported|not supported|不支持|invalid)/i.test(detail);
}

export function rejectsResponsesApi(status: number, detail: string) {
  if (status === 405) return /(?:method not allowed|unsupported|not supported|unknown)/i.test(detail);
  if (![400, 404].includes(status)) return false;
  const endpointMentioned = /(?:responses(?:\s+api)?|\/responses|endpoint|route|url)/i.test(detail);
  const unsupported =
    /(?:unsupported|not supported|unknown|not found|does not exist|invalid|cannot|can't|no such)/i.test(detail);
  return endpointMentioned && unsupported;
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

export function normalizeProviderUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("模型 API 地址必须使用 HTTPS");
  if (url.username || url.password) throw new Error("模型 API 地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("模型 API 基础地址不能包含查询参数或片段");
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/+$/, "");
}

export function parseResponsesOutput(body: unknown) {
  const response = body as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("");
}

export function parseResponsesRefusal(body: unknown): string | null {
  const response = body as {
    refusal?: unknown;
    output?: Array<{
      content?: Array<{ type?: string; refusal?: unknown; text?: unknown }>;
    }>;
  };
  if (typeof response.refusal === "string" && response.refusal.trim()) return response.refusal;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type !== "refusal") continue;
      const refusal = content.refusal ?? content.text;
      if (typeof refusal === "string" && refusal.trim()) return refusal;
    }
  }
  return null;
}

export function parseAnthropicOutput(body: unknown) {
  const response = body as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (response.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

function parseSseData(event: string) {
  const values = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((value) => value && value !== "[DONE]");
  if (!values.length) return [];
  const independentlyParsed: unknown[] = [];
  try {
    for (const value of values) independentlyParsed.push(JSON.parse(value));
    return independentlyParsed;
  } catch {
    return [JSON.parse(values.join("\n"))];
  }
}

export async function readChatCompletionStream(
  response: Response,
  onActivity: () => void,
  onContent: (delta: string) => void = () => {},
) {
  if (!response.body) throw new Error("模型流式响应缺少正文");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  const consume = (event: string) => {
    for (const value of parseSseData(event)) {
      const chunk = value as {
        choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
        usage?: Record<string, unknown>;
      };
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
      content += delta;
      if (delta) onContent(delta);
      if (chunk.usage) usage = parseProviderUsage(chunk);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) consume(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  return { content, usage };
}

export async function readResponsesStream(
  response: Response,
  onActivity: () => void,
  onContent: (delta: string) => void = () => {},
) {
  if (!response.body) throw new Error("模型流式响应缺少正文");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let refusal = "";
  let terminal: "completed" | "failed" | "incomplete" | null = null;
  let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  const consume = (event: string) => {
    for (const value of parseSseData(event)) {
      const chunk = value as {
        type?: string;
        delta?: string | null;
        message?: string;
        response?: {
          usage?: Record<string, unknown>;
          refusal?: unknown;
          output?: Array<{ content?: Array<{ type?: string; refusal?: unknown; text?: unknown }> }>;
          error?: { message?: string };
          incomplete_details?: { reason?: string };
        };
        usage?: Record<string, unknown>;
        error?: { message?: string } | string;
      };
      if (chunk.type === "response.output_text.delta") {
        const delta = typeof chunk.delta === "string" ? chunk.delta : "";
        content += delta;
        if (delta) onContent(delta);
      }
      if (chunk.type === "response.refusal.delta") {
        const delta = typeof chunk.delta === "string" ? chunk.delta : "";
        refusal += delta;
      }
      if (chunk.type === "response.completed") {
        terminal = "completed";
        if (chunk.response) {
          usage = parseProviderUsage(chunk.response);
          refusal ||= parseResponsesRefusal(chunk.response) ?? "";
        }
      }
      if (chunk.usage) usage = parseProviderUsage(chunk);
      if (chunk.type === "error" || chunk.error) {
        const errorMessage = typeof chunk.error === "string" ? chunk.error : chunk.error?.message;
        throw new Error(errorMessage ?? chunk.message ?? "Responses API 流式请求失败");
      }
      if (chunk.type === "response.failed") {
        terminal = "failed";
        throw new Error(chunk.response?.error?.message ?? "Responses API 请求失败");
      }
      if (chunk.type === "response.incomplete") {
        terminal = "incomplete";
        throw new Error(chunk.response?.incomplete_details?.reason ?? "Responses API 未完成输出");
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) consume(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!terminal) throw new Error("Responses API 流式响应未收到完成事件");
  if (refusal.trim()) throw new Error(`模型拒绝生成内容：${refusal.trim()}`);
  return { content, usage };
}

export async function readAnthropicStream(
  response: Response,
  onActivity: () => void,
  onContent: (delta: string) => void = () => {},
) {
  if (!response.body) throw new Error("模型流式响应缺少正文");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopReason: string | null = null;
  let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  const consume = (event: string) => {
    for (const value of parseSseData(event)) {
      const chunk = value as {
        type?: string;
        message?: { usage?: Record<string, unknown> };
        delta?: { type?: string; text?: string; stop_reason?: string | null };
        usage?: Record<string, unknown>;
        error?: { message?: string };
      };
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        const delta = chunk.delta.text ?? "";
        content += delta;
        if (delta) onContent(delta);
      }
      if (chunk.type === "message_start" && chunk.message?.usage) {
        usage = parseProviderUsage(chunk.message);
      }
      if (chunk.type === "message_delta" && chunk.usage) {
        const deltaUsage = parseProviderUsage(chunk);
        usage = {
          inputTokens: usage.inputTokens || deltaUsage.inputTokens,
          outputTokens: deltaUsage.outputTokens || usage.outputTokens,
        };
      }
      if (chunk.type === "message_delta" && chunk.delta?.stop_reason) stopReason = chunk.delta.stop_reason;
      if (chunk.type === "error" || chunk.error)
        throw new Error(chunk.error?.message ?? "Anthropic Messages API 流式请求失败");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) consume(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  return { content, usage, stopReason };
}

export class JsonStringFieldExtractor {
  private searchBuffer = "";
  private started = false;
  private finished = false;
  private escaped = false;
  private unicodeDigits: string | null = null;

  constructor(
    private readonly field: string,
    private readonly onValue: (delta: string) => void,
  ) {}

  push(fragment: string) {
    if (this.finished || !fragment) return;
    if (!this.started) {
      this.searchBuffer += fragment;
      const match = new RegExp(`"${this.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`).exec(
        this.searchBuffer,
      );
      if (!match) {
        this.searchBuffer = this.searchBuffer.slice(-Math.max(256, this.field.length + 16));
        return;
      }
      this.started = true;
      fragment = this.searchBuffer.slice((match.index ?? 0) + match[0].length);
      this.searchBuffer = "";
    }

    let decoded = "";
    for (const character of fragment) {
      if (this.unicodeDigits !== null) {
        this.unicodeDigits += character;
        if (this.unicodeDigits.length === 4) {
          decoded += String.fromCharCode(Number.parseInt(this.unicodeDigits, 16));
          this.unicodeDigits = null;
        }
        continue;
      }
      if (this.escaped) {
        this.escaped = false;
        if (character === "u") this.unicodeDigits = "";
        else
          decoded +=
            ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[character] ?? character;
        continue;
      }
      if (character === "\\") this.escaped = true;
      else if (character === '"') {
        this.finished = true;
        break;
      } else decoded += character;
    }
    if (decoded) this.onValue(decoded);
  }
}

export function providerError(status: number, detail: string) {
  const compact = detail.replace(/\s+/g, " ").slice(0, 300);
  const retryable = [429, 500, 502, 503, 504, 529].includes(status);
  return new AppError(
    retryable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_HTTP_ERROR",
    retryable ? `模型服务暂时不可用 ${status}: ${compact}` : `模型接口返回 ${status}: ${compact}`,
    { retryable },
  );
}
