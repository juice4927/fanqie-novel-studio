import { describe, expect, it } from "vitest";
import { readChatCompletionStream } from "../electron/ai/drivers/openai-chat";
import { normalizeSseText, parseSseData } from "../electron/ai/drivers/sse";

describe("SSE 解析", () => {
  it("一个事件里的多个完整 JSON 行各自解析", () => {
    const parsed = parseSseData('data: {"a":1}\ndata: {"b":2}');
    expect(parsed).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("JSON 在字符串中间被切开时按无分隔拼接", () => {
    const parsed = parseSseData('data: {"content":"abc\ndata: def"}');
    expect(parsed).toEqual([{ content: "abcdef" }]);
  });

  it("被切开的 JSON 中间的空格不会被吞掉", () => {
    const parsed = parseSseData('data: {"content":"a \ndata: b"}');
    expect(parsed).toEqual([{ content: "a b" }]);
  });

  it("多行 JSON 退回归并换行解析", () => {
    const parsed = parseSseData('data: {\ndata: "a": 1\ndata: }');
    expect(parsed).toEqual([{ a: 1 }]);
  });

  it("[DONE] 与空行仍被过滤", () => {
    expect(parseSseData("data: [DONE]\n\n")).toEqual([]);
    expect(parseSseData("event: ping")).toEqual([]);
  });

  it("裸 CR 也作为换行处理，末尾孤立 CR 留给下一块", () => {
    expect(normalizeSseText("a\rb\r\nc")).toBe("a\nb\nc");
    expect(normalizeSseText("chunk\r")).toBe("chunk\r");
    expect(normalizeSseText("chunk\r\n")).toBe("chunk\n");
  });

  it("裸 CR 分隔的流式响应仍能解析", async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "你" } }] })}\r\rdata: ${JSON.stringify({
      choices: [{ delta: { content: "好" } }],
    })}\r\rdata: [DONE]\r\r`;
    const response = new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    const streamed = await readChatCompletionStream(response, () => {});
    expect(streamed.content).toBe("你好");
  });
});
