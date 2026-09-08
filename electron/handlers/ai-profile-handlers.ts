import { randomUUID } from "node:crypto";
import { assertNoSecretHeaders, resolveAuthHeaders } from "../../src/shared/ai/auth";
import { canonicalizeProviderUrl } from "../../src/shared/ai/provider-url";
import type {
  AiProfile,
  AiProfileHealth,
  AiProfileView,
  AiRoleRoute,
  ApiSurface,
  ModelRole,
  StoredModelCapability,
} from "../../src/shared/ai/types";
import { isModelRole } from "../../src/shared/ai/types";
import { createDriver } from "../ai/drivers";
import type { WorkspaceDatabase } from "../database";
import { fetchLocalEndpointResponse, fetchPublicHttpResponse } from "../netguard";
import type { RegisterHandler } from "./types";

type ProfileDatabase = Pick<
  WorkspaceDatabase,
  | "listAiProfiles"
  | "getAiProfile"
  | "saveAiProfile"
  | "deleteAiProfile"
  | "getDefaultAiProfileId"
  | "setDefaultAiProfileId"
  | "listAiRoleRoutes"
  | "saveAiRoleRoute"
  | "listModelCapabilities"
  | "saveModelCapability"
>;

export interface AiProfileCredentials {
  read(id: string): Promise<string>;
  write(id: string, value: string): Promise<void>;
  remove(id: string): Promise<void>;
  listIds(): Promise<string[]>;
}

export interface AiProfileHandlerDependencies {
  register: RegisterHandler;
  database: ProfileDatabase;
  credentials: AiProfileCredentials;
  log: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
  now: () => string;
  /** 来源熔断状态（内存态）。 */
  health?: () => AiProfileHealth[];
}

const MODELS_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

function profileError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeProfile(input: AiProfile): AiProfile {
  const name = input.name.trim();
  if (!name) throw new Error("来源名称不能为空");
  if (name.length > 60) throw new Error("来源名称不能超过 60 个字符");
  assertNoSecretHeaders(input.extraHeaders ?? {});
  const { baseUrl, notices } = canonicalizeProviderUrl(input.baseUrl, {
    allowInsecure: input.localEndpoint === true,
  });
  if (notices.length) throw new Error(notices.join("；"));
  const extraQuery: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.extraQuery ?? {})) {
    if (!key.trim()) throw new Error("附加查询参数不能有空名称");
    extraQuery[key.trim()] = String(value);
  }
  const defaultModel = input.defaultModel.trim();
  return {
    ...input,
    id: input.id.trim() || randomUUID(),
    name,
    baseUrl,
    defaultModel,
    extraHeaders: Object.fromEntries(
      Object.entries(input.extraHeaders ?? {}).map(([key, value]) => [key.trim(), String(value)]),
    ),
    extraQuery,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    notes: (input.notes ?? "").slice(0, 500),
  };
}

function authHeadersFor(profile: AiProfile, secret: string) {
  return resolveAuthHeaders(profile.authScheme, secret);
}

function withQuery(baseUrl: string, query: Record<string, string>) {
  const entries = Object.entries(query);
  if (!entries.length) return baseUrl;
  const url = new URL(baseUrl);
  for (const [key, value] of entries) url.searchParams.set(key, value);
  return url.toString();
}

/** 按声明的协议面（auto 时依次协商）做一次最小结构化调用，并回写探测结果。 */
async function probeProfile(
  profile: AiProfile,
  secret: string,
  model: string,
): Promise<{ ok: boolean; message: string; capability?: StoredModelCapability }> {
  const candidates: ApiSurface[] =
    profile.apiSurface === "auto" ? ["openai-responses", "openai-chat"] : [profile.apiSurface];
  const failures: string[] = [];
  for (const surface of candidates) {
    try {
      const driver = createDriver(surface, {
        baseUrl: profile.baseUrl,
        apiKey: secret,
        authHeaders: authHeadersFor(profile, secret),
        extraHeaders: profile.extraHeaders,
        localEndpoint: profile.localEndpoint,
      });
      const startedAt = Date.now();
      const result = await driver.generate({
        model,
        system: "你是连接测试助手，只返回 JSON，不使用 Markdown。",
        user: '请只返回 {"ok": true}。',
        schema: null,
        structuredOutput: surface === "anthropic-messages" ? "prompt-only" : "json-mode",
        maxOutputTokens: 64,
        stream: false,
        signal: AbortSignal.timeout(30_000),
      });
      const ok = /\{\s*"ok"\s*:\s*true\s*\}/.test(result.text);
      const capability: StoredModelCapability = {
        profileId: profile.id,
        modelId: model,
        apiSurface: surface,
        supportsJsonSchema: surface === "openai-responses" ? true : null,
        supportsJsonMode: surface !== "anthropic-messages",
        supportsStreaming: true,
        supportsStreamUsage: null,
        supportsReasoning: null,
        maxOutputTokens: null,
        contextWindow: null,
        probedAt: new Date().toISOString(),
        source: "probe",
      };
      return {
        ok,
        message: ok
          ? `连接成功：${model}（${surface}，${Date.now() - startedAt} ms）`
          : "连接成功，但模型没有按要求返回 JSON，请确认模型可用",
        capability,
      };
    } catch (error) {
      failures.push(`${surface}: ${profileError(error)}`);
    }
  }
  return { ok: false, message: `连接失败：${failures.join("；")}` };
}

export function registerAiProfileHandlers({
  register,
  database,
  credentials,
  log,
  now,
  health,
}: AiProfileHandlerDependencies): void {
  const credentialIds = new Set<string>();
  const refreshCredentialIds = async () => {
    credentialIds.clear();
    for (const id of await credentials.listIds()) credentialIds.add(id);
    return credentialIds;
  };
  const view = (profile: AiProfile): AiProfileView => ({ ...profile, hasApiKey: credentialIds.has(profile.id) });

  register("listAiProfiles", async () => {
    await refreshCredentialIds();
    return database.listAiProfiles().map(view);
  });

  register("saveAiProfile", async (input, apiKey) => {
    const profile = sanitizeProfile(input);
    if (profile.localEndpoint && new URL(profile.baseUrl).protocol !== "http:")
      throw new Error("本地端点来源必须使用 http:// 回环或私网地址");
    const saved = database.saveAiProfile(profile);
    if (apiKey) {
      await credentials.write(saved.id, apiKey);
      credentialIds.add(saved.id);
    }
    if (database.getDefaultAiProfileId() === null) database.setDefaultAiProfileId(saved.id);
    return view(saved);
  });

  register("deleteAiProfile", async (id) => {
    const profile = database.getAiProfile(id);
    if (!profile) throw new Error("来源不存在");
    database.deleteAiProfile(id);
    await credentials.remove(id).catch((error) => {
      log("warn", "ai.profile.credential_delete_failed", { id, error: profileError(error) });
    });
    credentialIds.delete(id);
  });

  register("setDefaultAiProfile", (id) => {
    const profile = database.getAiProfile(id);
    if (!profile) throw new Error("来源不存在");
    if (!profile.enabled) throw new Error("不能把已停用的来源设为默认");
    database.setDefaultAiProfileId(id);
  });

  register("getDefaultAiProfileId", () => database.getDefaultAiProfileId());

  register("listAiRoleRoutes", () => database.listAiRoleRoutes());

  register("listAiProfileHealth", () => health?.() ?? []);

  register("setAiRoleRoute", (role: ModelRole, profileId: string | null, modelId: string | null) => {
    if (!isModelRole(role)) throw new Error(`未知的任务角色：${role}`);
    const route: AiRoleRoute = {
      role,
      profileId: profileId?.trim() ? profileId.trim() : null,
      modelId: modelId?.trim() ? modelId.trim() : null,
    };
    return database.saveAiRoleRoute(route);
  });

  register("testAiProfile", async (id) => {
    const profile = database.getAiProfile(id);
    if (!profile) throw new Error("来源不存在");
    if (!profile.defaultModel.trim()) throw new Error("请先填写该来源的默认模型");
    const secret = profile.authScheme === "none" ? "" : await credentials.read(id);
    if (profile.authScheme !== "none" && !secret) throw new Error("该来源还没有保存 API 密钥");
    const result = await probeProfile(profile, secret, profile.defaultModel);
    if (result.capability) database.saveModelCapability(result.capability);
    database.saveAiProfile({
      ...profile,
      lastTestAt: now(),
      lastTestOk: result.ok,
      lastError: result.ok ? null : result.message.slice(0, 300),
    });
    return { ok: result.ok, message: result.message };
  });

  register("refreshAiProfileModels", async (id) => {
    const profile = database.getAiProfile(id);
    if (!profile) throw new Error("来源不存在");
    if (profile.apiSurface === "anthropic-messages") return [];
    const secret = profile.authScheme === "none" ? "" : await credentials.read(id);
    const url = withQuery(`${profile.baseUrl}/models`, profile.extraQuery);
    const requestInit: RequestInit = {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(secret ? authHeadersFor(profile, secret) : {}),
        ...profile.extraHeaders,
      },
      signal: AbortSignal.timeout(20_000),
    };
    const response = profile.localEndpoint
      ? await fetchLocalEndpointResponse(url, requestInit)
      : await fetchPublicHttpResponse(url, requestInit);
    if (response.status === 404 || response.status === 405) return [];
    if (!response.ok) throw new Error(`获取模型清单失败：HTTP ${response.status}`);
    const text = (await response.text()).slice(0, MODELS_RESPONSE_LIMIT_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("模型清单不是合法 JSON");
    }
    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    const models = data
      .map((item) => (item as { id?: unknown }).id)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, 500);
    for (const modelId of models) {
      database.saveModelCapability({
        profileId: profile.id,
        modelId,
        apiSurface: profile.apiSurface === "auto" ? "openai-chat" : profile.apiSurface,
        supportsJsonSchema: null,
        supportsJsonMode: null,
        supportsStreaming: null,
        supportsStreamUsage: null,
        supportsReasoning: null,
        maxOutputTokens: null,
        contextWindow: null,
        probedAt: now(),
        source: "remote",
      });
    }
    return models;
  });

  register("exportAiProfiles", () => {
    const profiles = database.listAiProfiles().map(({ ...profile }) => profile);
    return JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: now(),
        defaultProfileId: database.getDefaultAiProfileId(),
        profiles,
        roleRoutes: database.listAiRoleRoutes(),
      },
      null,
      2,
    );
  });

  register("importAiProfiles", async (json) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("导入内容不是合法 JSON");
    }
    const payload = parsed as {
      profiles?: unknown;
      roleRoutes?: unknown;
      defaultProfileId?: unknown;
    };
    if (!Array.isArray(payload.profiles)) throw new Error("导入内容缺少 profiles 数组");
    const imported: AiProfile[] = [];
    for (const item of payload.profiles) {
      const candidate = item as Partial<AiProfile>;
      if (!candidate || typeof candidate.baseUrl !== "string" || typeof candidate.name !== "string") continue;
      const profile = sanitizeProfile({
        id: typeof candidate.id === "string" ? candidate.id : "",
        name: candidate.name,
        apiSurface: candidate.apiSurface ?? "auto",
        baseUrl: candidate.baseUrl,
        defaultModel: typeof candidate.defaultModel === "string" ? candidate.defaultModel : "",
        authScheme: candidate.authScheme ?? "bearer",
        extraHeaders: candidate.extraHeaders ?? {},
        extraQuery: candidate.extraQuery ?? {},
        localEndpoint: candidate.localEndpoint === true,
        enabled: candidate.enabled !== false,
        sortOrder: typeof candidate.sortOrder === "number" ? candidate.sortOrder : 0,
        notes: typeof candidate.notes === "string" ? candidate.notes : "",
        lastUsedAt: null,
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
      });
      imported.push(database.saveAiProfile(profile));
    }
    if (Array.isArray(payload.roleRoutes)) {
      for (const item of payload.roleRoutes) {
        const route = item as Partial<AiRoleRoute>;
        if (!route.role || !isModelRole(route.role)) continue;
        if (route.profileId && !database.getAiProfile(route.profileId)) continue;
        database.saveAiRoleRoute({
          role: route.role,
          profileId: route.profileId ?? null,
          modelId: route.modelId ?? null,
        });
      }
    }
    if (typeof payload.defaultProfileId === "string" && database.getAiProfile(payload.defaultProfileId))
      database.setDefaultAiProfileId(payload.defaultProfileId);
    await refreshCredentialIds();
    return imported.map(view);
  });
}
