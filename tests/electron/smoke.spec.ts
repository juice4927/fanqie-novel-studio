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
      await api.saveContract(project.id, {
        ...detailBefore.contract,
        premise: "维修员发现事故回声", protagonistDesire: "保护家人", readerPromise: "规则解谜", coreEmotion: "守护", ending: "关闭回声源头",
        openingMechanism: "一次检修事故让维修员听见尚未发生的回声",
        growthCarrier: "维修经验、事故证据与可信协作者共同积累",
        primaryPayoff: "提前阻止事故并揭开责任链条",
        longFormEngine: "个人事故、企业掩盖与回声源头形成三轮升级",
        protagonistArc: "维修员从只想保护家人、逃避旧事故，到愿意公开证据承担职业代价，并最终建立透明的事故追责规则",
        keyRelationships: ["维修员与安全主管从互相防备到共同核验证据", "维修员与企业负责人围绕事故责任和家人安全持续对抗"],
        worldRules: ["事故回声只能提示尚未发生的危险片段，不能直接给出原因", "每次追查都必须由维修记录和现场证据交叉验证"],
        majorForces: ["维修协作组掌握现场经验和设备记录", "企业管理层掌握事故档案和人员调度权"],
        timelineAnchors: ["开局前维修员曾因旧事故失去同事", "开局检修时首次听见未来事故回声", "中期证据指向企业长期掩盖", "终局公开回声源头与责任链"],
      });
      await api.approveContract(project.id);
      for (let number = 1; number <= 5; number += 1) {
        await api.saveChapter(project.id, { id: "", number, title: `批次第${number}章`, outline: `目标：完成第${number}步；冲突：资源有限；结果：线索推进`, content: "", wordCount: 0, status: "章纲", batchMode: "五章批次", isKeyChapter: false, revision: 0, updatedAt: new Date().toISOString() });
      }
      const plan = await api.savePlan(project.id, { id: "", kind: "细纲", title: "旧章纲", ordinal: 1, goal: "直接获得线索", conflict: "没有阻碍", outcome: "找到答案", targetWords: 2300, status: "草稿", parentId: null });
      const first = (await api.getProject(project.id)).chapters[0];
      const loadedFirst = await api.getChapter(project.id, first.id);
      const repaired = await api.applyPlanningRepairs(project.id, {
        plans: [{ targetId: plan.id, after: { title: "核对事故记录", goal: "交叉验证事故线索", conflict: "记录残缺且时间有限", outcome: "确认下一处调查地点", targetWords: 2200 } }],
        chapters: [{ targetId: first.id, after: { title: "残缺记录", outline: "先取得记录，再核对时间矛盾", chapterFunction: "调查", targetWords: 2200, chapterPromise: "验证事故线索", expectedPayoff: "确认一处矛盾", crisis: "记录即将被销毁", endingExpectation: "矛盾指向维修主管", expectationTargetChapter: 3 } }],
      });
      await api.approvePlan(project.id, plan.id);
      let protectedRepairBlocked = false;
      try { await api.applyPlanningRepairs(project.id, { plans: [{ targetId: plan.id, after: { title: "越权改写", goal: "越权改写目标", conflict: "越权改写冲突", outcome: "越权改写结果", targetWords: 2200 } }], chapters: [] }); }
      catch { protectedRepairBlocked = true; }
      const batch = await api.previewChapterBatch(project.id, first.id);
      const autoBackup = await api.getAutoBackupSettings();
      const health = await api.runSystemHealthCheck();
      const detail = await api.getProject(project.id);
      return { workspace: await api.getWorkspacePath(), projectId: project.id, title: detail.summary.title, firstOverviewContent: first.content, loadedFirstId: loadedFirst.id, batch, autoBackup, health, repaired, protectedRepairBlocked };
    });
    expect(result.workspace).toBe(workspace);
    expect(result.title).toBe("桌面烟雾测试");
    expect(result.firstOverviewContent).toBe("");
    expect(result.loadedFirstId).toBeTruthy();
    expect(result.batch.canRun).toBe(true);
    expect(result.batch.chapters).toHaveLength(5);
    expect(result.repaired).toMatchObject({ appliedPlanIds: [expect.any(String)], appliedChapterIds: [expect.any(String)] });
    expect(result.protectedRepairBlocked).toBe(true);
    expect(result.autoBackup).toMatchObject({ enabled: false, retentionCount: 7, hasPassword: false });
    expect(result.health).toMatchObject({ status: "正常", projectCount: 1, chapterCount: 5 });
    expect(existsSync(path.join(workspace, "catalog.sqlite"))).toBe(true);
    expect(existsSync(path.join(workspace, "projects", result.projectId, "project.sqlite"))).toBe(true);
    await page.evaluate(() => {
      window.location.href = "data:text/html,navigation-must-be-blocked";
    });
    await expect(page.getByRole("heading", { name: "多书总览" })).toBeVisible();
    const geolocationPermission = await page.evaluate(async () =>
      (await navigator.permissions.query({ name: "geolocation" })).state,
    );
    expect(geolocationPermission).toBe("denied");
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
