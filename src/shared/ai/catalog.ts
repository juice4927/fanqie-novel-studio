import type { AiReasoningEffort } from "../types";
import type {
  ApiSurface,
  ApiSurfacePreference,
  ModelCapabilities,
  ModelPricing,
  StoredModelCapability,
  StructuredOutputMode,
} from "./types";

/**
 * 内置模型能力快照。只声明稳定、可从协议层判断的字段（协议面 / 结构化输出档位 /
 * 流式 / 推理档位）；上下文与输出上限、定价留空即用保守默认，由探测结果、
 * /models 刷新或用户在来源里覆盖，避免把会过期的数字写死在代码里。
 */
export const MODEL_CATALOG_VERSION = "2026-09-08";

export interface CatalogEntry {
  apiSurface: ApiSurface;
  structuredOutput: StructuredOutputMode;
  streaming: boolean;
  streamUsage: boolean;
  reasoning: { supported: boolean; efforts: readonly AiReasoningEffort[] };
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
}

const REASONING_EFFORTS: readonly AiReasoningEffort[] = ["low", "medium", "high"];

const REASONING_ENTRY: Pick<CatalogEntry, "reasoning"> = { reasoning: { supported: true, efforts: REASONING_EFFORTS } };
const NO_REASONING_ENTRY: Pick<CatalogEntry, "reasoning"> = { reasoning: { supported: false, efforts: [] } };

const OPENAI_COMPATIBLE_CHAT: Omit<CatalogEntry, "reasoning"> = {
  apiSurface: "openai-chat",
  structuredOutput: "json-mode",
  streaming: true,
  streamUsage: false,
};

const PATTERNS: ReadonlyArray<{ test: RegExp; entry: CatalogEntry }> = [
  // OpenAI 推理模型：Responses 协议面 + 原生 JSON Schema。
  {
    test: /^o\d/,
    entry: {
      apiSurface: "openai-responses",
      structuredOutput: "native",
      streaming: true,
      streamUsage: false,
      ...REASONING_ENTRY,
    },
  },
  {
    test: /^gpt-(?:5|6)/,
    entry: {
      apiSurface: "openai-responses",
      structuredOutput: "native",
      streaming: true,
      streamUsage: false,
      ...REASONING_ENTRY,
    },
  },
  // 更早的 GPT 模型在兼容网关与 OpenAI 上都稳定支持 Chat Completions。
  { test: /^gpt-/, entry: { ...OPENAI_COMPATIBLE_CHAT, ...NO_REASONING_ENTRY } },
  // Anthropic Messages API。
  {
    test: /^claude-/,
    entry: {
      apiSurface: "anthropic-messages",
      structuredOutput: "prompt-only",
      streaming: true,
      streamUsage: false,
      ...NO_REASONING_ENTRY,
    },
  },
  // 国内 OpenAI 兼容供应商。
  {
    test: /^(?:deepseek|qwen|glm|kimi|moonshot|doubao|minimax|hunyuan|ernie|step|spark)/,
    entry: { ...OPENAI_COMPATIBLE_CHAT, ...NO_REASONING_ENTRY },
  },
  // Gemini 经 OpenAI 兼容端点接入。
  { test: /^gemini-/, entry: { ...OPENAI_COMPATIBLE_CHAT, ...NO_REASONING_ENTRY } },
];

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  apiSurface: "openai-chat",
  structuredOutput: "json-mode",
  streaming: true,
  streamUsage: false,
  reasoning: { supported: false, efforts: [] },
  source: "default",
};

/** 去掉 OpenRouter 等网关的 `provider/` 前缀与日期后缀，便于模式匹配。 */
export function normalizeModelId(model: string) {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function lookupCatalog(model: string): CatalogEntry | undefined {
  const normalized = normalizeModelId(model);
  return PATTERNS.find((item) => item.test.test(normalized))?.entry;
}

export interface CapabilityOverride {
  apiSurface?: ApiSurface;
  structuredOutput?: StructuredOutputMode;
  streaming?: boolean;
  streamUsage?: boolean;
  reasoning?: { supported: boolean; efforts: readonly AiReasoningEffort[] };
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
}

export interface ResolveCapabilitiesInput {
  model: string;
  /** 来源声明的协议面；非 auto 时优先于目录与探测结果。 */
  declaredSurface?: ApiSurfacePreference;
  /** 协商/探测落库的结果。 */
  probe?: CapabilityOverride | null;
  /** 用户在来源里手工覆盖的结果，优先级最高。 */
  override?: CapabilityOverride | null;
}

/**
 * 能力解析优先级：用户覆盖 > 探测结果 > 内置目录 > 保守默认。
 * 来源显式声明的协议面优先于目录与探测（auto 时才采用协商结果）。
 */
export function resolveModelCapabilities(input: ResolveCapabilitiesInput): ModelCapabilities {
  const catalog = lookupCatalog(input.model);
  let capabilities: ModelCapabilities = catalog ? { ...catalog, source: "catalog" } : { ...DEFAULT_CAPABILITIES };

  if (input.probe) {
    capabilities = { ...capabilities, ...input.probe, source: "probe" };
  }
  if (input.override) {
    capabilities = { ...capabilities, ...input.override, source: "user" };
  }
  if (input.declaredSurface && input.declaredSurface !== "auto") {
    capabilities = { ...capabilities, apiSurface: input.declaredSurface, source: capabilities.source ?? "user" };
  }
  return capabilities;
}

/** 把落库的探测记录还原成能力覆盖项；null 字段不覆盖。 */
export function capabilityOverrideFromStored(record: StoredModelCapability): CapabilityOverride {
  const structuredOutput: StructuredOutputMode | undefined =
    record.supportsJsonSchema === true
      ? "native"
      : record.supportsJsonMode === true
        ? "json-mode"
        : record.supportsJsonSchema === false && record.supportsJsonMode === false
          ? "prompt-only"
          : undefined;
  return {
    ...(structuredOutput ? { structuredOutput } : {}),
    ...(record.supportsStreaming !== null ? { streaming: record.supportsStreaming } : {}),
    ...(record.supportsStreamUsage !== null ? { streamUsage: record.supportsStreamUsage } : {}),
    ...(record.supportsReasoning !== null
      ? {
          reasoning: {
            supported: record.supportsReasoning,
            efforts: record.supportsReasoning ? REASONING_EFFORTS : [],
          },
        }
      : {}),
    ...(record.maxOutputTokens !== null ? { maxOutputTokens: record.maxOutputTokens } : {}),
    ...(record.contextWindow !== null ? { contextWindow: record.contextWindow } : {}),
  };
}
