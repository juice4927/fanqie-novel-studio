import { resolveAuthHeaders } from "../../src/shared/ai/auth";
import { normalizeProviderUrl } from "../../src/shared/ai/provider-url";
import type {
  AiProfile,
  ApiSurface,
  ApiSurfacePreference,
  ModelRole,
  TaskModelOverride,
} from "../../src/shared/ai/types";
import type { WorkspaceDatabase } from "../database";

/** 一次任务实际使用的来源与模型快照；任务启动后切换来源不影响它。 */
export interface ResolvedAiRoute {
  profileId: string | null;
  profileName: string | null;
  baseUrl: string;
  model: string;
  apiKey: string;
  requiresKey: boolean;
  apiSurface: ApiSurfacePreference;
  authHeaders: Record<string, string>;
  extraHeaders: Record<string, string>;
  extraQuery: Record<string, string>;
  /** 本地模型端点：走直连通道。 */
  localEndpoint: boolean;
  /** 旧版 provider 缓存键别名，用于迁移后继续命中历史缓存。 */
  legacyProviderKey: string | null;
}

type RouteDatabase = Pick<
  WorkspaceDatabase,
  | "listAiProfiles"
  | "getAiProfile"
  | "listAiRoleRoutes"
  | "getDefaultAiProfileId"
  | "listModelCapabilities"
  | "getAiSettings"
>;

/** 任务类型 → 角色：决定用哪个来源的哪个模型。 */
export function roleForTask(taskType: string): ModelRole {
  if (taskType === "draft-chapter" || taskType === "revise-chapter-quality") return "draft";
  if (taskType === "connection-test" || taskType === "suggest-aesthetic-profile") return "utility";
  if (taskType === "quality-review") return "review";
  if (taskType.startsWith("deconstruct-") || taskType === "extract-chapter-facts") return "extract";
  return "plan";
}

function legacyProviderKeyFor(profile: AiProfile, baseUrl: string) {
  if (profile.notes !== "由旧版模型设置迁移") return null;
  return profile.apiSurface === "anthropic-messages" ? `anthropic:${baseUrl}` : baseUrl;
}

/**
 * 三层切换优先级：单次覆盖 > 角色路由 > 默认来源。
 * 没有配置任何来源时返回 null，调用方回落到旧版单一设置。
 * 同步解析：密钥由主进程的内存缓存提供，保证任务启动即可拿到 jobId。
 */
export function createAiRouteResolver(deps: { database: RouteDatabase; getCredential: (profileId: string) => string }) {
  return function resolveAiRoute(role: ModelRole, override?: TaskModelOverride): ResolvedAiRoute | null {
    const profiles = deps.database.listAiProfiles();
    if (!profiles.length) return null;
    const settings = deps.database.getAiSettings();
    const roleRoute = deps.database.listAiRoleRoutes().find((item) => item.role === role) ?? null;
    const wantedId = override?.profileId?.trim() || roleRoute?.profileId || deps.database.getDefaultAiProfileId();
    const profile =
      (wantedId ? deps.database.getAiProfile(wantedId) : null) ?? profiles.find((item) => item.enabled) ?? null;
    if (!profile) return null;

    const overrideProfileId = override?.profileId?.trim() || null;
    // 单次覆盖到别的来源时，不能沿用角色路由里属于原来源的模型名。
    const roleModel = !overrideProfileId || overrideProfileId === roleRoute?.profileId ? roleRoute?.modelId : null;
    const model = override?.model?.trim() || roleModel?.trim() || profile.defaultModel.trim() || settings.model;
    const baseUrl = normalizeProviderUrl(profile.baseUrl);
    const requiresKey = profile.authScheme !== "none";
    const apiKey = requiresKey ? deps.getCredential(profile.id) : "";

    let apiSurface = profile.apiSurface;
    if (apiSurface === "auto") {
      const learned = deps.database
        .listModelCapabilities(profile.id)
        .find((item) => item.modelId === model && (item.source === "probe" || item.source === "user"));
      if (learned) apiSurface = learned.apiSurface as ApiSurface;
    }

    return {
      profileId: profile.id,
      profileName: profile.name,
      baseUrl,
      model,
      apiKey,
      requiresKey,
      apiSurface,
      authHeaders: requiresKey && apiKey ? resolveAuthHeaders(profile.authScheme, apiKey) : {},
      extraHeaders: profile.extraHeaders,
      extraQuery: profile.extraQuery,
      localEndpoint: profile.localEndpoint,
      legacyProviderKey: legacyProviderKeyFor(profile, baseUrl),
    };
  };
}
