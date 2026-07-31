import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SystemHealthReport } from "../src/shared/types";

export interface HealthScanProgress {
  completed: number;
  total: number;
  label: string;
}

export class HealthCheckCancelledError extends Error {
  constructor() {
    super("健康检查已取消");
    this.name = "HealthCheckCancelledError";
  }
}

const yieldToWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

async function directoryBytes(root: string, cancelled: () => boolean): Promise<number> {
  if (!existsSync(root)) return 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    if (cancelled()) throw new HealthCheckCancelledError();
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += (await stat(target)).size;
    }
    await yieldToWorker();
  }
  return total;
}

function openReadOnly(filePath: string) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export async function scanSystemHealth(
  root: string,
  onProgress: (progress: HealthScanProgress) => void = () => undefined,
  cancelled: () => boolean = () => false,
): Promise<SystemHealthReport> {
  const projectsRoot = path.join(root, "projects");
  const backupRoot = path.join(root, "backups");
  const catalogPath = path.join(root, "catalog.sqlite");
  const researchPath = path.join(root, "research", "research.sqlite");
  const checks: SystemHealthReport["checks"] = [];
  const catalog = openReadOnly(catalogPath);
  const projectRows = catalog.prepare("SELECT id, title FROM projects ORDER BY created_at").all() as Array<{ id: string; title: string }>;
  const total = projectRows.length + 4;
  let completed = 0;
  const advance = async (label: string) => {
    completed += 1;
    onProgress({ completed, total, label });
    await yieldToWorker();
    if (cancelled()) throw new HealthCheckCancelledError();
  };
  const addIntegrityCheck = (id: string, label: string, filePath: string, projectId: string | null) => {
    let db: DatabaseSync | null = null;
    try {
      db = openReadOnly(filePath);
      const rows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
      const messages = rows.map((row) => row.integrity_check).filter((message) => message !== "ok");
      checks.push({ id, label, status: messages.length ? "错误" : "正常", detail: messages.length ? messages.slice(0, 3).join("；") : "SQLite 完整性检查通过", projectId, repairable: false });
    } catch (error) {
      checks.push({ id, label, status: "错误", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), projectId, repairable: false });
    } finally {
      db?.close();
    }
  };

  try {
    onProgress({ completed: 0, total, label: "准备检查" });
    addIntegrityCheck("catalog-integrity", "目录数据库", catalogPath, null);
    await advance("目录数据库");
    addIntegrityCheck("research-integrity", "研究数据库", researchPath, null);
    await advance("研究数据库");
    const catalogIds = new Set(projectRows.map((row) => row.id));
    let chapterCount = 0;
    let failedAiJobs = Number((catalog.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number }).count);

    for (const row of projectRows) {
      const databasePath = path.join(projectsRoot, row.id, "project.sqlite");
      if (!existsSync(databasePath)) {
        checks.push({ id: `project-missing-${row.id}`, label: row.title, status: "错误", detail: "目录库存在作品，但项目数据库文件缺失", projectId: row.id, repairable: false });
        await advance(row.title);
        continue;
      }
      addIntegrityCheck(`project-integrity-${row.id}`, `${row.title} · 项目数据库`, databasePath, row.id);
      let db: DatabaseSync | null = null;
      try {
        db = openReadOnly(databasePath);
        const records = Number((db.prepare("SELECT COUNT(*) AS count FROM chapters").get() as { count: number }).count);
        const fts = Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_fts").get() as { count: number }).count);
        const trigram = Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_fts_tri").get() as { count: number }).count);
        chapterCount += records;
        failedAiJobs += Number((db.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number }).count);
        const indexesMatch = records === fts && records === trigram;
        checks.push({ id: `project-search-${row.id}`, label: `${row.title} · 搜索索引`, status: indexesMatch ? "正常" : "警告", detail: indexesMatch ? `${records} 章索引完整` : `章节 ${records}，全文索引 ${fts}，中文索引 ${trigram}`, projectId: row.id, repairable: !indexesMatch });
      } catch (error) {
        checks.push({ id: `project-statistics-${row.id}`, label: `${row.title} · 统计`, status: "错误", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), projectId: row.id, repairable: false });
      } finally {
        db?.close();
      }
      await advance(row.title);
    }

    if (existsSync(projectsRoot)) {
      for (const entry of await readdir(projectsRoot, { withFileTypes: true }))
        if (entry.isDirectory() && !catalogIds.has(entry.name))
          checks.push({ id: `orphan-${entry.name}`, label: "孤立项目目录", status: "警告", detail: `projects/${entry.name} 不在目录库中，未做自动处理`, projectId: null, repairable: false });
    }
    checks.push({ id: "failed-ai-jobs", label: "失败的 AI 任务", status: failedAiJobs ? "警告" : "正常", detail: failedAiJobs ? `共 ${failedAiJobs} 个失败任务，可在 AI 任务中心重试` : "没有失败的 AI 任务", projectId: null, repairable: false });
    await advance("项目目录");
    const backupBytes = await directoryBytes(backupRoot, cancelled);
    await advance("备份空间");
    const workspaceBytes = await directoryBytes(root, cancelled);
    const status = checks.some((item) => item.status === "错误") ? "错误" : checks.some((item) => item.status === "警告") ? "警告" : "正常";
    return { checkedAt: new Date().toISOString(), status, projectCount: projectRows.length, chapterCount, failedAiJobs, workspaceBytes, backupBytes, checks };
  } finally {
    catalog.close();
  }
}
