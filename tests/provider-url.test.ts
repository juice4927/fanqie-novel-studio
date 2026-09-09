import { describe, expect, it } from "vitest";
import { canonicalizeProviderUrl, normalizeProviderUrl } from "../src/shared/ai/provider-url";

describe("模型地址规范化", () => {
  it("从完整端点纠正回基础地址并给出提示", () => {
    const result = canonicalizeProviderUrl("https://api.deepseek.com/v1/chat/completions");
    expect(result.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(result.notices[0]).toContain("/chat/completions");
  });

  it("支持 responses 与 messages 端点后缀", () => {
    expect(canonicalizeProviderUrl("https://api.openai.com/v1/responses").baseUrl).toBe("https://api.openai.com/v1");
    expect(canonicalizeProviderUrl("https://api.anthropic.com/v1/messages").baseUrl).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  it("去尾斜杠并把 host 转小写", () => {
    expect(canonicalizeProviderUrl("https://API.OpenAI.com/v1///").baseUrl).toBe("https://api.openai.com/v1");
  });

  it("拒绝查询参数、片段与内嵌凭据", () => {
    expect(() => canonicalizeProviderUrl("https://api.example.com/v1?key=1")).toThrow(/查询参数/);
    expect(() => canonicalizeProviderUrl("https://api.example.com/v1#x")).toThrow(/片段/);
    expect(() => canonicalizeProviderUrl("https://user:pass@api.example.com/v1")).toThrow(/用户名或密码/);
  });

  it("默认只允许 HTTPS，本地端点显式豁免才放行 http", () => {
    expect(() => canonicalizeProviderUrl("http://127.0.0.1:11434/v1")).toThrow(/HTTPS/);
    expect(canonicalizeProviderUrl("http://127.0.0.1:11434/v1", { allowInsecure: true }).baseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  it("normalizeProviderUrl 保持既有约束", () => {
    expect(normalizeProviderUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
    expect(() => normalizeProviderUrl("http://api.openai.com/v1")).toThrow(/HTTPS/);
    expect(() => normalizeProviderUrl("https://api.openai.com/v1?x=1")).toThrow(/查询参数/);
  });

  it("normalizeProviderUrl 仅在本地端点豁免下放行 http", () => {
    expect(normalizeProviderUrl("http://127.0.0.1:11434/v1/", { allowInsecure: true })).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(() => normalizeProviderUrl("http://127.0.0.1:11434/v1", { allowInsecure: false })).toThrow(/HTTPS/);
    expect(() => normalizeProviderUrl("http://user:pass@127.0.0.1:11434/v1", { allowInsecure: true })).toThrow(
      /用户名或密码/,
    );
  });
});
