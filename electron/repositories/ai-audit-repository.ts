import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AiJobRecord } from "../../src/shared/types";

const now = () => new Date().toISOString();

export class AiAuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  recoverInterrupted() {
    this.db.prepare("UPDATE ai_jobs SET status = '已中断', error = '应用退出时任务仍在运行，可重新执行原操作', updated_at = ? WHERE status = '运行中'").run(now());
  }

  findSuccessful(taskType: string, inputHash: string, promptVersion: string, model: string) {
    const row = this.db.prepare("SELECT output FROM ai_jobs WHERE task_type = ? AND input_hash = ? AND prompt_version = ? AND model = ? AND status = '成功' ORDER BY updated_at DESC LIMIT 1")
      .get(taskType, inputHash, promptVersion, model) as { output: string | null } | undefined;
    return row?.output ?? null;
  }

  start(projectId: string | null, taskType: string, inputHash: string, promptVersion: string, provider: string, model: string, inputSummary: string, retryContext?: string) {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO ai_jobs(id, project_id, task_type, input_hash, prompt_version, provider, model, status, input_summary, output, estimated_cost, error, retry_context, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, '运行中', ?, NULL, 0, NULL, ?, ?, ?)`)
      .run(id, projectId, taskType, inputHash, promptVersion, provider, model, inputSummary, retryContext ?? null, timestamp, timestamp);
    return id;
  }

  finish(id: string, output: string, error?: string, usage?: { inputTokens: number; outputTokens: number; actualCost: number; durationMs: number; status?: "失败" | "已取消" }) {
    this.db.prepare("UPDATE ai_jobs SET status = ?, output = ?, error = ?, input_tokens = ?, output_tokens = ?, actual_cost = ?, duration_ms = ?, updated_at = ? WHERE id = ?")
      .run(error ? usage?.status ?? "失败" : "成功", error ? null : output, error ?? null, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.actualCost ?? 0, usage?.durationMs ?? 0, now(), id);
  }

  list(projectId?: string): AiJobRecord[] {
    const rows = (projectId
      ? this.db.prepare("SELECT * FROM ai_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId)
      : this.db.prepare("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT 200").all()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, taskType: String(row.task_type),
      inputSummary: String(row.input_summary), promptVersion: String(row.prompt_version), provider: String(row.provider), model: String(row.model),
      status: String(row.status) as AiJobRecord["status"], inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0),
      actualCost: Number(row.actual_cost ?? 0), durationMs: Number(row.duration_ms ?? 0), error: row.error ? String(row.error) : null,
      retryable: Boolean(row.retry_context) && ["失败", "已取消", "已中断"].includes(String(row.status)),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  retryContext(id: string) {
    const row = this.db.prepare("SELECT retry_context FROM ai_jobs WHERE id = ?").get(id) as { retry_context: string | null } | undefined;
    if (!row) throw new Error("AI 任务不存在");
    return row.retry_context;
  }

  prune(retentionDays = 90, maxRows = 5000) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const old = this.db.prepare("DELETE FROM ai_jobs WHERE status != '运行中' AND updated_at < ?").run(cutoff).changes;
    const overflow = this.db.prepare(`DELETE FROM ai_jobs WHERE id IN (
      SELECT id FROM ai_jobs WHERE status != '运行中' ORDER BY updated_at DESC LIMIT -1 OFFSET ?
    )`).run(maxRows).changes;
    return Number(old) + Number(overflow);
  }
}
