import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_KNOWLEDGE_SOURCES,
  compileCommercialGuidance,
  compileDeconstructionFramework,
  resolveGenreStage,
  resolveStoryStage,
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
      expect(outputs[index]).toContain("回报工具箱（不要求按固定顺序升级）");
      expect(outputs[index]).toContain("重复疲劳识别");
      expect(outputs[index]).toContain("基础题材母题（按需选用，不是固定套路）");
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

  it("combines narrative genres and elements without turning them into hard chapter gates", () => {
    const guidance = compileCommercialGuidance("都市脑洞", 12, {
      currentWords: 30000,
      targetWords: 1000000,
      secondaryGenres: ["悬疑", "群像"],
      genreElements: ["现代都市", "探案", "无CP"],
      customGenreDirection: "以基层医疗案件推动人物成长，不使用系统。",
    });
    expect(guidance).toContain("复合叙事类型：悬疑 + 群像");
    expect(guidance).toContain("题材元素：现代都市、探案、无CP");
    expect(guidance).toContain("以基层医疗案件推动人物成长，不使用系统");
    expect(guidance).toContain("不要求每章覆盖");
    expect(guidance).toContain("自定义创作方向优先于题材惯例");
  });

  it("keeps a custom subtype visible instead of replacing it with built-in options", () => {
    const guidance = compileCommercialGuidance("都市脑洞", 8, {
      subtype: "医疗探案群像",
      customGenreDirection: "案件服务于人物成长。",
    });
    expect(guidance).toContain("当前自定义子类型：医疗探案群像");
    expect(guidance).toContain("不强套内置子类型");
  });

  it("uses an approved project stage instead of imposing the generic chapter threshold", () => {
    const plans = [
      { kind: "宏观阶段", status: "已批准", ordinal: 1, targetWords: 100000, title: "困城求生", goal: "建立可信的小队协作", conflict: "资源与信任同时短缺", outcome: "获得第一个稳定据点" },
      { kind: "宏观阶段", status: "已批准", ordinal: 2, targetWords: 200000, title: "据点分裂", goal: "处理内部路线冲突", conflict: "救人与守城无法兼得", outcome: "小队形成新的行动原则" },
    ];
    const storyStage = resolveStoryStage(plans, 150000);
    expect(storyStage?.title).toBe("据点分裂");
    const guidance = compileCommercialGuidance("都市脑洞", 80, { currentWords: 150000, targetWords: 1000000, storyStage });
    expect(guidance).toContain("当前项目阶段：据点分裂");
    expect(guidance).toContain("项目阶段冲突：救人与守城无法兼得");
    expect(guidance).not.toContain("当前题材节奏参考：中期");
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
      expect(profile.conflictEngine.length).toBeGreaterThan(20);
      expect(profile.payoffPattern.length).toBeGreaterThan(20);
      expect(profile.expansionAxis.length).toBeGreaterThan(20);
      expect(profile.fatigueSignal.length).toBeGreaterThan(20);
      expect(profile.qualityChecks).toHaveLength(4);
      expect(profile.narrativeGenres.length).toBeGreaterThan(0);
      expect(profile.expansionRoutes.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("maps independent categories to fitting narrative rules and expansion routes", () => {
    const scienceFiction = FANQIE_CATEGORY_PROFILES.find((item) => item.key === "女频:8")!;
    const sports = FANQIE_CATEGORY_PROFILES.find((item) => item.key === "女频:746")!;
    const suspense = FANQIE_CATEGORY_PROFILES.find((item) => item.key === "女频:747")!;
    expect(scienceFiction).toMatchObject({ genre: "都市脑洞", recommendedSubtype: "异能规则", narrativeGenres: ["生存", "冒险"] });
    expect(sports).toMatchObject({ genre: "都市脑洞", recommendedSubtype: "系统成长", narrativeGenres: ["竞技", "成长"] });
    expect(suspense.narrativeGenres[0]).toBe("悬疑");
    expect(scienceFiction.expansionRoutes).not.toEqual(sports.expansionRoutes);
    expect(sports.expansionRoutes).not.toEqual(suspense.expansionRoutes);
    expect(scienceFiction.expansionAxis).toContain("不使用统一扩张公式");
  });

  it("gives distinct executable rules to categories inside the same broad genre", () => {
    const daily = compileCommercialGuidance("都市脑洞", 5, { fanqieCategoryKey: "男频:261" });
    const suspense = compileCommercialGuidance("都市脑洞", 5, { fanqieCategoryKey: "男频:539" });
    expect(daily).toContain("现实身份改善与可见生活反馈");
    expect(suspense).toContain("异常规则与案件真相互相验证");
    expect(daily).toContain("分类专属质检");
    expect(suspense).toContain("可复核异常证据");
    expect(daily).not.toBe(suspense);
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
