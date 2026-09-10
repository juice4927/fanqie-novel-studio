import type { AiReasoningEffort } from "../types";

export type { AiReasoningEffort };

/** 协议面：决定请求路径、请求体形状与流式解析方式。 */
export type ApiSurface = "openai-chat" | "openai-responses" | "anthropic-messages";

/** 来源声明的协议面；auto 表示首次协商后落库。 */
export type ApiSurfacePreference = ApiSurface | "auto";

/** 任务角色：决定用哪个来源的哪个模型。 */
export type ModelRole = "draft" | "plan" | "review" | "extract" | "utility";

export const MODEL_ROLES = ["draft", "plan", "review", "extract", "utility"] as const satisfies readonly ModelRole[];

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  draft: "正文 / 修订",
  plan: "结构 / 章纲",
  review: "语义质检",
  extract: "状态提取 / 拆书",
  utility: "连接测试 / 小任务",
};

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** 结构化输出的最高可用档位。 */
export type StructuredOutputMode = "native" | "json-mode" | "prompt-only";

export type CapabilitySource = "catalog" | "remote" | "probe" | "user" | "default";

export interface ModelCapabilities {
  apiSurface: ApiSurface;
  contextWindow?: number;
  maxOutputTokens?: number;
  structuredOutput: StructuredOutputMode;
  streaming: boolean;
  /** 是否支持 stream_options.include_usage（OpenAI 兼容协议）。 */
  streamUsage: boolean;
  reasoning: { supported: boolean; efforts: readonly AiReasoningEffort[] };
  pricing?: ModelPricing;
  source: CapabilitySource;
}

export type AuthScheme = "bearer" | "x-api-key" | "api-key" | "none" | `custom-header:${string}`;

export interface AiProfile {
  id: string;
  name: string;
  apiSurface: ApiSurfacePreference;
  baseUrl: string;
  defaultModel: string;
  authScheme: AuthScheme;
  /** 只放非密钥元数据；密钥值一律走 Credential Manager。 */
  extraHeaders: Record<string, string>;
  /** Azure api-version 等合法查询参数入口。 */
  extraQuery: Record<string, string>;
  localEndpoint: boolean;
  enabled: boolean;
  sortOrder: number;
  notes: string;
  lastUsedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}

export interface AiRoleRoute {
  role: ModelRole;
  /** null 表示使用默认来源。 */
  profileId: string | null;
  /** null 表示使用该来源的 defaultModel。 */
  modelId: string | null;
}

/** 渲染层看到的来源视图：只暴露密钥是否存在，绝不暴露密钥本身。 */
export interface AiProfileView extends AiProfile {
  hasApiKey: boolean;
}

/** 某个来源的模型候选；只含标识与来源，不含密钥与请求细节。 */
export interface AiProfileModelOption {
  modelId: string;
  /** remote=远端清单，probe=实际用过并探测过，user=用户手填。 */
  source: CapabilitySource;
  /** 能力行写入时间；手工填写的模型取合成时间。 */
  fetchedAt: string;
  /** 作者手动覆盖或探测到的上下文窗口；null 表示未知，运行时按来源类型取默认值。 */
  contextWindow: number | null;
}

/** 来源熔断状态；degradedUntil 非空表示正在冷却。 */
export interface AiProfileHealth {
  profileId: string;
  failures: number;
  degradedUntil: string | null;
}

/** 单次任务覆盖：只对本次请求生效，不落库。 */
export interface TaskModelOverride {
  profileId?: string;
  model?: string;
}

/** 能力探测/协商的持久化记录；null 表示未知。 */
export interface StoredModelCapability {
  profileId: string;
  modelId: string;
  apiSurface: string;
  supportsJsonSchema: boolean | null;
  supportsJsonMode: boolean | null;
  supportsStreaming: boolean | null;
  supportsStreamUsage: boolean | null;
  supportsReasoning: boolean | null;
  maxOutputTokens: number | null;
  contextWindow: number | null;
  probedAt: string;
  source: CapabilitySource;
}

export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value);
}
