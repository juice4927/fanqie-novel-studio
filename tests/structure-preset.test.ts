import { describe, expect, it } from "vitest";
import { StructurePlanningSchema } from "../electron/ai-definitions";
import {
  CHAPTERS_PER_LADDER_LEVEL,
  chapterPlanningRange,
  resolveCreationPreset,
  resolveStructurePreset,
} from "../src/shared/creation-presets";
import { getFanqieCategoryProfile } from "../src/shared/fanqie-taxonomy";
import { GENRE_SKELETON_SECTIONS } from "../src/shared/genre-skeleton-sections";
import { reviewIncubationCandidate } from "../src/shared/incubation-review";
import { GENRES, type IncubationCandidate } from "../src/shared/types";

const shapeOf = (lengthShape: string) => resolveStructurePreset({ categoryKey: "男频:1141", lengthShape });

const candidate = (overrides: Partial<IncubationCandidate> = {}): IncubationCandidate => ({
  id: "candidate-1",
  title: "测试方案",
  premise: "一个足够长的故事前提，用来说明主角的处境与选择。",
  genreSubtype: "系统成长",
  secondaryGenres: ["成长"],
  genreElements: ["现代都市", "系统"],
  openingMechanism: "系统降临",
  growthCarrier: "任务积分",
  primaryPayoff: "身份跃迁",
  protagonistDesire: "夺回被夺走的一切并证明自己",
  readerPromise: "连续的能力与身份回报",
  coreEmotion: "热血",
  ending: "主角完成目标并守住关系",
  immutableRules: ["能力有边界", "升级有代价"],
  prohibitedPatterns: ["反派降智", "误会拖延"],
  audience: "偏好成长与回报的读者",
  commercialHook: "开局低谷，回报连续可见",
  longFormEngine: "个人、团队、势力三轮扩张",
  fanqieCategoryKey: "男频:1141",
  subGenreIds: [],
  titleOptions: [
    { title: "测试方案甲", rationale: "直观点题", tags: ["热血"] },
    { title: "测试方案乙", rationale: "强调成长", tags: ["成长"] },
    { title: "测试方案丙", rationale: "突出反差", tags: ["逆袭"] },
  ],
  openingDesign: {
    chapter1Hook: "主角在系统降临当天被迫做出一个不可逆的选择。",
    firstThreeChaptersPromise: "前三章给出规则、代价与第一条可验证回报。",
    firstPayoffChapter: 2,
    retentionAnchors: ["规则边界", "代价来源"],
  },
  escalationLadder: [
    { stage: "第一级", conflict: "起步冲突", expansionAxis: "资源", payoff: "小回报", cost: "小代价" },
    { stage: "第二级", conflict: "升级冲突", expansionAxis: "关系", payoff: "中回报", cost: "中代价" },
    { stage: "第三级", conflict: "高位冲突", expansionAxis: "势力", payoff: "大回报", cost: "大代价" },
  ],
  sustainability: { fatiguePoint: "重复同类回报", shiftPlan: "切换扩张轴" },
  differentiation: { against: ["差异一", "差异二"], originalityRisk: "低", riskNotes: "" },
  suggestedTags: ["热血", "成长"],
  ...overrides,
});

describe("结构参数化", () => {
  it("篇幅形态决定阶段与分卷区间，作者选择覆盖分类推荐", () => {
    expect(shapeOf("单元剧").stages).toEqual([4, 6]);
    expect(shapeOf("单元剧").volumes).toEqual([4, 6]);
    expect(shapeOf("多卷史诗").stages).toEqual([5, 8]);
    expect(shapeOf("多卷史诗").volumes).toEqual([5, 8]);
    expect(shapeOf("长线连续").volumes).toEqual([3, 5]);
    expect(shapeOf("日常经营").stages).toEqual([4, 6]);

    // 男频:1141 的分类推荐是多卷史诗；作者改成单元剧后必须跟随作者。
    const categoryDefault = resolveStructurePreset({ categoryKey: "男频:1141" });
    expect(categoryDefault.volumes).toEqual([5, 8]);
    expect(shapeOf("单元剧").volumes).toEqual([4, 6]);
  });

  it("章纲字数区间以本书单章目标为中心，并夹回平台区间", () => {
    expect(chapterPlanningRange(2500)).toEqual([1750, 3250]);
    expect(chapterPlanningRange(1800)).toEqual([1400, 2340]);
    expect(chapterPlanningRange(4000)).toEqual([2800, 3500]);
    expect(chapterPlanningRange(undefined)).toEqual([1750, 3250]);
    expect(chapterPlanningRange(1000)[0]).toBeLessThanOrEqual(chapterPlanningRange(1000)[1]);
  });

  it("规划 schema 允许到 8 卷，超过则拒绝", () => {
    const volume = (index: number) => ({
      title: `第${index}卷`,
      goal: "一个足够长的阶段目标描述。",
      conflict: "一个足够长的阶段冲突描述。",
      outcome: "一个足够长的阶段结果描述。",
      targetWords: 200000,
    });
    const stage = (index: number) => ({
      title: `阶段${index}`,
      startChapter: index,
      goal: "一个足够长的阶段目标描述。",
      conflict: "一个足够长的阶段冲突描述。",
      outcome: "一个足够长的阶段结果描述。",
      targetWords: 200000,
    });
    const base = { stages: Array.from({ length: 5 }, (_, index) => stage(index + 1)) };
    expect(
      StructurePlanningSchema.safeParse({ ...base, volumes: Array.from({ length: 8 }, (_, i) => volume(i + 1)) })
        .success,
    ).toBe(true);
    expect(
      StructurePlanningSchema.safeParse({ ...base, volumes: Array.from({ length: 9 }, (_, i) => volume(i + 1)) })
        .success,
    ).toBe(false);
  });

  it("体检阈值随预设变化", () => {
    const category = getFanqieCategoryProfile("男频:1141")!;
    const narrow = resolveCreationPreset({ categoryKey: "男频:1141" });
    const wide = {
      ...narrow,
      structure: { ...narrow.structure, chapterWords: [2000, 2200] as const },
    };
    const at2500 = reviewIncubationCandidate({
      candidate: candidate(),
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      genreElements: ["现代都市", "系统"],
      category,
      preset: narrow,
    }).find((item) => item.id === "chapter-words");
    const at2500Narrow = reviewIncubationCandidate({
      candidate: candidate(),
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      genreElements: ["现代都市", "系统"],
      category,
      preset: wide,
    }).find((item) => item.id === "chapter-words");
    expect(at2500?.level).toBe("通过");
    expect(at2500Narrow?.level).toBe("提示");

    const capacity = reviewIncubationCandidate({
      candidate: candidate(),
      targetWords: 3_000_000,
      wordsPerChapter: 2000,
      genreElements: ["现代都市", "系统"],
      category,
      preset: narrow,
    }).find((item) => item.id === "engine-capacity");
    expect(capacity?.detail).toContain(`${CHAPTERS_PER_LADDER_LEVEL.多卷史诗} 章`);
  });

  it("每个题材都有骨架附加栏目，栏目名与提示都具体", () => {
    for (const genre of GENRES) {
      const sections = GENRE_SKELETON_SECTIONS[genre];
      expect(sections.length, genre).toBeGreaterThanOrEqual(1);
      for (const section of sections) {
        expect(section.label.length, genre).toBeGreaterThan(1);
        expect(section.hint.length, genre).toBeGreaterThan(4);
      }
    }
  });
});
