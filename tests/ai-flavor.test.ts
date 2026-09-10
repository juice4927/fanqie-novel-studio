import { describe, expect, it } from "vitest";
import {
  analyzeAiFlavor,
  formatAiFlavorReport,
  mergeAiFlavorReports,
  whitelistRangesFor,
} from "../src/shared/ai-flavor";
import { AI_FLAVOR_EXCLUSIONS, AI_FLAVOR_FEATURES, type AiFlavorFeature } from "../src/shared/ai-flavor-lexicon";
import baseline from "./fixtures/ai-flavor-baseline.json";

const TEST_FEATURE: AiFlavorFeature = {
  id: "test-hit",
  label: "测试命中",
  kind: "词",
  pattern: "错",
  isRegExp: false,
  severity: "advisory",
  ratio: 0,
  source: "测试",
};

function textWithHits(hits: number): string {
  return "错".repeat(hits) + "好".repeat(1000 - hits);
}

describe("ai flavor lexicon", () => {
  it("covers every kind and the validated human-vs-model ratios", () => {
    const kinds = new Set(AI_FLAVOR_FEATURES.map((feature) => feature.kind));
    expect(kinds).toEqual(new Set(["词", "句式", "标点", "结构"]));

    const ratios = new Map(AI_FLAVOR_FEATURES.map((feature) => [feature.id, feature.ratio]));
    expect(ratios.get("struct-initial-comment")).toBe(4.4);
    expect(ratios.get("struct-personified-vehicle")).toBe(7.3);
    expect(ratios.get("struct-contrast-pair")).toBe(3.4);
    expect(ratios.get("punct-enumeration-cluster")).toBe(1.8);
    expect(ratios.get("struct-adjacent-isomorphic")).toBe(2.0);
    expect(ratios.get("punct-dash")).toBe(3.0);
    expect(ratios.get("punct-colon")).toBe(3.8);
    expect(ratios.get("struct-ordinal-heading")).toBe(3.1);
    expect(ratios.get("struct-formulaic-opener")).toBe(3.2);
    expect(ratios.get("syntax-translationese")).toBe(2.6);

    for (const feature of AI_FLAVOR_FEATURES) {
      expect(feature.source.length).toBeGreaterThan(0);
      expect(feature.note?.length).toBeGreaterThan(0);
      if (feature.isRegExp) {
        expect(() => new RegExp(feature.pattern, "gmu"), feature.id).not.toThrow();
      } else {
        expect(feature.pattern.length, feature.id).toBeGreaterThan(0);
      }
    }
  });

  it("detects the one-level forbidden word and template lists", () => {
    const similes = analyzeAiFlavor("他仿佛看见一道光，犹如旧梦，宛若昨日，如同回声。");
    expect(similes.hits.find((hit) => hit.featureId === "blocking-cliche-simile")?.count).toBe(4);

    const actions = analyzeAiFlavor("毫无征兆，他深吸一口气，不禁眉头微皱，瞳孔一缩，心中一动，心头一震。");
    expect(actions.hits.find((hit) => hit.featureId === "blocking-cliche-action")?.count).toBe(7);

    const templates = analyzeAiFlavor("她眼中闪过一道光，嘴角勾起弧度，心中涌起热流。取而代之的是沉默。");
    const ids = templates.hits.map((hit) => hit.featureId);
    expect(ids).toContain("blocking-eye-flash");
    expect(ids).toContain("blocking-mouth-curl");
    expect(ids).toContain("blocking-heart-surge");
    expect(ids).toContain("blocking-replaced-by");

    const judgements = analyzeAiFlavor("毫无疑问，他的判断不容置疑，答案显而易见。");
    expect(judgements.hits.find((hit) => hit.featureId === "blocking-absolute-judgment")?.count).toBe(3);
  });

  it("documents the excluded features with their ratios", () => {
    expect(AI_FLAVOR_EXCLUSIONS.map((item) => item.label)).toEqual([
      "正文设问",
      "句长均匀度",
      "比喻标记",
      "设问自答",
      "动词名词化",
    ]);
    expect(AI_FLAVOR_EXCLUSIONS.map((item) => item.ratio)).toEqual([0.05, 0.87, 0.42, 1.03, 0.52]);
    for (const exclusion of AI_FLAVOR_EXCLUSIONS) {
      expect(exclusion.reason.length).toBeGreaterThan(0);
      expect(AI_FLAVOR_FEATURES.some((feature) => feature.id === exclusion.id)).toBe(false);
    }
  });
});

describe("analyzeAiFlavor", () => {
  it("detects one feature of each kind", () => {
    const word = analyzeAiFlavor("他隐约听见脚步声。");
    expect(word.hits.map((hit) => hit.featureId)).toContain("blocking-vague-amount");
    expect(word.hits.every((hit) => hit.severity === "blocking")).toBe(true);

    const syntax = analyzeAiFlavor("不是命运，而是选择。");
    expect(syntax.hits.map((hit) => hit.featureId)).toContain("blocking-not-but");

    const punctuation = analyzeAiFlavor("他走了——没有回头。");
    const dash = punctuation.hits.find((hit) => hit.featureId === "punct-dash");
    expect(dash?.count).toBe(1);
    expect(dash?.severity).toBe("advisory");

    const structure = analyzeAiFlavor("值得一提的是，他终于来了。");
    expect(structure.hits.map((hit) => hit.featureId)).toContain("struct-formulaic-opener");
  });

  it("counts literal patterns without overlapping and reports positions", () => {
    const report = analyzeAiFlavor("他张了张嘴……又闭上……最后什么也没说……");
    const ellipsis = report.hits.find((hit) => hit.featureId === "punct-ellipsis-pause");
    expect(ellipsis?.count).toBe(3);
    expect(ellipsis?.positions).toEqual([5, 10, 19]);
  });

  it("computes per-thousand frequency from the effective characters", () => {
    const report = analyzeAiFlavor(textWithHits(4), { lexicon: [TEST_FEATURE] });
    expect(report.characters).toBe(1000);
    expect(report.hits[0].count).toBe(4);
    expect(report.hits[0].perThousand).toBe(4);
    expect(report.densityPerThousand).toBe(4);
    expect(report.risk).toBe("中");
  });

  it("suppresses whitelisted ranges from both hits and the character denominator", () => {
    const text = "他隐约听见脚步声，隐约觉得不对。";
    const withoutWhitelist = analyzeAiFlavor(text);
    const hitBefore = withoutWhitelist.hits.find((item) => item.featureId === "blocking-vague-amount");
    expect(hitBefore?.count).toBe(2);
    expect(withoutWhitelist.characters).toBe(16);

    const whitelisted = analyzeAiFlavor(text, { whitelist: [{ start: 1, end: 3 }] });
    const hitAfter = whitelisted.hits.find((item) => item.featureId === "blocking-vague-amount");
    expect(hitAfter?.count).toBe(1);
    expect(whitelisted.characters).toBe(14);

    const allWhitelisted = analyzeAiFlavor(text, { whitelist: [{ start: -10, end: 999 }] });
    expect(allWhitelisted.characters).toBe(0);
    expect(allWhitelisted.hits).toEqual([]);
    expect(allWhitelisted.densityPerThousand).toBe(0);
    expect(allWhitelisted.risk).toBe("低");
  });

  it("classifies risk at the documented density boundaries", () => {
    const cases: ReadonlyArray<[number, "低" | "中" | "高"]> = [
      [0, "低"],
      [2, "低"],
      [3, "中"],
      [5, "中"],
      [6, "高"],
    ];
    for (const [hits, risk] of cases) {
      const report = analyzeAiFlavor(textWithHits(hits), { lexicon: [TEST_FEATURE] });
      expect(report.densityPerThousand).toBe(hits);
      expect(report.risk).toBe(risk);
    }
  });

  it("does not flag the documented exclusions", () => {
    const questions = "天为什么会黑？地为什么会转？人为什么会老？水为什么会流？花为什么会谢？月为什么会缺？";
    const sentences = questions.split("？").filter(Boolean);
    expect(new Set(sentences.map((sentence) => [...sentence].length)).size).toBe(1);

    const report = analyzeAiFlavor(questions);
    expect(report.hits).toEqual([]);
    expect(report.blockingCount).toBe(0);
    expect(report.advisoryCount).toBe(0);
    expect(report.risk).toBe("低");

    const selfAnswered = analyzeAiFlavor("他为什么离开？因为心已经冷了。");
    expect(selfAnswered.hits).toEqual([]);
  });

  it("is deterministic and shares no mutable state between calls", () => {
    const text = "他隐约觉得不对，仿佛有什么东西压在胸口。他深吸一口气，转身走了。";
    const first = analyzeAiFlavor(text);
    const second = analyzeAiFlavor(text);
    expect(second).toEqual(first);
    expect(formatAiFlavorReport(second)).toBe(formatAiFlavorReport(first));

    first.hits[0].positions.push(999);
    expect(analyzeAiFlavor(text)).toEqual(second);
  });

  it("never throws on odd input and skips unusable lexicon entries", () => {
    expect(analyzeAiFlavor("").risk).toBe("低");
    expect(analyzeAiFlavor("今天天气很好。", { whitelist: [] }).hits).toEqual([]);

    const brokenRegex: AiFlavorFeature = {
      ...TEST_FEATURE,
      id: "broken-regex",
      pattern: "([",
      isRegExp: true,
    };
    const emptyLiteral: AiFlavorFeature = { ...TEST_FEATURE, id: "empty-literal", pattern: "" };
    expect(() => analyzeAiFlavor("随便写点什么。", { lexicon: [brokenRegex, emptyLiteral] })).not.toThrow();
    expect(analyzeAiFlavor("随便写点什么。", { lexicon: [brokenRegex, emptyLiteral] }).hits).toEqual([]);
  });
});

describe("mergeAiFlavorReports", () => {
  it("aggregates counts and recomputes density and risk", () => {
    const first = analyzeAiFlavor("他隐约听见脚步声。");
    const second = analyzeAiFlavor("他隐约觉得不对。");
    const merged = mergeAiFlavorReports([first, second]);

    expect(merged.characters).toBe(first.characters + second.characters);
    const hit = merged.hits.find((item) => item.featureId === "blocking-vague-amount");
    expect(hit?.count).toBe(2);
    expect(hit?.perThousand).toBeCloseTo(2 / (merged.characters / 1000), 10);
    expect(hit?.positions).toEqual([]);
    expect(merged.blockingCount).toBe(2);
    expect(merged.advisoryCount).toBe(0);
    expect(merged.risk).toBe("高");
  });

  it("returns an empty low-risk report for no input", () => {
    const merged = mergeAiFlavorReports([]);
    expect(merged).toEqual({
      characters: 0,
      hits: [],
      blockingCount: 0,
      advisoryCount: 0,
      densityPerThousand: 0,
      risk: "低",
    });
  });
});

describe("formatAiFlavorReport", () => {
  it("returns a compact one-line Chinese summary", () => {
    const report = analyzeAiFlavor("他隐约听见脚步声，隐约觉得不对。");
    const summary = formatAiFlavorReport(report);
    expect(summary).toContain("AI 味观察");
    expect(summary).toContain(`${report.characters} 字`);
    expect(summary).toContain("风险");
    expect(summary).toContain("一级禁用");
    expect(summary.endsWith("。")).toBe(true);
    expect(summary.includes("\n")).toBe(false);

    const clean = formatAiFlavorReport(analyzeAiFlavor("今天天气很好。"));
    expect(clean).toContain("命中 0 次");
    expect(clean).toContain("风险低");
  });
});

describe("ai flavor calibration baseline", () => {
  const samples = baseline as ReadonlyArray<{
    source: "human" | "model";
    text: string;
    expectedRisk: "低" | "中" | "高";
  }>;

  it("keeps at least three human and three model samples", () => {
    expect(samples.filter((sample) => sample.source === "human").length).toBeGreaterThanOrEqual(3);
    expect(samples.filter((sample) => sample.source === "model").length).toBeGreaterThanOrEqual(3);
  });

  it("matches every documented expectedRisk", () => {
    for (const sample of samples) {
      const report = analyzeAiFlavor(sample.text);
      expect(report.risk, `${sample.source}: ${sample.text.slice(0, 16)}`).toBe(sample.expectedRisk);
    }
  });
});

describe("whitelistRangesFor", () => {
  it("展开字面量词条的全部出现位置，并跳过空白词条", () => {
    const text = "他深吸一口气，又深吸一口气。";
    expect(whitelistRangesFor(text, ["深吸一口气", "  "])).toEqual([
      { start: 1, end: 6 },
      { start: 8, end: 13 },
    ]);
  });
});
