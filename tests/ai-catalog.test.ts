import { describe, expect, it } from "vitest";
import { lookupCatalog, normalizeModelId, resolveModelCapabilities } from "../src/shared/ai/catalog";

describe("内置模型目录", () => {
  it("按模型族推断协议面", () => {
    expect(lookupCatalog("gpt-6")?.apiSurface).toBe("openai-responses");
    expect(lookupCatalog("o3-mini")?.apiSurface).toBe("openai-responses");
    expect(lookupCatalog("gpt-4o")?.apiSurface).toBe("openai-chat");
    expect(lookupCatalog("claude-sonnet-4-20250514")?.apiSurface).toBe("anthropic-messages");
    expect(lookupCatalog("deepseek-chat")?.apiSurface).toBe("openai-chat");
    expect(lookupCatalog("glm-4.6")?.apiSurface).toBe("openai-chat");
  });

  it("剥掉网关前缀与大小写差异", () => {
    expect(normalizeModelId("OpenRouter/DeepSeek/deepseek-chat")).toBe("deepseek-chat");
    expect(lookupCatalog("openrouter/anthropic/claude-sonnet-4")?.apiSurface).toBe("anthropic-messages");
  });

  it("未知模型退回保守默认", () => {
    const capabilities = resolveModelCapabilities({ model: "some-private-model" });
    expect(capabilities).toMatchObject({
      apiSurface: "openai-chat",
      structuredOutput: "json-mode",
      streaming: true,
      source: "default",
    });
  });

  it("优先级：用户覆盖 > 探测结果 > 内置目录", () => {
    const catalogOnly = resolveModelCapabilities({ model: "gpt-6" });
    expect(catalogOnly.source).toBe("catalog");
    expect(catalogOnly.structuredOutput).toBe("native");

    const probed = resolveModelCapabilities({ model: "gpt-6", probe: { structuredOutput: "json-mode" } });
    expect(probed.source).toBe("probe");
    expect(probed.structuredOutput).toBe("json-mode");

    const overridden = resolveModelCapabilities({
      model: "gpt-6",
      probe: { structuredOutput: "json-mode" },
      override: { structuredOutput: "native" },
    });
    expect(overridden.source).toBe("user");
    expect(overridden.structuredOutput).toBe("native");
  });

  it("来源显式声明的协议面优先于目录与探测", () => {
    const declared = resolveModelCapabilities({
      model: "gpt-6",
      declaredSurface: "openai-chat",
      probe: { apiSurface: "openai-responses" },
    });
    expect(declared.apiSurface).toBe("openai-chat");
  });

  it("auto 时采用协商结果", () => {
    const negotiated = resolveModelCapabilities({
      model: "gpt-6",
      declaredSurface: "auto",
      probe: { apiSurface: "openai-chat" },
    });
    expect(negotiated.apiSurface).toBe("openai-chat");
    expect(negotiated.source).toBe("probe");
  });
});
