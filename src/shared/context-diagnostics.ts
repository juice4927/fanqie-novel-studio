import type { ContextDiagnostics, ContextPackage, ContextSectionDiagnostic } from "./types";

export type ContextContentKey = Exclude<keyof ContextPackage, "estimatedTokens" | "diagnostics">;

export interface ContextSectionMetadata {
  source: string;
  reason: string;
  includedItems?: number;
  totalItems?: number;
}

export const CONTEXT_SECTION_LABELS: Record<ContextContentKey, string> = {
  contract: "创作契约",
  commercialGuidance: "商业写作知识",
  chapterIntent: "本章商业意图",
  expectationLedger: "期待兑现账本",
  longTermMemory: "长期摘要",
  volumeGoal: "当前卷目标",
  rollingOutline: "滚动章纲",
  recentSummary: "近期摘要",
  relevantFacts: "相关事实",
  forbiddenKnowledge: "禁止泄露信息",
  authorStyle: "作者自身文风统计",
};

const DEFAULT_METADATA: Record<ContextContentKey, ContextSectionMetadata> = {
  contract: { source: "已审批创作契约", reason: "约束故事前提、读者承诺和不可破坏规则" },
  commercialGuidance: { source: "题材插件与当前阶段", reason: "提供当前题材阶段的冲突、回报和禁忌规则" },
  chapterIntent: { source: "当前章纲", reason: "明确本章承诺、回报、危机和结尾期待" },
  expectationLedger: { source: "期待兑现账本", reason: "优先加载本章承接和仍待兑现的跨章期待" },
  longTermMemory: { source: "章节、阶段、分卷和全书摘要", reason: "保留超出近期章节窗口的长期因果" },
  volumeGoal: { source: "当前已批准分卷", reason: "约束本章对当前卷目标的贡献" },
  rollingOutline: { source: "未来三十章已批准规划", reason: "避免当前章破坏近期结构和后续兑现" },
  recentSummary: { source: "最近五章摘要", reason: "承接紧邻事件、人物行动和局势变化" },
  relevantFacts: { source: "当前有效且已确认的状态事实", reason: "约束人物、关系、能力、资源、地点和时间线" },
  forbiddenKnowledge: { source: "当前有效秘密与知情范围", reason: "防止角色使用尚未获得的信息" },
  authorStyle: { source: "本项目最近二十章已定稿正文统计", reason: "保持作者自身叙事密度，不加载研究样本文风" },
};

const EMPTY_MARKERS = /^(?:无|暂无|未填写|尚无|尚未)/;

export function contextForModel(context: ContextPackage): Omit<ContextPackage, "diagnostics"> {
  const { diagnostics: _diagnostics, ...modelContext } = context;
  return modelContext;
}

export function buildContextDiagnostics(
  context: Omit<ContextPackage, "diagnostics">,
  metadata: Partial<Record<ContextContentKey, Partial<ContextSectionMetadata>>> = {},
  warnings: string[] = [],
): ContextDiagnostics {
  const sections = (Object.keys(CONTEXT_SECTION_LABELS) as ContextContentKey[]).map((key): ContextSectionDiagnostic => {
    const value = context[key];
    const defaults = DEFAULT_METADATA[key];
    const details = { ...defaults, ...metadata[key] };
    const includedItems = details.includedItems ?? (value.trim() ? value.split(/\n+/).length : 0);
    const totalItems = Math.max(includedItems, details.totalItems ?? includedItems);
    const empty = !value.trim() || EMPTY_MARKERS.test(value.trim());
    return {
      key,
      label: CONTEXT_SECTION_LABELS[key],
      source: details.source,
      reason: details.reason,
      characters: value.length,
      includedItems,
      totalItems,
      status: empty ? "缺失" : includedItems < totalItems ? "已截断" : "已包含",
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    sections,
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}
