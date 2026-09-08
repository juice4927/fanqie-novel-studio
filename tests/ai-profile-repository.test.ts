import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDatabase } from "../electron/database";
import type { AiProfile, StoredModelCapability } from "../src/shared/ai/types";

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-profile-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

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

describe("AI 来源仓储", () => {
  it("保存、排序并维护默认来源", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-b", name: "备用", sortOrder: 2 }));
    database.saveAiProfile(profile({ id: "p-a", name: "主力", sortOrder: 1 }));

    expect(database.listAiProfiles().map((item) => item.id)).toEqual(["p-a", "p-b"]);
    database.setDefaultAiProfileId("p-a");
    expect(database.getDefaultAiProfileId()).toBe("p-a");
  });

  it("删除来源会清空指向它的角色路由与能力缓存，并清掉默认指向", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-a" }));
    database.setDefaultAiProfileId("p-a");
    database.saveAiRoleRoute({ role: "draft", profileId: "p-a", modelId: "deepseek-chat" });
    database.saveModelCapability({
      profileId: "p-a",
      modelId: "deepseek-chat",
      apiSurface: "openai-chat",
      supportsJsonSchema: null,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsStreamUsage: false,
      supportsReasoning: null,
      maxOutputTokens: null,
      contextWindow: null,
      probedAt: new Date().toISOString(),
      source: "probe",
    });

    database.deleteAiProfile("p-a");

    expect(database.listAiProfiles()).toEqual([]);
    expect(database.listAiRoleRoutes().find((route) => route.role === "draft")?.profileId).toBeNull();
    expect(database.listModelCapabilities("p-a")).toEqual([]);
    expect(database.getDefaultAiProfileId()).toBeNull();
  });

  it("角色路由必须指向存在且启用的来源", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-a" }));
    database.saveAiProfile(profile({ id: "p-off", name: "停用", enabled: false }));

    expect(() => database.saveAiRoleRoute({ role: "draft", profileId: "missing", modelId: null })).toThrow(/不存在/);
    expect(() => database.saveAiRoleRoute({ role: "draft", profileId: "p-off", modelId: null })).toThrow(/停用/);
    expect(database.saveAiRoleRoute({ role: "draft", profileId: "p-a", modelId: "deepseek-chat" })).toEqual({
      role: "draft",
      profileId: "p-a",
      modelId: "deepseek-chat",
    });
  });

  it("能力缓存按来源与模型读写", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-a" }));
    const record: StoredModelCapability = {
      profileId: "p-a",
      modelId: "deepseek-chat",
      apiSurface: "openai-chat",
      supportsJsonSchema: false,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsStreamUsage: null,
      supportsReasoning: false,
      maxOutputTokens: 8192,
      contextWindow: null,
      probedAt: "2026-09-08T00:00:00.000Z",
      source: "probe",
    };
    database.saveModelCapability(record);
    database.saveModelCapability({ ...record, supportsStreamUsage: false, source: "user" });

    expect(database.listModelCapabilities("p-a")).toEqual([{ ...record, supportsStreamUsage: false, source: "user" }]);
  });

  it("换地址或协议面时清空该来源的能力缓存", () => {
    const database = createDatabase();
    database.saveAiProfile(profile({ id: "p-cache" }));
    const record: StoredModelCapability = {
      profileId: "p-cache",
      modelId: "deepseek-chat",
      apiSurface: "openai-chat",
      supportsJsonSchema: null,
      supportsJsonMode: null,
      supportsStreaming: null,
      supportsStreamUsage: null,
      supportsReasoning: null,
      maxOutputTokens: null,
      contextWindow: null,
      probedAt: "2026-09-08T00:00:00.000Z",
      source: "remote",
    };
    database.saveModelCapability(record);

    database.saveAiProfile(profile({ id: "p-cache", name: "只改名字" }));
    expect(database.listModelCapabilities("p-cache")).toHaveLength(1);

    database.saveAiProfile(profile({ id: "p-cache", baseUrl: "https://api.other.example/v1" }));
    expect(database.listModelCapabilities("p-cache")).toEqual([]);

    database.saveModelCapability(record);
    database.saveAiProfile(
      profile({ id: "p-cache", baseUrl: "https://api.other.example/v1", apiSurface: "openai-responses" }),
    );
    expect(database.listModelCapabilities("p-cache")).toEqual([]);
  });

  it("审计任务记录来源与角色", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-audit-"));
    roots.push(root);
    const database = new WorkspaceDatabase(root);
    databases.push(database);

    const jobId = database.startAiJob(
      null,
      "draft-chapter",
      "input-hash",
      "v1",
      "profile:p-main:https://api.deepseek.com/v1",
      "deepseek-chat",
      "摘要",
      undefined,
      "p-main",
      "draft",
    );

    const inspection = new DatabaseSync(path.join(root, "catalog.sqlite"));
    const row = inspection.prepare("SELECT profile_id, role FROM ai_jobs WHERE id = ?").get(jobId);
    inspection.close();
    expect(row).toEqual({ profile_id: "p-main", role: "draft" });
  });

  it("旧版单来源设置迁移为默认来源且幂等", () => {
    const database = createDatabase();
    expect(database.listAiProfiles()).toEqual([]);

    database.saveAiSettings({
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      embeddingModel: "text-embedding-3-small",
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      longTaskTimeoutMinutes: 10,
    });

    const first = database.listAiProfiles();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      name: "默认来源",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      authScheme: "bearer",
    });
    expect(database.getDefaultAiProfileId()).toBe(first[0].id);
    expect(database.listAiProfiles()).toHaveLength(1);
  });

  it("Anthropic 旧设置迁移为 x-api-key 与 Messages 协议面", () => {
    const database = createDatabase();
    database.saveAiSettings({
      protocol: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      embeddingModel: "text-embedding-3-small",
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      longTaskTimeoutMinutes: 10,
    });

    expect(database.listAiProfiles()[0]).toMatchObject({
      apiSurface: "anthropic-messages",
      authScheme: "x-api-key",
    });
  });
});
