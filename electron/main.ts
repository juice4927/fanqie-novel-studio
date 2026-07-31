import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  Chapter,
  ChapterFactsExtractionEvent,
  MetricSnapshot,
} from "../src/shared/types";
import { WorkspaceDatabase, now } from "./database";
import { BackgroundWorker } from "./worker-client";
import { AiService } from "./ai-service";
import { createEncryptedBackup } from "./backup";
import { readApiCredential, readAutoBackupCredential, writeApiCredential } from "./credential-store";
import { compileProjectChapterContext } from "../src/shared/context-compiler";
import {
  createChapterGenerationCoordinator,
  type ChapterGenerationCoordinator,
} from "./chapter-generation-service";
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
let chapterGeneration: ChapterGenerationCoordinator;
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
    isGenerationActive: chapterGeneration.isActive,
    currentDate: () => new Date(),
  });
  registerAiHandlers({
    register: handle,
    database,
    ai,
    compileContext: compileProjectChapterContext,
    generateChapterDraft: chapterGeneration.generateOne,
    sendChapterDraftStream: (streamId, event) => {
      mainWindow?.webContents.send("studio:chapter-draft-stream", {
        streamId,
        event,
      });
    },
    previewChapterBatch: chapterGeneration.previewBatch,
    generateChapterBatch: chapterGeneration.generateBatch,
    runLocalQualityCheck: (input) =>
      worker.run("quality-check", input),
    createId: randomUUID,
    currentTimestamp: now,
    isGenerationActive: chapterGeneration.isActive,
    markGenerationActive: chapterGeneration.markActive,
    markGenerationIdle: chapterGeneration.markIdle,
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
      chapterGeneration.startOne(projectId, chapterId, undefined, "bypass"),
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
  chapterGeneration = createChapterGenerationCoordinator({
    database,
    ai,
    getApiKey,
    compileContext: compileProjectChapterContext,
  });
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
