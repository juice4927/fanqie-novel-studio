import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_KNOWLEDGE_SOURCES,
  compileCommercialGuidance,
  compileDeconstructionFramework,
  resolveGenreStage,
} from "../src/shared/commercial-knowledge";
import { GENRE_PLUGINS, GENRE_STAGES } from "../src/shared/genre-plugins";
import { FANQIE_CATEGORY_PROFILES } from "../src/shared/fanqie-taxonomy";
import { GENRES } from "../src/shared/types";

describe("structured Chinese web-fiction genre packages", () => {
  it("provides complete structured rules for all six genres", () => {
    for (const genre of GENRES) {
      const plugin = GENRE_PLUGINS[genre];
      expect(plugin.id).toContain(".v2");
      expect(plugin.subtypes.length).toBeGreaterThanOrEqual(3);
      expect(plugin.targetAudience.length).toBeGreaterThanOrEqual(2);
      expect(plugin.coreFantasies.length).toBeGreaterThanOrEqual(3);
      expect(plugin.tabooBoundaries.length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(plugin.stages)).toEqual([...GENRE_STAGES]);
      expect(plugin.conflictEngines.length).toBeGreaterThanOrEqual(4);
      expect(plugin.rewardLadder.length).toBeGreaterThanOrEqual(5);
      expect(plugin.expansionAxes.length).toBeGreaterThanOrEqual(4);
      expect(plugin.fatigueRules.length).toBeGreaterThanOrEqual(2);
      expect(plugin.ledgerTemplates.length).toBeGreaterThanOrEqual(3);
      expect(plugin.qualityChecks.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("selects opening, retention, expansion, middle, climax and closure from progress", () => {
    expect(resolveGenreStage(1)).toBe("开篇");
    expect(resolveGenreStage(6)).toBe("追读");
    expect(resolveGenreStage(20)).toBe("扩张");
    expect(
      resolveGenreStage(80, { currentWords: 900000, targetWords: 3000000 }),
    ).toBe("中期");
    expect(
      resolveGenreStage(400, { currentWords: 2200000, targetWords: 3000000 }),
    ).toBe("高潮");
    expect(
      resolveGenreStage(500, { currentWords: 2750000, targetWords: 3000000 }),
    ).toBe("收束");
  });

  it("produces visibly different guidance for the same generic chapter position", () => {
    const uniqueMechanisms = {
      都市脑洞: "能力规则与现实制度冲突",
      "玄幻/仙侠": "境界压制与越阶解法",
      "历史/架空": "财政供给与战略目标",
      现言甜宠: "亲密需求与自我保护",
      古言宅斗: "证据真相与名声传播",
      年代重生: "前世记忆与历史偏移",
    } as const;
    const outputs = GENRES.map((genre) => compileCommercialGuidance(genre, 20));
    GENRES.forEach((genre, index) => {
      expect(outputs[index]).toContain(uniqueMechanisms[genre]);
      expect(outputs[index]).toContain("回报阶梯（由小到大）");
      expect(outputs[index]).toContain("重复疲劳识别");
      expect(outputs[index]).toContain("不作为机械硬门禁");
    });
    expect(new Set(outputs).size).toBe(GENRES.length);
  });

  it("applies the selected subtype profile to writing guidance", () => {
    const guidance = compileCommercialGuidance("年代重生", 12, {
      currentWords: 30000,
      targetWords: 1000000,
      subtype: "创业致富",
    });
    expect(guidance).toContain("当前子类型：创业致富");
    expect(guidance).toContain("政策、资金、渠道和竞争");
  });

  it("uses the same structured package for deconstruction", () => {
    const framework = compileDeconstructionFramework("古言宅斗");
    expect(framework).toContain("证据链");
    expect(framework).toContain("长线扩张轴");
    expect(framework).toContain("重复疲劳模式");
    expect(framework).toContain("期待→压力证据→主动行动→结果兑现→实际影响");
  });

  it("keeps source authority and provenance visible", () => {
    expect(
      COMMERCIAL_KNOWLEDGE_SOURCES.filter(
        (source) => source.authority === "平台官方",
      ).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      COMMERCIAL_KNOWLEDGE_SOURCES.every((source) =>
        source.url.startsWith("https://"),
      ),
    ).toBe(true);
  });

  it("maps every current Fanqie category to an executable genre profile", () => {
    expect(FANQIE_CATEGORY_PROFILES).toHaveLength(37);
    expect(FANQIE_CATEGORY_PROFILES.filter((item) => item.channel === "男频")).toHaveLength(19);
    expect(FANQIE_CATEGORY_PROFILES.filter((item) => item.channel === "女频")).toHaveLength(18);
    for (const profile of FANQIE_CATEGORY_PROFILES) {
      expect(GENRE_PLUGINS[profile.genre].subtypes.map((item) => item.name)).toContain(profile.recommendedSubtype);
      expect(profile.openingFocus.length).toBeGreaterThan(8);
      expect(profile.taboo.length).toBeGreaterThan(8);
    }
  });

  it("injects selected Fanqie category rules into writing guidance", () => {
    const guidance = compileCommercialGuidance("都市脑洞", 1, {
      fanqieCategoryKey: "男频:262",
    });
    expect(guidance).toContain("番茄分类映射：男频·都市脑洞");
    expect(guidance).toContain("三章内完成能力试验和现实收益");
    expect(guidance).toContain("震惊循环和任务流水");
  });
});
