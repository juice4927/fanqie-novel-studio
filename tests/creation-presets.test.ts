import { describe, expect, it } from "vitest";
import {
  LENGTH_SHAPES,
  NARRATIVE_PERSONS,
  OPENING_ARCHETYPES,
  PROTAGONIST_ROLES,
  TONE_TAGS,
} from "../src/shared/creation-options";
import { DEFAULT_CREATION_PRESET, resolveCreationPreset, TARGET_WORD_PRESETS } from "../src/shared/creation-presets";
import {
  type CategoryCreationPreset,
  FANQIE_CATEGORY_PROFILES,
  FANQIE_CREATION_PRESETS,
  getFanqieCategoryProfile,
  listFanqieSubGenres,
} from "../src/shared/fanqie-taxonomy";

const SHAPE_NAMES: readonly string[] = LENGTH_SHAPES.map((item) => item.name);
const PERSON_NAMES: readonly string[] = [...NARRATIVE_PERSONS];
const TARGET_WORDS: readonly number[] = TARGET_WORD_PRESETS;

/** 把预设摊平成可比较的字段，数组按集合比较（顺序不算差异）。 */
const comparable = (seed: CategoryCreationPreset) => ({
  lengthShape: seed.lengthShape,
  narrativePerson: seed.narrativePerson,
  targetWords: String(seed.targetWords),
  openings: [...seed.openingArchetypes].sort().join("|"),
  tones: [...seed.toneTags].sort().join("|"),
  roles: [...seed.protagonistRoles].sort().join("|"),
});

describe("分类开书预设", () => {
  it("每个分类都有预设，且没有孤立键", () => {
    const keys = FANQIE_CATEGORY_PROFILES.map((profile) => profile.key).sort();
    expect(Object.keys(FANQIE_CREATION_PRESETS).sort()).toEqual(keys);
    for (const profile of FANQIE_CATEGORY_PROFILES) {
      expect(profile.creationPreset, profile.key).toBeDefined();
    }
  });

  it("预设取值都在面板可选项内", () => {
    for (const [key, seed] of Object.entries(FANQIE_CREATION_PRESETS)) {
      expect(SHAPE_NAMES, key).toContain(seed.lengthShape);
      expect(PERSON_NAMES, key).toContain(seed.narrativePerson);
      expect(TARGET_WORDS, key).toContain(seed.targetWords);
      expect(seed.openingArchetypes.length, key).toBeGreaterThan(0);
      expect(seed.toneTags.length, key).toBeLessThanOrEqual(2);
      expect(seed.protagonistRoles.length, key).toBeLessThanOrEqual(2);
      for (const opening of seed.openingArchetypes) expect(OPENING_ARCHETYPES, key).toContain(opening);
      for (const tone of seed.toneTags) expect(TONE_TAGS, key).toContain(tone);
      for (const role of seed.protagonistRoles) expect(PROTAGONIST_ROLES, key).toContain(role);
    }
  });

  it("同题材分类的预设至少在两个字段上不同", () => {
    const groups = new Map<string, typeof FANQIE_CATEGORY_PROFILES>();
    for (const profile of FANQIE_CATEGORY_PROFILES) {
      groups.set(profile.genre, [...(groups.get(profile.genre) ?? []), profile]);
    }
    for (const [genre, profiles] of groups) {
      for (let left = 0; left < profiles.length; left += 1) {
        for (let right = left + 1; right < profiles.length; right += 1) {
          const a = comparable(profiles[left].creationPreset!);
          const b = comparable(profiles[right].creationPreset!);
          const differences = (Object.keys(a) as Array<keyof typeof a>).filter((field) => a[field] !== b[field]);
          expect(
            differences.length,
            `${genre}：${profiles[left].name} vs ${profiles[right].name}`,
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("结构区间由篇幅形态驱动，单章字数与回报窗口取自分类画像", () => {
    const epic = getFanqieCategoryProfile("男频:1141")!;
    const epicPreset = resolveCreationPreset({ categoryKey: epic.key });
    expect(epicPreset.lengthShape).toBe("多卷史诗");
    expect(epicPreset.structure.stages).toEqual([5, 8]);
    expect(epicPreset.structure.volumes).toEqual([5, 8]);
    expect(epicPreset.structure.chapterWords).toEqual(epic.typicalChapterWords);
    expect(epicPreset.structure.firstPayoffWindow).toEqual(epic.firstPayoffWindow);

    const episodic = getFanqieCategoryProfile("男频:539")!;
    const episodicPreset = resolveCreationPreset({ categoryKey: episodic.key });
    expect(episodicPreset.lengthShape).toBe("单元剧");
    expect(episodicPreset.structure.stages).toEqual([4, 6]);
    expect(episodicPreset.structure.volumes).toEqual([4, 6]);

    const daily = getFanqieCategoryProfile("男频:261")!;
    expect(resolveCreationPreset({ categoryKey: daily.key }).lengthShape).toBe("日常经营");
  });

  it("分类默认值确实随分类变化", () => {
    const fantasy = resolveCreationPreset({ categoryKey: "男频:1141" });
    const sweet = resolveCreationPreset({ categoryKey: "女频:267" });
    expect(fantasy.openingArchetypes).toEqual(["穿越", "能力觉醒"]);
    expect(fantasy.toneTags).toEqual(["热血"]);
    expect(fantasy.targetWords).toBe(3_000_000);
    expect(sweet.openingArchetypes).toEqual(["系统降临", "继承/获得"]);
    expect(sweet.toneTags).toEqual(["甜宠", "轻松"]);
    expect(sweet.targetWords).toBe(1_000_000);
    expect(sweet.lengthShape).not.toBe(fantasy.lengthShape);
  });

  it("二级流派只做区间窄化，不会越出分类范围", () => {
    const profile = getFanqieCategoryProfile("男频:1141")!;
    const [sub] = listFanqieSubGenres(profile.key);
    expect(sub).toBeDefined();
    const preset = resolveCreationPreset({ categoryKey: profile.key, subGenreIds: [sub.id] });
    const [low, high] = preset.structure.chapterWords;
    expect(low).toBeGreaterThanOrEqual(profile.typicalChapterWords[0]);
    expect(high).toBeLessThanOrEqual(profile.typicalChapterWords[1]);
  });

  it("未知分类回退到改造前的全局默认", () => {
    const preset = resolveCreationPreset({ categoryKey: "不存在的分类" });
    expect(preset).toEqual(DEFAULT_CREATION_PRESET);
    expect(preset.categoryKey).toBeNull();
    expect(preset.openingArchetypes).toEqual(["重生"]);
    expect(preset.updateCadence).toBe("每日 2 章");
  });
});
