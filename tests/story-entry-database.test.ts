import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { now, WorkspaceDatabase } from "../electron/database";
import { compileProjectChapterContext } from "../src/shared/context-compiler";
import type { Chapter, StoryEntry } from "../src/shared/types";

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-story-entry-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

function entry(patch: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id: "",
    kind: "人物",
    name: "林舟",
    aliases: [],
    summary: "调查员",
    detail: "市局调查员",
    aiContext: "detected",
    effectiveFrom: 1,
    effectiveTo: null,
    revealChapter: null,
    knownBy: [],
    exclusionTerms: [],
    sourceContractItem: null,
    pinned: false,
    updatedAt: now(),
    ...patch,
  };
}

function chapter(number: number): Chapter {
  return {
    id: "",
    number,
    title: `第${number}章`,
    outline: "林舟调取门禁记录并确认内鬼",
    content: "",
    wordCount: 0,
    status: "章纲",
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 0,
    updatedAt: now(),
  };
}

afterEach(() => {
  databases.forEach((database) => {
    database.close();
  });
  databases.length = 0;
  roots.forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
  roots.length = 0;
});

describe("story entry persistence", () => {
  it("saves, lists and deletes entries inside a project", () => {
    const database = createDatabase();
    const project = database.createProject({
      title: "设定条目",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    const saved = database.saveStoryEntry(project.id, entry({ aliases: ["小林", " 小林 "] }));
    expect(saved.id).not.toBe("");
    expect(saved.aliases).toEqual(["小林"]);
    expect(database.getProject(project.id).storyEntries).toHaveLength(1);
    database.deleteStoryEntry(project.id, saved.id);
    expect(database.getProject(project.id).storyEntries).toHaveLength(0);
  });

  it("seeds from the contract idempotently and feeds the compiler", () => {
    const database = createDatabase();
    const project = database.createProject({
      title: "种子条目",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    const contract = database.getProject(project.id).contract;
    database.saveContract(project.id, {
      ...contract,
      keyRelationships: ["林舟：与顾闻互不信任"],
      worldRules: ["所有异常必须有可验证触发条件"],
    });

    const first = database.seedStoryEntries(project.id);
    expect(first.map((item) => item.id)).toEqual(["seed:keyRelationships:0", "seed:worldRules:0"]);
    const second = database.seedStoryEntries(project.id);
    expect(second).toHaveLength(first.length);

    const context = compileProjectChapterContext(database.getProject(project.id), chapter(2));
    expect(context.contract).toContain("关键关系：已转为设定条目");
    expect(context.storyEntries).toContain("林舟");
    expect(context.storyEntries).toContain("所有异常必须有可验证触发条件");
  });
});

describe("AI 味白名单持久化", () => {
  it("去重、去空白并写回项目详情", () => {
    const database = createDatabase();
    const project = database.createProject({
      title: "白名单",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    expect(database.getProject(project.id).aiFlavorWhitelist).toEqual([]);
    const saved = database.saveAiFlavorWhitelist(project.id, ["深吸一口气", " 深吸一口气 ", "  "]);
    expect(saved).toEqual(["深吸一口气"]);
    expect(database.getProject(project.id).aiFlavorWhitelist).toEqual(["深吸一口气"]);
  });
});
