import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDatabase } from "../electron/database";
import { registerAiProfileHandlers } from "../electron/handlers/ai-profile-handlers";
import type { IpcInvokeChannel, RegisterHandler } from "../electron/handlers/types";
import type { AiProfile, AiProfileModelOption, StoredModelCapability } from "../src/shared/ai/types";

const { fetchPublicHttpResponse, fetchLocalEndpointResponse } = vi.hoisted(() => ({
  fetchPublicHttpResponse: vi.fn(),
  fetchLocalEndpointResponse: vi.fn(),
}));

vi.mock("../electron/netguard", () => ({ fetchPublicHttpResponse, fetchLocalEndpointResponse }));

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-models-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

beforeEach(() => {
  fetchPublicHttpResponse.mockReset();
  fetchLocalEndpointResponse.mockReset();
});

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function profile(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: "profile-main",
    name: "主力来源",
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

function capability(
  profileId: string,
  modelId: string,
  source: StoredModelCapability["source"],
): StoredModelCapability {
  return {
    profileId,
    modelId,
    apiSurface: "openai-chat",
    supportsJsonSchema: null,
    supportsJsonMode: null,
    supportsStreaming: null,
    supportsStreamUsage: null,
    supportsReasoning: null,
    maxOutputTokens: null,
    contextWindow: null,
    probedAt: "2026-09-08T00:00:00.000Z",
    source,
  };
}

function modelsResponse(ids: string[]) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: ids.map((id) => ({ id })) }),
  };
}

function createHandlers(database: WorkspaceDatabase) {
  const handlers = new Map<IpcInvokeChannel, (...args: never[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    handlers.set(channel, callback as (...args: never[]) => unknown);
  };
  registerAiProfileHandlers({
    register,
    database,
    credentials: {
      read: async () => "sk-test",
      write: async () => undefined,
      remove: async () => undefined,
      listIds: async () => [],
    },
    log: () => undefined,
    now: () => new Date().toISOString(),
  });
  return handlers;
}

describe("来源模型清单", () => {
  it("合并能力行、默认模型与角色路由，默认模型置顶", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-merge", defaultModel: "b-model" }));
    database.saveModelCapability(capability("p-merge", "a-model", "remote"));
    database.saveModelCapability(capability("p-merge", "b-model", "probe"));
    database.saveAiRoleRoute({ role: "draft", profileId: "p-merge", modelId: "c-model" });

    const handlers = createHandlers(database);
    const options = handlers.get("listAiProfileModels")?.("p-merge") as AiProfileModelOption[];

    expect(options.map((option) => option.modelId)).toEqual(["b-model", "a-model", "c-model"]);
    expect(options.find((option) => option.modelId === "a-model")?.source).toBe("remote");
    expect(options.find((option) => option.modelId === "b-model")?.source).toBe("probe");
    expect(options.find((option) => option.modelId === "c-model")?.source).toBe("user");
  });

  it("TTL 内复用缓存，force 才重新请求", async () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-ttl" }));
    fetchPublicHttpResponse.mockResolvedValue(modelsResponse(["m-1"]));

    const handlers = createHandlers(database);
    const refresh = handlers.get("refreshAiProfileModels") as (id: string, force?: boolean) => Promise<string[]>;

    expect(await refresh("p-ttl")).toEqual(["m-1"]);
    expect(fetchPublicHttpResponse).toHaveBeenCalledTimes(1);
    expect(await refresh("p-ttl")).toEqual(["m-1"]);
    expect(fetchPublicHttpResponse).toHaveBeenCalledTimes(1);
    expect(await refresh("p-ttl", true)).toEqual(["m-1"]);
    expect(fetchPublicHttpResponse).toHaveBeenCalledTimes(2);
  });

  it("404 按不支持清单处理：返回空且不写库", async () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-404" }));
    fetchPublicHttpResponse.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const handlers = createHandlers(database);
    const refresh = handlers.get("refreshAiProfileModels") as (id: string, force?: boolean) => Promise<string[]>;

    expect(await refresh("p-404")).toEqual([]);
    expect(database.listModelCapabilities("p-404")).toEqual([]);
  });

  it("保存来源后允许立刻重试清单", async () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-save" }));
    fetchPublicHttpResponse.mockResolvedValue({ ok: false, status: 401, text: async () => "" });

    const handlers = createHandlers(database);
    const refresh = handlers.get("refreshAiProfileModels") as (id: string, force?: boolean) => Promise<string[]>;
    await expect(refresh("p-save")).rejects.toThrow(/401/);

    fetchPublicHttpResponse.mockResolvedValue(modelsResponse(["m-2"]));
    await handlers.get("saveAiProfile")?.({ ...profile({ id: "p-save" }) });

    expect(await refresh("p-save")).toEqual(["m-2"]);
    expect(fetchPublicHttpResponse).toHaveBeenCalledTimes(2);
  });

  it("anthropic-messages 不发请求", async () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-anthropic", apiSurface: "anthropic-messages" }));

    const handlers = createHandlers(database);
    const refresh = handlers.get("refreshAiProfileModels") as (id: string, force?: boolean) => Promise<string[]>;

    expect(await refresh("p-anthropic", true)).toEqual([]);
    expect(fetchPublicHttpResponse).not.toHaveBeenCalled();
    expect(fetchLocalEndpointResponse).not.toHaveBeenCalled();
  });
});
