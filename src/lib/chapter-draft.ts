import type { Chapter } from "../shared/types";

export function chapterDraftSignature(chapter: Chapter) {
  const { id: _id, revision: _revision, updatedAt: _updatedAt, wordCount: _wordCount, ...editable } = chapter;
  return JSON.stringify(editable);
}

export function chapterRecoveryKey(projectId: string, chapter: Chapter) {
  return `novel-studio.chapter-draft.${projectId}.${chapter.id || `new-${chapter.number}`}`;
}

export function readRecoveredChapter(projectId: string, chapter: Chapter, storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    const recovered = storage.getItem(chapterRecoveryKey(projectId, chapter));
    return recovered ? JSON.parse(recovered) as Chapter : chapter;
  } catch {
    return chapter;
  }
}

export function writeRecoveredChapter(projectId: string, chapter: Chapter, storage: Pick<Storage, "setItem"> = localStorage) {
  try { storage.setItem(chapterRecoveryKey(projectId, chapter), JSON.stringify(chapter)); return true; } catch { return false; }
}

export function clearRecoveredChapter(projectId: string, chapter: Chapter, storage: Pick<Storage, "removeItem"> = localStorage) {
  try { storage.removeItem(chapterRecoveryKey(projectId, chapter)); } catch { /* storage unavailable */ }
}

export class AutosaveCoordinator {
  private pending: Chapter | null = null;
  private running = false;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: Array<{
    signature: string;
    resolve: (chapter: Chapter) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private readonly save: (chapter: Chapter) => Promise<Chapter>,
    private readonly onSaved: (snapshot: Chapter, saved: Chapter) => void,
    private readonly onError: (error: unknown) => void,
    private readonly retryDelayMs = 1500,
  ) {}

  enqueue(chapter: Chapter) {
    if (this.stopped) return;
    this.pending = { ...chapter };
    void this.flush();
  }

  saveLatest(chapter: Chapter) {
    if (this.stopped) return Promise.reject(new Error("自动保存已停止"));
    const snapshot = { ...chapter };
    this.pending = snapshot;
    const signature = chapterDraftSignature(snapshot);
    const promise = new Promise<Chapter>((resolve, reject) => {
      this.waiters.push({ signature, resolve, reject });
    });
    void this.flush();
    return promise;
  }

  private async flush() {
    if (this.running || !this.pending || this.stopped) return;
    const snapshot = this.pending;
    this.pending = null;
    this.running = true;
    try {
      const saved = await this.save(snapshot);
      if (!this.stopped) {
        this.onSaved(snapshot, saved);
        const signature = chapterDraftSignature(snapshot);
        const completed = this.pending
          ? this.waiters.filter((waiter) => waiter.signature === signature)
          : this.waiters;
        this.waiters = this.waiters.filter((waiter) => !completed.includes(waiter));
        completed.forEach((waiter) => waiter.resolve(saved));
      }
    } catch (error) {
      if (this.stopped) return;
      this.pending ??= snapshot;
      this.onError(error);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.flush();
      }, this.retryDelayMs);
    } finally {
      this.running = false;
      if (this.pending && !this.retryTimer) void this.flush();
    }
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const error = new Error("自动保存已停止");
    this.waiters.splice(0).forEach((waiter) => waiter.reject(error));
  }
}
