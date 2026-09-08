import { describe, expect, it, vi } from "vitest";
import { createUpdateService, type UpdaterPort } from "../electron/update-service";
import type { UpdateSettingsInput } from "../src/shared/types";

type Listener = (...args: unknown[]) => void;

function createFakeUpdater() {
  const listeners = new Map<string, Listener[]>();
  const port = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  } as unknown as UpdaterPort;
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return { port, emit };
}

function createService(overrides: Partial<Parameters<typeof createUpdateService>[0]> = {}) {
  const { port, emit } = createFakeUpdater();
  const settings: UpdateSettingsInput = { autoCheck: true, autoInstallOnQuit: false };
  const dependencies = {
    logger: { write: vi.fn() },
    updater: port,
    enabled: true,
    currentVersion: "0.2.1",
    getSettings: () => ({ ...settings }),
    saveSettings: (input: UpdateSettingsInput) => Object.assign(settings, input),
    hasBackupPassword: vi.fn(async () => true),
    readBackupPassword: vi.fn(async () => "stored-password"),
    createBackup: vi.fn(async () => undefined),
    hasActiveGeneration: vi.fn(() => false),
    publish: vi.fn(),
    now: () => new Date("2026-09-08T00:00:00.000Z"),
    ...overrides,
  };
  const service = createUpdateService(dependencies);
  return { service, emit, dependencies, settings };
}

async function downloadUpdate(
  service: ReturnType<typeof createUpdateService>,
  emit: (event: string, ...args: unknown[]) => void,
  { installable = true }: { installable?: boolean } = {},
) {
  const checking = service.check();
  emit("update-available", { version: "0.2.2", releaseNotes: "- 修复若干问题" });
  emit("download-progress", { percent: 42 });
  emit("update-downloaded", { version: "0.2.2" });
  await checking;
  await vi.waitFor(() => expect(service.status().phase).toBe("downloaded"));
  if (installable) await vi.waitFor(() => expect(service.status().canInstall).toBe(true));
}

describe("update service", () => {
  it("tracks available, downloading and downloaded states", async () => {
    const { service, emit, dependencies } = createService();
    try {
      await downloadUpdate(service, emit);
      const status = service.status();
      expect(status).toMatchObject({
        phase: "downloaded",
        currentVersion: "0.2.1",
        availableVersion: "0.2.2",
        progressPercent: 100,
        releaseNotes: "- 修复若干问题",
        canInstall: true,
        backupPasswordRequired: false,
      });
      expect(status.lastCheckedAt).toBe("2026-09-08T00:00:00.000Z");
      expect(dependencies.updater.autoDownload).toBe(true);
      expect(dependencies.publish).toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it("requires a backup password before installing", async () => {
    const { service, emit, dependencies } = createService({
      hasBackupPassword: vi.fn(async () => false),
      readBackupPassword: vi.fn(async () => null),
    });
    try {
      await downloadUpdate(service, emit, { installable: false });
      await vi.waitFor(() => expect(service.status().backupPasswordRequired).toBe(true));
      expect(service.status().canInstall).toBe(false);
      await expect(service.install()).rejects.toThrow("需要备份密码才能安装更新");
      expect(dependencies.createBackup).not.toHaveBeenCalled();
      expect(dependencies.updater.quitAndInstall).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it("installs with a one-off password after creating the snapshot", async () => {
    const { service, emit, dependencies } = createService({
      hasBackupPassword: vi.fn(async () => false),
      readBackupPassword: vi.fn(async () => null),
    });
    try {
      await downloadUpdate(service, emit, { installable: false });
      await vi.waitFor(() => expect(service.status().backupPasswordRequired).toBe(true));
      await service.install("one-off-password");
      expect(dependencies.createBackup).toHaveBeenCalledWith("one-off-password");
      expect(dependencies.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    } finally {
      service.dispose();
    }
  });

  it("refuses to install while a chapter generation is running", async () => {
    const { service, emit, dependencies } = createService({ hasActiveGeneration: vi.fn(() => true) });
    try {
      await downloadUpdate(service, emit);
      await expect(service.install()).rejects.toThrow("正在生成正文");
      expect(dependencies.createBackup).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it("keeps the downloaded package when the pre-update backup fails", async () => {
    const { service, emit, dependencies } = createService({
      createBackup: vi.fn(async () => {
        throw new Error("磁盘已满");
      }),
    });
    try {
      await downloadUpdate(service, emit);
      await expect(service.install()).rejects.toThrow("安装前备份失败：磁盘已满");
      expect(service.status()).toMatchObject({ phase: "downloaded", error: "磁盘已满", canInstall: false });
      expect(dependencies.updater.quitAndInstall).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it("reports a clear error when updates are disabled", async () => {
    const { service, dependencies } = createService({ enabled: false });
    try {
      const status = await service.check();
      expect(status.phase).toBe("idle");
      expect(status.error).toContain("打包后的桌面版");
      expect(dependencies.updater.checkForUpdates).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it("persists the auto check and quit-install switches", () => {
    const { service, settings } = createService();
    try {
      const next = service.saveSettings({ autoCheck: false, autoInstallOnQuit: true });
      expect(settings).toEqual({ autoCheck: false, autoInstallOnQuit: true });
      expect(next).toMatchObject({ autoCheck: false, autoInstallOnQuit: true });
    } finally {
      service.dispose();
    }
  });

  it("retries a failed check with backoff", async () => {
    vi.useFakeTimers();
    const { service, dependencies } = createService();
    try {
      (dependencies.updater.checkForUpdates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("网络不可达"));
      await service.check();
      expect(service.status()).toMatchObject({ phase: "error", error: "网络不可达" });
      const callsBefore = (dependencies.updater.checkForUpdates as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
      expect((dependencies.updater.checkForUpdates as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });
});
