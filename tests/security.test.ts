import { describe, expect, it } from "vitest";
import { sanitizeResearchBatch, sanitizeResearchText } from "../electron/ai-service";
import { validateIpcArgs } from "../electron/ipc-validation";

describe("research text sanitization", () => {
  it("redacts identifying metadata and stable entities before cloud analysis", () => {
    const source = "作者：某作者\n沈砚说道，他刚从云港市回来。《第七码头》记录了电话 13812345678 和 https://example.test/a。";
    const sanitized = sanitizeResearchText(source);
    expect(sanitized).not.toContain("某作者");
    expect(sanitized).not.toContain("沈砚");
    expect(sanitized).not.toContain("云港市");
    expect(sanitized).not.toContain("第七码头");
    expect(sanitized).not.toContain("13812345678");
    expect(sanitized).not.toContain("example.test");
    expect(sanitized).toContain("<角色1>");
    expect(sanitized).toContain("<地点组织1>");
  });

  it("redacts names in ordinary sentences and keeps placeholders stable across chapters", () => {
    const sanitized = sanitizeResearchBatch([
      { content: "大家都认识沈砚。沈砚，你终于从云港市回来了。" },
      { content: "第二天，沈砚去了云港市。" },
    ]);
    expect(sanitized.join("\n")).not.toContain("沈砚");
    expect(sanitized.join("\n")).not.toContain("云港市");
    expect(sanitized[0].match(/<角色1>/g)?.length).toBe(2);
    expect(sanitized[1]).toContain("<角色1>");
    expect(sanitized[0]).toContain("<地点组织1>");
    expect(sanitized[1]).toContain("<地点组织1>");
  });
});

describe("IPC runtime validation", () => {
  it("rejects malformed and oversized write payloads", () => {
    expect(() => validateIpcArgs("createProject", [{ title: "", genre: "未知", targetWords: -1, updateCadence: "" }])).toThrow("参数无效");
    expect(() => validateIpcArgs("saveChapter", ["project", {
      id: "chapter", number: 1, title: "标题", outline: "章纲", content: "正文".repeat(100_001),
      wordCount: 0, status: "草稿", batchMode: "逐章", isKeyChapter: false,
      revision: 1, updatedAt: new Date().toISOString(),
    }, "autosave"])).toThrow("content");
    expect(() => validateIpcArgs("capturePublicRanking", ["file:///etc/passwd", "榜单"])).toThrow("参数无效");
    expect(() => validateIpcArgs("importMetricsCsv", ["project", "x".repeat(20_000_001)])).toThrow("参数无效");
    expect(() => validateIpcArgs("createBackup", ["short"])).toThrow("参数无效");
  });

  it("accepts valid autosaves and does not echo secret values in errors", () => {
    const chapter = {
      id: "chapter", number: 1, title: "标题", outline: "章纲", content: "正文",
      wordCount: 2, status: "草稿", batchMode: "逐章", isKeyChapter: false,
      revision: 1, updatedAt: new Date().toISOString(),
    };
    expect(validateIpcArgs("saveChapter", ["project", chapter, "autosave"])).toEqual(["project", chapter, "autosave"]);
    const secret = "sensitive-api-key";
    try {
      validateIpcArgs("saveAiSettings", [{ baseUrl: "not-a-url", model: "m", embeddingModel: "e", inputPricePerMillion: 0, outputPricePerMillion: 0 }, secret]);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
    const settings = { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1", embeddingModel: "local", inputPricePerMillion: 0, outputPricePerMillion: 0, longTaskTimeoutMinutes: 10 };
    expect(validateIpcArgs("saveAiSettings", [settings])).toEqual([settings]);
    expect(() => validateIpcArgs("saveAiSettings", [{ ...settings, longTaskTimeoutMinutes: 20 }])).toThrow("参数无效");
  });

  it("validates composable genre inputs with bounded selections", () => {
    const input = {
      genre: "都市脑洞",
      targetWords: 1000000,
      updateCadence: "每日 2 章",
      seed: "医疗悬疑群像",
      secondaryGenres: ["悬疑", "群像"],
      genreElements: ["现代都市", "探案", "无CP"],
      customGenreDirection: "不使用系统",
    };
    expect(validateIpcArgs("generateBookConcepts", [input])).toEqual([input]);
    expect(() => validateIpcArgs("generateBookConcepts", [{
      ...input,
      secondaryGenres: ["悬疑", "群像", "成长", "经营"],
    }])).toThrow("参数无效");
    expect(() => validateIpcArgs("generateBookConcepts", [{
      ...input,
      secondaryGenres: ["不存在的类型"],
    }])).toThrow("参数无效");
  });

  it("accepts a strict per-project aesthetic profile", () => {
    const contract = {
      premise: "前提", protagonistDesire: "欲望", readerPromise: "承诺", coreEmotion: "情绪", ending: "终局",
      immutableRules: [], prohibitedPatterns: [], version: 1, approved: false,
      updatedAt: new Date().toISOString(),
      aestheticProfile: {
        narrativeDistance: "贴身", emotionalTemperature: "热烈",
        proseTexture: "明快", dialogueStyle: "直接", emotionalExpression: "外放",
        signatureTechniques: ["群像交锋"], avoidPatterns: ["冷处理"],
      },
    };

    expect(validateIpcArgs("saveContract", ["project", contract])).toEqual(["project", contract]);
    expect(() => validateIpcArgs("saveContract", ["project", {
      ...contract,
      aestheticProfile: { ...contract.aestheticProfile, emotionalTemperature: "统一模板" },
    }])).toThrow("参数无效");
  });
});
