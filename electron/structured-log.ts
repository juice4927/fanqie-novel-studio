import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const SECRET_KEYS = /api[-_]?key|token|authorization|password|secret|credential/i;

export function redact(value: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[USER]");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

export class StructuredLogger {
  readonly filePath: string;
  constructor(root: string, private readonly maxBytes = 5 * 1024 * 1024) {
    mkdirSync(root, { recursive: true });
    this.filePath = path.join(root, "application.jsonl");
  }

  write(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
    if (existsSync(this.filePath) && statSync(this.filePath).size >= this.maxBytes) renameSync(this.filePath, `${this.filePath}.1`);
    appendFileSync(this.filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, data: redact(data) })}\n`, "utf8");
  }
}
