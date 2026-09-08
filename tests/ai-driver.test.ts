import { describe, expect, it, vi } from "vitest";
import type { DriverRequest } from "../electron/ai/drivers";
import { createDriver } from "../electron/ai/drivers";
import { ProviderHttpError } from "../electron/ai/transport";

const baseRequest: DriverRequest = {
  model: "deepseek-chat",
  system: "系统",
  user: "用户",
  schema: null,
  structuredOutput: "json-mode",
  maxOutputTokens: 100,
  temperature: 0.5,
  stream: false,
  signal: new AbortController().signal,
};

describe("协议驱动", () => {
  it("chat 驱动构造请求并解析非流式响应", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const driver = createDriver("openai-chat", { baseUrl: "https://api.example.com/v1", apiKey: "k" });
    const result = await driver.generate(baseRequest);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(result).toMatchObject({ text: "ok", usage: { inputTokens: 3, outputTokens: 2 }, finishReason: "stop" });
  });

  it("供应商返回非 2xx 时抛出带状态码的 ProviderHttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid api key", { status: 401, headers: { "retry-after": "7" } })),
    );
    const driver = createDriver("openai-chat", { baseUrl: "https://api.example.com/v1", apiKey: "k" });

    const error = await driver.generate(baseRequest).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 401, detail: "invalid api key", retryAfter: "7" });
  });

  it("responses 驱动流式返回增量与用量", async () => {
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "你好" })}\n\n`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { usage: { input_tokens: 1, output_tokens: 2 } },
      })}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );

    const driver = createDriver("openai-responses", { baseUrl: "https://api.example.com/v1", apiKey: "k" });
    const streamed = await driver.stream({
      ...baseRequest,
      model: "gpt-5.1",
      structuredOutput: "native",
      stream: true,
    });
    const deltas: string[] = [];
    for await (const part of streamed.parts) if (part.type === "text-delta") deltas.push(part.text);
    const result = await streamed.result;

    expect(deltas).toEqual(["你好"]);
    expect(result.text).toBe("你好");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it("请求流式但供应商返回普通 JSON 时自动退回非流式解析", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "纯 JSON" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const driver = createDriver("openai-chat", { baseUrl: "https://api.example.com/v1", apiKey: "k" });
    const streamed = await driver.stream({ ...baseRequest, stream: true });
    const deltas: string[] = [];
    for await (const part of streamed.parts) if (part.type === "text-delta") deltas.push(part.text);

    expect(deltas).toEqual(["纯 JSON"]);
    await expect(streamed.result).resolves.toMatchObject({ text: "纯 JSON" });
  });

  it("anthropic 驱动把 max_tokens 截断映射为 length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "x" }],
              stop_reason: "max_tokens",
              usage: { input_tokens: 1, output_tokens: 9 },
            }),
            { status: 200 },
          ),
      ),
    );

    const driver = createDriver("anthropic-messages", {
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
    });
    const result = await driver.generate({ ...baseRequest, model: "claude-x", structuredOutput: "prompt-only" });

    expect(driver.endpoint).toBe("https://api.anthropic.com/v1/messages");
    expect(result.finishReason).toBe("length");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 9 });
  });
});
