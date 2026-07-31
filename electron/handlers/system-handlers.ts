import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type {
  HealthCheckTask,
  SystemHealthReport,
} from "../../src/shared/types";
import {
  autoBackupFileName,
  createEncryptedBackup,
  nextAutoBackupAt,
  pruneAutoBackups,
  restoreEncryptedBackup,
} from "../backup";
import {
  deleteAutoBackupCredential,
  readAutoBackupCredential,
  writeAutoBackupCredential,
} from "../credential-store";
import { now, type WorkspaceDatabase } from "../database";
import type { BackgroundWorker } from "../worker-client";
import type { RegisterHandler } from "./types";

type SystemDatabase = Pick<
  WorkspaceDatabase,
  | "backupRoot"
  | "checkpointAll"
  | "finishAutoBackup"
  | "getAutoBackupSettings"
  | "rebuildSearchIndexes"
  | "root"
  | "runSystemHealthCheck"
  | "saveAutoBackupSettings"
>;

interface SystemMetadata {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

export interface SystemHandlerDependencies {
  register: RegisterHandler;
  database: SystemDatabase;
  worker: Pick<BackgroundWorker, "cancel" | "run">;
  logFilePath: string;
  getSystemMetadata: () => SystemMetadata;
  chooseBackupDestination: (defaultFileName: string) => Promise<string | null>;
  chooseBackupSource: () => Promise<string | null>;
  chooseDiagnosticDestination: (
    defaultFileName: string,
  ) => Promise<string | null>;
}

export interface SystemHandlerRuntime {
  runAutomaticBackup: (force?: boolean) => Promise<
    ReturnType<SystemDatabase["getAutoBackupSettings"]>
  >;
}

export function registerSystemHandlers({
  register,
  database,
  worker,
  logFilePath,
  getSystemMetadata,
  chooseBackupDestination,
  chooseBackupSource,
  chooseDiagnosticDestination,
}: SystemHandlerDependencies): SystemHandlerRuntime {
  let autoBackupRunning = false;
  const healthTasks = new Map<string, HealthCheckTask>();
  const healthTaskFinishedAt = new Map<string, number>();

  const pruneHealthTasks = () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, finishedAt] of healthTaskFinishedAt) {
      if (finishedAt < cutoff) {
        healthTaskFinishedAt.delete(id);
        healthTasks.delete(id);
      }
    }
    const completed = [...healthTaskFinishedAt.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    for (const [id] of completed.slice(100)) {
      healthTaskFinishedAt.delete(id);
      healthTasks.delete(id);
    }
  };

  const runAutomaticBackup = async (force = false) => {
    const settings = database.getAutoBackupSettings();
    if (!settings.enabled || autoBackupRunning) return settings;
    if (
      !force &&
      settings.nextRunAt &&
      Date.parse(settings.nextRunAt) > Date.now()
    ) {
      return settings;
    }
    autoBackupRunning = true;
    try {
      const password = await readAutoBackupCredential();
      if (!password)
        throw new Error("自动备份密码不存在，请在系统设置中重新保存");
      database.checkpointAll();
      const destination = path.join(database.backupRoot, autoBackupFileName());
      await createEncryptedBackup(database.root, destination, password);
      await pruneAutoBackups(
        database.backupRoot,
        settings.retentionCount,
      );
      return database.finishAutoBackup(
        "成功",
        nextAutoBackupAt(settings.frequency),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return database.finishAutoBackup(
        "失败",
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        message,
      );
    } finally {
      autoBackupRunning = false;
    }
  };

  const runHealthCheck = (id: string) =>
    worker.run<SystemHealthReport>(
      "system-health",
      { root: database.root },
      {
        id,
        onProgress: (value) => {
          const progress = value as {
            completed: number;
            total: number;
            label: string;
          };
          const task = healthTasks.get(id);
          if (task?.status === "运行中")
            healthTasks.set(id, { ...task, ...progress });
        },
      },
    );

  register("createBackup", async (password) => {
    const destination = await chooseBackupDestination(
      `长篇创作工作台-${now().slice(0, 10)}.novelbak`,
    );
    if (!destination) return null;
    database.checkpointAll();
    await createEncryptedBackup(database.root, destination, password);
    return destination;
  });
  register("restoreBackup", async (password) => {
    const source = await chooseBackupSource();
    if (!source) return null;
    return restoreEncryptedBackup(source, database.root, password);
  });
  register("getAutoBackupSettings", async () => ({
    ...database.getAutoBackupSettings(),
    hasPassword: Boolean(await readAutoBackupCredential()),
  }));
  register("saveAutoBackupSettings", async (input, password) => {
    const currentPassword = await readAutoBackupCredential();
    if (input.enabled && !password && !currentPassword)
      throw new Error("启用自动备份需要设置至少 8 位的专用密码");
    if (password) await writeAutoBackupCredential(password);
    if (!input.enabled) await deleteAutoBackupCredential();
    const saved = database.saveAutoBackupSettings(
      input,
      input.enabled ? nextAutoBackupAt(input.frequency) : null,
    );
    return {
      ...saved,
      hasPassword: input.enabled && Boolean(password || currentPassword),
    };
  });
  register("runAutoBackup", async () => ({
    ...(await runAutomaticBackup(true)),
    hasPassword: Boolean(await readAutoBackupCredential()),
  }));
  register("runSystemHealthCheck", () => runHealthCheck(randomUUID()));
  register("startSystemHealthCheck", () => {
    pruneHealthTasks();
    const running = [...healthTasks.values()].find(
      (task) => task.status === "运行中",
    );
    if (running) return running;
    const id = randomUUID();
    const task: HealthCheckTask = {
      id,
      status: "运行中",
      completed: 0,
      total: 1,
      label: "准备检查",
      report: null,
      error: null,
    };
    healthTasks.set(id, task);
    void runHealthCheck(id)
      .then((report) => {
        const current = healthTasks.get(id);
        if (current?.status === "运行中") {
          healthTasks.set(id, {
            ...current,
            status: "完成",
            completed: current.total,
            label: "检查完成",
            report,
          });
          healthTaskFinishedAt.set(id, Date.now());
        }
      })
      .catch((error) => {
        const current = healthTasks.get(id);
        const message = error instanceof Error ? error.message : String(error);
        if (current) {
          healthTasks.set(id, {
            ...current,
            status: message === "健康检查已取消" ? "已取消" : "失败",
            error: message,
          });
          healthTaskFinishedAt.set(id, Date.now());
        }
      });
    return task;
  });
  register("getSystemHealthCheck", (id) => {
    const task = healthTasks.get(id);
    if (!task) throw new Error("健康检查任务不存在");
    return task;
  });
  register("cancelSystemHealthCheck", (id) => {
    const task = healthTasks.get(id);
    if (!task || task.status !== "运行中") return false;
    healthTasks.set(id, { ...task, status: "已取消", label: "正在取消" });
    return worker.cancel(id);
  });
  register("rebuildSearchIndexes", async (projectId) => {
    database.rebuildSearchIndexes(projectId, false);
    return runHealthCheck(randomUUID());
  });
  register("exportDiagnosticBundle", async () => {
    const destination = await chooseDiagnosticDestination(
      `长篇创作工作台-诊断-${now().slice(0, 10)}.zip`,
    );
    if (!destination) return null;
    const zip = new JSZip();
    zip.file(
      "system.json",
      JSON.stringify(
        { ...getSystemMetadata(), generatedAt: now() },
        null,
        2,
      ),
    );
    zip.file(
      "health.json",
      JSON.stringify(database.runSystemHealthCheck(), null, 2),
    );
    try {
      zip.file("application.jsonl", await readFile(logFilePath, "utf8"));
    } catch {
      zip.file("application.jsonl", "");
    }
    await writeFile(
      destination,
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    return destination;
  });
  register("getWorkspacePath", () => database.root);

  return { runAutomaticBackup };
}
