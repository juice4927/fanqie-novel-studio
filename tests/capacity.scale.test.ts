import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { now, WorkspaceDatabase } from "../electron/database";
import { contextBudgetTokens, DEFAULT_CLOUD_CONTEXT_WINDOW } from "../src/shared/context-budget";
import { compileProjectChapterContext, DEFAULT_CONTEXT_BUDGET_TOKENS } from "../src/shared/context-compiler";

it("holds ten isolated three-million-character projects", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-scale-test-"));
  const database = new WorkspaceDatabase(root);
  const body = "长篇容量验证正文".repeat(250);
  let firstProjectId = "";
  let firstChapterId = "";
  try {
    for (let book = 1; book <= 10; book += 1) {
      const project = database.createProject({
        title: `容量作品${book}`,
        genre: book % 2 ? "都市脑洞" : "现言甜宠",
        targetWords: 3000000,
        updateCadence: "每日2章",
      });
      if (book === 1) firstProjectId = project.id;
      for (let chapter = 1; chapter <= 1500; chapter += 1) {
        const saved = database.saveChapter(project.id, {
          id: "",
          number: chapter,
          title: `第${chapter}章`,
          outline: `目标：推进作品${book}第${chapter}章`,
          content: body,
          wordCount: 0,
          status: "草稿",
          batchMode: "五章批次",
          isKeyChapter: false,
          revision: 0,
          updatedAt: now(),
        });
        if (book === 1 && chapter === 1) firstChapterId = saved.id;
        if (chapter % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(database.getProjectSummary(project.id).currentWords).toBe(3000000);
    }
    const startedAt = performance.now();
    expect(database.listProjects()).toHaveLength(10);
    expect(performance.now() - startedAt).toBeLessThan(2000);
    const overviewStartedAt = performance.now();
    const overview = database.getProjectOverview(firstProjectId);
    expect(overview.chapters).toHaveLength(1500);
    expect(overview.chapters.every((chapter) => chapter.content === "")).toBe(true);
    expect(performance.now() - overviewStartedAt).toBeLessThan(2000);
    expect(database.getChapter(firstProjectId, firstChapterId).content).toBe(body);
    // 上下文编译在长篇中必须受模型窗口预算约束，不能把整本书塞进每次请求。
    const project = database.getProject(firstProjectId);
    // 128k 档：预算收紧，各段按比例收缩。
    const tightBudget = contextBudgetTokens(128_000);
    for (const number of [1, 600, 1200]) {
      const chapter = project.chapters.find((item) => item.number === number)!;
      const context = compileProjectChapterContext(project, chapter, undefined, {
        budgetTokens: tightBudget,
        windowTokens: 128_000,
      });
      expect(context.estimatedTokens).toBeLessThanOrEqual(tightBudget);
      expect(context.recentSummary.length).toBeLessThan(60_000);
      expect(context.rollingOutline.length).toBeLessThan(60_000);
    }
    // 设定条目：章纲提到的条目必须注入，常驻条目无条件注入，整体仍在预算内。
    database.saveContract(firstProjectId, {
      ...project.contract,
      worldRules: ["所有异常必须有可验证触发条件"],
    });
    database.saveStoryEntry(firstProjectId, {
      id: "",
      kind: "设定",
      name: "作品1",
      aliases: [],
      summary: "容量测试作品",
      detail: "容量测试作品的主线设定",
      aiContext: "detected",
      effectiveFrom: 1,
      effectiveTo: null,
      revealChapter: null,
      knownBy: [],
      exclusionTerms: [],
      sourceContractItem: null,
      pinned: false,
      updatedAt: now(),
    });
    database.seedStoryEntries(firstProjectId);
    const withEntries = database.getProject(firstProjectId);
    // 1M 默认档：装填量由各段硬上限约束，1500 章不会全部塞进上下文。
    const entriesContext = compileProjectChapterContext(
      withEntries,
      withEntries.chapters.find((item) => item.number === 600)!,
      undefined,
      { budgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS, windowTokens: DEFAULT_CLOUD_CONTEXT_WINDOW },
    );
    expect(entriesContext.storyEntries).toContain("作品1");
    expect(entriesContext.storyEntries).toContain("所有异常必须有可验证触发条件");
    expect(entriesContext.estimatedTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET_TOKENS);
    expect(entriesContext.estimatedTokens).toBeLessThan(120_000);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 300000);
