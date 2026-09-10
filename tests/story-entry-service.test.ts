import { describe, expect, it } from "vitest";
import { type ContextCompilerInput, compileChapterContext } from "../src/shared/context-compiler";
import { detectMentions, normalizeMentionText } from "../src/shared/mention-detection";
import {
  isStoryEntryEffective,
  prepareStoryEntrySave,
  renderStoryEntryLine,
  seedStoryEntriesFromContract,
  selectStoryEntriesForChapter,
  storyEntryProperNouns,
} from "../src/shared/story-entry-service";
import type { Chapter, StoryContract, StoryEntry } from "../src/shared/types";

const timestamp = "2026-09-09T00:00:00.000Z";

function entry(patch: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id: "entry-1",
    kind: "人物",
    name: "林舟",
    aliases: [],
    summary: "调查员",
    detail: "市局调查员，负责调取门禁记录",
    aiContext: "detected",
    effectiveFrom: 1,
    effectiveTo: null,
    revealChapter: null,
    knownBy: [],
    exclusionTerms: [],
    sourceContractItem: null,
    pinned: false,
    updatedAt: timestamp,
    ...patch,
  };
}

function chapter(number: number, patch: Partial<Chapter> = {}): Chapter {
  return {
    id: `chapter-${number}`,
    number,
    title: `第${number}章`,
    outline: "林舟调取门禁记录并确认内鬼",
    content: "上一章结尾：顾闻把录音带塞进内袋。",
    wordCount: 1000,
    status: "草稿",
    batchMode: "逐章",
    isKeyChapter: false,
    chapterFunction: "行动",
    chapterPromise: "拿到门禁记录",
    expectedPayoff: "锁定可疑人员",
    crisis: "记录可能被清除",
    endingExpectation: "线索指向内鬼",
    linkedExpectationIds: [],
    revision: 1,
    updatedAt: timestamp,
    ...patch,
  };
}

function contract(patch: Partial<StoryContract> = {}): StoryContract {
  return {
    premise: "调查城市事故",
    protagonistDesire: "还原真相",
    readerPromise: "持续获得可靠线索",
    coreEmotion: "信任",
    ending: "公开真相",
    immutableRules: ["证据必须交叉验证"],
    prohibitedPatterns: [],
    keyRelationships: ["林舟与顾闻互不信任"],
    worldRules: ["所有异常必须有可验证触发条件"],
    version: 1,
    approved: true,
    updatedAt: timestamp,
    ...patch,
  };
}

function input(patch: Partial<ContextCompilerInput> = {}): ContextCompilerInput {
  return {
    summary: { genre: "都市脑洞", currentWords: 20_000, targetWords: 1_000_000 },
    contract: contract(),
    chapter: chapter(10),
    plans: [],
    relevantFacts: [],
    constraintFacts: [],
    summaries: [],
    expectations: [],
    recentChapters: [chapter(9)],
    styleSamples: [],
    storyEntries: [],
    ...patch,
  };
}

describe("mention detection", () => {
  it("matches the name and aliases by substring", () => {
    const hits = detectMentions([entry({ aliases: ["小林", "林队"] })], [{ source: "章纲", text: "林队带队出发" }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedTerm).toBe("林队");
    expect(hits[0].matchedIn).toBe("章纲");
  });

  it("normalizes whitespace, full width and case", () => {
    expect(normalizeMentionText("Ａlice  Smith")).toBe("alicesmith");
    const hits = detectMentions([entry({ name: "alice" })], [{ source: "章纲", text: "ＡLICE 到场" }]);
    expect(hits).toHaveLength(1);
  });

  it("ignores single-character names", () => {
    expect(detectMentions([entry({ name: "舟" })], [{ source: "章纲", text: "舟到了" }])).toHaveLength(0);
  });

  it("drops hits covered by an exclusion term", () => {
    const entries = [entry({ name: "林舟", exclusionTerms: ["林舟的"] })];
    expect(detectMentions(entries, [{ source: "章纲", text: "林舟的搭档先到" }])).toHaveLength(0);
    expect(detectMentions(entries, [{ source: "章纲", text: "林舟到场" }])).toHaveLength(1);
  });

  it("records the first segment and aggregates the hit count", () => {
    const hits = detectMentions(
      [entry()],
      [
        { source: "章纲", text: "林舟先走" },
        { source: "上章末尾", text: "林舟又回来了" },
      ],
    );
    expect(hits[0].matchedIn).toBe("章纲");
    expect(hits[0].count).toBe(2);
  });
});

describe("story entry rules", () => {
  it("trims, dedupes and validates ranges", () => {
    const saved = prepareStoryEntrySave(
      undefined,
      entry({
        name: " 林舟 ",
        aliases: ["小林", " 小林 ", "林舟"],
        effectiveFrom: 5,
        effectiveTo: 2,
        exclusionTerms: [" 门 ", "门"],
        pinned: undefined as unknown as boolean,
      }),
      { id: "entry-x", updatedAt: timestamp },
    );
    expect(saved.name).toBe("林舟");
    expect(saved.aliases).toEqual(["小林"]);
    expect(saved.exclusionTerms).toEqual(["门"]);
    expect(saved.effectiveTo).toBe(5);
    expect(saved.pinned).toBe(false);
  });

  it("keeps the seed source across edits", () => {
    const previous = entry({ sourceContractItem: "keyRelationships" });
    const saved = prepareStoryEntrySave(
      previous,
      { ...previous, sourceContractItem: null },
      {
        id: previous.id,
        updatedAt: timestamp,
      },
    );
    expect(saved.sourceContractItem).toBe("keyRelationships");
  });

  it("checks the effective chapter range", () => {
    expect(isStoryEntryEffective(entry({ effectiveFrom: 5 }), 4)).toBe(false);
    expect(isStoryEntryEffective(entry({ effectiveFrom: 5 }), 5)).toBe(true);
    expect(isStoryEntryEffective(entry({ effectiveTo: 9 }), 10)).toBe(false);
  });

  it("seeds deterministic entries and keeps world rules always-on", () => {
    const seeds = seedStoryEntriesFromContract(contract(), timestamp);
    expect(seeds.map((item) => item.id)).toEqual(["seed:keyRelationships:0", "seed:worldRules:0"]);
    expect(seeds[0].aiContext).toBe("detected");
    expect(seeds[1].aiContext).toBe("always");
    expect(seeds[0].sourceContractItem).toBe("keyRelationships");
    expect(storyEntryProperNouns(seeds)).toContain(seeds[0].name);
  });
});

describe("story entry selection", () => {
  const segments = [{ source: "章纲" as const, text: "林舟调取门禁记录" }];

  it("injects always and pinned entries without a hit", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [
        entry({ id: "always", name: "顾闻", aiContext: "always" }),
        entry({ id: "pinned", name: "周成", pinned: true }),
      ],
      chapterNumber: 10,
      segments,
      limit: 10,
    });
    expect(selection.selected.map((item) => item.entry.id).sort()).toEqual(["always", "pinned"]);
  });

  it("injects detected entries only on a hit", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [entry({ id: "hit", name: "林舟" }), entry({ id: "miss", name: "顾闻" })],
      chapterNumber: 10,
      segments,
      limit: 10,
    });
    expect(selection.selected.map((item) => item.entry.id)).toEqual(["hit"]);
  });

  it("treats detected_excluded as the inverse of detected", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [
        entry({ id: "hit", name: "林舟", aiContext: "detected_excluded" }),
        entry({ id: "miss", name: "顾闻", aiContext: "detected_excluded" }),
      ],
      chapterNumber: 10,
      segments,
      limit: 10,
    });
    expect(selection.selected.map((item) => item.entry.id)).toEqual(["miss"]);
  });

  it("skips never entries and out-of-range entries", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [
        entry({ id: "never", name: "林舟", aiContext: "never" }),
        entry({ id: "future", name: "林舟", effectiveFrom: 20 }),
      ],
      chapterNumber: 10,
      segments,
      limit: 10,
    });
    expect(selection.selected).toHaveLength(0);
  });

  it("hides the detail before the reveal chapter", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [entry({ revealChapter: 50, summary: "只有摘要", detail: "详述内容" })],
      chapterNumber: 10,
      segments,
      limit: 10,
    });
    const line = renderStoryEntryLine(selection.selected[0]);
    expect(line).toContain("只有摘要");
    expect(line).not.toContain("详述内容");
    expect(line).toContain("未到揭示章");
  });

  it("respects the injection budget", () => {
    const selection = selectStoryEntriesForChapter({
      entries: [entry({ id: "a", name: "林舟" }), entry({ id: "b", name: "林舟" })],
      chapterNumber: 10,
      segments,
      limit: 1,
    });
    expect(selection.selected).toHaveLength(1);
    expect(selection.omitted).toBe(1);
    expect(selection.total).toBe(2);
  });

  it("stops at the character budget while keeping the highest-priority entry", () => {
    const longDetail = "设定详情".repeat(200);
    const selection = selectStoryEntriesForChapter({
      entries: [
        entry({ id: "pinned", name: "顾闻", pinned: true, detail: longDetail }),
        entry({ id: "hit", name: "林舟", detail: longDetail }),
        entry({ id: "hit2", name: "林舟", detail: longDetail }),
      ],
      chapterNumber: 10,
      segments,
      limit: 10,
      maxCharacters: 700,
    });
    expect(selection.selected.map((item) => item.entry.id)).toEqual(["pinned"]);
    expect(selection.omitted).toBe(2);
  });

  it("caps a single entry detail so one long entry cannot eat the budget", () => {
    const line = renderStoryEntryLine({ entry: entry({ detail: "长".repeat(1000) }), revealHidden: false });
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(800);
  });
});

describe("context compiler integration", () => {
  it("replaces managed contract lists and injects only mentioned entries", () => {
    const context = compileChapterContext(
      input({
        storyEntries: [
          entry({ id: "lin", name: "林舟", sourceContractItem: "keyRelationships" }),
          entry({ id: "gu", name: "顾闻", kind: "人物" }),
          entry({ id: "zhou", name: "周成", kind: "人物" }),
        ],
      }),
    );
    expect(context.contract).toContain("关键关系：已转为设定条目");
    expect(context.contract).not.toContain("林舟与顾闻互不信任");
    expect(context.storyEntries).toContain("林舟");
    // 上一章末尾提到顾闻，因此它属于命中条目；周成两处都没出现，不应注入。
    expect(context.storyEntries).toContain("顾闻");
    expect(context.storyEntries).not.toContain("周成");
    const diagnostic = context.diagnostics?.sections.find((section) => section.key === "storyEntries");
    expect(diagnostic?.includedItems).toBe(2);
    expect(diagnostic?.totalItems).toBe(3);
  });

  it("keeps the legacy contract lists when no entries are seeded", () => {
    const context = compileChapterContext(input());
    expect(context.contract).toContain("林舟与顾闻互不信任");
    expect(context.storyEntries).toContain("尚未建立设定条目");
  });

  it("scans the current draft when regenerating, but not when the chapter is empty", () => {
    const entries = [entry({ id: "zhou", name: "周成" })];
    const regenerating = compileChapterContext(
      input({ chapter: chapter(10, { content: "周成站在门口。" }), storyEntries: entries }),
    );
    expect(regenerating.storyEntries).toContain("周成");
    const fresh = compileChapterContext(input({ chapter: chapter(10, { content: "" }), storyEntries: entries }));
    expect(fresh.storyEntries).not.toContain("周成");
  });
});
