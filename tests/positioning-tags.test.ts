import { describe, expect, it } from "vitest";
import {
  compilePositioningCard,
  dedupePositioningTags,
  OPENING_ARCHETYPES,
  PROTAGONIST_ROLES,
  positioningTagOwners,
  TONE_TAGS,
} from "../src/shared/creation-options";
import { FANQIE_CATEGORY_PROFILES, listFanqieSubGenres } from "../src/shared/fanqie-taxonomy";
import {
  GENRE_ELEMENT_GROUPS,
  GENRE_ELEMENTS,
  PRIMARY_GENRE_ELEMENT_GROUPS,
  PRIMARY_GENRE_ELEMENTS,
} from "../src/shared/genre-composition";
import { MUTUALLY_EXCLUSIVE_ELEMENTS } from "../src/shared/incubation-review";
import type { BookConceptInput } from "../src/shared/types";

describe("positioning tag layers", () => {
  it("keeps tone tags and protagonist roles in a single source", () => {
    const toneGroup = GENRE_ELEMENT_GROUPS.find((group) => group.label === "情绪基调");
    const roleGroup = GENRE_ELEMENT_GROUPS.find((group) => group.label === "主角身份");
    expect(toneGroup?.elements).toBe(TONE_TAGS);
    expect(roleGroup?.elements).toBe(PROTAGONIST_ROLES);
    expect(PRIMARY_GENRE_ELEMENT_GROUPS.map((group) => group.label)).toEqual(["世界与时代", "故事机制", "人物关系"]);
    expect(PRIMARY_GENRE_ELEMENTS.length + TONE_TAGS.length + PROTAGONIST_ROLES.length).toBe(GENRE_ELEMENTS.length);
    for (const label of [...TONE_TAGS, ...PROTAGONIST_ROLES]) {
      expect(PRIMARY_GENRE_ELEMENTS).not.toContain(label);
    }
  });

  it("assigns each label to its highest-priority layer", () => {
    const owners = positioningTagOwners({
      fanqieCategoryKey: "男频:8",
      genre: "科幻末世",
      subGenreIds: [],
      secondaryGenres: ["群像"],
      openingArchetype: "重生",
      lengthShape: "单元剧",
      protagonistRoles: ["医生"],
      toneTags: ["治愈"],
      genreElements: ["群像", "末世", "重生", "单元剧"],
    });
    expect(owners.get("科幻末世")).toBe("番茄分类");
    expect(owners.get("群像")).toBe("复合叙事类型");
    expect(owners.get("重生")).toBe("开局形态");
    expect(owners.get("单元剧")).toBe("篇幅形态");
    expect(owners.get("医生")).toBe("主角身份");
    expect(owners.get("治愈")).toBe("情绪基调");
    expect(owners.get("末世")).toBe("题材元素");
  });

  it("drops lower-layer labels that duplicate a higher layer", () => {
    const deduped = dedupePositioningTags({
      fanqieCategoryKey: "男频:8",
      genre: "科幻末世",
      subGenreIds: [],
      secondaryGenres: ["群像"],
      openingArchetype: "重生",
      lengthShape: "单元剧",
      protagonistRoles: ["医生"],
      toneTags: ["治愈"],
      genreElements: ["群像", "重生", "单元剧", "末世", "医生", "治愈"],
    });
    expect(deduped.genreElements).toEqual(["末世"]);
    expect(deduped.secondaryGenres).toEqual(["群像"]);
    expect(deduped.toneTags).toEqual(["治愈"]);
  });

  it("leaves every category's default positioning without duplicate labels", () => {
    for (const profile of FANQIE_CATEGORY_PROFILES) {
      const options = listFanqieSubGenres(profile.key);
      const subGenreIds = options.slice(0, 1).map((item) => item.id);
      const deduped = dedupePositioningTags({
        fanqieCategoryKey: profile.key,
        genre: profile.genre,
        subGenreIds,
        secondaryGenres: [...profile.narrativeGenres],
        openingArchetype: OPENING_ARCHETYPES[0],
        lengthShape: "单元剧",
        protagonistRoles: ["医生"],
        toneTags: ["治愈"],
        genreElements: [...profile.genreElements],
      });
      const subGenreNames = options.filter((item) => deduped.subGenreIds.includes(item.id)).map((item) => item.name);
      const labels = [
        ...subGenreNames,
        ...(deduped.secondaryGenres ?? []),
        ...(deduped.protagonistRoles ?? []),
        ...(deduped.toneTags ?? []),
        ...(deduped.genreElements ?? []),
      ];
      expect(new Set(labels).size, `${profile.channel}·${profile.name} 存在重复标签：${labels.join("、")}`).toBe(
        labels.length,
      );
    }
  });

  it("keeps every mutual-exclusion label selectable and detectable", () => {
    for (const [left, right] of MUTUALLY_EXCLUSIVE_ELEMENTS) {
      expect(GENRE_ELEMENTS).toContain(left);
      expect(GENRE_ELEMENTS).toContain(right);
    }
  });

  it("compiles a card without repeating a label across layers", () => {
    const input: BookConceptInput = {
      genre: "科幻末世",
      fanqieCategoryKey: "男频:8",
      subGenreIds: [],
      openingArchetype: "重生",
      lengthShape: "单元剧",
      narrativePerson: "第三人称限知",
      protagonistRoles: ["医生"],
      toneTags: ["治愈"],
      secondaryGenres: ["群像"],
      genreElements: ["群像", "重生", "单元剧", "医生", "治愈", "末世"],
      customGenreDirection: "",
      targetWords: 1_000_000,
      wordsPerChapter: 2500,
      updateCadence: "每日 2 章",
      seed: "",
    };
    const card = compilePositioningCard(input);
    expect(card.match(/群像/g)).toHaveLength(1);
    expect(card.match(/重生/g)).toHaveLength(1);
    expect(card.match(/单元剧/g)).toHaveLength(1);
    expect(card.match(/医生/g)).toHaveLength(1);
    expect(card.match(/治愈/g)).toHaveLength(1);
    expect(card.match(/科幻末世/g)).toHaveLength(1);
    expect(card).toContain("题材元素：末世");
  });
});
