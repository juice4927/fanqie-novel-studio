import { describe, expect, it, vi } from "vitest";
import {
  aiEndpoint,
  JsonStringFieldExtractor,
  parseAnthropicOutput,
  parseResponsesOutput,
  providerError,
  readAnthropicStream,
  readChatCompletionStream,
  readResponsesStream,
  rejectsResponsesApi,
  rejectsStreaming,
  usesResponsesApi,
} from "../electron/ai-provider";

describe("OpenAI-compatible streaming", () => {
  it("extracts and decodes a JSON content string across arbitrary deltas", () => {
    let content = "";
    const extractor = new JsonStringFieldExtractor("content", (delta) => {
      content += delta;
    });
    for (const part of ['{"title":"标题","con', 'tent":"第一段\\n第', '二段\\u3002","other":1}']) extractor.push(part);
    expect(content).toBe("第一段\n第二段。");
  });

  it("reassembles SSE JSON split across arbitrary network chunks", async () => {
    const encoder = new TextEncoder();
    const parts = [
      'data: {"choices":[{"delta":{"content":"{\\"value\\":"}}]}\r',
      '\n\r\ndata: {"choices":[{"delta":{"content":"1}"}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
      "data: [DONE]\n\n",
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }),
    );
    const activity = vi.fn();

    const result = await readChatCompletionStream(response, activity);

    expect(result).toEqual({ content: '{"value":1}', usage: { inputTokens: 7, outputTokens: 3 } });
    expect(activity).toHaveBeenCalledTimes(3);
  });

  it("accepts multiple complete data lines in one SSE event", async () => {
    const response = new Response(
      [
        'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
        'data: {"choices":[{"delta":{"content":"true}"}}]}',
        "",
        "",
      ].join("\n"),
    );

    await expect(readChatCompletionStream(response, vi.fn())).resolves.toMatchObject({
      content: '{"ok":true}',
    });
  });

  it("recognizes providers that explicitly reject streaming", () => {
    expect(rejectsStreaming(400, "stream is not supported by this model")).toBe(true);
    expect(rejectsStreaming(500, "stream is not supported")).toBe(false);
  });
});

describe("Anthropic Messages API", () => {
  it("builds the messages endpoint without inferring from the model name", () => {
    expect(aiEndpoint("https://api.anthropic.com/v1", "claude-sonnet", false, "anthropic-messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(aiEndpoint("https://api.anthropic.com", "claude-sonnet", false, "anthropic-messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(aiEndpoint("https://proxy.invalid/v1", "claude-sonnet", false, "openai-compatible")).toBe(
      "https://proxy.invalid/v1/chat/completions",
    );
  });

  it("reads all text blocks from a non-streaming message", () => {
    expect(
      parseAnthropicOutput({
        content: [
          { type: "text", text: '{"ok":' },
          { type: "tool_use", id: "ignored" },
          { type: "text", text: "true}" },
        ],
      }),
    ).toBe('{"ok":true}');
  });

  it("reassembles text deltas and combines input/output usage", async () => {
    const encoder = new TextEncoder();
    const parts = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\":"}}\n',
      '\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"true}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }),
    );

    await expect(readAnthropicStream(response, vi.fn())).resolves.toEqual({
      content: '{"ok":true}',
      usage: { inputTokens: 12, outputTokens: 5 },
      stopReason: "end_turn",
    });
  });

  it("surfaces Anthropic error events and treats overload status as retryable", async () => {
    const response = new Response('event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n');
    await expect(readAnthropicStream(response, vi.fn())).rejects.toThrow("overloaded");
    expect(providerError(529, "overloaded_error").message).toContain("暂时不可用");
  });
});

describe("Responses API", () => {
  it("routes GPT models to responses and leaves other models on chat completions", () => {
    expect(usesResponsesApi("gpt-5.1")).toBe(true);
    expect(usesResponsesApi(" GPT-4o ")).toBe(true);
    expect(usesResponsesApi("deepseek-chat")).toBe(false);
    expect(aiEndpoint("https://api.openai.com/v1/", "gpt-5.1")).toBe("https://api.openai.com/v1/responses");
    expect(aiEndpoint("https://model.invalid/v1", "deepseek-chat")).toBe("https://model.invalid/v1/chat/completions");
  });

  it("recognizes endpoints that do not implement the Responses API", () => {
    expect(rejectsResponsesApi(404, "unknown endpoint /responses")).toBe(true);
    expect(rejectsResponsesApi(500, "temporary failure")).toBe(false);
    expect(aiEndpoint("https://model.invalid/v1", "gpt-5.1", false)).toBe("https://model.invalid/v1/chat/completions");
  });

  it("reads output text from a non-streaming response", () => {
    expect(parseResponsesOutput({ output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }] })).toBe(
      '{"ok":true}',
    );
  });

  it("reassembles typed Responses SSE events and usage", async () => {
    const encoder = new TextEncoder();
    const parts = [
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"value\\":"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"1}"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":4}}}\n\n',
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }),
    );

    await expect(readResponsesStream(response, vi.fn())).resolves.toEqual({
      content: '{"value":1}',
      usage: { inputTokens: 9, outputTokens: 4 },
    });
  });

  it("surfaces failed Responses events", async () => {
    const response = new Response(
      'data: {"type":"response.failed","response":{"error":{"message":"context limit"}}}\n\n',
    );
    await expect(readResponsesStream(response, vi.fn())).rejects.toThrow("context limit");
  });
});
