import { describe, expect, it } from "vitest";
import { buildContextDiagnostics, contextForModel } from "../src/shared/context-diagnostics";
import type { ContextPackage } from "../src/shared/types";

const context = (): ContextPackage => ({
  contract: "故事前提：测试",
  commercialGuidance: "阶段：追读",
  chapterIntent: "本章承诺：推进",
  expectationLedger: "期待一\n期待二",
  longTermMemory: "长期摘要",
  volumeGoal: "尚未批准当前卷纲",
  rollingOutline: "第10章\n第11章",
  recentSummary: "第9章摘要",
  relevantFacts: "事实一\n事实二",
  forbiddenKnowledge: "无额外限制",
  authorStyle: "平均句长 18 字",
  estimatedTokens: 120,
});

describe("context diagnostics", () => {
  it("explains included, truncated and missing context without changing model input", () => {
    const value = context();
    value.diagnostics = buildContextDiagnostics(
      value,
      {
        rollingOutline: { includedItems: 2, totalItems: 6 },
        relevantFacts: { includedItems: 2, totalItems: 2 },
      },
      ["状态账本存在冲突事实"],
    );

    expect(value.diagnostics.sections.find((item) => item.key === "rollingOutline")?.status).toBe("已截断");
    expect(value.diagnostics.sections.find((item) => item.key === "volumeGoal")?.status).toBe("缺失");
    expect(value.diagnostics.warnings).toEqual(["状态账本存在冲突事实"]);
    expect(contextForModel(value)).not.toHaveProperty("diagnostics");
    expect(contextForModel(value).estimatedTokens).toBe(120);
  });
});
