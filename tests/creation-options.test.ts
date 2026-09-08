import { describe, expect, it } from "vitest";
import {
  compilePositioningCard,
  DEFAULT_WORDS_PER_CHAPTER,
  MAX_WORDS_PER_CHAPTER,
  MIN_WORDS_PER_CHAPTER,
  normalizeWordsPerChapter,
} from "../src/shared/creation-options";
import { GENRE_ELEMENT_GROUPS, GENRE_ELEMENTS, NARRATIVE_GENRES } from "../src/shared/genre-composition";
import { approvedVolumeRanges } from "../src/shared/planning";
import type { BookConceptInput, PlanNode } from "../src/shared/types";

describe("creation options", () => {
  it("offers the expanded narrative and element surface", () => {
    expect(NARRATIVE_GENRES).toHaveLength(18);
    expect(GENRE_ELEMENT_GROUPS).toHaveLength(5);
    expect(GENRE_ELEMENTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GENRE_ELEMENTS).size).toBe(GENRE_ELEMENTS.length);
    for (const legacy of ["现代都市", "重生", "系统", "种田", "多主角"]) expect(GENRE_ELEMENTS).toContain(legacy);
    for (const added of ["模拟器", "单元剧", "师徒", "热血", "学生"]) expect(GENRE_ELEMENTS).toContain(added);
  });

  it("normalizes per-chapter word targets", () => {
    expect(normalizeWordsPerChapter(undefined)).toBe(DEFAULT_WORDS_PER_CHAPTER);
    expect(normalizeWordsPerChapter(2000)).toBe(2000);
    expect(() => normalizeWordsPerChapter(MIN_WORDS_PER_CHAPTER - 1)).toThrow();
    expect(() => normalizeWordsPerChapter(MAX_WORDS_PER_CHAPTER + 1)).toThrow();
    expect(() => normalizeWordsPerChapter(2500.5)).toThrow();
  });

  it("compresses the whole positioning panel into a short card", () => {
    const input: BookConceptInput = {
      genre: "科幻末世",
      fanqieCategoryKey: "男频:8",
      subGenreIds: [],
      openingArchetype: "灾变爆发",
      lengthShape: "长线连续",
      narrativePerson: "第三人称限知",
      protagonistRoles: ["医生"],
      toneTags: ["热血", "悬疑紧张"],
      secondaryGenres: ["生存", "群像"],
      genreElements: ["末世", "系统"],
      customGenreDirection: "不要无敌流",
      targetWords: 3_000_000,
      wordsPerChapter: 3000,
      updateCadence: "每日 3 章",
      seed: "",
      readerPersona: "18–35 岁移动端读者",
      readerPromise: "灾变规则下的生存与重建",
      commercialBoundary: "不写无代价的能力",
      evidenceNotes: ["科幻末世竞争中等，新书率上升"],
    };
    const card = compilePositioningCard(input);
    expect(card).toContain("男频·科幻末世");
    expect(card).toContain("开局形态：灾变爆发");
    expect(card).toContain("主角身份：医生");
    expect(card).toContain("单章约 3000 字");
    expect(card).toContain("不要无敌流");
    expect(card).toContain("读者画像：18–35 岁移动端读者");
    expect(card).toContain("读者承诺：灾变规则下的生存与重建");
    expect(card).toContain("商业边界：不写无代价的能力");
    expect(card).toContain("市场证据：科幻末世竞争中等");
    expect(card.length).toBeLessThan(500);
  });
});

describe("per-chapter word target drives volume ranges", () => {
  const plan = (targetWords: number): PlanNode => ({
    id: "volume",
    kind: "分卷",
    title: "第一卷",
    ordinal: 1,
    goal: "目标",
    conflict: "冲突",
    outcome: "结果",
    targetWords,
    status: "已批准",
    parentId: null,
  });

  it("estimates more chapters per volume for shorter chapters", () => {
    const at2500 = approvedVolumeRanges([plan(250000)], 2500)[0];
    const at2000 = approvedVolumeRanges([plan(250000)], 2000)[0];
    expect(at2500.toChapter).toBe(100);
    expect(at2000.toChapter).toBe(125);
  });
});
