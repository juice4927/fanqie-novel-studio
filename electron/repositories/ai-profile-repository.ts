import type { DatabaseSync } from "node:sqlite";
import type { AiProfile, AiRoleRoute, ModelRole, StoredModelCapability } from "../../src/shared/ai/types";
import { isModelRole } from "../../src/shared/ai/types";

interface ProfileRow {
  id: string;
  name: string;
  api_surface: string;
  base_url: string;
  default_model: string;
  auth_scheme: string;
  extra_headers: string;
  extra_query: string;
  local_endpoint: number;
  enabled: number;
  sort_order: number;
  notes: string;
  last_used_at: string | null;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_error: string | null;
}

interface RouteRow {
  role: string;
  profile_id: string | null;
  model_id: string | null;
}

interface CapabilityRow {
  profile_id: string;
  model_id: string;
  api_surface: string;
  supports_json_schema: number | null;
  supports_json_mode: number | null;
  supports_streaming: number | null;
  supports_stream_usage: number | null;
  supports_reasoning: number | null;
  max_output_tokens: number | null;
  context_window: number | null;
  probed_at: string;
  source: string;
}

function parseStringMap(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key, String(item)]),
    );
  } catch {
    return {};
  }
}

function toBoolean(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function fromBoolean(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function toProfile(row: ProfileRow): AiProfile {
  return {
    id: row.id,
    name: row.name,
    apiSurface: row.api_surface as AiProfile["apiSurface"],
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    authScheme: row.auth_scheme as AiProfile["authScheme"],
    extraHeaders: parseStringMap(row.extra_headers),
    extraQuery: parseStringMap(row.extra_query),
    localEndpoint: row.local_endpoint === 1,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    notes: row.notes,
    lastUsedAt: row.last_used_at,
    lastTestAt: row.last_test_at,
    lastTestOk: toBoolean(row.last_test_ok),
    lastError: row.last_error,
  };
}

/** 来源、角色路由与能力探测缓存的仓储；密钥不在此处，永远只在凭据管理器。 */
export class AiProfileRepository {
  constructor(private readonly db: DatabaseSync) {}

  listProfiles(): AiProfile[] {
    const rows = this.db
      .prepare("SELECT * FROM ai_profiles ORDER BY sort_order ASC, name ASC")
      .all() as unknown as ProfileRow[];
    return rows.map(toProfile);
  }

  findProfile(id: string): AiProfile | null {
    const row = this.db.prepare("SELECT * FROM ai_profiles WHERE id = ?").get(id) as unknown as ProfileRow | undefined;
    return row ? toProfile(row) : null;
  }

  saveProfile(profile: AiProfile): AiProfile {
    const now = new Date().toISOString();
    const previous = this.findProfile(profile.id);
    // 换端点（地址或协议面）后旧清单与旧探测结论都不再适用，必须清掉，
    // 否则模型下拉会列出别家来源的模型。
    const endpointChanged =
      previous !== null && (previous.baseUrl !== profile.baseUrl || previous.apiSurface !== profile.apiSurface);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO ai_profiles (
             id, name, api_surface, base_url, default_model, auth_scheme, extra_headers, extra_query,
             local_endpoint, enabled, sort_order, notes, last_used_at, last_test_at, last_test_ok, last_error,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             api_surface = excluded.api_surface,
             base_url = excluded.base_url,
             default_model = excluded.default_model,
             auth_scheme = excluded.auth_scheme,
             extra_headers = excluded.extra_headers,
             extra_query = excluded.extra_query,
             local_endpoint = excluded.local_endpoint,
             enabled = excluded.enabled,
             sort_order = excluded.sort_order,
             notes = excluded.notes,
             last_used_at = excluded.last_used_at,
             last_test_at = excluded.last_test_at,
             last_test_ok = excluded.last_test_ok,
             last_error = excluded.last_error,
             updated_at = excluded.updated_at`,
        )
        .run(
          profile.id,
          profile.name,
          profile.apiSurface,
          profile.baseUrl,
          profile.defaultModel,
          profile.authScheme,
          JSON.stringify(profile.extraHeaders ?? {}),
          JSON.stringify(profile.extraQuery ?? {}),
          profile.localEndpoint ? 1 : 0,
          profile.enabled ? 1 : 0,
          profile.sortOrder,
          profile.notes,
          profile.lastUsedAt,
          profile.lastTestAt,
          fromBoolean(profile.lastTestOk),
          profile.lastError,
          now,
          now,
        );
      if (endpointChanged) this.db.prepare("DELETE FROM model_capabilities WHERE profile_id = ?").run(profile.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.findProfile(profile.id) as AiProfile;
  }

  deleteProfile(id: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("UPDATE ai_role_routes SET profile_id = NULL, updated_at = ? WHERE profile_id = ?")
        .run(new Date().toISOString(), id);
      this.db.prepare("DELETE FROM model_capabilities WHERE profile_id = ?").run(id);
      this.db.prepare("DELETE FROM ai_profiles WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  countProfiles(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM ai_profiles").get() as { total: number };
    return Number(row?.total ?? 0);
  }

  getDefaultProfileId(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ai.defaultProfileId'").get() as
      | { value: string }
      | undefined;
    return row?.value?.trim() ? row.value.trim() : null;
  }

  setDefaultProfileId(id: string | null): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai.defaultProfileId', ?)").run(id ?? "");
  }

  listRoleRoutes(): AiRoleRoute[] {
    const rows = this.db
      .prepare("SELECT role, profile_id, model_id FROM ai_role_routes")
      .all() as unknown as RouteRow[];
    return rows
      .filter((row) => isModelRole(row.role))
      .map((row) => ({
        role: row.role as ModelRole,
        profileId: row.profile_id,
        modelId: row.model_id,
      }));
  }

  saveRoleRoute(route: AiRoleRoute): AiRoleRoute {
    if (!isModelRole(route.role)) throw new Error(`未知的任务角色：${route.role}`);
    if (route.profileId) {
      const profile = this.findProfile(route.profileId);
      if (!profile) throw new Error("角色路由指向的来源不存在");
      if (!profile.enabled) throw new Error("角色路由不能指向已停用的来源");
    }
    this.db
      .prepare(
        `INSERT INTO ai_role_routes (role, profile_id, model_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET profile_id = excluded.profile_id, model_id = excluded.model_id, updated_at = excluded.updated_at`,
      )
      .run(route.role, route.profileId, route.modelId, new Date().toISOString());
    return { role: route.role, profileId: route.profileId, modelId: route.modelId };
  }

  listCapabilities(profileId: string): StoredModelCapability[] {
    const rows = this.db
      .prepare("SELECT * FROM model_capabilities WHERE profile_id = ?")
      .all(profileId) as unknown as CapabilityRow[];
    return rows.map((row) => ({
      profileId: row.profile_id,
      modelId: row.model_id,
      apiSurface: row.api_surface,
      supportsJsonSchema: toBoolean(row.supports_json_schema),
      supportsJsonMode: toBoolean(row.supports_json_mode),
      supportsStreaming: toBoolean(row.supports_streaming),
      supportsStreamUsage: toBoolean(row.supports_stream_usage),
      supportsReasoning: toBoolean(row.supports_reasoning),
      maxOutputTokens: row.max_output_tokens,
      contextWindow: row.context_window,
      probedAt: row.probed_at,
      source: row.source as StoredModelCapability["source"],
    }));
  }

  findCapability(profileId: string, modelId: string, apiSurface: string): StoredModelCapability | null {
    return (
      this.listCapabilities(profileId).find((item) => item.modelId === modelId && item.apiSurface === apiSurface) ??
      null
    );
  }

  saveCapability(record: StoredModelCapability): StoredModelCapability {
    this.db
      .prepare(
        `INSERT INTO model_capabilities (
           profile_id, model_id, api_surface, supports_json_schema, supports_json_mode, supports_streaming,
           supports_stream_usage, supports_reasoning, max_output_tokens, context_window, probed_at, source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, model_id, api_surface) DO UPDATE SET
           supports_json_schema = excluded.supports_json_schema,
           supports_json_mode = excluded.supports_json_mode,
           supports_streaming = excluded.supports_streaming,
           supports_stream_usage = excluded.supports_stream_usage,
           supports_reasoning = excluded.supports_reasoning,
           max_output_tokens = excluded.max_output_tokens,
           context_window = excluded.context_window,
           probed_at = excluded.probed_at,
           source = excluded.source`,
      )
      .run(
        record.profileId,
        record.modelId,
        record.apiSurface,
        fromBoolean(record.supportsJsonSchema),
        fromBoolean(record.supportsJsonMode),
        fromBoolean(record.supportsStreaming),
        fromBoolean(record.supportsStreamUsage),
        fromBoolean(record.supportsReasoning),
        record.maxOutputTokens,
        record.contextWindow,
        record.probedAt,
        record.source,
      );
    return record;
  }
}
