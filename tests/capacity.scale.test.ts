import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { now, WorkspaceDatabase } from "../electron/database";

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
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 300000);
