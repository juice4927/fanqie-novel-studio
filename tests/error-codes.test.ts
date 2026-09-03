import { describe, expect, it } from "vitest";
import { providerError } from "../electron/ai-provider";
import { AppError, appErrorCode, isAppError } from "../src/shared/error-codes";

describe("structured error codes", () => {
  it("carries a stable code and retryable flag on AppError", () => {
    const error = new AppError("PROVIDER_TIMEOUT", "模型请求超时", { retryable: false });
    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("模型请求超时");
  });

  it("classifies retryable provider outages by code", () => {
    const error = providerError(503, "service busy");
    expect(isAppError(error)).toBe(true);
    expect(appErrorCode(error)).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("暂时不可用");
  });

  it("classifies non-retryable provider errors distinctly", () => {
    const error = providerError(400, "bad request");
    expect(appErrorCode(error)).toBe("PROVIDER_HTTP_ERROR");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("模型接口返回");
  });

  it("returns null for plain errors", () => {
    expect(isAppError(new Error("普通错误"))).toBe(false);
    expect(appErrorCode(new Error("普通错误"))).toBeNull();
  });
});
