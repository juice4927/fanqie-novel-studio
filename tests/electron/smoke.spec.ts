import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("starts the production Electron app and persists through the preload API", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "novel-electron-smoke-"));
  const application = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      NOVEL_STUDIO_WORKSPACE: workspace,
      NOVEL_STUDIO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "多书总览" })).toBeVisible();
    const result = await page.evaluate(async () => {
      const api = window.novelStudio!;
      const project = await api.createProject({ title: "桌面烟雾测试", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
      const detailBefore = await api.getProject(project.id);
      await api.saveContract(project.id, { ...detailBefore.contract, premise: "维修员发现事故回声", protagonistDesire: "保护家人", readerPromise: "规则解谜", coreEmotion: "守护", ending: "关闭回声源头" });
      await api.approveContract(project.id);
      for (let number = 1; number <= 5; number += 1) {
        await api.saveChapter(project.id, { id: "", number, title: `批次第${number}章`, outline: `目标：完成第${number}步；冲突：资源有限；结果：线索推进`, content: "", wordCount: 0, status: "章纲", batchMode: "五章批次", isKeyChapter: false, revision: 0, updatedAt: new Date().toISOString() });
      }
      const first = (await api.getProject(project.id)).chapters[0];
      const batch = await api.previewChapterBatch(project.id, first.id);
      const autoBackup = await api.getAutoBackupSettings();
      const health = await api.runSystemHealthCheck();
      const detail = await api.getProject(project.id);
      return { workspace: await api.getWorkspacePath(), projectId: project.id, title: detail.summary.title, batch, autoBackup, health };
    });
    expect(result.workspace).toBe(workspace);
    expect(result.title).toBe("桌面烟雾测试");
    expect(result.batch.canRun).toBe(true);
    expect(result.batch.chapters).toHaveLength(5);
    expect(result.autoBackup).toMatchObject({ enabled: false, retentionCount: 7, hasPassword: false });
    expect(result.health).toMatchObject({ status: "正常", projectCount: 1, chapterCount: 5 });
    expect(existsSync(path.join(workspace, "catalog.sqlite"))).toBe(true);
    expect(existsSync(path.join(workspace, "projects", result.projectId, "project.sqlite"))).toBe(true);
  } finally {
    await application.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("starts the packaged Windows application", async () => {
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "长篇创作工作台.exe");
  test.skip(process.platform !== "win32" || !existsSync(executablePath), "packaged Windows app is not available");
  const workspace = mkdtempSync(path.join(os.tmpdir(), "novel-packaged-smoke-"));
  const application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: "test",
      NOVEL_STUDIO_WORKSPACE: workspace,
      NOVEL_STUDIO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "多书总览" })).toBeVisible();
    expect(await page.evaluate(() => Boolean(window.novelStudio))).toBe(true);
  } finally {
    await application.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
