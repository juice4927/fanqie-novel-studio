import { describe, expect, it } from "vitest";
import { classifyProviderError, parseRetryAfterMs, providerError } from "../src/shared/ai/errors";

describe("供应商错误分类", () => {
  it("区分鉴权与权限错误且不重试", () => {
    expect(classifyProviderError({ status: 401 })).toMatchObject({ kind: "auth", retryable: false });
    expect(classifyProviderError({ status: 403 })).toMatchObject({ kind: "permission", retryable: false });
  });

  it("限流可重试并读取 Retry-After 秒数", () => {
    expect(classifyProviderError({ status: 429, retryAfter: "3" })).toEqual({
      kind: "rate_limit",
      retryable: true,
      retryAfterMs: 3000,
    });
  });

  it("支持 Retry-After 的 HTTP 日期格式", () => {
    const retryAfterMs = parseRetryAfterMs(new Date(Date.now() + 5_000).toUTCString());
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it("余额不足与上下文超限不重试", () => {
    expect(classifyProviderError({ status: 402 })).toMatchObject({ kind: "quota", retryable: false });
    expect(classifyProviderError({ status: 400, detail: "maximum context length is 8192 tokens" })).toMatchObject({
      kind: "context_length",
      retryable: false,
    });
  });

  it("内容策略与模型下线单独归类", () => {
    expect(classifyProviderError({ status: 400, detail: "content policy violation" })).toMatchObject({
      kind: "content_filter",
      retryable: false,
    });
    expect(classifyProviderError({ status: 404, detail: "The model `gpt-3.5-turbo` does not exist" })).toMatchObject({
      kind: "model_not_found",
      retryable: false,
    });
  });

  it("端点不支持某能力归为 unsupported_capability", () => {
    expect(
      classifyProviderError({ status: 400, detail: "response_format is not supported by this endpoint" }),
    ).toMatchObject({ kind: "unsupported_capability", retryable: false });
  });

  it("5xx 只重试可恢复状态码", () => {
    expect(classifyProviderError({ status: 500 })).toMatchObject({ kind: "server", retryable: true });
    expect(classifyProviderError({ status: 503 })).toMatchObject({ kind: "server", retryable: true });
    expect(classifyProviderError({ status: 501 })).toMatchObject({ kind: "server", retryable: false });
  });

  it("无状态码视为网络错误，超时单独归类", () => {
    expect(classifyProviderError({ detail: "fetch failed" })).toMatchObject({ kind: "network", retryable: true });
    expect(classifyProviderError({ status: 408 })).toMatchObject({ kind: "timeout", retryable: true });
  });

  it("保留既有 AppError 码与文案，供审计与 UI 兼容", () => {
    const retryable = providerError(503, "upstream    unavailable");
    expect(retryable.code).toBe("PROVIDER_UNAVAILABLE");
    expect(retryable.retryable).toBe(true);
    expect(retryable.message).toBe("模型服务暂时不可用 503: upstream unavailable");

    const permanent = providerError(401, "invalid key");
    expect(permanent.code).toBe("PROVIDER_HTTP_ERROR");
    expect(permanent.retryable).toBe(false);
    expect(permanent.message).toBe("模型接口返回 401: invalid key");
  });
});
