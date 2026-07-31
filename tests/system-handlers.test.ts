import { describe, expect, it, vi } from "vitest";
import {
  registerSystemHandlers,
  type SystemHandlerDependencies,
} from "../electron/handlers/system-handlers";
import type { RegisterHandler } from "../electron/handlers/types";
import type { SystemHealthReport } from "../src/shared/types";

const report: SystemHealthReport = {
  checkedAt: "2026-07-31T00:00:00.000Z",
  status: "正常",
  projectCount: 1,
  chapterCount: 5,
  failedAiJobs: 0,
  workspaceBytes: 1024,
  backupBytes: 2048,
  checks: [],
};

function createDependencies(workerRun = vi.fn(async () => report)) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    handlers.set(channel, callback);
  };
  const database = {
    root: "C:/workspace",
    backupRoot: "C:/workspace/backups",
    checkpointAll: vi.fn(),
    finishAutoBackup: vi.fn(),
    getAutoBackupSettings: vi.fn(() => ({
      enabled: false,
      frequency: "daily",
      retentionCount: 7,
      hasPassword: false,
      lastRunAt: null,
      lastStatus: "未运行",
      lastError: null,
      nextRunAt: null,
    })),
    rebuildSearchIndexes: vi.fn(),
    runSystemHealthCheck: vi.fn(() => report),
    saveAutoBackupSettings: vi.fn(),
  };
  const workerCancel = vi.fn(() => true);
  const dependencies = {
    register,
    database,
    worker: { run: workerRun, cancel: workerCancel },
    logFilePath: "C:/workspace/application.jsonl",
    getSystemMetadata: () => ({
      appVersion: "1.0.0",
      electron: "43",
      chrome: "140",
      node: "22",
      platform: "win32",
      arch: "x64",
    }),
    chooseBackupDestination: vi.fn(async () => null),
    chooseBackupSource: vi.fn(async () => null),
    chooseDiagnosticDestination: vi.fn(async () => null),
  } as unknown as SystemHandlerDependencies;
  return {
    dependencies,
    handlers,
    database,
    workerCancel,
  };
}

describe("system handlers", () => {
  it("registers the complete system surface and honors canceled file selection", async () => {
    const { dependencies, handlers, database } = createDependencies();
    registerSystemHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "cancelSystemHealthCheck",
      "createBackup",
      "exportDiagnosticBundle",
      "getAutoBackupSettings",
      "getSystemHealthCheck",
      "getWorkspacePath",
      "rebuildSearchIndexes",
      "restoreBackup",
      "runAutoBackup",
      "runSystemHealthCheck",
      "saveAutoBackupSettings",
      "startSystemHealthCheck",
    ]);
    expect(handlers.get("getWorkspacePath")!()).toBe("C:/workspace");
    await expect(handlers.get("createBackup")!("password")).resolves.toBeNull();
    expect(database.checkpointAll).not.toHaveBeenCalled();
  });

  it("deduplicates a running health task and retains progress through completion", async () => {
    let resolveHealth!: (value: SystemHealthReport) => void;
    let onProgress!: (value: unknown) => void;
    const healthPromise = new Promise<SystemHealthReport>((resolve) => {
      resolveHealth = resolve;
    });
    const workerRun = vi.fn(
      (_task: string, _payload: unknown, options: { onProgress: (value: unknown) => void }) => {
        onProgress = options.onProgress;
        return healthPromise;
      },
    );
    const { dependencies, handlers } = createDependencies(workerRun);
    registerSystemHandlers(dependencies);

    const first = handlers.get("startSystemHealthCheck")!() as { id: string };
    const second = handlers.get("startSystemHealthCheck")!() as { id: string };
    expect(second.id).toBe(first.id);
    expect(workerRun).toHaveBeenCalledTimes(1);

    onProgress({ completed: 2, total: 4, label: "检查项目数据库" });
    expect(handlers.get("getSystemHealthCheck")!(first.id)).toMatchObject({
      status: "运行中",
      completed: 2,
      total: 4,
      label: "检查项目数据库",
    });

    resolveHealth(report);
    await healthPromise;
    await Promise.resolve();
    expect(handlers.get("getSystemHealthCheck")!(first.id)).toMatchObject({
      status: "完成",
      completed: 4,
      report,
    });
  });

  it("marks a running health task canceled before delegating cancellation", () => {
    const workerRun = vi.fn(() => new Promise<SystemHealthReport>(() => {}));
    const { dependencies, handlers, workerCancel } = createDependencies(workerRun);
    registerSystemHandlers(dependencies);
    const task = handlers.get("startSystemHealthCheck")!() as { id: string };

    expect(handlers.get("cancelSystemHealthCheck")!(task.id)).toBe(true);
    expect(workerCancel).toHaveBeenCalledWith(task.id);
    expect(handlers.get("getSystemHealthCheck")!(task.id)).toMatchObject({
      status: "已取消",
      label: "正在取消",
    });
  });
});
