import { withQuery } from "../../../src/shared/ai/provider-url";
import { createAsyncQueue } from "../async-queue";
import { readProviderError, sendProviderRequest } from "../transport";
import { normalizeSseText, parseSseData } from "./sse";
import type { DriverConfig, DriverRequest, DriverResult, ModelDriver, StreamPart } from "./types";
import { type ProviderUsage, parseProviderUsage } from "./usage";

export function parseAnthropicOutput(body: unknown) {
  const response = body as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (response.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
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
    buffer = normalizeSseText(`${buffer}${decoder.decode(value, { stream: true })}`);
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) consume(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  return { content, usage, stopReason };
}

function buildAnthropicBody(request: DriverRequest, stream: boolean) {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    ...(stream ? { stream: true } : {}),
    system: `${request.system}\n只返回合法 JSON，不使用 Markdown。`,
    messages: [{ role: "user", content: request.user }],
  };
}

function anthropicEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.hostname.toLowerCase() === "api.anthropic.com" && url.pathname === "/") return `${baseUrl}/v1/messages`;
  return baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;
}

function anthropicFinishReason(stopReason: string | null | undefined): DriverResult["finishReason"] {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "refusal") return "content-filter";
  return "stop";
}

export function createAnthropicMessagesDriver(config: DriverConfig): ModelDriver {
  const endpoint = withQuery(anthropicEndpoint(config.baseUrl), config.extraQuery);
  const headers = {
    ...(config.authHeaders ?? { "x-api-key": config.apiKey }),
    "anthropic-version": "2023-06-01",
    ...config.extraHeaders,
  };
  const parseBody = (body: unknown): DriverResult => {
    const parsed = body as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
    return {
      text: parseAnthropicOutput(body),
      usage: parseProviderUsage(body),
      finishReason: anthropicFinishReason(parsed.stop_reason),
    };
  };
  return {
    apiSurface: "anthropic-messages",
    endpoint,
    async generate(request) {
      const response = await sendProviderRequest({
        url: endpoint,
        headers,
        body: buildAnthropicBody(request, false),
        signal: request.signal,
        local: config.localEndpoint,
      });
      if (!response.ok) throw await readProviderError(response);
      return parseBody(await response.json());
    },
    async stream(request) {
      const response = await sendProviderRequest({
        url: endpoint,
        headers,
        body: buildAnthropicBody(request, true),
        signal: request.signal,
        local: config.localEndpoint,
      });
      if (!response.ok) throw await readProviderError(response);
      const queue = createAsyncQueue<StreamPart>();
      const result = (async (): Promise<DriverResult> => {
        try {
          if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
            const streamed = await readAnthropicStream(
              response,
              () => queue.push({ type: "activity" }),
              (text) => queue.push({ type: "text-delta", text }),
            );
            const finishReason = anthropicFinishReason(streamed.stopReason);
            queue.push({ type: "usage", usage: streamed.usage });
            queue.push({ type: "finish", reason: finishReason });
            return { text: streamed.content, usage: streamed.usage, finishReason };
          }
          const parsed = parseBody(await response.json());
          if (parsed.text) queue.push({ type: "text-delta", text: parsed.text });
          queue.push({ type: "usage", usage: parsed.usage });
          queue.push({ type: "finish", reason: parsed.finishReason });
          return parsed;
        } catch (error) {
          queue.fail(error);
          throw error;
        } finally {
          queue.close();
        }
      })();
      return { parts: queue.iterate(), result };
    },
  };
}
