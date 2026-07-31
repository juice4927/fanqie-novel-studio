import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AiJobRecord } from "../../src/shared/types";

const now = () => new Date().toISOString();

function hydrateAiJob(row: Record<string, unknown>): AiJobRecord {
  return {
    id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, taskType: String(row.task_type),
    inputSummary: String(row.input_summary), promptVersion: String(row.prompt_version), provider: String(row.provider), model: String(row.model),
    status: String(row.status) as AiJobRecord["status"], inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0),
    actualCost: Number(row.actual_cost ?? 0), durationMs: Number(row.duration_ms ?? 0),
    headersAt: row.headers_at ? String(row.headers_at) : null, firstTokenAt: row.first_token_at ? String(row.first_token_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null, chunkCount: Number(row.chunk_count ?? 0), attemptCount: Number(row.attempt_count ?? 0),
    error: row.error ? String(row.error) : null,
    retryable: Boolean(row.retry_context) && ["失败", "已取消", "已中断"].includes(String(row.status)),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export interface AiJobCompletion {
  inputTokens: number;
  outputTokens: number;
  actualCost: number;
  durationMs: number;
  status?: "失败" | "已取消";
  headersAt?: string | null;
  firstTokenAt?: string | null;
  completedAt?: string | null;
  chunkCount?: number;
  attemptCount?: number;
}

export class AiAuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  recoverInterrupted() {
    this.db.prepare("UPDATE ai_jobs SET status = '已中断', error = '应用退出时任务仍在运行，可重新执行原操作', updated_at = ? WHERE status = '运行中'").run(now());
  }

  findSuccessful(taskType: string, inputHash: string, promptVersion: string, provider: string, model: string) {
    const row = this.db.prepare("SELECT output FROM ai_jobs WHERE task_type = ? AND input_hash = ? AND prompt_version = ? AND provider = ? AND model = ? AND status = '成功' ORDER BY updated_at DESC LIMIT 1")
      .get(taskType, inputHash, promptVersion, provider, model) as { output: string | null } | undefined;
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

  updateTelemetry(id: string, telemetry: Pick<AiJobCompletion, "headersAt" | "firstTokenAt" | "chunkCount" | "attemptCount">) {
    this.db.prepare(`UPDATE ai_jobs SET
      headers_at = COALESCE(headers_at, ?), first_token_at = COALESCE(first_token_at, ?),
      chunk_count = ?, attempt_count = ?, updated_at = ? WHERE id = ?`)
      .run(telemetry.headersAt ?? null, telemetry.firstTokenAt ?? null, telemetry.chunkCount ?? 0, telemetry.attemptCount ?? 0, now(), id);
  }

  finish(id: string, output: string, error?: string, usage?: AiJobCompletion) {
    this.db.prepare(`UPDATE ai_jobs SET status = ?, output = ?, error = ?, input_tokens = ?, output_tokens = ?,
      actual_cost = ?, duration_ms = ?, headers_at = COALESCE(headers_at, ?), first_token_at = COALESCE(first_token_at, ?),
      completed_at = ?, chunk_count = ?, attempt_count = ?, updated_at = ? WHERE id = ?`)
      .run(error ? usage?.status ?? "失败" : "成功", error ? null : output, error ?? null,
        usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.actualCost ?? 0, usage?.durationMs ?? 0,
        usage?.headersAt ?? null, usage?.firstTokenAt ?? null, usage?.completedAt ?? now(),
        usage?.chunkCount ?? 0, usage?.attemptCount ?? 0, now(), id);
  }

  list(projectId?: string): AiJobRecord[] {
    const rows = (projectId
      ? this.db.prepare("SELECT * FROM ai_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId)
      : this.db.prepare("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT 200").all()) as Array<Record<string, unknown>>;
    return rows.map(hydrateAiJob);
  }

  get(id: string): AiJobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM ai_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? hydrateAiJob(row) : undefined;
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
