import type { ContextContentKey } from "./context-diagnostics";
import type { ContextBand } from "./types";

/**
 * 上下文渲染顺序，按「稳定度」排序而不是按业务重要性。
 *
 * 供应商前缀缓存（Bedrock / OpenAI / Anthropic）要求从第一个 token 起完全一致，
 * 改动靠前的段会让靠后的缓存全部失效。因此：
 * - 稳定前缀（契约）放最前，每本书只在契约审批后变化；
 * - 慢变段（卷目标、长期记忆）随后；
 * - 快变段（摘要、事实、章纲）每章都可能变；
 * - 本章任务放最末，贴近生成点，同时吃到近因注意力。
 *
 * 裁剪优先级仍由 `context-compiler.ts` 的 TRIM_ORDER 决定，与渲染顺序解耦：
 * 渲染顺序只影响缓存与注意力，不影响预算超限时先丢哪一段。
 */
export const CONTEXT_LAYOUT = [
  { key: "contract", band: "stable" },
  { key: "volumeGoal", band: "slow" },
  { key: "longTermMemory", band: "slow" },
  { key: "commercialGuidance", band: "fast" },
  { key: "expectationLedger", band: "fast" },
  { key: "recentSummary", band: "fast" },
  { key: "relevantFacts", band: "fast" },
  { key: "storyEntries", band: "fast" },
  { key: "rollingOutline", band: "fast" },
  { key: "authorStyle", band: "fast" },
  { key: "forbiddenKnowledge", band: "fast" },
  { key: "chapterIntent", band: "task" },
] as const satisfies ReadonlyArray<{ key: ContextContentKey; band: ContextBand }>;

export const CONTEXT_BAND_SHORT: Record<ContextBand, string> = {
  stable: "稳定",
  slow: "慢变",
  fast: "快变",
  task: "本章",
};

export function contextBandOf(key: ContextContentKey): ContextBand | undefined {
  return CONTEXT_LAYOUT.find((item) => item.key === key)?.band;
}
