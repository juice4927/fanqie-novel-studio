import type { UpdateSettingsInput, UpdateStatus } from "../src/shared/types";

export interface UpdateInfoLike {
  version?: string;
  releaseNotes?: string | Array<{ note?: string | null }> | null;
}

export interface DownloadProgressLike {
  percent?: number;
}

/** electron-updater 的最小接口，便于在测试中注入假实现。 */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): void;
  on(event: "update-available", listener: (info: UpdateInfoLike) => void): void;
  on(event: "update-not-available", listener: (info: UpdateInfoLike) => void): void;
  on(event: "download-progress", listener: (progress: DownloadProgressLike) => void): void;
  on(event: "update-downloaded", listener: (info: UpdateInfoLike) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export interface UpdateLogger {
  write(level: "info" | "error", event: string, meta?: Record<string, unknown>): void;
}

export interface UpdateServiceDependencies {
  logger: UpdateLogger;
  updater: UpdaterPort;
  /** 未打包或显式禁用时为 false：只报告状态，不发起网络请求。 */
  enabled: boolean;
  currentVersion: string;
  getSettings(): UpdateSettingsInput;
  saveSettings(input: UpdateSettingsInput): UpdateSettingsInput;
  hasBackupPassword(): Promise<boolean>;
  readBackupPassword(): Promise<string | null>;
  createBackup(password: string): Promise<void>;
  hasActiveGeneration(): boolean;
  publish?(status: UpdateStatus): void;
  now?(): Date;
}

export interface UpdateService {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(password?: string): Promise<UpdateStatus>;
  saveSettings(input: UpdateSettingsInput): UpdateStatus;
  dispose(): void;
}

const INITIAL_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const PROGRESS_THROTTLE_MS = 500;

function releaseNotesOf(info: UpdateInfoLike): string | null {
  const notes = info.releaseNotes;
  if (!notes) return null;
  if (typeof notes === "string") return notes;
  const text = notes
    .map((item) => item?.note ?? "")
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createUpdateService({
  logger,
  updater,
  enabled,
  currentVersion,
  getSettings,
  saveSettings: persistSettings,
  hasBackupPassword,
  readBackupPassword,
  createBackup,
  hasActiveGeneration,
  publish,
  now = () => new Date(),
}: UpdateServiceDependencies): UpdateService {
  const settings = getSettings();
  let status: UpdateStatus = {
    phase: "idle",
    currentVersion,
    availableVersion: null,
    progressPercent: null,
    releaseNotes: null,
    lastCheckedAt: null,
    error: null,
    autoCheck: settings.autoCheck,
    autoInstallOnQuit: settings.autoInstallOnQuit,
    backupPasswordRequired: false,
    canInstall: false,
  };
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let lastProgressPublish = 0;

  const snapshot = (): UpdateStatus => ({ ...status });
  const emit = () => publish?.(snapshot());
  const update = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch };
    emit();
  };
  const unref = (timer: { unref?: () => void }) => timer.unref?.();

  const refreshReadiness = async () => {
    if (status.phase !== "downloaded") return;
    const hasPassword = await hasBackupPassword();
    update({
      backupPasswordRequired: !hasPassword,
      canInstall: status.phase === "downloaded" && hasPassword,
    });
  };

  const scheduleRetry = (delayMs: number) => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void check();
    }, delayMs);
    unref(retryTimer);
  };

  const handleError = (error: unknown) => {
    const message = messageOf(error);
    logger.write("error", "update.failed", { error: message });
    const shouldRetry = enabled && status.autoCheck && retryAttempt < RETRY_DELAYS_MS.length;
    update({ phase: "error", error: message, progressPercent: null, canInstall: false });
    if (shouldRetry) {
      const delay = RETRY_DELAYS_MS[retryAttempt];
      retryAttempt += 1;
      scheduleRetry(delay);
    }
  };

  async function check(): Promise<UpdateStatus> {
    if (!enabled) {
      update({ phase: "idle", error: "自动更新仅在打包后的桌面版可用" });
      return snapshot();
    }
    if (status.phase === "checking" || status.phase === "downloading" || status.phase === "installing") {
      return snapshot();
    }
    logger.write("info", "update.checking");
    update({ phase: "checking", error: null, lastCheckedAt: now().toISOString() });
    try {
      await updater.checkForUpdates();
      retryAttempt = 0;
      if (snapshot().phase === "checking") update({ phase: "up-to-date" });
    } catch (error) {
      handleError(error);
    }
    return snapshot();
  }

  async function install(password?: string): Promise<UpdateStatus> {
    if (!enabled) throw new Error("自动更新仅在打包后的桌面版可用");
    if (status.phase !== "downloaded") throw new Error("当前没有已下载的更新");
    if (hasActiveGeneration()) throw new Error("正在生成正文，请等待任务完成或取消后再安装更新");
    const provided = password?.trim();
    const effective = provided || (await readBackupPassword()) || "";
    if (!effective) throw new Error("需要备份密码才能安装更新");
    update({ phase: "installing", error: null });
    try {
      await createBackup(effective);
    } catch (error) {
      const message = messageOf(error);
      logger.write("error", "update.backup_failed", { error: message });
      update({ phase: "downloaded", error: message, canInstall: false });
      throw new Error(`安装前备份失败：${message}`);
    }
    logger.write("info", "update.installing", { version: status.availableVersion });
    updater.quitAndInstall(false, true);
    return snapshot();
  }

  function saveSettings(input: UpdateSettingsInput): UpdateStatus {
    const saved = persistSettings(input);
    update({ autoCheck: saved.autoCheck, autoInstallOnQuit: saved.autoInstallOnQuit });
    return snapshot();
  }

  function dispose() {
    if (retryTimer) clearTimeout(retryTimer);
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    retryTimer = null;
    initialTimer = null;
    intervalTimer = null;
  }

  if (enabled) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => {
      if (status.phase === "idle" || status.phase === "up-to-date" || status.phase === "error")
        update({ phase: "checking", error: null });
    });
    updater.on("update-available", (info) => {
      logger.write("info", "update.available", { version: info.version });
      update({
        phase: "available",
        availableVersion: info.version ?? null,
        releaseNotes: releaseNotesOf(info) ?? status.releaseNotes,
        error: null,
      });
    });
    updater.on("download-progress", (progress) => {
      const percent =
        typeof progress.percent === "number" ? Math.max(0, Math.min(100, Math.round(progress.percent))) : null;
      const nowMs = Date.now();
      if (nowMs - lastProgressPublish >= PROGRESS_THROTTLE_MS || percent === 100) {
        lastProgressPublish = nowMs;
        update({ phase: "downloading", progressPercent: percent });
      } else {
        status = { ...status, phase: "downloading", progressPercent: percent };
      }
    });
    updater.on("update-downloaded", (info) => {
      logger.write("info", "update.downloaded", { version: info.version });
      update({
        phase: "downloaded",
        availableVersion: info.version ?? status.availableVersion,
        progressPercent: 100,
        releaseNotes: releaseNotesOf(info) ?? status.releaseNotes,
        error: null,
      });
      void refreshReadiness();
    });
    updater.on("update-not-available", (info) => {
      logger.write("info", "update.current", { version: info.version });
      update({ phase: "up-to-date", availableVersion: null, progressPercent: null, error: null });
    });
    updater.on("error", (error) => handleError(error));

    initialTimer = setTimeout(() => {
      if (getSettings().autoCheck) void check();
    }, INITIAL_DELAY_MS);
    unref(initialTimer);
    intervalTimer = setInterval(() => {
      if (getSettings().autoCheck) void check();
    }, CHECK_INTERVAL_MS);
    unref(intervalTimer);
  }

  return {
    status: snapshot,
    check,
    install,
    saveSettings,
    dispose,
  };
}
