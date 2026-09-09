import { randomUUID } from "node:crypto";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { compileProjectChapterContext } from "../src/shared/context-compiler";
import {
  applyContractRepairs,
  applyTextRepair,
  chapterRevisionSnapshot,
  planRevisionSnapshot,
  sameRevisionSnapshot,
} from "../src/shared/novel-revision";
import type { Chapter, ChapterFactsExtractionEvent, NovelRevisionProposal } from "../src/shared/types";
import { hasUsableAiCredential as hasUsableCredential } from "./ai/credential-presence";
import { createProfileRuntime } from "./ai/profile-runtime";
import { createAiRouteResolver } from "./ai/route-resolver";
import { AiService } from "./ai-service";
import { createEncryptedBackup } from "./backup";
import { type ChapterGenerationCoordinator, createChapterGenerationCoordinator } from "./chapter-generation-service";
import {
  deleteAiProfileCredential,
  deleteApiCredential,
  deleteProxyCredential,
  listAiProfileCredentialIds,
  readAiProfileCredential,
  readApiCredential,
  readAutoBackupCredential,
  readProxyCredential,
  writeAiProfileCredential,
  writeApiCredential,
  writeProxyCredential,
} from "./credential-store";
import { now, WorkspaceDatabase } from "./database";
import { registerAiHandlers } from "./handlers/ai-handlers";
import { type AiProfileCredentials, registerAiProfileHandlers } from "./handlers/ai-profile-handlers";
import { registerNetworkHandlers } from "./handlers/network-handlers";
import { registerProjectHandlers } from "./handlers/project-handlers";
import { type ResearchHandlerRuntime, registerResearchHandlers } from "./handlers/research-handlers";
import { registerSystemHandlers, type SystemHandlerRuntime } from "./handlers/system-handlers";
import type { RegisterHandler } from "./handlers/types";
import { registerUpdateHandlers } from "./handlers/update-handlers";
import { validateIpcArgs } from "./ipc-validation";
import { configureOutboundProxy, fetchPublicHttpResponse, setOutboundProxyDnsObserver } from "./netguard";
import { StructuredLogger } from "./structured-log";
import { createUpdateService, type UpdateService } from "./update-service";
import { BackgroundWorker } from "./worker-client";

let mainWindow: BrowserWindow | null = null;
let database: WorkspaceDatabase;
let worker: BackgroundWorker;
let ai: AiService;
let apiCredential = "";
/** 来源熔断与并发控制：进程内共享，任务成功/失败都会更新。 */
const profileRuntime = createProfileRuntime();
/** 来源密钥内存缓存：路由解析必须同步，启动后预热，保存/删除时增量更新。 */
const profileCredentials = new Map<string, string>();
const profileCredentialsBridge: AiProfileCredentials = {
  read: async (id) => {
    const cached = profileCredentials.get(id);
    if (cached !== undefined) return cached;
    const value = await readAiProfileCredential(id);
    if (value) profileCredentials.set(id, value);
    return value;
  },
  write: async (id, value) => {
    await writeAiProfileCredential(id, value);
    profileCredentials.set(id, value);
  },
  remove: async (id) => {
    await deleteAiProfileCredential(id);
    profileCredentials.delete(id);
  },
  listIds: async () => {
    const ids = await listAiProfileCredentialIds();
    for (const id of ids) {
      if (profileCredentials.has(id)) continue;
      void readAiProfileCredential(id).then((value) => {
        if (value) profileCredentials.set(id, value);
      });
    }
    return ids;
  },
};

async function prewarmProfileCredentials() {
  try {
    for (const id of await listAiProfileCredentialIds()) {
      if (profileCredentials.has(id)) continue;
      const value = await readAiProfileCredential(id);
      if (value) profileCredentials.set(id, value);
    }
  } catch (error) {
    logger.write("warn", "ai.credentials.prewarm_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
let chapterGeneration: ChapterGenerationCoordinator;
let rankingScheduleTimer: ReturnType<typeof setInterval> | null = null;
let researchHandlers: ResearchHandlerRuntime;
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let systemHandlers: SystemHandlerRuntime;
let logger: StructuredLogger;
let updateService: UpdateService | null = null;
let quitInstallAttempted = false;
const singleInstanceLockDisabled = process.env.NOVEL_STUDIO_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const hasSingleInstanceLock = singleInstanceLockDisabled || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else if (!singleInstanceLockDisabled)
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

function getApiKey() {
  return apiCredential;
}

/**
 * AI 任务门禁：有来源时按来源判断（默认来源 → 任一启用来源），
 * 没有任何来源时回退旧版单密钥。只用于「是否已配置」的判断，
 * 真正的密钥仍由路由解析按角色取。
 */
function hasUsableAiCredential() {
  return hasUsableCredential({
    profiles: database.listAiProfiles(),
    defaultProfileId: database.getDefaultAiProfileId(),
    legacyApiKey: apiCredential,
    credentialFor: (id) => profileCredentials.get(id) ?? "",
  });
}

/** 旧版单密钥迁移到“默认来源”：只在默认来源还没有密钥时移动一次，失败不阻塞启动。 */
async function migrateLegacyAiCredential() {
  try {
    const migrated = database.listAiProfiles().find((profile) => profile.notes === "由旧版模型设置迁移");
    if (!migrated) return;
    const ids = await listAiProfileCredentialIds();
    if (ids.includes(migrated.id)) return;
    const legacy = apiCredential || (await readApiCredential());
    if (!legacy) return;
    await profileCredentialsBridge.write(migrated.id, legacy);
    await deleteApiCredential();
    apiCredential = "";
    logger.write("info", "ai.credentials.migrated", { profileId: migrated.id });
  } catch (error) {
    logger.write("warn", "ai.credentials.migration_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function extractFinalizedChapterFacts(projectId: string, chapter: Chapter): Promise<ChapterFactsExtractionEvent> {
  try {
    const project = database.getProjectOverview(projectId);
    const candidates = await ai.extractChapterFacts(project, chapter);
    const existing = new Set(
      project.facts.map(
        (fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`,
      ),
    );
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

/** 启动时按已保存设置配置出站代理；配置坏了只回退直连，绝不阻止启动。 */
async function configureOutboundProxyFromSettings() {
  try {
    const settings = database.getProxySettings();
    if (!settings.enabled || !settings.url) {
      configureOutboundProxy(null);
      return;
    }
    const password = await readProxyCredential();
    configureOutboundProxy({
      url: settings.url,
      username: settings.username || undefined,
      password: password || undefined,
    });
    logger.write("info", "proxy.configured", { url: new URL(settings.url).origin });
  } catch (error) {
    configureOutboundProxy(null);
    logger.write("error", "proxy.configure.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 经代理对已保存的模型地址发一次不带密钥的 GET：拿到任何状态码即链路通。 */
async function testOutboundProxy(): Promise<{ ok: boolean; message: string }> {
  const settings = database.getProxySettings();
  if (!settings.enabled || !settings.url) return { ok: false, message: "请先启用并保存代理设置" };
  const target = database.getAiSettings().baseUrl;
  const startedAt = Date.now();
  try {
    const response = await fetchPublicHttpResponse(
      target,
      { method: "GET", signal: AbortSignal.timeout(15_000) },
      { allowCrossOriginRedirect: true },
    );
    await response.body?.cancel();
    return {
      ok: true,
      message: `代理连通：${new URL(target).origin} 返回 HTTP ${response.status}（${Date.now() - startedAt} ms）`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `代理连接失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function registerHandlers() {
  const handle: RegisterHandler = (channel, callback) =>
    ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
      if (!mainWindow || event.sender.id !== mainWindow.webContents.id) throw new Error("拒绝来自非主窗口的调用");
      const startedAt = Date.now();
      try {
        const result = await callback(...validateIpcArgs(channel, args));
        logger.write("info", "ipc.completed", { channel, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        logger.write("error", "ipc.failed", {
          channel,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
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
      return result.canceled ? null : (result.filePaths[0] ?? null);
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
      return result.canceled ? null : (result.filePath ?? null);
    },
    chooseBackupSource: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "校验并恢复备份副本",
        properties: ["openFile"],
        filters: [{ name: "加密备份", extensions: ["novelbak"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    chooseDiagnosticDestination: async (defaultFileName) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出崩溃诊断包",
        defaultPath: defaultFileName,
        filters: [{ name: "诊断包", extensions: ["zip"] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
    confirmDiagnosticExport: async () => {
      if (!mainWindow) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["取消", "继续导出"],
        defaultId: 0,
        cancelId: 0,
        title: "导出诊断包",
        message: "诊断包包含系统版本、工作区路径、项目名称、健康检查结果和应用日志。",
        detail: "请仅将诊断包提供给可信的技术支持人员。",
      });
      return result.response === 1;
    },
    chooseProjectExportDestination: async (defaultFileName, format) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出发布包",
        defaultPath: defaultFileName,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
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
    runLocalQualityCheck: (input) => worker.run("quality-check", input),
    createId: randomUUID,
    currentTimestamp: now,
    isGenerationActive: chapterGeneration.isActive,
    markGenerationActive: chapterGeneration.markActive,
    markGenerationIdle: chapterGeneration.markIdle,
    getApiKey,
    hasAiCredential: hasUsableAiCredential,
    saveApiKey: async (apiKey) => {
      await writeApiCredential(apiKey);
      apiCredential = apiKey;
    },
    clearApiKey: async () => {
      await deleteApiCredential();
      apiCredential = "";
    },
    queueFinalizedFactExtraction: (projectId, chapter) => {
      setImmediate(() => {
        void extractFinalizedChapterFacts(projectId, chapter).then((result) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("studio:chapter-facts-extracted", result);
          }
        });
      });
    },
    startChapterRetry: (projectId, chapterId) => chapterGeneration.startOne(projectId, chapterId, undefined, "bypass"),
    logRetryFailure: (details) => logger.write("error", "ai.retry.failed", { ...details }),
  });
  registerAiProfileHandlers({
    register: handle,
    database,
    credentials: {
      read: profileCredentialsBridge.read,
      write: profileCredentialsBridge.write,
      remove: profileCredentialsBridge.remove,
      listIds: profileCredentialsBridge.listIds,
    },
    log: (level, event, data) => logger.write(level, event, data),
    now,
    health: () => profileRuntime.snapshot(),
  });
  registerNetworkHandlers({
    register: handle,
    getSettings: () => database.getProxySettings(),
    saveSettings: (input) => database.saveProxySettings(input),
    readProxyCredential,
    writeProxyCredential,
    deleteProxyCredential,
    testConnection: () => testOutboundProxy(),
    log: (level, event, data) => logger.write(level, event, data),
  });
  if (!updateService) throw new Error("更新服务尚未初始化");
  registerUpdateHandlers({ register: handle, update: updateService });
  handle("analyzeNovelRevision", (id, input) => ai.analyzeNovelRevision(database.getProject(id), input));
  handle("applyNovelRevision", (id, proposal: NovelRevisionProposal, selectedRepairIds: string[]) => {
    const selected = new Set(selectedRepairIds);
    if (!selected.size) throw new Error("请至少选择一项修改");
    if (selected.size !== selectedRepairIds.length) throw new Error("修改提案包含重复项目");
    const allRepairIds = new Set([
      ...proposal.contractRepairs.map((item) => item.id),
      ...proposal.planRepairs.map((item) => item.id),
      ...proposal.chapterRepairs.map((item) => item.id),
      ...(proposal.textRepair ? [proposal.textRepair.id] : []),
    ]);
    if ([...selected].some((repairId) => !allRepairIds.has(repairId))) throw new Error("修改提案包含未知项目");

    const project = database.getProject(id);
    const contractRepairs = proposal.contractRepairs.filter((item) => selected.has(item.id));
    if (contractRepairs.length && project.contract.version !== proposal.baseContractVersion)
      throw new Error("创作设定版本已变化，请重新分析修改意见");
    const nextContract = contractRepairs.length ? applyContractRepairs(project.contract, contractRepairs) : null;
    const plansById = new Map(project.plans.map((item) => [item.id, item]));
    const planRepairs = proposal.planRepairs.filter((item) => selected.has(item.id));
    for (const repair of planRepairs) {
      const current = plansById.get(repair.targetId);
      if (!current || !sameRevisionSnapshot(planRevisionSnapshot(current), repair.before))
        throw new Error(`规划“${repair.location}”已变化，请重新分析修改意见`);
    }
    const chaptersById = new Map(project.chapters.map((item) => [item.id, item]));
    const chapterRepairs = proposal.chapterRepairs.filter((item) => selected.has(item.id));
    for (const repair of chapterRepairs) {
      const current = chaptersById.get(repair.targetId);
      if (
        !current ||
        current.revision !== repair.baseRevision ||
        !sameRevisionSnapshot(chapterRevisionSnapshot(current), repair.before)
      )
        throw new Error(`${repair.location}已变化，请重新分析修改意见`);
    }
    if (proposal.textRepair && selected.has(proposal.textRepair.id)) {
      const current = chaptersById.get(proposal.textRepair.targetId);
      if (!current) throw new Error("正文修改目标不存在");
      applyTextRepair(current, proposal.textRepair);
    }

    const changeRequestIds: string[] = [];
    const approveProtectedChange = (
      targetKind: "创作契约" | "规划" | "章节",
      targetId: string,
      title: string,
      before: unknown,
      after: unknown,
    ) => {
      const change = database.saveChangeRequest(id, {
        id: "",
        targetKind,
        targetId,
        baseVersion: 0,
        title,
        reason: proposal.instruction,
        beforeValue: JSON.stringify(before),
        afterValue: JSON.stringify(after),
        impact: proposal.summary,
        rollback: "从目标历史版本恢复本次修改前内容",
        status: "待审批",
        createdAt: "",
      });
      database.decideChangeRequest(id, change.id, "批准");
      changeRequestIds.push(change.id);
    };
    const appliedTargets: string[] = [];
    if (nextContract) {
      if (project.contract.approved)
        approveProtectedChange("创作契约", "contract", "AI 修改意见联动创作设定", project.contract, nextContract);
      database.saveContract(id, nextContract);
      appliedTargets.push("创作设定");
    }
    for (const repair of planRepairs) {
      const current = plansById.get(repair.targetId)!;
      if (current.status === "已批准")
        approveProtectedChange("规划", current.id, `AI 修改意见联动：${current.title}`, repair.before, repair.after);
      database.savePlan(id, { ...current, ...repair.after });
      appliedTargets.push(repair.location);
    }
    const affectedChapterIds = new Set([
      ...chapterRepairs.map((item) => item.targetId),
      ...(proposal.textRepair && selected.has(proposal.textRepair.id) ? [proposal.textRepair.targetId] : []),
    ]);
    for (const chapterId of affectedChapterIds) {
      const current = chaptersById.get(chapterId)!;
      const metadata = chapterRepairs.find((item) => item.targetId === chapterId);
      const text =
        proposal.textRepair?.targetId === chapterId && selected.has(proposal.textRepair.id)
          ? proposal.textRepair
          : null;
      const next = {
        ...current,
        ...(metadata?.after ?? {}),
        content: text ? applyTextRepair(current, text) : current.content,
      };
      if (["已定稿", "待发布", "已发布"].includes(current.status))
        approveProtectedChange("章节", current.id, `AI 修改意见联动：第${current.number}章`, current, next);
      database.saveChapter(id, next);
      appliedTargets.push(`第${current.number}章`);
    }
    return { appliedTargets, changeRequestIds };
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
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning",
      buttons: ["继续编辑", "放弃未保存内容并关闭"],
      defaultId: 0,
      cancelId: 0,
      title: "存在未保存内容",
      message: "当前章节还有未保存内容。",
    });
    if (choice === 1) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

if (hasSingleInstanceLock)
  app.whenReady().then(async () => {
    const workspaceRoot =
      process.env.NOVEL_STUDIO_WORKSPACE || path.join(app.getPath("documents"), "长篇创作工作台数据");
    try {
      apiCredential = await readApiCredential();
    } catch {
      apiCredential = "";
    }
    database = new WorkspaceDatabase(workspaceRoot);
    database.pruneAiJobHistory();
    logger = new StructuredLogger(path.join(app.getPath("userData"), "logs"));
    logger.write("info", "application.started", { version: app.getVersion(), workspace: workspaceRoot });
    setOutboundProxyDnsObserver((hostname) => logger.write("warn", "netguard.proxy.dns_unresolved", { hostname }));
    await migrateLegacyAiCredential();
    await configureOutboundProxyFromSettings();
    void prewarmProfileCredentials();
    worker = new BackgroundWorker();
    ai = new AiService(
      database,
      getApiKey,
      120_000,
      0,
      (level, event, data) => logger.write(level, event, data),
      createAiRouteResolver({ database, getCredential: (id) => profileCredentials.get(id) ?? "" }),
      (info) => {
        try {
          database.saveModelCapability({
            profileId: info.profileId,
            modelId: info.model,
            apiSurface: info.apiSurface,
            supportsJsonSchema: info.apiSurface === "openai-responses" ? info.supported : null,
            supportsJsonMode: info.apiSurface === "anthropic-messages" ? false : info.supported,
            supportsStreaming: null,
            supportsStreamUsage: null,
            supportsReasoning: null,
            maxOutputTokens: null,
            contextWindow: null,
            probedAt: now(),
            source: "probe",
          });
        } catch (error) {
          logger.write("warn", "ai.capability.persist_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      profileRuntime,
      hasUsableAiCredential,
    );
    chapterGeneration = createChapterGenerationCoordinator({
      database,
      ai,
      hasAiCredential: hasUsableAiCredential,
      compileContext: compileProjectChapterContext,
    });
    updateService = createUpdateService({
      logger,
      updater: autoUpdater,
      enabled: app.isPackaged && process.env.NOVEL_STUDIO_DISABLE_AUTO_UPDATE !== "1",
      currentVersion: app.getVersion(),
      getSettings: () => database.getUpdateSettings(),
      saveSettings: (input) => database.saveUpdateSettings(input),
      hasBackupPassword: async () => Boolean(await readAutoBackupCredential()),
      readBackupPassword: () => readAutoBackupCredential(),
      createBackup: async (password) => {
        database.checkpointAll();
        await createEncryptedBackup(
          database.root,
          path.join(database.backupRoot, `pre-update-${app.getVersion()}.novelbak`),
          password,
        );
      },
      hasActiveGeneration: () => database.listProjects().some((project) => chapterGeneration.isActive(project.id)),
      publish: (status) => mainWindow?.webContents.send("studio:update-status", status),
    });
    registerHandlers();
    void researchHandlers.runDueRankingSchedules();
    void systemHandlers.runAutomaticBackup();
    rankingScheduleTimer = setInterval(() => void researchHandlers.runDueRankingSchedules(), 15 * 60 * 1000);
    autoBackupTimer = setInterval(() => void systemHandlers.runAutomaticBackup(), 15 * 60 * 1000);
    createWindow();
    process.on("uncaughtException", (error) =>
      logger.write("error", "process.uncaughtException", { error: error.message, stack: error.stack }),
    );
    process.on("unhandledRejection", (reason) =>
      logger.write("error", "process.unhandledRejection", { error: String(reason) }),
    );
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

app.on("window-all-closed", () => {
  if (rankingScheduleTimer) clearInterval(rankingScheduleTimer);
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  const status = updateService?.status();
  // 退出时安装：在关闭数据库之前完成备份与安装，失败则正常退出。
  if (updateService && !quitInstallAttempted && status?.phase === "downloaded" && status.autoInstallOnQuit) {
    quitInstallAttempted = true;
    void updateService
      .install()
      .catch((error) => logger.write("error", "update.quit_install_failed", { error: String(error) }))
      .finally(() => {
        void worker?.close();
        database?.close();
        if (process.platform !== "darwin") app.quit();
      });
    return;
  }
  void worker?.close();
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
