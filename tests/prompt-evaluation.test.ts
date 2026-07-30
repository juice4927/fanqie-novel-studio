import { describe, expect, it } from "vitest";
import { parseProviderUsage, providerError, rejectsJsonMode } from "../electron/ai-provider";
import { comparePromptVersions, evaluatePromptOutput } from "../src/shared/prompt-evaluation";

describe("provider compatibility", () => {
  it("normalizes token usage and detects JSON mode rejection", () => {
    expect(parseProviderUsage({ usage: { prompt_tokens: 120, completion_tokens: 80 } })).toEqual({ inputTokens: 120, outputTokens: 80 });
    expect(parseProviderUsage({ usage: { input_tokens: 12, output_tokens: 8 } })).toEqual({ inputTokens: 12, outputTokens: 8 });
    expect(rejectsJsonMode(400, "response_format is unsupported")).toBe(true);
    expect(providerError(429, "busy")).toContain("暂时不可用");
  });
});

describe("prompt regression evaluation", () => {
  const fixture = { id: "chapter-json", requiredKeys: ["title", "content"], forbiddenFacts: ["主角已经知道密码"], maxCharacters: 1000 };
  it("detects structure and fact regressions deterministically", () => {
    const good = evaluatePromptOutput(fixture, { title: "门锁", content: "主角调查门锁并发现新的问题。" }, 100, 50);
    const bad = evaluatePromptOutput(fixture, { content: "主角已经知道密码。重复句子重复句子重复句子重复句子" }, 100, 50);
    expect(good.structureScore).toBe(100);
    expect(bad.structureScore).toBe(50);
    expect(bad.factScore).toBe(50);
    expect(comparePromptVersions([good], [bad])).toMatchObject({ regressed: true });
  });
});
