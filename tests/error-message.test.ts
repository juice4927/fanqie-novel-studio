import { describe, expect, it } from "vitest";
import { describeError } from "../src/lib/error-message";

describe("error message hints", () => {
  it("keeps domain messages and appends an actionable hint", () => {
    expect(describeError(new Error("尚未配置 AI API 密钥"))).toContain("系统设置");
    expect(describeError(new Error("创作契约审批后才能生成正文"))).toContain("故事圣经");
    expect(describeError(new Error("该章仍有未解决的硬性问题"))).toContain("质检中心");
    expect(describeError(new Error("章节在 AI 生成期间已被修改，旧生成结果未保存"))).toBe(
      "章节在 AI 生成期间已被修改，旧生成结果未保存",
    );
  });

  it("maps network and rate-limit failures to a next step", () => {
    expect(describeError(new Error("fetch failed"))).toContain("基础地址");
    expect(describeError(new Error("request timed out"))).toContain("超时");
    expect(describeError(new Error("429 rate limit exceeded"))).toContain("过于频繁");
  });

  it("strips the Error prefix and handles empty input", () => {
    expect(describeError(new Error("Error: 普通错误"))).toBe("普通错误");
    expect(describeError(new Error("普通错误"))).toBe("普通错误");
    expect(describeError(undefined)).toContain("未知错误");
  });
});
