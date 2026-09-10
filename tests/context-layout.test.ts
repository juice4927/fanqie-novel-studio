import { describe, expect, it } from "vitest";
import { renderContextForPrompt, renderStableBookContext } from "../src/shared/context-compiler";
import { buildContextDiagnostics } from "../src/shared/context-diagnostics";
import { CONTEXT_LAYOUT, contextBandOf } from "../src/shared/context-layout";
import type { ContextPackage } from "../src/shared/types";

function context(patch: Partial<ContextPackage> = {}): ContextPackage {
  return {
    contract: "契约正文",
    commercialGuidance: "题材引导正文",
    chapterIntent: "本章任务正文",
    expectationLedger: "跨章期待正文",
    longTermMemory: "长期记忆正文",
    volumeGoal: "当前卷目标正文",
    rollingOutline: "滚动章纲正文",
    recentSummary: "近期摘要正文",
    relevantFacts: "相关事实正文",
    storyEntries: "设定条目正文",
    forbiddenKnowledge: "边界正文",
    authorStyle: "文风正文",
    estimatedTokens: 100,
    ...patch,
  };
}

describe("context layout", () => {
  it("orders bands from stable to task", () => {
    const bands = CONTEXT_LAYOUT.map((item) => item.band);
    expect(bands[0]).toBe("stable");
    expect(bands.at(-1)).toBe("task");
    expect(bands.indexOf("slow")).toBeGreaterThan(bands.lastIndexOf("stable"));
    expect(bands.indexOf("fast")).toBeGreaterThan(bands.lastIndexOf("slow"));
    expect(bands.indexOf("task")).toBeGreaterThan(bands.lastIndexOf("fast"));
  });

  it("covers every renderable section exactly once", () => {
    const keys = CONTEXT_LAYOUT.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(contextBandOf("contract")).toBe("stable");
    expect(contextBandOf("chapterIntent")).toBe("task");
    expect(contextBandOf("guidanceMode")).toBeUndefined();
  });

  it("renders the stable prefix first and the chapter task last", () => {
    const rendered = renderContextForPrompt(context());
    expect(rendered.startsWith("## 创作契约与审美")).toBe(true);
    expect(rendered.trimEnd().endsWith("本章任务正文")).toBe(true);
    expect(rendered).not.toContain("guidanceMode");
  });

  it("renders only the stable band for the system prompt", () => {
    expect(renderStableBookContext(context())).toBe("## 创作契约与审美\n契约正文");
    expect(renderStableBookContext(context({ contract: "" }))).toBe("");
  });

  it("can exclude the stable band from the user message", () => {
    const rendered = renderContextForPrompt(context(), { excludeStable: true });
    expect(rendered).not.toContain("契约正文");
    expect(rendered).toContain("本章任务正文");
  });

  it("keeps the stable prefix byte-identical across chapters", () => {
    const first = renderStableBookContext(context({ chapterIntent: "第一章任务" }));
    const second = renderStableBookContext(context({ chapterIntent: "第二章任务", recentSummary: "第二章摘要" }));
    expect(first).toBe(second);
  });

  it("marks bands in diagnostics and measures the stable prefix", () => {
    const diagnostics = buildContextDiagnostics(context());
    expect(diagnostics.sections.find((section) => section.key === "contract")?.band).toBe("stable");
    expect(diagnostics.sections.find((section) => section.key === "chapterIntent")?.band).toBe("task");
    expect(diagnostics.stablePrefixCharacters).toBe("契约正文".length);
  });
});
