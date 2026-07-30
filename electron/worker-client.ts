import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";

export class BackgroundWorker {
  private worker: Worker;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; onProgress?: (value: unknown) => void }>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn() {
    const worker = new Worker(path.join(__dirname, "worker.cjs"));
    worker.on("message", (message: { id: string; ok?: boolean; progress?: unknown; result?: unknown; error?: string }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.progress) {
        pending.onProgress?.(message.progress);
        return;
      }
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error ?? "后台任务失败"));
    });
    worker.on("error", (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    worker.on("exit", (code) => {
      if (code !== 0) this.worker = this.spawn();
    });
    return worker;
  }

  run<T>(task: "parse-document" | "quality-check" | "system-health", payload: unknown, options: { id?: string; onProgress?: (value: unknown) => void } = {}): Promise<T> {
    const id = options.id ?? randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress: options.onProgress });
      this.worker.postMessage({ id, task, payload });
    });
  }

  cancel(id: string) {
    if (!this.pending.has(id)) return false;
    this.worker.postMessage({ id, cancel: true });
    return true;
  }

  close() {
    return this.worker.terminate();
  }
}
