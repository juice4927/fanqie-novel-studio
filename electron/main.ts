import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import type {
  AppApi,
  BatchGenerationPreview,
  Chapter,
  ChapterDraftStreamEvent,
  ChapterFactsExtractionEvent,
  ConceptCandidate,
  ContextPackage,
  ImportPreview,
  InsightPack,
  MetricSnapshot,
  PlanningGenerationResult,
  PlanningRepairInput,
  ProjectDetail,
  QualityIssue,
  RankingSnapshot,
  RankingCaptureSchedule,
  ResearchBook,
  HealthCheckTask,
  SystemHealthReport,
} from "../src/shared/types";
import { WorkspaceDatabase, now } from "./database";
import { BackgroundWorker } from "./worker-client";
import { AiService, type AiCachePolicy } from "./ai-service";
import { autoBackupFileName, createEncryptedBackup, nextAutoBackupAt, pruneAutoBackups, restoreEncryptedBackup } from "./backup";
import { analyzeRankings, captureFanqieOpeningSample, capturePublicRankingPage } from "./ranking-service";
import { analyzeMetrics, parseMetricsCsv } from "../src/shared/metrics";
import {
  volumeBoundaryChapters,
} from "../src/shared/planning";
import { deleteAutoBackupCredential, readApiCredential, readAutoBackupCredential, writeApiCredential, writeAutoBackupCredential } from "./credential-store";
import { assertNoHardStoryConstraint, evaluateStoryConstraints } from "../src/shared/story-constraints";
import { hasMajorStateChange } from "../src/shared/major-state-change";
import { compileChapterContext } from "../src/shared/context-compiler";
import { estimateChapterOutputTokens } from "../src/shared/token-estimator";
import {
  assertChapterRetrySnapshot,
  createChapterGenerationGuard,
  serializeChapterAiRetryContext,
  validateChapterAiRetrySource,
} from "./ai-retry";
import { completeRankingSchedule, failRankingSchedule, nextRankingRun } from "../src/shared/ranking-schedule";
import { validateIpcArgs } from "./ipc-validation";
import { StructuredLogger } from "./structured-log";
import { configureAutoUpdates } from "./update-service";
import JSZip from "jszip";

let mainWindow: BrowserWindow | null = null;
let database: WorkspaceDatabase;
let worker: BackgroundWorker;
let ai: AiService;
let apiCredential = "";
const activeGenerationProjects = new Set<string>();
let rankingScheduleTimer: ReturnType<typeof setInterval> | null = null;
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let autoBackupRunning = false;
const healthTasks = new Map<string, HealthCheckTask>();
const healthTaskFinishedAt = new Map<string, number>();
let logger: StructuredLogger;
const singleInstanceLockDisabled =
  process.env.NOVEL_STUDIO_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const hasSingleInstanceLock =
  singleInstanceLockDisabled || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else if (!singleInstanceLockDisabled) app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function runRankingSchedule(id: string) {
  const schedule = database.listRankingSchedules().find((item) => item.id === id);
  if (!schedule) throw new Error("定时采榜任务不存在");
  const snapshot = await capturePublicRankingPage(schedule.url, schedule.listName);
  database.saveRanking(snapshot);
  database.saveRankingSchedule(completeRankingSchedule(schedule, snapshot));
  return snapshot;
}

async function runDueRankingSchedules() {
  const current = Date.now();
  for (const schedule of database.listRankingSchedules()) {
    if (!schedule.enabled || Date.parse(schedule.nextRunAt) > current) continue;
    try { await runRankingSchedule(schedule.id); } catch (error) {
      database.saveRankingSchedule(failRankingSchedule(schedule, error));
    }
  }
}

async function runAutomaticBackup(force = false) {
  const settings = database.getAutoBackupSettings();
  if (!settings.enabled || autoBackupRunning) return settings;
  if (!force && settings.nextRunAt && Date.parse(settings.nextRunAt) > Date.now()) return settings;
  autoBackupRunning = true;
  try {
    const password = await readAutoBackupCredential();
    if (!password) throw new Error("自动备份密码不存在，请在系统设置中重新保存");
    database.checkpointAll();
    const destination = path.join(database.backupRoot, autoBackupFileName());
    await createEncryptedBackup(database.root, destination, password);
    await pruneAutoBackups(database.backupRoot, settings.retentionCount);
    return database.finishAutoBackup("成功", nextAutoBackupAt(settings.frequency));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return database.finishAutoBackup("失败", new Date(Date.now() + 60 * 60 * 1000).toISOString(), message);
  } finally {
    autoBackupRunning = false;
  }
}

function previewChapterBatch(
  project: ProjectDetail,
  settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
  chapterId: string,
): BatchGenerationPreview {
  const start = project.chapters.find((chapter) => chapter.id === chapterId);
  const blocked = (
    reason: string,
    chapters: BatchGenerationPreview["chapters"] = [],
  ): BatchGenerationPreview => ({
    chapters,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    canRun: false,
    blockingReason: reason,
  });
  if (!start) return blocked("章节不存在");
  if (start.batchMode !== "五章批次") return blocked("请先保存“五章批次”模式");
  if (!project.contract.approved) return blocked("创作契约审批后才能生成正文");
  if (project.facts.some((fact) => fact.confidence === "有冲突"))
    return blocked("状态账本存在冲突事实，已自动恢复逐章模式");

  const ordered = project.chapters
    .filter(
      (chapter) =>
        chapter.number >= start.number && chapter.number < start.number + 5,
    )
    .sort((a, b) => a.number - b.number);
  if (
    ordered.length !== 5 ||
    ordered.some((chapter, index) => chapter.number !== start.number + index)
  ) {
    return blocked("需要从当前章开始预先建立连续五章及其章纲");
  }
  const boundaries = volumeBoundaryChapters(project.plans);
  const activeHardIssues = new Set(
    project.issues
      .filter((issue) => issue.severity === "硬性" && issue.status === "待处理")
      .map((issue) => issue.chapterId),
  );
  for (const chapter of ordered) {
    const summary = ordered.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
    }));
    if (chapter.batchMode !== "五章批次")
      return blocked(`第${chapter.number}章处于逐章模式`, summary);
    if (chapter.isKeyChapter)
      return blocked(`第${chapter.number}章是关键章，必须逐章审批`, summary);
    if (boundaries.has(chapter.number))
      return blocked(
        `第${chapter.number}章位于卷首或卷末，必须逐章审批`,
        summary,
      );
    if (hasMajorStateChange(chapter.outline, project.summary.genre, project.contract.majorStateChanges))
      return blocked(
        `第${chapter.number}章包含重大状态变化，必须逐章审批`,
        summary,
      );
    if (activeHardIssues.has(chapter.id))
      return blocked(`第${chapter.number}章有未解决的硬性告警`, summary);
    if (!chapter.outline.trim())
      return blocked(`第${chapter.number}章尚未填写章纲`, summary);
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      return blocked(`第${chapter.number}章已经定稿或进入发布流程`, summary);
    const hardConstraint = evaluateStoryConstraints(project.facts, chapter).find((finding) => finding.severity === "硬性");
    if (hardConstraint) return blocked(`第${chapter.number}章写前约束失败：${hardConstraint.message}`, summary);
  }

  const inputTokens = ordered.reduce(
    (sum, chapter) => sum + compileContext(project, chapter).estimatedTokens,
    0,
  );
  const outputTokens = ordered.reduce(
    (sum, chapter) => sum + estimateChapterOutputTokens(chapter.targetWords ?? 2300),
    0,
  );
  const estimatedCost =
    (inputTokens / 1_000_000) * settings.inputPricePerMillion +
    (outputTokens / 1_000_000) * settings.outputPricePerMillion;
  return {
    chapters: ordered.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
    })),
    inputTokens,
    outputTokens,
    estimatedCost,
    canRun: true,
    blockingReason: null,
  };
}

function startOneChapter(
  id: string,
  chapterId: string,
  onStream?: (event: ChapterDraftStreamEvent) => void,
  cachePolicy: AiCachePolicy = "use",
) {
  if (activeGenerationProjects.has(id)) throw new Error("该作品已有正文生成任务正在运行");
  const project = database.getProject(id);
  if (!project.contract.approved) throw new Error("创作契约审批后才能生成正文");
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在");
  if (!chapter.outline.trim()) throw new Error("请先填写本章章纲");
  if (["已定稿", "待发布", "已发布"].includes(chapter.status)) throw new Error("已定稿或进入发布流程的章节不能由 AI 覆写");
  assertNoHardStoryConstraint(evaluateStoryConstraints(project.facts, chapter));
  if (!getApiKey()) throw new Error("尚未配置 AI API 密钥");
  activeGenerationProjects.add(id);
  try {
    const facts = database.searchRelevantFacts(id, `${chapter.title} ${chapter.outline}`, chapter.number);
    const generationGuard = createChapterGenerationGuard(chapter);
    const task = ai.startDraftChapter(id, chapter, compileContext(project, chapter, facts), {
      retryContext: serializeChapterAiRetryContext("chapter", id, chapter),
      onStream,
      cachePolicy,
    });
    return {
      ...task,
      completion: task.completion
        .then((generated) => database.saveGeneratedChapter(id, generated, generationGuard))
        .finally(() => activeGenerationProjects.delete(id)),
    };
  } catch (error) {
    activeGenerationProjects.delete(id);
    throw error;
  }
}

async function generateOneChapter(id: string, chapterId: string, onStream?: (event: ChapterDraftStreamEvent) => void) {
  return startOneChapter(id, chapterId, onStream).completion;
}

async function generateChapterBatchFrom(id: string, chapterId: string) {
  if (activeGenerationProjects.has(id)) throw new Error("该作品已有正文生成任务正在运行");
  const preview = previewChapterBatch(database.getProject(id), database.getAiSettings(), chapterId);
  if (!preview.canRun) throw new Error(preview.blockingReason ?? "当前不能执行五章批次");
  activeGenerationProjects.add(id);
  try {
    const generated: Chapter[] = [];
    for (const candidate of preview.chapters) {
      const currentProject = database.getProject(id);
      const chapter = currentProject.chapters.find((item) => item.id === candidate.id);
      if (!chapter) throw new Error(`第${candidate.number}章不存在`);
      if (chapter.content.trim()) { generated.push(chapter); continue; }
      assertNoHardStoryConstraint(evaluateStoryConstraints(currentProject.facts, chapter));
      const facts = database.searchRelevantFacts(id, `${chapter.title} ${chapter.outline}`, chapter.number);
      const generationGuard = createChapterGenerationGuard(chapter);
      const draft = await ai.draftChapter(
        id,
        chapter,
        compileContext(currentProject, chapter, facts),
        serializeChapterAiRetryContext("batch", id, chapter),
      );
      generated.push(database.saveGeneratedChapter(id, draft, generationGuard));
    }
    return generated;
  } finally {
    activeGenerationProjects.delete(id);
  }
}

function getApiKey() {
  return apiCredential;
}

async function extractFinalizedChapterFacts(
  projectId: string,
  chapter: Chapter,
): Promise<ChapterFactsExtractionEvent> {
  try {
    const project = database.getProjectOverview(projectId);
    const candidates = await ai.extractChapterFacts(project, chapter);
    const existing = new Set(project.facts.map((fact) =>
      `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`,
    ));
    let candidateCount = 0;
    for (const fact of candidates) {
      const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
      if (existing.has(key)) continue;
      database.saveFact(projectId, fact);
      existing.add(key);
      candidateCount += 1;
    }
    return { projectId, chapterId: chapter.id, status: "已完成", candidateCount };
  } catch (error) {
    return {
      projectId,
      chapterId: chapter.id,
      status: "失败",
      candidateCount: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function compileContext(
  project: ProjectDetail,
  chapter: Chapter,
  relevantFacts: ReadonlyArray<ProjectDetail["facts"][number]> = project.facts,
): ContextPackage {
  return compileChapterContext({
    summary: project.summary,
    contract: project.contract,
    chapter,
    plans: project.plans,
    relevantFacts,
    constraintFacts: project.facts,
    summaries: project.summaries,
    expectations: project.expectations,
    recentChapters: project.chapters,
    styleSamples: project.chapters
      .filter((item) =>
        item.number < chapter.number &&
        ["已定稿", "待发布", "已发布"].includes(item.status) &&
        item.content,
      )
      .sort((left, right) => left.number - right.number)
      .slice(-20)
      .map((item) => item.content),
  });
}

function getDashboard() {
  const projects = database.listProjects();
  const { dueToday, activeAlerts, pendingIssues } = database.getDashboardActivity(now().slice(0, 10));
  return {
    projects,
    dueToday,
    activeAlerts,
    totals: {
      activeBooks: projects.filter(
        (project) => !["暂停", "完结", "归档"].includes(project.status),
      ).length,
      totalWords: projects.reduce(
        (sum, project) => sum + project.currentWords,
        0,
      ),
      stockChapters: projects.reduce(
        (sum, project) => sum + project.stockChapters,
        0,
      ),
      pendingIssues,
    },
  };
}

function value(row: Record<string, string>, keys: string[], fallback = "") {
  for (const key of keys)
    if (row[key] !== undefined && row[key] !== "") return row[key];
  return fallback;
}

function parseNumber(raw: string) {
  const numeric = Number(String(raw).replace(/[,，万]/g, ""));
  if (String(raw).includes("万")) return Math.round(numeric * 10000);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseRankingCsv(csvText: string, listName: string): RankingSnapshot {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length && !parsed.data.length)
    throw new Error(parsed.errors[0].message);
  const id = randomUUID();
  return {
    id,
    source: "CSV 手动导入",
    listName,
    capturedAt: now(),
    status: parsed.errors.length ? "部分成功" : "成功",
    error: parsed.errors.length
      ? parsed.errors.map((error) => error.message).join("；")
      : null,
    entries: parsed.data.map((row, index) => ({
      id: randomUUID(),
      snapshotId: id,
      rank: parseNumber(value(row, ["排名", "rank"], String(index + 1))),
      title: value(row, ["书名", "title"], "未命名"),
      author: value(row, ["作者", "author"], "未知"),
      genre: value(row, ["题材", "分类", "genre"], "未分类"),
      words: parseNumber(value(row, ["字数", "words"])),
      status: value(row, ["状态", "status"], "未知"),
      tags: value(row, ["标签", "tags"])
        .split(/[、,，]/)
        .filter(Boolean),
      sourceUrl: value(row, ["链接", "url", "sourceUrl"]),
    })),
  };
}

async function exportProject(projectId: string, format: "txt" | "md" | "docx") {
  if (!mainWindow) return null;
  const project = database.getProject(projectId);
  const chapters = project.chapters.filter((chapter) =>
    ["已定稿", "待发布", "已发布"].includes(chapter.status),
  );
  if (!chapters.length) throw new Error("没有可导出的已定稿章节");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出发布包",
    defaultPath: `${project.summary.title}-发布包.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (format === "docx") {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: project.summary.title,
              heading: HeadingLevel.TITLE,
            }),
            ...chapters.flatMap((chapter) => [
              new Paragraph({
                text: `第${chapter.number}章 ${chapter.title}`,
                heading: HeadingLevel.HEADING_1,
              }),
              ...chapter.content
                .split(/\n+/)
                .filter(Boolean)
                .map((line) => new Paragraph({ text: line })),
            ]),
          ],
        },
      ],
    });
    await writeFile(result.filePath, await Packer.toBuffer(document));
  } else {
    const text = chapters
      .map((chapter) =>
        format === "md"
          ? `# 第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`
          : `第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`,
      )
      .join("\n\n");
    await writeFile(result.filePath, text, "utf8");
  }
  const pending = project.issues.filter((issue) => issue.status === "待处理");
  const conflicts = project.facts.filter(
    (fact) => fact.confidence === "有冲突",
  );
  const report = [
    `# ${project.summary.title} 发布前检查报告`,
    "",
    `- 生成时间：${new Date().toLocaleString("zh-CN")}`,
    `- 导出章节：${chapters.length} 章`,
    `- 创作契约：${project.contract.approved ? `已审批 v${project.contract.version}` : "未审批"}`,
    `- 已批准卷纲：${project.plans.filter((plan) => plan.kind === "分卷" && plan.status === "已批准").length}`,
    `- 未处理硬性问题：${pending.filter((issue) => issue.severity === "硬性").length}`,
    `- 其他待处理问题：${pending.filter((issue) => issue.severity !== "硬性").length}`,
    `- 冲突事实：${conflicts.length}`,
    "",
    "## 待处理问题",
    "",
    ...(pending.length
      ? pending.map(
          (issue) =>
            `- [${issue.severity}] ${issue.category}：${issue.message}`,
        )
      : ["- 无"]),
    "",
    "## 冲突事实",
    "",
    ...(conflicts.length
      ? conflicts.map(
          (fact) =>
            `- ${fact.subject} / ${fact.predicate}：${fact.value}（证据第${fact.evidenceChapter}章）`,
        )
      : ["- 无"]),
    "",
    "> 本报告只辅助人工发布检查，不代表平台审核结论。",
  ].join("\n");
  const reportPath = `${result.filePath.slice(0, -path.extname(result.filePath).length)}-检查报告.md`;
  await writeFile(reportPath, report, "utf8");
  return result.filePath;
}

function registerHandlers() {
  const pruneHealthTasks = () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, finishedAt] of healthTaskFinishedAt) {
      if (finishedAt < cutoff) { healthTaskFinishedAt.delete(id); healthTasks.delete(id); }
    }
    const completed = [...healthTaskFinishedAt.entries()].sort((left, right) => right[1] - left[1]);
    for (const [id] of completed.slice(100)) { healthTaskFinishedAt.delete(id); healthTasks.delete(id); }
  };
  const handle = (
    channel: Exclude<keyof AppApi, "onChapterFactsExtracted">,
    callback: (...args: any[]) => unknown,
  ) =>
    ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
      if (!mainWindow || event.sender.id !== mainWindow.webContents.id)
        throw new Error("拒绝来自非主窗口的调用");
      const startedAt = Date.now();
      try {
        const result = await callback(...validateIpcArgs(channel, args));
        logger.write("info", "ipc.completed", { channel, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        logger.write("error", "ipc.failed", { channel, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  handle("getDashboard", () => getDashboard());
  handle("listProjects", () => database.listProjects());
  handle("createProject", (input) => database.createProject(input));
  handle("generateBookConcepts", (input) => ai.generateBookConcepts(input));
  handle("createProjectFromConcept", async (input, concept) => {
    const skeleton = await ai.expandBookConcept(input, concept);
    return database.createProjectFromConcept({
      title: concept.title,
      genre: input.genre,
      targetWords: input.targetWords,
      updateCadence: input.updateCadence,
    }, {
      premise: concept.premise,
      genreSubtype: concept.genreSubtype,
      fanqieCategoryKey: "",
      secondaryGenres: concept.secondaryGenres,
      genreElements: concept.genreElements,
      customGenreDirection: input.customGenreDirection ?? "",
      audience: concept.audience,
      commercialHook: concept.commercialHook,
      openingMechanism: concept.openingMechanism,
      growthCarrier: concept.growthCarrier,
      primaryPayoff: concept.primaryPayoff,
      longFormEngine: concept.longFormEngine,
      protagonistDesire: concept.protagonistDesire,
      protagonistArc: skeleton.protagonistArc,
      keyRelationships: skeleton.keyRelationships,
      worldRules: skeleton.worldRules,
      majorForces: skeleton.majorForces,
      timelineAnchors: skeleton.timelineAnchors,
      readerPromise: concept.readerPromise,
      coreEmotion: concept.coreEmotion,
      ending: concept.ending,
      immutableRules: concept.immutableRules,
      prohibitedPatterns: concept.prohibitedPatterns,
    });
  });
  handle("deleteProject", (id, confirmationTitle) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品仍有正文生成任务运行，暂时不能删除");
    return database.deleteProject(id, confirmationTitle);
  });
  handle("getProject", (id) => database.getProjectOverview(id));
  handle("getChapter", (id, chapterId) => database.getChapter(id, chapterId));
  handle("updateProject", (id, patch) => database.updateProject(id, patch));
  handle("saveContract", (id, contract) => database.saveContract(id, contract));
  handle("suggestAestheticProfile", (id, contract) => {
    const project = database.getProject(id);
    return ai.suggestAestheticProfile({ ...project, contract });
  });
  handle("approveContract", (id) => database.approveContract(id));
  handle("savePlan", (id, plan) => database.savePlan(id, plan));
  handle("approvePlan", (id, planId) => database.approvePlan(id, planId));
  handle("generatePlanningDraft", async (id, input) => {
    const project = database.getProject(id);
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    if (input.mode === "全书结构" && project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷"))
      throw new Error("当前已有宏观阶段或分卷；为避免重复，AI 不会覆盖现有结构");
    const fromChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const count = input.mode === "后续章纲" ? input.chapterCount ?? 10 : 0;
    if (input.mode === "后续章纲" && project.chapters.some((chapter) => chapter.number >= fromChapter && chapter.number < fromChapter + count))
      throw new Error(`第${fromChapter}–${fromChapter + count - 1}章范围内已有章节，AI 不会覆盖`);
    const savedPlans: PlanningGenerationResult["plans"] = [];
    const savedChapters: PlanningGenerationResult["chapters"] = [];
    try {
      const generated = await ai.generatePlanning(project, { ...input, fromChapter }, (batch) => {
        const latest = database.getProject(id);
        if (batch.chapters.some((chapter) => latest.chapters.some((existing) => existing.number === chapter.number)))
          throw new Error("生成期间章节范围发生变化，本批结果未保存，请重新生成");
        savedPlans.push(...batch.plans.map((plan) => database.savePlan(id, plan)));
        savedChapters.push(...batch.chapters.map((chapter) => database.saveChapter(id, chapter)));
      });
      if (!generated.chapters.length) {
        savedPlans.push(...generated.plans.map((plan) => database.savePlan(id, plan)));
      }
      return { ...generated, plans: savedPlans, chapters: savedChapters };
    } catch (error) {
      if (!savedChapters.length) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`已保存第${savedChapters[0].number}–${savedChapters.at(-1)!.number}章；后续批次生成失败：${message}`);
    }
  });
  handle("reviewPlanning", (id, input) => ai.reviewPlanning(database.getProject(id), input));
  handle("applyPlanningRepairs", (id, input: PlanningRepairInput) => {
    const project = database.getProject(id);
    const plansById = new Map(project.plans.map((plan) => [plan.id, plan]));
    const chaptersById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
    if (!input.plans.length && !input.chapters.length) throw new Error("没有可应用的规划修复");
    if (new Set(input.plans.map((item) => item.targetId)).size !== input.plans.length || new Set(input.chapters.map((item) => item.targetId)).size !== input.chapters.length)
      throw new Error("修复提案包含重复目标");
    for (const repair of input.plans) {
      const current = plansById.get(repair.targetId);
      if (!current) throw new Error(`规划修复目标不存在：${repair.targetId}`);
      if (current.status === "已批准") throw new Error(`规划“${current.title}”已经批准，需先建立并批准改纲变更单`);
    }
    for (const repair of input.chapters) {
      const current = chaptersById.get(repair.targetId);
      if (!current) throw new Error(`章节修复目标不存在：${repair.targetId}`);
      if (["已定稿", "待发布", "已发布"].includes(current.status)) throw new Error(`第${current.number}章已受保护，需先建立并批准章节变更单`);
    }
    const appliedPlanIds = input.plans.map((repair) => database.savePlan(id, { ...plansById.get(repair.targetId)!, ...repair.after }).id);
    const appliedChapterIds = input.chapters.map((repair) => {
      const definedAfter = Object.fromEntries(Object.entries(repair.after).filter(([, value]) => value !== undefined));
      return database.saveChapter(id, { ...chaptersById.get(repair.targetId)!, ...definedAfter }).id;
    });
    return { appliedPlanIds, appliedChapterIds };
  });
  handle("saveChapter", (id, chapter, mode) => database.saveChapter(id, chapter, mode));
  handle("saveExpectation", (id, expectation) =>
    database.saveExpectation(id, expectation),
  );
  handle("transitionChapter", async (id, chapterId, status) => {
    const saved = database.transitionChapter(id, chapterId, status);
    if (status !== "已定稿") {
      return { chapter: saved, ledgerExtraction: { status: "不适用", candidateCount: 0 } };
    }
    if (!getApiKey()) {
      return { chapter: saved, ledgerExtraction: { status: "未配置", candidateCount: 0 } };
    }
    setImmediate(() => {
      void extractFinalizedChapterFacts(id, saved).then((result) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("studio:chapter-facts-extracted", result);
      });
    });
    return { chapter: saved, ledgerExtraction: { status: "排队中", candidateCount: 0 } };
  });
  handle("compileContext", (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    return compileContext(
      project,
      chapter,
      database.searchRelevantFacts(
        id,
        `${chapter.title} ${chapter.outline}`,
        chapter.number,
      ),
    );
  });
  handle("searchProject", (id, query, offset, limit) => database.searchProject(id, query, offset, limit));
  handle("listRevisions", (id, collection, entityId) =>
    database.listRevisions(id, collection, entityId),
  );
  handle("restoreRevision", (id, revisionId) =>
    database.restoreRevision(id, revisionId),
  );
  handle("runQualityCheck", async (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    const localIssues = await worker.run<QualityIssue[]>("quality-check", {
      projectId: id,
      chapter,
      previousChapter: project.chapters.find(
        (item) => item.number === chapter.number - 1,
      ),
      recentChapters: project.chapters
        .filter((item) => item.number < chapter.number)
        .slice(-12),
      facts: project.facts,
      contract: project.contract,
      genre: project.summary.genre,
      originalityMatches: database.findOriginalityMatches(chapter.content),
    });
    const intentIssues: QualityIssue[] = [
      ["本章承诺", chapter.chapterPromise],
      ["预期回报", chapter.expectedPayoff],
      ["当前危机", chapter.crisis],
      ["结尾期待", chapter.endingExpectation],
    ]
      .filter(([, value]) => !String(value ?? "").trim())
      .map(([label]) => ({
        id: randomUUID(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "章节商业意图",
        message: `${label}尚未规划，建议在写作台补充后再判断本章闭环。`,
        evidence: "",
        status: "待处理" as const,
        createdAt: now(),
      }));
    const dueExpectationIssues: QualityIssue[] = project.expectations
      .filter(
        (item) =>
          (item.status === "待兑现" || item.status === "部分兑现") &&
          item.expectedPayoffChapter !== null &&
          item.expectedPayoffChapter <= chapter.number &&
          !chapter.linkedExpectationIds?.includes(item.id),
      )
      .map((item) => ({
        id: randomUUID(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "期待兑现",
        message: `“${item.title}”已到预计兑现章，但本章未标记承接；请确认延期、部分兑现或调整目标章。`,
        evidence: `第${item.sourceChapter}章提出`,
        status: "待处理" as const,
        createdAt: now(),
      }));
    let semanticIssues: QualityIssue[] = [];
    if (getApiKey()) {
      try {
        semanticIssues = await ai.reviewChapter(
          { ...project, facts },
          chapter,
          compileContext(project, chapter, facts),
        );
      } catch (error) {
        semanticIssues = [
          {
            id: randomUUID(),
            projectId: id,
            chapterId,
            severity: "警告",
            category: "语义质检",
            message: "云端语义质检未完成，本次结果仅包含本地规则检查。",
            evidence:
              error instanceof Error
                ? error.message.slice(0, 300)
                : String(error).slice(0, 300),
            status: "待处理",
            createdAt: now(),
          },
        ];
      }
    }
    const seen = new Set<string>();
    const issues = [
      ...localIssues,
      ...intentIssues,
      ...dueExpectationIssues,
      ...semanticIssues,
    ].filter((issue) => {
      const key = `${issue.category}\n${issue.message}\n${issue.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    database.saveIssues(id, chapterId, issues);
    if (chapter.status === "草稿")
      database.transitionChapter(id, chapterId, "待质检");
    return issues;
  });
  handle("reviseChapterFromQuality", async (id, chapterId) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品已有正文生成或修订任务正在运行");
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      throw new Error("已定稿或进入发布流程的章节不能直接由 AI 修改");
    const issues = project.issues.filter(
      (issue) => issue.chapterId === chapterId && issue.status === "待处理",
    );
    if (!issues.length) throw new Error("本章没有可供 AI 修订的待处理问题");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    activeGenerationProjects.add(id);
    try {
      const revised = await ai.reviseChapter(
        { ...project, facts },
        chapter,
        compileContext(project, chapter, facts),
        issues,
      );
      return database.saveGeneratedChapter(id, revised);
    } finally {
      activeGenerationProjects.delete(id);
    }
  });
  handle("extractChapterFacts", async (id, chapterId) => {
    const project = database.getProjectOverview(id);
    const chapter = database.getChapter(id, chapterId);
    if (!chapter.content.trim()) throw new Error("章节还没有正文");
    const relevantFacts = database.searchRelevantFacts(
      id,
      `${chapter.title}\n${chapter.outline}\n${chapter.content.slice(0, 4_000)}`,
      chapter.number,
      40,
    );
    const candidates = await ai.extractChapterFacts(
      { ...project, facts: relevantFacts },
      chapter,
    );
    const existing = new Set(project.facts.map((fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`));
    const saved = [];
    for (const fact of candidates) {
      const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
      if (existing.has(key)) continue;
      saved.push(database.saveFact(id, fact));
      existing.add(key);
    }
    return saved;
  });
  handle("saveFact", (id, fact) => database.saveFact(id, fact));
  handle("resolveIssue", (id, issueId, status) =>
    database.resolveIssue(id, issueId, status),
  );
  handle("saveChangeRequest", (id, change) =>
    database.saveChangeRequest(id, change),
  );
  handle("decideChangeRequest", (id, changeId, decision) =>
    database.decideChangeRequest(id, changeId, decision),
  );
  handle("saveSchedule", (id, item) => database.saveSchedule(id, item));
  handle("listRankings", () => database.listRankings());
  handle("importRankingCsv", (csvText, listName) => {
    const snapshot = parseRankingCsv(csvText, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  handle("capturePublicRanking", async (url, listName) => {
    const snapshot = await capturePublicRankingPage(url, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  handle("listRankingSchedules", () => database.listRankingSchedules());
  handle("saveRankingSchedule", (input: Parameters<AppApi["saveRankingSchedule"]>[0]) => {
    const existing = input.id ? database.listRankingSchedules().find((item) => item.id === input.id) : undefined;
    const restartCycle = !existing || existing.frequency !== input.frequency || (!existing.enabled && input.enabled);
    return database.saveRankingSchedule({
      id: input.id || randomUUID(),
      url: input.url,
      listName: input.listName,
      frequency: input.frequency,
      enabled: input.enabled,
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: restartCycle ? nextRankingRun(input.frequency) : existing.nextRunAt,
      lastStatus: existing?.lastStatus ?? "未运行",
      lastError: existing?.lastError ?? null,
    });
  });
  handle("runRankingSchedule", (id) => runRankingSchedule(id));
  handle("deleteRankingSchedule", (id) => database.deleteRankingSchedule(id));
  handle("getRankingAnalytics", () => analyzeRankings(database.listRankings()));
  handle("listResearchBooks", () => database.listResearchBooks());
  handle("previewResearchFile", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "小说文档", extensions: ["txt", "epub", "docx"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return worker.run<ImportPreview>("parse-document", {
      filePath: result.filePaths[0],
    });
  });
  handle(
    "importResearchBook",
    (preview, genre, rightsConfirmed, cloudConsent) => {
      if (!rightsConfirmed) throw new Error("必须确认拥有材料的合法使用权");
      const book: ResearchBook = {
        id: randomUUID(),
        title: path.basename(preview.fileName, path.extname(preview.fileName)),
        author: "未标注",
        genre,
        sourceType: preview.sourceType,
        chapterCount: preview.chapters.length,
        wordCount: preview.totalWords,
        rightsConfirmed,
        cloudConsent,
        importedAt: now(),
        status: "待拆解",
      };
      database.saveResearchBook(book, preview.chapters);
      return book;
    },
  );
  handle("importPublicResearchSample", async (sourceUrl, genre, cloudConsent) => {
    const sample = await captureFanqieOpeningSample(sourceUrl);
    const book: ResearchBook = {
      id: randomUUID(),
      title: sample.title,
      author: sample.author,
      genre,
      sourceType: "公开试读",
      sourceUrl: sample.sourceUrl,
      sampleScope: `官方公开前 ${sample.chapters.length} 章，仅代表开篇样本`,
      chapterCount: sample.chapters.length,
      wordCount: sample.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      rightsConfirmed: false,
      cloudConsent,
      importedAt: now(),
      status: "待拆解",
    };
    database.saveResearchBook(book, sample.chapters);
    return book;
  });
  handle("listInsights", () => database.listInsights());
  handle("createInsight", (input) => {
    const insight: InsightPack = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
    };
    database.saveInsight(insight);
    return insight;
  });
  handle("deconstructResearchBook", async (bookId) => {
    const source = database.getResearchBook(bookId);
    database.updateResearchBook({ ...source.book, status: "拆解中" });
    try {
      const result = await ai.deconstruct(source.book, source.chapters);
      database.saveInsight(result.insight);
      database.saveResearchAnalyses(result.analyses);
      database.updateResearchBook({ ...source.book, status: "已拆解" });
      return result.insight;
    } catch (error) {
      database.updateResearchBook({ ...source.book, status: "失败" });
      throw error;
    }
  });
  handle("listResearchAnalyses", (bookId) =>
    database.listResearchAnalyses(bookId),
  );
  handle("attachInsights", (id, insightIds) =>
    database.attachInsights(id, insightIds),
  );
  handle("generateConcepts", async (id): Promise<ConceptCandidate[]> => {
    const project = database.getProject(id);
    const opportunities = analyzeRankings(database.listRankings()).marketOpportunities
      .filter((item) => project.contract.fanqieCategoryKey ? item.categoryKey === project.contract.fanqieCategoryKey : item.genre === project.summary.genre)
      .filter((item) => item.evidenceLevel !== "基线")
      .slice(0, 5);
    return ai.generateConcepts(
      project,
      database.getInsights(project.insightIds),
      opportunities,
    );
  });
  handle("generateChapterDraft", (id, chapterId, streamId) => generateOneChapter(id, chapterId, streamId
    ? (event) => mainWindow?.webContents.send("studio:chapter-draft-stream", { streamId, event })
    : undefined));
  handle("previewChapterBatch", (id, chapterId) =>
    previewChapterBatch(
      database.getProject(id),
      database.getAiSettings(),
      chapterId,
    ),
  );
  handle("generateChapterBatch", generateChapterBatchFrom);
  handle("getAiSettings", () => ({
    ...database.getAiSettings(),
    hasApiKey: Boolean(getApiKey()),
  }));
  handle("saveAiSettings", async (settings, apiKey) => {
    if (apiKey) {
      await writeApiCredential(apiKey);
      apiCredential = apiKey;
    }
    return {
      ...database.saveAiSettings(settings),
      hasApiKey: Boolean(getApiKey()),
    };
  });
  handle("listAiJobs", (projectId) => database.listAiJobs(projectId));
  handle("cancelAiJob", (id) => ai.cancelJob(id));
  handle("retryAiJob", async (id) => {
    const sourceJob = database.getAiJob(id);
    if (!sourceJob) throw new Error("AI 任务不存在");
    const context = validateChapterAiRetrySource(sourceJob, database.getAiJobRetryContext(id));
    assertChapterRetrySnapshot(context, database.getChapter(context.projectId, context.chapterId));
    const task = startOneChapter(context.projectId, context.chapterId, undefined, "bypass");
    if (!task.jobId || task.source !== "network") {
      await task.completion;
      throw new Error("重试没有创建新的 AI 任务，请返回章节工作区重新生成");
    }
    void task.completion
      .catch((error) => logger.write("error", "ai.retry.failed", {
        sourceJobId: id,
        retryJobId: task.jobId,
        projectId: context.projectId,
        chapterId: context.chapterId,
        error: error instanceof Error ? error.message : String(error),
      }))
      .catch(() => {});
    const retryJob = database.getAiJob(task.jobId);
    if (!retryJob) throw new Error("AI 重试任务已启动，但审计记录不可用");
    return retryJob;
  });
  handle("exportProject", (id, format) => exportProject(id, format));
  handle("importMetricsCsv", (id, csvText) => {
    const metrics = parseMetricsCsv(csvText);
    database.saveMetrics(id, metrics);
    return metrics.length;
  });
  handle("getReviewSuggestions", (id) =>
    analyzeMetrics(database.getProject(id).metrics),
  );
  handle("saveReviewExperiment", (id, experiment) => database.saveReviewExperiment(id, experiment));
  handle("createBackup", async (password) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "创建加密备份",
      defaultPath: `长篇创作工作台-${now().slice(0, 10)}.novelbak`,
      filters: [{ name: "加密备份", extensions: ["novelbak"] }],
    });
    if (result.canceled || !result.filePath) return null;
    database.checkpointAll();
    await createEncryptedBackup(database.root, result.filePath, password);
    return result.filePath;
  });
  handle("restoreBackup", async (password) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "校验并恢复备份副本",
      properties: ["openFile"],
      filters: [{ name: "加密备份", extensions: ["novelbak"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return restoreEncryptedBackup(result.filePaths[0], database.root, password);
  });
  handle("getAutoBackupSettings", async () => ({
    ...database.getAutoBackupSettings(),
    hasPassword: Boolean(await readAutoBackupCredential()),
  }));
  handle("saveAutoBackupSettings", async (input, password) => {
    const currentPassword = await readAutoBackupCredential();
    if (input.enabled && !password && !currentPassword)
      throw new Error("启用自动备份需要设置至少 8 位的专用密码");
    if (password) await writeAutoBackupCredential(password);
    if (!input.enabled) await deleteAutoBackupCredential();
    const saved = database.saveAutoBackupSettings(
      input,
      input.enabled ? nextAutoBackupAt(input.frequency) : null,
    );
    return { ...saved, hasPassword: input.enabled && Boolean(password || currentPassword) };
  });
  handle("runAutoBackup", async () => ({
    ...await runAutomaticBackup(true),
    hasPassword: Boolean(await readAutoBackupCredential()),
  }));
  const runHealthCheck = (id: string) => worker.run<SystemHealthReport>(
    "system-health",
    { root: database.root },
    {
      id,
      onProgress: (value) => {
        const progress = value as { completed: number; total: number; label: string };
        const task = healthTasks.get(id);
        if (task?.status === "运行中") healthTasks.set(id, { ...task, ...progress });
      },
    },
  );
  handle("runSystemHealthCheck", () => runHealthCheck(randomUUID()));
  handle("startSystemHealthCheck", () => {
    pruneHealthTasks();
    const running = [...healthTasks.values()].find((task) => task.status === "运行中");
    if (running) return running;
    const id = randomUUID();
    const task: HealthCheckTask = { id, status: "运行中", completed: 0, total: 1, label: "准备检查", report: null, error: null };
    healthTasks.set(id, task);
    void runHealthCheck(id).then((report) => {
      const current = healthTasks.get(id);
      if (current?.status === "运行中") {
        healthTasks.set(id, { ...current, status: "完成", completed: current.total, label: "检查完成", report });
        healthTaskFinishedAt.set(id, Date.now());
      }
    }).catch((error) => {
      const current = healthTasks.get(id);
      const message = error instanceof Error ? error.message : String(error);
      if (current) {
        healthTasks.set(id, { ...current, status: message === "健康检查已取消" ? "已取消" : "失败", error: message });
        healthTaskFinishedAt.set(id, Date.now());
      }
    });
    return task;
  });
  handle("getSystemHealthCheck", (id) => {
    const task = healthTasks.get(id);
    if (!task) throw new Error("健康检查任务不存在");
    return task;
  });
  handle("cancelSystemHealthCheck", (id) => {
    const task = healthTasks.get(id);
    if (!task || task.status !== "运行中") return false;
    healthTasks.set(id, { ...task, status: "已取消", label: "正在取消" });
    return worker.cancel(id);
  });
  handle("rebuildSearchIndexes", async (projectId) => {
    database.rebuildSearchIndexes(projectId, false);
    return runHealthCheck(randomUUID());
  });
  handle("exportDiagnosticBundle", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出崩溃诊断包",
      defaultPath: `长篇创作工作台-诊断-${now().slice(0, 10)}.zip`,
      filters: [{ name: "诊断包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const zip = new JSZip();
    zip.file("system.json", JSON.stringify({ appVersion: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch, generatedAt: now() }, null, 2));
    zip.file("health.json", JSON.stringify(database.runSystemHealthCheck(), null, 2));
    try { zip.file("application.jsonl", await readFile(logger.filePath, "utf8")); } catch { zip.file("application.jsonl", ""); }
    await writeFile(result.filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    return result.filePath;
  });
  handle("getWorkspacePath", () => database.root);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4f4f1",
    title: "长篇创作工作台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  const openExternalHttpUrl = (value: string) => {
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        void shell.openExternal(url.toString());
      }
    } catch {
      // Ignore malformed and unsupported external URLs.
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternalHttpUrl(url);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const workspaceRoot =
    process.env.NOVEL_STUDIO_WORKSPACE ||
    path.join(app.getPath("documents"), "长篇创作工作台数据");
  try {
    apiCredential = await readApiCredential();
  } catch {
    apiCredential = "";
  }
  database = new WorkspaceDatabase(workspaceRoot);
  database.pruneAiJobHistory();
  logger = new StructuredLogger(path.join(app.getPath("userData"), "logs"));
  logger.write("info", "application.started", { version: app.getVersion(), workspace: workspaceRoot });
  worker = new BackgroundWorker();
  ai = new AiService(database, getApiKey, 120_000, 0, (level, event, data) => logger.write(level, event, data));
  registerHandlers();
  void runDueRankingSchedules();
  void runAutomaticBackup();
  rankingScheduleTimer = setInterval(() => void runDueRankingSchedules(), 15 * 60 * 1000);
  autoBackupTimer = setInterval(() => void runAutomaticBackup(), 15 * 60 * 1000);
  createWindow();
  configureAutoUpdates(logger, async () => {
    database.checkpointAll();
    const password = await readAutoBackupCredential();
    if (!password) throw new Error("自动更新前需要先在设置中保存自动备份密码");
    await createEncryptedBackup(database.root, path.join(database.backupRoot, `pre-update-${app.getVersion()}.novelbak`), password);
  });
  process.on("uncaughtException", (error) => logger.write("error", "process.uncaughtException", { error: error.message, stack: error.stack }));
  process.on("unhandledRejection", (reason) => logger.write("error", "process.unhandledRejection", { error: String(reason) }));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (rankingScheduleTimer) clearInterval(rankingScheduleTimer);
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  void worker?.close();
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
