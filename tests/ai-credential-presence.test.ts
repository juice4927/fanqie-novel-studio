import { describe, expect, it } from "vitest";
import { hasUsableAiCredential } from "../electron/ai/credential-presence";
import type { AiProfile } from "../src/shared/ai/types";

function profile(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: "p-main",
    name: "主力",
    apiSurface: "openai-chat",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    authScheme: "bearer",
    extraHeaders: {},
    extraQuery: {},
    localEndpoint: false,
    enabled: true,
    sortOrder: 0,
    notes: "",
    lastUsedAt: null,
    lastTestAt: null,
    lastTestOk: null,
    lastError: null,
    ...overrides,
  };
}

describe("AI 凭据存在性判断", () => {
  it("没有来源时回退旧版单密钥", () => {
    expect(
      hasUsableAiCredential({ profiles: [], defaultProfileId: null, legacyApiKey: "legacy", credentialFor: () => "" }),
    ).toBe(true);
    expect(
      hasUsableAiCredential({ profiles: [], defaultProfileId: null, legacyApiKey: "", credentialFor: () => "" }),
    ).toBe(false);
  });

  it("配置了来源后按来源判断，旧版密钥不再作为凭据", () => {
    const main = profile({ id: "p-main" });
    expect(
      hasUsableAiCredential({
        profiles: [main],
        defaultProfileId: "p-main",
        legacyApiKey: "legacy",
        credentialFor: () => "",
      }),
    ).toBe(false);
    expect(
      hasUsableAiCredential({
        profiles: [main],
        defaultProfileId: "p-main",
        legacyApiKey: "",
        credentialFor: (id) => (id === "p-main" ? "secret" : ""),
      }),
    ).toBe(true);
  });

  it("默认来源之外的启用来源有密钥也算已配置", () => {
    const main = profile({ id: "p-main" });
    const cheap = profile({ id: "p-cheap", name: "便宜" });
    expect(
      hasUsableAiCredential({
        profiles: [main, cheap],
        defaultProfileId: "p-main",
        legacyApiKey: "",
        credentialFor: (id) => (id === "p-cheap" ? "secret" : ""),
      }),
    ).toBe(true);
  });

  it("无需密钥的来源（本地端点）不需要凭据", () => {
    const local = profile({ id: "p-local", authScheme: "none", localEndpoint: true });
    expect(
      hasUsableAiCredential({
        profiles: [local],
        defaultProfileId: "p-local",
        legacyApiKey: "",
        credentialFor: () => "",
      }),
    ).toBe(true);
  });

  it("被禁用且非默认的来源有密钥也不算已配置", () => {
    const main = profile({ id: "p-main" });
    const disabled = profile({ id: "p-off", name: "停用", enabled: false });
    expect(
      hasUsableAiCredential({
        profiles: [main, disabled],
        defaultProfileId: "p-main",
        legacyApiKey: "",
        credentialFor: (id) => (id === "p-off" ? "secret" : ""),
      }),
    ).toBe(false);
  });

  it("默认来源即使被禁用，只要它有密钥仍算已配置", () => {
    const main = profile({ id: "p-main", enabled: false });
    expect(
      hasUsableAiCredential({
        profiles: [main],
        defaultProfileId: "p-main",
        legacyApiKey: "",
        credentialFor: () => "secret",
      }),
    ).toBe(true);
  });
});
