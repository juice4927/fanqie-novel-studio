import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "../src/shared/ai/provider-presets";
import { canonicalizeProviderUrl } from "../src/shared/ai/provider-url";

describe("供应商预设模板", () => {
  it("模板 key 唯一且覆盖国内外常用来源", () => {
    const keys = PROVIDER_PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["openai", "anthropic", "deepseek", "dashscope", "zhipu", "openrouter", "local"]),
    );
  });

  it("预填地址都是可规范化的基础地址（占位与自建网关除外）", () => {
    for (const preset of PROVIDER_PRESETS) {
      if (!preset.baseUrl || preset.baseUrl.includes("<")) continue;
      const canonical = canonicalizeProviderUrl(preset.baseUrl, { allowInsecure: preset.localEndpoint === true });
      expect(canonical.baseUrl).toBe(preset.baseUrl.replace(/\/+$/, ""));
    }
  });

  it("本地模板显式标记并允许 http，Azure 使用 api-key 头", () => {
    const local = PROVIDER_PRESETS.find((preset) => preset.key === "local");
    expect(local).toMatchObject({ localEndpoint: true, authScheme: "none" });
    expect(local?.baseUrl.startsWith("http://127.0.0.1")).toBe(true);

    const azure = PROVIDER_PRESETS.find((preset) => preset.key === "azure-openai");
    expect(azure?.authScheme).toBe("api-key");
  });

  it("Anthropic 模板走 Messages 协议", () => {
    expect(PROVIDER_PRESETS.find((preset) => preset.key === "anthropic")?.apiSurface).toBe("anthropic-messages");
  });
});
