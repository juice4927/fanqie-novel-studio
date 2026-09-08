import { describe, expect, it } from "vitest";
import {
  constraintDensity,
  contextComposition,
  countDirectives,
  positiveGuidanceRatio,
} from "../src/shared/guidance-metrics";
import {
  compileBeatSuggestion,
  compileGuidanceModeInstruction,
  guidanceCharacterWindow,
  guidanceTemperature,
  normalizeGuidanceMode,
  resolveGuidanceLevel,
} from "../src/shared/guidance-mode";
import { CHAPTER_FUNCTIONS, type ContextPackage } from "../src/shared/types";

describe("guidance modes", () => {
  it("normalizes unknown modes to the balanced default", () => {
    expect(normalizeGuidanceMode("自由")).toBe("自由");
    expect(normalizeGuidanceMode("严谨")).toBe("严谨");
    expect(normalizeGuidanceMode(undefined)).toBe("均衡");
    expect(normalizeGuidanceMode("宽松")).toBe("均衡");
  });

  it("maps modes to ascending sampling temperature", () => {
    expect(guidanceTemperature("自由")).toBeGreaterThan(guidanceTemperature("均衡"));
    expect(guidanceTemperature("均衡")).toBeGreaterThan(guidanceTemperature("严谨"));
    expect(guidanceTemperature(undefined)).toBe(0.85);
  });

  it("only the strict mode loads the full genre reference", () => {
    expect(resolveGuidanceLevel("自由")).toMatchObject({ retrieval: false, fullReference: false });
    expect(resolveGuidanceLevel("均衡")).toMatchObject({ retrieval: true, fullReference: false });
    expect(resolveGuidanceLevel("严谨")).toMatchObject({ retrieval: false, fullReference: true });
  });

  it("keeps the character window a soft reference, never a hard gate", () => {
    const balanced = guidanceCharacterWindow(2300, "均衡");
    expect(balanced.minimum).toBeLessThan(2300);
    expect(balanced.maximum).toBeGreaterThan(2300);
    const free = guidanceCharacterWindow(2300, "自由");
    expect(free.maximum).toBeGreaterThan(balanced.maximum);
    // 提示词给出的下限不能低于结构校验的硬下限（800），否则模型照做也会被拒。
    expect(guidanceCharacterWindow(1400, "自由").minimum).toBeGreaterThanOrEqual(800);
  });

  it("covers every chapter function with a beat suggestion", () => {
    for (const chapterFunction of CHAPTER_FUNCTIONS) {
      const suggestion = compileBeatSuggestion(chapterFunction);
      expect(suggestion).toContain("不必逐拍走完");
      expect(suggestion.length).toBeGreaterThan(10);
    }
  });

  it("gives every mode a positive instruction without a bare prohibition", () => {
    for (const mode of ["自由", "均衡", "严谨"] as const) {
      const instruction = compileGuidanceModeInstruction(mode);
      expect(instruction).toContain(mode);
      expect(constraintDensity(instruction)).toBe(0);
    }
  });
});

describe("guidance metrics", () => {
  it("counts prohibitions and checklist items deterministically", () => {
    const text = "不要强塞冲突。建议先明确目标。\n- 第一条\n- 第二条\n1. 第三条";
    expect(countDirectives(text)).toMatchObject({ prohibitions: 1, checklistItems: 3 });
    expect(constraintDensity(text)).toBeGreaterThan(0);
    expect(positiveGuidanceRatio(text)).toBeGreaterThan(0);
  });

  it("reports the intent-to-guidance ratio and shares", () => {
    const context = {
      contract: "契约",
      commercialGuidance: "商业知识".repeat(100),
      chapterIntent: "本章任务".repeat(50),
      expectationLedger: "",
      longTermMemory: "",
      volumeGoal: "",
      rollingOutline: "",
      recentSummary: "",
      relevantFacts: "",
      forbiddenKnowledge: "",
      authorStyle: "",
    } satisfies Pick<
      ContextPackage,
      | "contract"
      | "commercialGuidance"
      | "chapterIntent"
      | "expectationLedger"
      | "longTermMemory"
      | "volumeGoal"
      | "rollingOutline"
      | "recentSummary"
      | "relevantFacts"
      | "forbiddenKnowledge"
      | "authorStyle"
    >;
    const composition = contextComposition(context);
    expect(composition.sections.commercialGuidance).toBe(400);
    expect(composition.sections.chapterIntent).toBe(200);
    expect(composition.intentToGuidanceRatio).toBe(0.5);
    expect(composition.commercialShare).toBeGreaterThan(0);
  });

  it("returns a neutral ratio when there is no generic guidance", () => {
    const composition = contextComposition({
      contract: "",
      commercialGuidance: "",
      chapterIntent: "任务",
      expectationLedger: "",
      longTermMemory: "",
      volumeGoal: "",
      rollingOutline: "",
      recentSummary: "",
      relevantFacts: "",
      forbiddenKnowledge: "",
      authorStyle: "",
    });
    expect(composition.intentToGuidanceRatio).toBe(1);
    expect(composition.total).toBe(2);
  });
});
