import type { AiReasoningEffort, ApiSurface, StructuredOutputMode } from "../../../src/shared/ai/types";
import type { ProviderUsage } from "./usage";

/** 协议适配器入参：与具体供应商解耦的统一请求。 */
export interface DriverRequest {
  model: string;
  system: string;
  user: string;
  /** JSON Schema；Responses 协议面用它做原生结构化输出。 */
  schema: unknown | null;
  /** 原生结构化输出的 schema 名称（按任务类型生成）。 */
  schemaName?: string;
  structuredOutput: StructuredOutputMode;
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: AiReasoningEffort;
  includeStreamUsage?: boolean;
  stream: boolean;
  signal: AbortSignal;
}

export type StreamPart =
  | { type: "activity" }
  | { type: "text-delta"; text: string }
  | { type: "refusal"; text: string }
  | { type: "usage"; usage: ProviderUsage }
  | { type: "finish"; reason: DriverFinishReason };

export type DriverFinishReason = "stop" | "length" | "content-filter" | "unknown";

export interface DriverResult {
  text: string;
  usage: ProviderUsage;
  finishReason: DriverFinishReason;
}

export interface DriverStream {
  parts: AsyncIterable<StreamPart>;
  result: Promise<DriverResult>;
}

export interface DriverConfig {
  /** 已规范化的基础地址。 */
  baseUrl: string;
  apiKey: string;
  /** 覆盖默认鉴权头（自定义头名或非 Bearer 方案时使用）。 */
  authHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  extraQuery?: Record<string, string>;
  /** 本地模型端点：走直连通道，不做公网校验。 */
  localEndpoint?: boolean;
}

/** 一个协议面一个驱动；运行时按来源声明的 apiSurface 选择。 */
export interface ModelDriver {
  readonly apiSurface: ApiSurface;
  readonly endpoint: string;
  generate(request: DriverRequest): Promise<DriverResult>;
  stream(request: DriverRequest): Promise<DriverStream>;
}
