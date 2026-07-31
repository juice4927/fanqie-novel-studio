import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BatchGenerationPreview,
  Chapter,
  ChapterDraftStreamEvent,
  ChapterFactsExtractionEvent,
  ContextPackage,
  MetricSnapshot,
  ProjectDetail,
} from "../src/shared/types";
import { WorkspaceDatabase, now } from "./database";
import { BackgroundWorker } from "./worker-client";
import { AiService, type AiCachePolicy } from "./ai-service";
import { createEncryptedBackup } from "./backup";
import { readApiCredential, readAutoBackupCredential, writeApiCredential } from "./credential-store";
import { assertNoHardStoryConstraint, evaluateStoryConstraints } from "../src/shared/story-constraints";
import { compileChapterContext } from "../src/shared/context-compiler";
import { buildChapterBatchPreview } from "../src/shared/chapter-batch-service";
import {
  createChapterGenerationGuard,
  serializeChapterAiRetryContext,
} from "./ai-retry";
import { validateIpcArgs } from "./ipc-validation";
import { StructuredLogger } from "./structured-log";
import { configureAutoUpdates } from "./update-service";
import { registerAiHandlers } from "./handlers/ai-handlers";
import {
  registerProjectHandlers,
} from "./handlers/project-handlers";
import {
  registerResearchHandlers,
  type ResearchHandlerRuntime,
} from "./handlers/research-handlers";
import {
  registerSystemHandlers,
  type SystemHandlerRuntime,
} from "./handlers/system-handlers";
import type { RegisterHandler } from "./handlers/types";

let mainWindow: BrowserWindow | null = null;
let database: WorkspaceDatabase;
let worker: BackgroundWorker;
let ai: AiService;
let apiCredential = "";
const activeGenerationProjects = new Set<string>();
let rankingScheduleTimer: ReturnType<typeof setInterval> | null = null;
let researchHandlers: ResearchHandlerRuntime;
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let systemHandlers: SystemHandlerRuntime;
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

function previewChapterBatch(
  project: ProjectDetail,
  settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
  chapterId: string,
): BatchGenerationPreview {
  return buildChapterBatchPreview(
    project,
    settings,
    chapterId,
    (chapter) => compileContext(project, chapter).estimatedTokens,
  );
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

function registerHandlers() {
  const handle: RegisterHandler = (channel, callback) =>
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
  researchHandlers = registerResearchHandlers({
    register: handle,
    database,
    ai,
    worker,
    chooseResearchFile: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{ name: "小说文档", extensions: ["txt", "epub", "docx"] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  });
  systemHandlers = registerSystemHandlers({
    register: handle,
    database,
    worker,
    logFilePath: logger.filePath,
    getSystemMetadata: () => ({
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
    chooseBackupDestination: async (defaultFileName) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "创建加密备份",
        defaultPath: defaultFileName,
        filters: [{ name: "加密备份", extensions: ["novelbak"] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    chooseBackupSource: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "校验并恢复备份副本",
        properties: ["openFile"],
        filters: [{ name: "加密备份", extensions: ["novelbak"] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    chooseDiagnosticDestination: async (defaultFileName) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出崩溃诊断包",
        defaultPath: defaultFileName,
        filters: [{ name: "诊断包", extensions: ["zip"] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    chooseProjectExportDestination: async (defaultFileName, format) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出发布包",
        defaultPath: defaultFileName,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    },
  });
  registerProjectHandlers({
    register: handle,
    database,
    ai,
    isGenerationActive: (projectId) =>
      activeGenerationProjects.has(projectId),
    currentDate: () => new Date(),
  });
  registerAiHandlers({
    register: handle,
    database,
    ai,
    compileContext,
    generateChapterDraft: generateOneChapter,
    sendChapterDraftStream: (streamId, event) => {
      mainWindow?.webContents.send("studio:chapter-draft-stream", {
        streamId,
        event,
      });
    },
    previewChapterBatch,
    generateChapterBatch: generateChapterBatchFrom,
    runLocalQualityCheck: (input) =>
      worker.run("quality-check", input),
    createId: randomUUID,
    currentTimestamp: now,
    isGenerationActive: (projectId) =>
      activeGenerationProjects.has(projectId),
    markGenerationActive: (projectId) =>
      activeGenerationProjects.add(projectId),
    markGenerationIdle: (projectId) =>
      activeGenerationProjects.delete(projectId),
    getApiKey,
    saveApiKey: async (apiKey) => {
      await writeApiCredential(apiKey);
      apiCredential = apiKey;
    },
    queueFinalizedFactExtraction: (projectId, chapter) => {
      setImmediate(() => {
        void extractFinalizedChapterFacts(projectId, chapter).then((result) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              "studio:chapter-facts-extracted",
              result,
            );
          }
        });
      });
    },
    startChapterRetry: (projectId, chapterId) =>
      startOneChapter(projectId, chapterId, undefined, "bypass"),
    logRetryFailure: (details) =>
      logger.write("error", "ai.retry.failed", { ...details }),
  });
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
  void researchHandlers.runDueRankingSchedules();
  void systemHandlers.runAutomaticBackup();
  rankingScheduleTimer = setInterval(
    () => void researchHandlers.runDueRankingSchedules(),
    15 * 60 * 1000,
  );
  autoBackupTimer = setInterval(
    () => void systemHandlers.runAutomaticBackup(),
    15 * 60 * 1000,
  );
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
