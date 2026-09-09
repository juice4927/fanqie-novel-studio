import { withQuery } from "../../../src/shared/ai/provider-url";
import { createAsyncQueue } from "../async-queue";
import { readProviderError, sendProviderRequest } from "../transport";
import { normalizeSseText, parseSseData } from "./sse";
import type { DriverConfig, DriverRequest, DriverResult, ModelDriver, StreamPart } from "./types";
import { type ProviderUsage, parseProviderUsage } from "./usage";

/** 输出触顶时统一成可识别的截断文案，避免被当成结构错误重试。 */
function incompleteReasonMessage(reason: string | undefined) {
  if (reason === "max_output_tokens") return "模型输出达到输出上限，结果已截断";
  return reason ?? "Responses API 未完成输出";
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

export function rejectsResponsesApi(status: number, detail: string) {
  if (status === 405) return /(?:method not allowed|unsupported|not supported|unknown)/i.test(detail);
  if (![400, 404].includes(status)) return false;
  const endpointMentioned = /(?:responses(?:\s+api)?|\/responses|endpoint|route|url)/i.test(detail);
  const unsupported =
    /(?:unsupported|not supported|unknown|not found|does not exist|invalid|cannot|can't|no such)/i.test(detail);
  return endpointMentioned && unsupported;
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
        throw new Error(incompleteReasonMessage(chunk.response?.incomplete_details?.reason));
      }
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
  if (!terminal) throw new Error("Responses API 流式响应未收到完成事件");
  if (refusal.trim()) throw new Error(`模型拒绝生成内容：${refusal.trim()}`);
  return { content, usage };
}

function buildResponsesBody(request: DriverRequest, stream: boolean) {
  const format =
    request.structuredOutput === "native" && request.schema
      ? {
          type: "json_schema",
          name: request.schemaName ?? "structured_response",
          strict: true,
          schema: request.schema,
        }
      : undefined;
  return {
    model: request.model,
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    max_output_tokens: request.maxOutputTokens,
    store: false,
    ...(stream ? { stream: true } : {}),
    instructions: `${request.system}\n只返回合法 JSON，不使用 Markdown。`,
    input: request.user,
    ...(format ? { text: { format } } : {}),
  };
}

export function createOpenAiResponsesDriver(config: DriverConfig): ModelDriver {
  const endpoint = withQuery(`${config.baseUrl}/responses`, config.extraQuery);
  const headers = { ...(config.authHeaders ?? { Authorization: `Bearer ${config.apiKey}` }), ...config.extraHeaders };
  const parseBody = (body: unknown): DriverResult => {
    const refusal = parseResponsesRefusal(body);
    if (refusal) throw new Error(`模型拒绝生成内容：${refusal}`);
    const incomplete = body as { status?: string; incomplete_details?: { reason?: string } };
    if (incomplete.status === "incomplete")
      throw new Error(incompleteReasonMessage(incomplete.incomplete_details?.reason));
    return { text: parseResponsesOutput(body), usage: parseProviderUsage(body), finishReason: "stop" };
  };
  return {
    apiSurface: "openai-responses",
    endpoint,
    async generate(request) {
      const response = await sendProviderRequest({
        url: endpoint,
        headers,
        body: buildResponsesBody(request, false),
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
        body: buildResponsesBody(request, true),
        signal: request.signal,
        local: config.localEndpoint,
      });
      if (!response.ok) throw await readProviderError(response);
      const queue = createAsyncQueue<StreamPart>();
      const result = (async (): Promise<DriverResult> => {
        try {
          if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
            const streamed = await readResponsesStream(
              response,
              () => queue.push({ type: "activity" }),
              (text) => queue.push({ type: "text-delta", text }),
            );
            queue.push({ type: "usage", usage: streamed.usage });
            queue.push({ type: "finish", reason: "stop" });
            return { text: streamed.content, usage: streamed.usage, finishReason: "stop" };
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
