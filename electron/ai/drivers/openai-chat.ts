import { withQuery } from "../../../src/shared/ai/provider-url";
import { createAsyncQueue } from "../async-queue";
import { readProviderError, sendProviderRequest } from "../transport";
import { normalizeSseText, parseSseData } from "./sse";
import type { DriverConfig, DriverFinishReason, DriverRequest, DriverResult, ModelDriver, StreamPart } from "./types";
import { type ProviderUsage, parseProviderUsage } from "./usage";

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
  let finishReason: DriverFinishReason = "stop";
  const consume = (event: string) => {
    for (const value of parseSseData(event)) {
      const chunk = value as {
        choices?: Array<{
          delta?: { content?: string | null };
          message?: { content?: string | null };
          finish_reason?: string | null;
        }>;
        usage?: Record<string, unknown>;
      };
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
      content += delta;
      if (delta) onContent(delta);
      if (chunk.choices?.[0]?.finish_reason === "length") finishReason = "length";
      if (chunk.usage) usage = parseProviderUsage(chunk);
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
  return { content, usage, finishReason };
}

function buildChatBody(request: DriverRequest, stream: boolean) {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    ...(request.structuredOutput === "prompt-only" ? {} : { response_format: { type: "json_object" } }),
    ...(stream ? { stream: true } : {}),
    ...(stream && request.includeStreamUsage ? { stream_options: { include_usage: true } } : {}),
    messages: [
      { role: "system", content: `${request.system}\n只返回合法 JSON，不使用 Markdown。` },
      { role: "user", content: request.user },
    ],
  };
}

function parseChatBody(body: unknown) {
  const parsed = body as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const choice = parsed.choices?.[0];
  const finishReason: DriverFinishReason = choice?.finish_reason === "length" ? "length" : "stop";
  return { text: choice?.message?.content ?? "", finishReason };
}

export function createOpenAiChatDriver(config: DriverConfig): ModelDriver {
  const endpoint = withQuery(`${config.baseUrl}/chat/completions`, config.extraQuery);
  const headers = { ...(config.authHeaders ?? { Authorization: `Bearer ${config.apiKey}` }), ...config.extraHeaders };
  return {
    apiSurface: "openai-chat",
    endpoint,
    async generate(request) {
      const response = await sendProviderRequest({
        url: endpoint,
        headers,
        body: buildChatBody(request, false),
        signal: request.signal,
        local: config.localEndpoint,
      });
      if (!response.ok) throw await readProviderError(response);
      const body = await response.json();
      const { text, finishReason } = parseChatBody(body);
      return { text, usage: parseProviderUsage(body), finishReason };
    },
    async stream(request) {
      const response = await sendProviderRequest({
        url: endpoint,
        headers,
        body: buildChatBody(request, true),
        signal: request.signal,
        local: config.localEndpoint,
      });
      if (!response.ok) throw await readProviderError(response);
      const queue = createAsyncQueue<StreamPart>();
      const result = (async (): Promise<DriverResult> => {
        try {
          if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
            const streamed = await readChatCompletionStream(
              response,
              () => queue.push({ type: "activity" }),
              (text) => queue.push({ type: "text-delta", text }),
            );
            queue.push({ type: "usage", usage: streamed.usage });
            queue.push({ type: "finish", reason: streamed.finishReason });
            return { text: streamed.content, usage: streamed.usage, finishReason: streamed.finishReason };
          }
          const body = await response.json();
          const { text, finishReason } = parseChatBody(body);
          const usage = parseProviderUsage(body);
          if (text) queue.push({ type: "text-delta", text });
          queue.push({ type: "usage", usage });
          queue.push({ type: "finish", reason: finishReason });
          return { text, usage, finishReason };
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
