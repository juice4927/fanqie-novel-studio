import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import type { HealthCheckTask, ProjectDetail, SystemHealthReport } from "../../src/shared/types";
import {
  autoBackupFileName,
  createEncryptedBackup,
  nextAutoBackupAt,
  pruneAutoBackups,
  restoreEncryptedBackup,
} from "../backup";
import { deleteAutoBackupCredential, readAutoBackupCredential, writeAutoBackupCredential } from "../credential-store";
import { now, type WorkspaceDatabase } from "../database";
import type { BackgroundWorker } from "../worker-client";
import type { RegisterHandler } from "./types";

type SystemDatabase = Pick<
  WorkspaceDatabase,
  | "backupRoot"
  | "checkpointAll"
  | "finishAutoBackup"
  | "getAutoBackupSettings"
  | "getChapter"
  | "getProjectOverview"
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
  chooseDiagnosticDestination: (defaultFileName: string) => Promise<string | null>;
  confirmDiagnosticExport?: () => Promise<boolean>;
  chooseProjectExportDestination: (defaultFileName: string, format: "txt" | "md" | "docx") => Promise<string | null>;
}

export interface SystemHandlerRuntime {
  runAutomaticBackup: (force?: boolean) => Promise<ReturnType<SystemDatabase["getAutoBackupSettings"]>>;
}

const exportableChapterStatuses = new Set(["已定稿", "待发布", "已发布"]);

async function exportProject(
  database: Pick<SystemDatabase, "getChapter" | "getProjectOverview">,
  projectId: string,
  format: "txt" | "md" | "docx",
  chooseDestination: SystemHandlerDependencies["chooseProjectExportDestination"],
) {
  const project = database.getProjectOverview(projectId);
  const chapterMetadata = project.chapters.filter((chapter) => exportableChapterStatuses.has(chapter.status));
  if (!chapterMetadata.length) throw new Error("没有可导出的已定稿章节");
  const destination = await chooseDestination(`${project.summary.title}-发布包.${format}`, format);
  if (!destination) return null;
  const chapters = chapterMetadata.map((chapter) => database.getChapter(projectId, chapter.id));
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
    await writeFile(destination, await Packer.toBuffer(document));
  } else {
    const text = chapters
      .map((chapter) =>
        format === "md"
          ? `# 第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`
          : `第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`,
      )
      .join("\n\n");
    await writeFile(destination, text, "utf8");
  }
  await writeFile(
    `${destination.slice(0, -path.extname(destination).length)}-检查报告.md`,
    buildPublishingReport(project, chapters.length),
    "utf8",
  );
  return destination;
}

function buildPublishingReport(project: ProjectDetail, chapterCount: number) {
  const pending = project.issues.filter((issue) => issue.status === "待处理");
  const conflicts = project.facts.filter((fact) => fact.confidence === "有冲突");
  return [
    `# ${project.summary.title} 发布前检查报告`,
    "",
    `- 生成时间：${new Date().toLocaleString("zh-CN")}`,
    `- 导出章节：${chapterCount} 章`,
    `- 创作契约：${project.contract.approved ? `已审批 v${project.contract.version}` : "未审批"}`,
    `- 已批准卷纲：${project.plans.filter((plan) => plan.kind === "分卷" && plan.status === "已批准").length}`,
    `- 未处理硬性问题：${pending.filter((issue) => issue.severity === "硬性").length}`,
    `- 其他待处理问题：${pending.filter((issue) => issue.severity !== "硬性").length}`,
    `- 冲突事实：${conflicts.length}`,
    "",
    "## 待处理问题",
    "",
    ...(pending.length
      ? pending.map((issue) => `- [${issue.severity}] ${issue.category}：${issue.message}`)
      : ["- 无"]),
    "",
    "## 冲突事实",
    "",
    ...(conflicts.length
      ? conflicts.map(
          (fact) => `- ${fact.subject} / ${fact.predicate}：${fact.value}（证据第${fact.evidenceChapter}章）`,
        )
      : ["- 无"]),
    "",
    "> 本报告只辅助人工发布检查，不代表平台审核结论。",
  ].join("\n");
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
  confirmDiagnosticExport,
  chooseProjectExportDestination,
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
    const completed = [...healthTaskFinishedAt.entries()].sort((left, right) => right[1] - left[1]);
    for (const [id] of completed.slice(100)) {
      healthTaskFinishedAt.delete(id);
      healthTasks.delete(id);
    }
  };

  const runAutomaticBackup = async (force = false) => {
    const settings = database.getAutoBackupSettings();
    if (!settings.enabled || autoBackupRunning) return settings;
    if (!force && settings.nextRunAt && Date.parse(settings.nextRunAt) > Date.now()) {
      return settings;
    }
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
          if (task?.status === "运行中") healthTasks.set(id, { ...task, ...progress });
        },
      },
    );

  register("createBackup", async (password) => {
    const destination = await chooseBackupDestination(`长篇创作工作台-${now().slice(0, 10)}.novelbak`);
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
    if (input.enabled && !password && !currentPassword) throw new Error("启用自动备份需要设置至少 8 位的专用密码");
    if (password) await writeAutoBackupCredential(password);
    if (!input.enabled) await deleteAutoBackupCredential();
    const saved = database.saveAutoBackupSettings(input, input.enabled ? nextAutoBackupAt(input.frequency) : null);
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
    const running = [...healthTasks.values()].find((task) => task.status === "运行中");
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
    if (task?.status !== "运行中") return false;
    healthTasks.set(id, { ...task, status: "已取消", label: "正在取消" });
    return worker.cancel(id);
  });
  register("rebuildSearchIndexes", async (projectId) => {
    database.rebuildSearchIndexes(projectId, false);
    return runHealthCheck(randomUUID());
  });
  register("exportDiagnosticBundle", async () => {
    if (confirmDiagnosticExport && !(await confirmDiagnosticExport())) return null;
    const destination = await chooseDiagnosticDestination(`长篇创作工作台-诊断-${now().slice(0, 10)}.zip`);
    if (!destination) return null;
    const zip = new JSZip();
    zip.file("system.json", JSON.stringify({ ...getSystemMetadata(), generatedAt: now() }, null, 2));
    zip.file("health.json", JSON.stringify(database.runSystemHealthCheck(), null, 2));
    try {
      zip.file("application.jsonl", await readFile(logFilePath, "utf8"));
    } catch {
      zip.file("application.jsonl", "");
    }
    await writeFile(destination, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    return destination;
  });
  register("exportProject", (projectId, format) =>
    exportProject(database, projectId, format, chooseProjectExportDestination),
  );
  register("getWorkspacePath", () => database.root);

  return { runAutomaticBackup };
}
