import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDatabase, now } from "../electron/database";
import { createChapterGenerationGuard } from "../electron/ai-retry";
import type { EmbeddingProvider } from "../electron/semantic";
import type { Chapter, LedgerFact, QualityIssue } from "../src/shared/types";

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-test-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

function createChapter(number: number, content = "这是一段用于验证章节版本和项目隔离的正文内容。".repeat(40)): Chapter {
  return { id: "", number, title: `第${number}章`, outline: "目标：验证状态；冲突：测试门禁；结果：保留证据。", content,
    wordCount: 0, status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 0, updatedAt: now() };
}

const completeNarrativeEngine = {
  openingMechanism: "一次异常事件迫使主角主动调查",
  growthCarrier: "专业能力、关系网络与认知共同积累",
  primaryPayoff: "解决现实问题并改变人物处境",
  longFormEngine: "个人困境、组织阻力和规则真相形成三轮升级",
  protagonistArc: "主角从逃避责任到主动承担调查代价，并在终局建立新的行动准则",
  keyRelationships: ["主角与搭档从互不信任到共同承担后果", "主角与对手围绕规则解释权持续冲突"],
  worldRules: ["所有异常结果都必须有可验证的触发条件", "能力使用会消耗现实资源并产生关系代价"],
  majorForces: ["主角调查团队掌握专业能力与基层线索", "既得利益组织掌握资源渠道与规则解释权"],
  timelineAnchors: ["开局前主角因旧事故逃避责任", "开局异常迫使主角重新调查", "中期证据揭示组织性掩盖", "终局主角公开真相并建立新规则"],
};

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("per-book isolation and gates", () => {
  it("migrates an unversioned catalog without losing existing projects", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-legacy-"));
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const legacy = new DatabaseSync(path.join(root, "catalog.sqlite"));
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL, status TEXT NOT NULL,
        target_words INTEGER NOT NULL, update_cadence TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO projects VALUES (
        'legacy-project', '旧版作品', '都市脑洞', '候选立项', 1000000, '每日1章',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const database = new WorkspaceDatabase(root);
    databases.push(database);
    expect(database.listProjects()[0]).toMatchObject({ id: "legacy-project", title: "旧版作品", safeStockLine: 10 });
    const inspection = new DatabaseSync(path.join(root, "catalog.sqlite"));
    expect((inspection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(6);
    expect((inspection.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).some((column) => column.name === "safe_stock_line")).toBe(true);
    inspection.close();
  });

  it("stores bounded automatic backup scheduling metadata without a password", () => {
    const database = createDatabase();
    const nextRunAt = "2026-07-31T08:00:00.000Z";
    const saved = database.saveAutoBackupSettings({ enabled: true, frequency: "weekly", retentionCount: 12 }, nextRunAt);
    expect(saved).toMatchObject({ enabled: true, frequency: "weekly", retentionCount: 12, nextRunAt, hasPassword: false });
    expect(() => database.saveAutoBackupSettings({ enabled: true, frequency: "daily", retentionCount: 31 }, nextRunAt)).toThrow("1–30");
    expect(JSON.stringify(saved)).not.toContain("password");
  });

  it("persists the configurable long AI task timeout", () => {
    const database = createDatabase();
    expect(database.getAiSettings().longTaskTimeoutMinutes).toBe(10);
    const { hasApiKey: _hasApiKey, ...current } = database.getAiSettings();
    expect(database.saveAiSettings({ ...current, longTaskTimeoutMinutes: 15 }).longTaskTimeoutMinutes).toBe(15);
  });

  it("records AI usage and marks abandoned running jobs as interrupted", () => {
    const database = createDatabase();
    const id = database.startAiJob(null, "draft-chapter", "hash", "prompt", "provider", "model", "第1章");
    database.finishAiJob(id, "{}", undefined, {
      inputTokens: 120, outputTokens: 80, actualCost: 0.012, durationMs: 345,
      headersAt: "2026-07-30T10:00:01.000Z", firstTokenAt: "2026-07-30T10:00:02.000Z",
      completedAt: "2026-07-30T10:00:03.000Z", chunkCount: 42, attemptCount: 2,
    });
    expect(database.listAiJobs()[0]).toMatchObject({
      id, status: "成功", inputTokens: 120, outputTokens: 80, actualCost: 0.012, durationMs: 345,
      headersAt: "2026-07-30T10:00:01.000Z", firstTokenAt: "2026-07-30T10:00:02.000Z",
      completedAt: "2026-07-30T10:00:03.000Z", chunkCount: 42, attemptCount: 2,
    });
    const abandoned = database.startAiJob(null, "draft-chapter", "hash-2", "prompt", "provider", "model", "第2章");
    const root = database.root;
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const reopened = new WorkspaceDatabase(root);
    databases.push(reopened);
    expect(reopened.listAiJobs().find((job) => job.id === abandoned)).toMatchObject({ status: "已中断", error: expect.stringContaining("重新执行") });
  });

  it("preserves every AI attempt while caching the latest success", () => {
    const database = createDatabase();
    const first = database.startAiJob(null, "draft-chapter", "same-hash", "prompt", "provider", "model", "第一次", "{\"kind\":\"chapter\"}");
    database.finishAiJob(first, "", "第一次失败");
    const second = database.startAiJob(null, "draft-chapter", "same-hash", "prompt", "provider", "model", "第二次", "{\"kind\":\"chapter\"}");
    database.finishAiJob(second, "{\"content\":\"成功\"}");
    expect(database.listAiJobs().filter((job) => [first, second].includes(job.id))).toHaveLength(2);
    expect(database.listAiJobs().find((job) => job.id === first)).toMatchObject({ status: "失败", retryable: true });
    expect(database.findAiJob("draft-chapter", "same-hash", "prompt", "provider", "model")).toBe("{\"content\":\"成功\"}");
    expect(database.findAiJob("draft-chapter", "same-hash", "prompt", "other-provider", "model")).toBeNull();
  });

  it("gets an AI job by id even when it falls outside the bounded history list", () => {
    const database = createDatabase();
    const target = database.startAiJob("project", "draft-chapter", "target-hash", "prompt", "provider", "model", "目标任务", "{\"kind\":\"chapter\"}");
    database.finishAiJob(target, "", "目标失败");
    const inspection = new DatabaseSync(path.join(database.root, "catalog.sqlite"));
    inspection.prepare("UPDATE ai_jobs SET created_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", target);
    inspection.close();
    for (let index = 0; index < 201; index += 1) {
      const id = database.startAiJob("project", "quality-review", `hash-${index}`, "prompt", "provider", "model", `任务${index}`);
      database.finishAiJob(id, "{}");
    }

    expect(database.listAiJobs().some((job) => job.id === target)).toBe(false);
    expect(database.getAiJob(target)).toMatchObject({
      id: target, projectId: "project", status: "失败", error: "目标失败", retryable: true,
    });
    expect(database.getAiJob("missing-job")).toBeUndefined();
  });

  it("does not let an AI result overwrite an autosaved chapter change", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "生成并发保护", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const original = database.saveChapter(project.id, createChapter(1));
    const guard = createChapterGenerationGuard(original);
    const autosaved = database.saveChapter(project.id, {
      ...original,
      outline: "用户在 AI 生成期间修改并自动保存的新章纲。",
      content: "用户保留的新正文。".repeat(80),
    }, "autosave");

    expect(autosaved.revision).toBe(original.revision);
    expect(() => database.saveGeneratedChapter(project.id, {
      ...original,
      title: "AI 旧结果",
      content: "基于旧章纲生成的正文。".repeat(100),
    }, guard)).toThrow("生成期间已被修改");
    expect(database.getChapter(project.id, original.id)).toMatchObject({
      outline: autosaved.outline,
      content: autosaved.content,
      revision: original.revision,
    });
  });

  it("detects and rebuilds incomplete chapter search indexes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-health-"));
    roots.push(root);
    let database = new WorkspaceDatabase(root);
    const project = database.createProject({ title: "索引健康", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    database.saveChapter(project.id, createChapter(1, "可被搜索的健康检查正文"));
    database.close();

    const raw = new DatabaseSync(path.join(root, "projects", project.id, "project.sqlite"));
    raw.exec("DELETE FROM chapter_fts_tri");
    raw.close();

    database = new WorkspaceDatabase(root);
    databases.push(database);
    const broken = database.runSystemHealthCheck();
    expect(broken.status).toBe("警告");
    expect(broken.checks).toContainEqual(expect.objectContaining({ id: `project-search-${project.id}`, status: "警告", repairable: true }));
    const repaired = database.rebuildSearchIndexes(project.id);
    expect(repaired.checks).toContainEqual(expect.objectContaining({ id: `project-search-${project.id}`, status: "正常", repairable: false }));
    expect(database.searchProject(project.id, "健康检查")).toHaveLength(1);
  });

  it("reports orphan project directories without deleting them", () => {
    const database = createDatabase();
    const orphan = path.join(database.projectsRoot, "orphan-project");
    mkdirSync(orphan, { recursive: true });
    const report = database.runSystemHealthCheck();
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "orphan-orphan-project", status: "警告", repairable: false }));
    expect(existsSync(orphan)).toBe(true);
  });

  it("creates a zero-start project with an unapproved contract draft", () => {
    const database = createDatabase();
    const created = database.createProjectFromConcept(
      { title: "她在八零开新局", genre: "年代重生", targetWords: 1000000, updateCadence: "每日 2 章" },
      {
        premise: "女主从一场被安排的婚事中止损，用技术与经营重建自己的人生。",
        genreSubtype: "年代经营", fanqieCategoryKey: "",
        protagonistDesire: "拿回人生选择权，并建立属于自己的事业。",
        readerPromise: "持续兑现止损反击、事业升级和双向关系成长。",
        coreEmotion: "清醒反击与共同成长",
        ending: "女主建立独立事业，也完成一段平等而坚定的亲密关系。",
        immutableRules: ["主角靠主动行动解决问题", "事业升级必须付出真实成本"],
        prohibitedPatterns: ["反派无理由降智", "连续误会拖延关系"],
      },
    );
    const project = database.getProject(created.id);
    expect(project.summary.title).toBe("她在八零开新局");
    expect(project.contract.premise).toContain("技术与经营");
    expect(project.contract.genreSubtype).toBe("年代经营");
    expect(project.contract.approved).toBe(false);
  });

  it("persists composable genre settings for a manually created project", () => {
    const database = createDatabase();
    const created = database.createProject({
      title: "白夜急诊室",
      genre: "都市脑洞",
      targetWords: 1000000,
      updateCadence: "每日 2 章",
      secondaryGenres: ["悬疑", "群像"],
      genreElements: ["现代都市", "探案", "无CP"],
      customGenreDirection: "用真实职业困境推进案件，不使用系统。",
    });
    const contract = database.getProject(created.id).contract;
    expect(contract.secondaryGenres).toEqual(["悬疑", "群像"]);
    expect(contract.genreElements).toEqual(["现代都市", "探案", "无CP"]);
    expect(contract.customGenreDirection).toContain("不使用系统");
  });

  it("moves a title-confirmed project to the recoverable trash directory", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "待移除作品", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    database.saveChapter(project.id, createChapter(1));
    expect(() => database.deleteProject(project.id, "错误书名")).toThrow("书名");
    expect(database.listProjects().some((item) => item.id === project.id)).toBe(true);
    const result = database.deleteProject(project.id, project.title);
    expect(database.listProjects().some((item) => item.id === project.id)).toBe(false);
    expect(result).toContain("回收目录");
    const destination = path.join(database.trashRoot, readdirSync(database.trashRoot)[0]);
    expect(existsSync(destination)).toBe(true);
    expect(readdirSync(destination)).toContain("project.sqlite");
    expect(existsSync(path.join(database.projectsRoot, project.id))).toBe(false);
  });

  it("persists chapter intent and synchronizes the cross-chapter expectation ledger", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "期待账本", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const chapter = database.saveChapter(project.id, {
      ...createChapter(1), chapterPromise: "验证能力首次反馈", expectedPayoff: "救人成功但付出记忆代价",
      crisis: "七分钟内必须找到伤者", endingExpectation: "谁在制造事故", expectationTargetChapter: 6,
    });
    const detail = database.getProject(project.id);
    expect(chapter.endingExpectationId).toBeTruthy();
    expect(detail.expectations).toHaveLength(1);
    expect(detail.expectations[0]).toMatchObject({ sourceChapter: 1, expectedPayoffChapter: 6, status: "待兑现" });
    const fulfilled = database.saveExpectation(project.id, { ...detail.expectations[0], status: "已兑现", actualPayoffChapter: 5, payoffResult: "锁定第一名交易者" });
    expect(fulfilled.payoffResult).toContain("交易者");
  });

  it("keeps autosaves out of revision history until a version is established", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "自动保存版本", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const initial = database.saveChapter(project.id, createChapter(1, "第一稿正文"));
    const firstAutosave = database.saveChapter(project.id, { ...initial, content: "自动保存正文一" }, "autosave");
    const secondAutosave = database.saveChapter(project.id, { ...firstAutosave, content: "自动保存正文二" }, "autosave");

    expect(secondAutosave.revision).toBe(initial.revision);
    expect(database.getProject(project.id).chapters[0].content).toBe("自动保存正文二");
    expect(database.listRevisions(project.id, "chapters", initial.id)).toHaveLength(0);

    const versioned = database.saveChapter(project.id, secondAutosave);
    const revisions = database.listRevisions(project.id, "chapters", initial.id);
    expect(versioned.revision).toBe(initial.revision + 1);
    expect(revisions).toHaveLength(1);
    expect((revisions[0].payload as Chapter).content).toBe("自动保存正文二");
  });

  it("loads project chapter metadata separately from chapter bodies", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "正文懒加载", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const body = "只应通过单章接口读取的正文".repeat(1000);
    const saved = database.saveChapter(project.id, createChapter(1, body));

    const overview = database.getProjectOverview(project.id);
    expect(overview.chapters[0]).toMatchObject({ id: saved.id, content: "", wordCount: body.length });
    expect(JSON.stringify(overview)).not.toContain("只应通过单章接口读取的正文");
    expect(database.getChapter(project.id, saved.id).content).toBe(body);
    expect(() => database.getChapter(project.id, "missing-chapter")).toThrow("章节不存在");

    const inspection = new DatabaseSync(path.join(database.projectPath(project.id), "project.sqlite"));
    const chapterColumns = inspection.prepare("PRAGMA table_info(chapters)").all() as Array<{ name: string }>;
    expect(chapterColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "number", "status", "word_count", "updated_at",
    ]));
    expect((inspection.prepare("SELECT COUNT(*) AS count FROM records WHERE collection = 'chapters'").get() as { count: number }).count).toBe(0);
    expect((inspection.prepare("SELECT content FROM chapter_contents WHERE chapter_id = ?").get(saved.id) as { content: string }).content).toBe(body);
    inspection.close();
  });

  it("migrates legacy chapter records into indexed metadata and separate content", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "旧章节迁移", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const root = database.root;
    const projectPath = database.projectPath(project.id);
    database.close();
    databases.splice(databases.indexOf(database), 1);

    const legacy = new DatabaseSync(path.join(projectPath, "project.sqlite"));
    legacy.exec("DROP TABLE chapter_contents; DROP TABLE chapters; PRAGMA user_version = 1;");
    const chapter = { ...createChapter(3, "迁移后仍需保留的正文"), id: crypto.randomUUID(), wordCount: 10 };
    legacy.prepare("INSERT INTO records(collection, id, payload, updated_at) VALUES('chapters', ?, ?, ?)")
      .run(chapter.id, JSON.stringify(chapter), chapter.updatedAt);
    legacy.close();

    const reopened = new WorkspaceDatabase(root);
    databases.push(reopened);
    expect(reopened.getProjectOverview(project.id).chapters[0]).toMatchObject({ id: chapter.id, number: 3, content: "" });
    expect(reopened.getChapter(project.id, chapter.id).content).toBe(chapter.content);
    const migrated = new DatabaseSync(path.join(projectPath, "project.sqlite"));
    expect((migrated.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
    expect((migrated.prepare("SELECT COUNT(*) AS count FROM records WHERE collection = 'chapters'").get() as { count: number }).count).toBe(0);
    expect((migrated.prepare("PRAGMA table_info(embeddings)").all() as Array<{ name: string }>).map((column) => column.name))
      .toEqual(expect.arrayContaining(["provider_id", "dimensions"]));
    migrated.close();
  });

  it("loads visible dashboard activity through an exclusive cutoff without chapter bodies", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "轻量总览", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    let chapter = database.saveChapter(project.id, createChapter(1, "不应进入仪表盘的正文".repeat(1000)));
    chapter = database.transitionChapter(project.id, chapter.id, "待质检");
    chapter = database.transitionChapter(project.id, chapter.id, "待定稿");
    chapter = database.transitionChapter(project.id, chapter.id, "已定稿");
    expect(() => database.saveSchedule(project.id, {
      id: "", projectId: project.id, projectTitle: project.title,
      chapterId: chapter.id, chapterNumber: chapter.number, chapterTitle: chapter.title,
      publishAt: "2026-07-31T20:00:00", status: "待发布",
    })).toThrow("带时区");
    database.saveSchedule(project.id, {
      id: "", projectId: project.id, projectTitle: project.title,
      chapterId: chapter.id, chapterNumber: chapter.number, chapterTitle: chapter.title,
      publishAt: "2026-07-31T08:00:00.000Z", status: "待发布",
    });
    database.saveSchedule(project.id, {
      id: "", projectId: project.id, projectTitle: project.title,
      chapterId: chapter.id, chapterNumber: chapter.number, chapterTitle: chapter.title,
      publishAt: "2026-08-01T00:00:00.000Z", status: "待发布",
    });
    database.saveIssues(project.id, chapter.id, Array.from({ length: 15 }, (_, index) => ({
      id: crypto.randomUUID(), projectId: project.id, chapterId: chapter.id,
      severity: "警告" as const, category: "测试", message: `告警${index}`,
      evidence: "摘要", status: "待处理" as const, createdAt: new Date(Date.now() + index).toISOString(),
    })));

    const secondVisible = database.createProject({ title: "第二本可见作品", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    database.saveIssues(secondVisible.id, "cross-project", [
      {
        id: crypto.randomUUID(), projectId: secondVisible.id, chapterId: null,
        severity: "警告", category: "测试", message: "跨项目最新告警",
        evidence: "摘要", status: "待处理", createdAt: "2099-01-01T00:00:00.000Z",
      },
    ]);

    const archived = database.createProject({ title: "归档总览", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    let archivedChapter = database.saveChapter(archived.id, createChapter(1));
    archivedChapter = database.transitionChapter(archived.id, archivedChapter.id, "待质检");
    archivedChapter = database.transitionChapter(archived.id, archivedChapter.id, "待定稿");
    archivedChapter = database.transitionChapter(archived.id, archivedChapter.id, "已定稿");
    database.saveSchedule(archived.id, {
      id: "", projectId: archived.id, projectTitle: archived.title,
      chapterId: archivedChapter.id, chapterNumber: archivedChapter.number, chapterTitle: archivedChapter.title,
      publishAt: "2026-07-31T09:00:00.000Z", status: "待发布",
    });
    database.saveIssues(archived.id, archivedChapter.id, [
      {
        id: crypto.randomUUID(), projectId: archived.id, chapterId: archivedChapter.id,
        severity: "警告", category: "测试", message: "归档告警",
        evidence: "摘要", status: "待处理", createdAt: now(),
      },
    ]);
    database.updateProject(archived.id, { status: "归档" });

    const activity = database.getDashboardActivity("2026-08-01T00:00:00.000Z");
    expect(activity.dueToday).toHaveLength(1);
    expect(activity.dueToday[0].publishAt).toBe("2026-07-31T08:00:00.000Z");
    expect(activity.activeAlerts).toHaveLength(12);
    expect(activity.activeAlerts[0].message).toBe("跨项目最新告警");
    expect(activity.pendingIssues).toBe(16);
    expect(JSON.stringify(activity)).not.toContain("归档告警");
    expect(JSON.stringify(activity)).not.toContain("不应进入仪表盘的正文");
    expect(() => database.getDashboardActivity("invalid"))
      .toThrow("仪表盘截止时间无效");
  });

  it("keeps same-name entities inside their own project databases", () => {
    const database = createDatabase();
    const one = database.createProject({ title: "项目一", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const two = database.createProject({ title: "项目二", genre: "现言甜宠", targetWords: 3000000, updateCadence: "每日1章" });
    database.saveChapter(one.id, createChapter(1, "林舟在旧城发现异常。".repeat(80)));
    database.saveChapter(two.id, createChapter(1, "林舟在婚礼现场收到来信。".repeat(80)));
    database.saveFact(one.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "维修员", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    database.saveFact(two.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "律师", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    expect(database.getProject(one.id).facts[0].value).toBe("维修员");
    expect(database.getProject(two.id).facts[0].value).toBe("律师");
    expect(database.getProject(one.id).chapters[0].content).not.toContain("婚礼现场");
  });

  it("blocks approval order and unresolved hard issues", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "门禁测试", genre: "玄幻/仙侠", targetWords: 3000000, updateCadence: "每日2章" });
    const plan = database.savePlan(project.id, { id: "", kind: "分卷", title: "第一卷", ordinal: 1, goal: "建立成长规则", conflict: "资源有限", outcome: "完成筑基", targetWords: 150000, status: "待审批", parentId: null });
    expect(() => database.approvePlan(project.id, plan.id)).toThrow("创作契约");
    const saved = database.saveChapter(project.id, createChapter(1));
    const issue: QualityIssue = { id: crypto.randomUUID(), projectId: project.id, chapterId: saved.id, severity: "硬性", category: "设定冲突", message: "境界冲突", evidence: "第一章", status: "待处理", createdAt: now() };
    database.saveIssues(project.id, saved.id, [issue]);
    database.transitionChapter(project.id, saved.id, "待质检");
    expect(() => database.resolveIssue(project.id, issue.id, "已忽略")).toThrow("不能忽略");
    expect(() => database.transitionChapter(project.id, saved.id, "待定稿")).toThrow("硬性问题");
    database.resolveIssue(project.id, issue.id, "已解决");
    database.transitionChapter(project.id, saved.id, "待定稿");
    expect(database.transitionChapter(project.id, saved.id, "已定稿").status).toBe("已定稿");
    expect(database.getProject(project.id).summaries.map((item) => item.layer)).toEqual(expect.arrayContaining(["场景", "章节", "十章阶段", "全书"]));
    expect(database.getProject(project.id).summaries.find((item) => item.layer === "章节")?.content).toContain("未解决事项：");
    expect(database.searchProject(project.id, "章节版本")[0].chapterNumber).toBe(1);
  });

  it("marks overlapping facts as conflicts and ranks relevant facts", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "事实测试", genre: "历史/架空", targetWords: 3000000, updateCadence: "每日1章" });
    const base: Omit<LedgerFact, "id" | "updatedAt"> = { kind: "地点", subject: "北仓", predicate: "控制方", value: "巡检司", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开" };
    database.saveFact(project.id, { ...base, id: "", updatedAt: now() });
    const conflict = database.saveFact(project.id, { ...base, id: "", value: "盐运司", evidenceChapter: 2, updatedAt: now() });
    database.saveFact(project.id, { id: "", kind: "人物", subject: "陆青", predicate: "武器", value: "长弓", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    expect(conflict.confidence).toBe("有冲突");
    expect(database.searchRelevantFacts(project.id, "北仓控制方", 3, 2).some((fact) => fact.subject === "北仓")).toBe(true);
  });

  it("rebuilds fact vectors when the embedding provider changes", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "嵌入切换", genre: "历史/架空", targetWords: 3000000, updateCadence: "每日1章" });
    database.saveFact(project.id, { id: "", kind: "地点", subject: "北仓", predicate: "控制方", value: "巡检司", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    database.saveFact(project.id, { id: "", kind: "人物", subject: "陆青", predicate: "武器", value: "长弓", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    const root = database.root;
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const batchSizes: number[] = [];
    const provider: EmbeddingProvider = {
      id: "test-keyword-v2",
      dimensions: 3,
      embed: (texts) => {
        batchSizes.push(texts.length);
        return texts.map((text) => text.includes("北仓") ? [1, 0, 0] : text.includes("长弓") ? [0, 1, 0] : [0, 0, 1]);
      },
    };
    const reopened = new WorkspaceDatabase(root, provider);
    databases.push(reopened);

    expect(reopened.searchRelevantFacts(project.id, "查找北仓", 3, 1)[0]?.subject).toBe("北仓");
    const inspection = new DatabaseSync(path.join(reopened.projectPath(project.id), "project.sqlite"));
    const rows = inspection.prepare("SELECT provider_id, dimensions FROM embeddings WHERE source_type = 'facts'").all() as Array<{ provider_id: string; dimensions: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.provider_id === provider.id && row.dimensions === provider.dimensions)).toBe(true);
    expect(batchSizes).toEqual([2, 1]);
    inspection.close();
  });

  it("atomically ends the previous state when a replacement candidate is confirmed", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "状态替换", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const previous = database.saveFact(project.id, { id: "", kind: "地点", subject: "林舟", predicate: "所在地", value: "北京", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    const candidate = database.saveFact(project.id, { id: "", kind: "地点", subject: "林舟", predicate: "所在地", value: "上海", validFromChapter: 8, validToChapter: null, evidenceChapter: 8, confidence: "待确认", knowledgeScope: "公开", replacesFactId: previous.id, updatedAt: now() });

    expect(candidate.confidence).toBe("待确认");
    expect(database.getProject(project.id).facts.find((fact) => fact.id === previous.id)?.validToChapter).toBeNull();
    const confirmed = database.saveFact(project.id, { ...candidate, confidence: "已确认" });
    const facts = database.getProject(project.id).facts;

    expect(confirmed.confidence).toBe("已确认");
    expect(facts.find((fact) => fact.id === previous.id)?.validToChapter).toBe(7);
    expect(facts.find((fact) => fact.id === confirmed.id)?.validFromChapter).toBe(8);
  });

  it("keeps ignored candidates out of conflicts without changing active state", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "忽略候选", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const current = database.saveFact(project.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "维修员", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });

    const ignored = database.saveFact(project.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "律师", validFromChapter: 4, validToChapter: null, evidenceChapter: 4, confidence: "已忽略", knowledgeScope: "公开", updatedAt: now() });
    const facts = database.getProject(project.id).facts;

    expect(ignored.confidence).toBe("已忽略");
    expect(facts.find((fact) => fact.id === current.id)?.validToChapter).toBeNull();
    expect(facts.some((fact) => fact.confidence === "有冲突")).toBe(false);
    expect(database.searchRelevantFacts(project.id, "律师", 4).some((fact) => fact.id === ignored.id)).toBe(false);
  });

  it("versions a secret when its knowledge scope expands", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "秘密传播", genre: "悬疑/脑洞", targetWords: 3000000, updateCadence: "每日1章" });
    const privateFact = database.saveFact(project.id, { id: "", kind: "秘密", subject: "仓库密钥", predicate: "真实位置", value: "藏在旧钟背面", validFromChapter: 2, validToChapter: null, evidenceChapter: 2, confidence: "已确认", knowledgeScope: "林舟", updatedAt: now() });

    const sharedFact = database.saveFact(project.id, { id: "", kind: "秘密", subject: "仓库密钥", predicate: "真实位置", value: "藏在旧钟背面", validFromChapter: 9, validToChapter: null, evidenceChapter: 9, confidence: "已确认", knowledgeScope: "林舟、苏晚", replacesFactId: privateFact.id, changeType: "知情范围变更", updatedAt: now() });
    const facts = database.getProject(project.id).facts;

    expect(sharedFact.confidence).toBe("已确认");
    expect(facts.find((fact) => fact.id === privateFact.id)?.validToChapter).toBe(8);
    expect(facts.find((fact) => fact.id === sharedFact.id)?.knowledgeScope).toBe("林舟、苏晚");
  });

  it("persists review experiments without applying story changes", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "实验测试", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const draft = {
      id: "", title: "减少重复回报", hypothesis: "关系回报替代重复震惊后追读率提高", changeSummary: "第10至15章调整回报类型",
      fromChapter: 10, toChapter: 15, baselineStart: "2026-07-01", baselineEnd: "2026-07-07",
      observationStart: "2026-07-08", observationEnd: "2026-07-14", primaryMetric: "追读率" as const,
      successCriteria: "提高2个百分点", confounders: "推荐量、发布时间", status: "观察中" as const,
      conclusion: "", decision: null, createdAt: now(), updatedAt: now(),
    };
    const saved = database.saveReviewExperiment(project.id, draft);
    expect(database.getProject(project.id).experiments[0]).toMatchObject({ id: saved.id, status: "观察中", fromChapter: 10, toChapter: 15 });
    expect(database.getProject(project.id).changes).toEqual([]);
    expect(() => database.saveReviewExperiment(project.id, { ...saved, baselineStart: "2026-07-08", baselineEnd: "2026-07-01" })).toThrow("观察日期范围无效");
    expect(() => database.saveReviewExperiment(project.id, { ...saved, status: "已结论", conclusion: "", decision: null })).toThrow("结论和处理决定");
  });
});

describe("research firewall", () => {
  it("detects continuous-expression reuse without copying source into projects", () => {
    const database = createDatabase();
    const unique = "暮色沿着废弃钟楼的铜制排水管缓慢下降直到第七码头灯光熄灭";
    database.saveResearchBook({ id: "sample", title: "隔离样本", author: "作者", genre: "都市脑洞", sourceType: "TXT", chapterCount: 1, wordCount: unique.length, rightsConfirmed: true, cloudConsent: false, importedAt: now(), status: "待拆解" }, [{ title: "第一章", content: unique.repeat(2), wordCount: unique.length * 2 }]);
    const matches = database.findOriginalityMatches(`新正文开头。${unique}，后续内容。`);
    expect(matches[0].researchRef).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(matches)).not.toContain("隔离样本");
    expect(JSON.stringify(matches)).not.toContain(unique);
    const project = database.createProject({ title: "原创项目", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    expect(JSON.stringify(database.getProject(project.id))).not.toContain(unique);
  });
});

describe("approval gates", () => {
  it("moves chapter state and publication schedule in one database operation", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "排期事务", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    let chapter = database.saveChapter(project.id, createChapter(1));
    chapter = database.transitionChapter(project.id, chapter.id, "待质检");
    chapter = database.transitionChapter(project.id, chapter.id, "待定稿");
    chapter = database.transitionChapter(project.id, chapter.id, "已定稿");
    expect(chapter.revision).toBe(4);
    const scheduled = database.saveSchedule(project.id, {
      id: "", projectId: "forged", projectTitle: "forged", chapterId: chapter.id,
      chapterNumber: 999, chapterTitle: "forged", publishAt: "2026-08-01T08:00:00.000Z", status: "待发布",
    });
    expect(scheduled).toMatchObject({ projectId: project.id, projectTitle: "排期事务", chapterNumber: 1, chapterTitle: "第1章" });
    expect(database.getProject(project.id).chapters[0].status).toBe("待发布");
    expect(database.getProjectSummary(project.id)).toMatchObject({ currentWords: chapter.wordCount, chapterCount: 1, stockChapters: 1, nextPublishAt: "2026-08-01T08:00:00.000Z" });

    database.saveSchedule(project.id, { ...scheduled, status: "已发布" });
    expect(database.getProject(project.id).chapters[0].status).toBe("已发布");
    expect(database.getProjectSummary(project.id)).toMatchObject({ stockChapters: 0, nextPublishAt: null });
  });

  it("does not save a schedule when the chapter transition is invalid", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "排期回滚", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const chapter = database.saveChapter(project.id, createChapter(1));
    expect(() => database.saveSchedule(project.id, {
      id: "", projectId: project.id, projectTitle: project.title, chapterId: chapter.id,
      chapterNumber: 1, chapterTitle: chapter.title, publishAt: "2026-08-01T08:00:00.000Z", status: "待发布",
    })).toThrow("不允许");
    expect(database.getProject(project.id).schedule).toEqual([]);
    expect(database.getProject(project.id).chapters[0].status).toBe("草稿");
  });

  it("persists each project's aesthetic profile in the story contract", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "审美隔离", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    const saved = database.saveContract(project.id, {
      ...database.getProject(project.id).contract,
      aestheticProfile: {
        narrativeDistance: "贴身", emotionalTemperature: "热烈",
        proseTexture: "明快", dialogueStyle: "短促", emotionalExpression: "直接",
        signatureTechniques: ["多人交锋"], avoidPatterns: ["旁白说教"],
      },
    });

    expect(saved.aestheticProfile).toMatchObject({
      narrativeDistance: "贴身",
      emotionalTemperature: "热烈",
      proseTexture: "明快",
    });
    expect(database.getProject(project.id).contract.aestheticProfile).toEqual(saved.aestheticProfile);
  });

  it("requires an approved change request before editing an approved contract", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "门禁测试", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const initial = database.saveContract(project.id, {
      ...database.getProject(project.id).contract,
      premise: "主角发现异常规则", readerPromise: "持续解谜与成长", ending: "主角关闭规则源头", ...completeNarrativeEngine,
    });
    const approved = database.approveContract(project.id);
    expect(database.saveContract(project.id, { ...approved })).toEqual(approved);
    expect(() => database.saveContract(project.id, { ...initial, premise: "未经审批的新前提" })).toThrow(/变更单/);
    const change = database.saveChangeRequest(project.id, {
      id: "", targetKind: "创作契约", targetId: "contract", baseVersion: 0,
      title: "调整故事前提", reason: "阶段复盘", beforeValue: initial.premise,
      afterValue: "经审批的新前提", impact: "创作契约", rollback: "恢复上一版本", status: "待审批", createdAt: now(),
    });
    database.decideChangeRequest(project.id, change.id, "批准");
    const saved = database.saveContract(project.id, { ...initial, premise: "经审批的新前提" });
    expect(saved.premise).toBe("经审批的新前提");
    expect(database.getProject(project.id).changes.find((item) => item.id === change.id)?.status).toBe("已应用");
  });

  it("owns lifecycle status and binds approvals to one target version", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "状态门禁", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const first = database.saveChapter(project.id, { ...createChapter(1), status: "已发布" });
    const second = database.saveChapter(project.id, createChapter(2));
    expect(first.status).toBe("草稿");
    expect(database.saveChapter(project.id, { ...first, status: "已发布" }).status).toBe("草稿");
    expect(() => database.transitionChapter(project.id, first.id, "已发布")).toThrow("不允许");

    const contract = database.saveContract(project.id, { ...database.getProject(project.id).contract, premise: "前提", readerPromise: "承诺", ending: "终局", ...completeNarrativeEngine });
    database.approveContract(project.id);
    const unrelated = database.saveChangeRequest(project.id, {
      id: "伪造编号", targetKind: "章节", targetId: second.id, baseVersion: 999, title: "无关章节变更", reason: "测试",
      beforeValue: "旧", afterValue: "新", impact: "第二章", rollback: "恢复", status: "已批准", createdAt: "2000-01-01T00:00:00.000Z",
    });
    expect(unrelated.status).toBe("待审批");
    expect(unrelated.baseVersion).toBe(second.revision);
    expect(() => database.saveContract(project.id, { ...contract, premise: "不能挪用审批" })).toThrow("变更单");
  });

  it("rejects approval when the long-form narrative engine is incomplete", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "空壳契约", genre: "玄幻/仙侠", targetWords: 1000000, updateCadence: "每日2章" });
    database.saveContract(project.id, { ...database.getProject(project.id).contract, premise: "主角进入陌生城池", readerPromise: "持续探索真相", ending: "主角作出最终选择" });
    expect(() => database.approveContract(project.id)).toThrow(/开局机制.*成长载体.*核心回报.*长篇发动机/);
  });

  it("binds planning changes to the current persisted plan version", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "规划版本", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    database.saveContract(project.id, {
      ...database.getProject(project.id).contract,
      premise: "主角追查异常事故", readerPromise: "持续调查并兑现线索", ending: "公开真相", ...completeNarrativeEngine,
    });
    database.approveContract(project.id);
    const plan = database.savePlan(project.id, {
      id: "", kind: "分卷", title: "第一卷", ordinal: 1, goal: "建立规则", conflict: "资源有限",
      outcome: "完成阶段目标", targetWords: 150000, status: "待审批", parentId: null,
    });
    database.approvePlan(project.id, plan.id);
    const request = database.saveChangeRequest(project.id, {
      id: "", targetKind: "规划", targetId: plan.id, baseVersion: 0, title: "调整阶段目标", reason: "复盘",
      beforeValue: plan.goal, afterValue: "建立并验证规则", impact: "第一卷", rollback: "恢复旧目标",
      status: "待审批", createdAt: now(),
    });
    expect(request.baseVersion).toBe(2);
    database.decideChangeRequest(project.id, request.id, "批准");
    expect(database.savePlan(project.id, { ...plan, goal: "建立并验证规则" }).status).toBe("待审批");
    expect(database.saveChangeRequest(project.id, { ...request, id: "" }).baseVersion).toBe(3);
    expect(() => database.saveChangeRequest(project.id, { ...request, targetId: "missing" })).toThrow("变更目标规划不存在");
    expect(() => database.decideChangeRequest(project.id, "missing", "批准")).toThrow("变更单不存在");
  });
});
