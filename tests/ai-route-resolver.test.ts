import { describe, expect, it } from "vitest";
import { createAiRouteResolver, roleForTask } from "../electron/ai/route-resolver";
import type { AiProfile, AiRoleRoute, StoredModelCapability } from "../src/shared/ai/types";

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

function fakeDatabase(input: {
  profiles?: AiProfile[];
  routes?: AiRoleRoute[];
  defaultId?: string | null;
  capabilities?: StoredModelCapability[];
  model?: string;
}) {
  const profiles = input.profiles ?? [];
  return {
    listAiProfiles: () => profiles,
    getAiProfile: (id: string) => profiles.find((item) => item.id === id) ?? null,
    listAiRoleRoutes: () => input.routes ?? [],
    getDefaultAiProfileId: () => input.defaultId ?? null,
    listModelCapabilities: () => input.capabilities ?? [],
    getAiSettings: () => ({ model: input.model ?? "gpt-6" }),
  } as never;
}

describe("AI 来源路由", () => {
  it("按任务类型推断角色", () => {
    expect(roleForTask("draft-chapter")).toBe("draft");
    expect(roleForTask("quality-review")).toBe("review");
    expect(roleForTask("deconstruct-batch")).toBe("extract");
    expect(roleForTask("extract-chapter-facts")).toBe("extract");
    expect(roleForTask("connection-test")).toBe("utility");
    expect(roleForTask("generate-chapter-plans")).toBe("plan");
  });

  it("没有配置来源时返回 null，调用方回落到旧版设置", () => {
    const resolve = createAiRouteResolver({ database: fakeDatabase({}), getCredential: () => "k" });
    expect(resolve("draft")).toBeNull();
  });

  it("角色路由优先于默认来源，并携带该来源的鉴权头", () => {
    const main = profile({ id: "p-main" });
    const cheap = profile({ id: "p-cheap", name: "便宜", authScheme: "x-api-key" });
    const resolve = createAiRouteResolver({
      database: fakeDatabase({
        profiles: [main, cheap],
        defaultId: "p-main",
        routes: [{ role: "extract", profileId: "p-cheap", modelId: "glm-4.6" }],
      }),
      getCredential: (id) => (id === "p-cheap" ? "secret-cheap" : "secret-main"),
    });

    expect(resolve("extract")).toMatchObject({
      profileId: "p-cheap",
      model: "glm-4.6",
      apiKey: "secret-cheap",
      authHeaders: { "x-api-key": "secret-cheap" },
    });
    expect(resolve("draft")).toMatchObject({ profileId: "p-main", model: "deepseek-chat" });
  });

  it("单次覆盖优先于角色路由，且不改变默认", () => {
    const resolve = createAiRouteResolver({
      database: fakeDatabase({
        profiles: [profile({ id: "p-main" }), profile({ id: "p-other", name: "备用", defaultModel: "qwen-max" })],
        defaultId: "p-main",
        routes: [{ role: "draft", profileId: "p-main", modelId: "deepseek-chat" }],
      }),
      getCredential: () => "k",
    });

    expect(resolve("draft", { profileId: "p-other", model: "qwen-plus" })).toMatchObject({
      profileId: "p-other",
      model: "qwen-plus",
    });
  });

  it("已学习的协议面会替代 auto", () => {
    const resolve = createAiRouteResolver({
      database: fakeDatabase({
        profiles: [profile({ id: "p-auto", apiSurface: "auto" })],
        defaultId: "p-auto",
        capabilities: [
          {
            profileId: "p-auto",
            modelId: "deepseek-chat",
            apiSurface: "openai-chat",
            supportsJsonSchema: null,
            supportsJsonMode: true,
            supportsStreaming: true,
            supportsStreamUsage: null,
            supportsReasoning: null,
            maxOutputTokens: null,
            contextWindow: null,
            probedAt: "2026-09-08T00:00:00.000Z",
            source: "probe",
          },
        ],
      }),
      getCredential: () => "k",
    });

    expect(resolve("draft")).toMatchObject({ apiSurface: "openai-chat" });
  });

  it("单次覆盖到别的来源时不沿用原来源的模型名", () => {
    const resolve = createAiRouteResolver({
      database: fakeDatabase({
        profiles: [profile({ id: "p-main" }), profile({ id: "p-cheap", name: "便宜", defaultModel: "glm-4.6" })],
        defaultId: "p-main",
        routes: [{ role: "draft", profileId: "p-main", modelId: "deepseek-chat" }],
      }),
      getCredential: () => "k",
    });

    expect(resolve("draft", { profileId: "p-cheap" })).toMatchObject({ profileId: "p-cheap", model: "glm-4.6" });
  });

  it("旧版迁移来源附带缓存别名，且无需密钥的来源不要求凭据", () => {
    const migrated = profile({ id: "p-legacy", notes: "由旧版模型设置迁移" });
    const local = profile({ id: "p-local", authScheme: "none", localEndpoint: true });
    const resolve = createAiRouteResolver({
      database: fakeDatabase({ profiles: [migrated, local], defaultId: "p-legacy" }),
      getCredential: () => "",
    });

    expect(resolve("draft")?.legacyProviderKey).toBe("https://api.deepseek.com/v1");
    expect(resolve("draft", { profileId: "p-local" })).toMatchObject({
      requiresKey: false,
      apiKey: "",
      authHeaders: {},
    });
  });
});
