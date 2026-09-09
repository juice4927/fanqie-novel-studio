import type { Chapter } from "../shared/types";

export function chapterDraftSignature(chapter: Chapter) {
  const { id: _id, revision: _revision, updatedAt: _updatedAt, wordCount: _wordCount, ...editable } = chapter;
  return JSON.stringify(editable);
}

export function chapterRecoveryKey(projectId: string, chapter: Chapter) {
  return `novel-studio.chapter-draft.${projectId}.${chapter.id || `new-${chapter.number}`}`;
}

export function readRecoveredChapter(
  projectId: string,
  chapter: Chapter,
  storage: Pick<Storage, "getItem"> = localStorage,
) {
  try {
    const recovered = storage.getItem(chapterRecoveryKey(projectId, chapter));
    if (!recovered) return chapter;
    const parsed = JSON.parse(recovered) as Chapter;
    if (parsed.id !== chapter.id) return chapter;
    // 尚未落库的新章没有服务端版本可比较：恢复稿只要有内容就采用。
    // 否则 EMPTY_CHAPTER 每次生成的当前时间戳会让恢复稿永远"过期"。
    if (!chapter.id) return parsed.content.trim() || parsed.outline.trim() ? parsed : chapter;
    if (parsed.revision < chapter.revision) return chapter;
    if (parsed.revision === chapter.revision) {
      const recoveredAt = Date.parse(parsed.updatedAt);
      const currentAt = Date.parse(chapter.updatedAt);
      // 时间戳非法时视为无效恢复稿，避免用陈旧内容覆盖服务端同版本内容。
      if (!Number.isFinite(recoveredAt) || !Number.isFinite(currentAt) || recoveredAt < currentAt) return chapter;
    }
    return parsed;
  } catch {
    return chapter;
  }
}

export function writeRecoveredChapter(
  projectId: string,
  chapter: Chapter,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    // 恢复稿代表本地尚未落盘的最新编辑，写入时补上时间戳，
    // 避免保存后继续输入的内容因草稿对象仍持有旧 updatedAt 而被判定过期。
    storage.setItem(
      chapterRecoveryKey(projectId, chapter),
      JSON.stringify({ ...chapter, updatedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveredChapter(
  projectId: string,
  chapter: Chapter,
  storage: Pick<Storage, "removeItem"> = localStorage,
) {
  try {
    storage.removeItem(chapterRecoveryKey(projectId, chapter));
  } catch {
    /* storage unavailable */
  }
}

export class AutosaveCoordinator {
  private pending: { chapter: Chapter; save: (chapter: Chapter) => Promise<Chapter>; explicit: boolean } | null = null;
  private pendingAutosave: Chapter | null = null;
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
    private readonly onError: (error: unknown, willRetry: boolean) => void,
    private readonly retryDelayMs = 1500,
    private readonly maxRetries = 3,
  ) {}

  private retryCount = 0;

  enqueue(chapter: Chapter) {
    if (this.stopped) return;
    const snapshot = { ...chapter };
    if (this.pending?.explicit || this.running) this.pendingAutosave = snapshot;
    else this.pending = { chapter: snapshot, save: this.save, explicit: false };
    void this.flush();
  }

  saveLatest(chapter: Chapter, save: (chapter: Chapter) => Promise<Chapter> = this.save) {
    if (this.stopped) return Promise.reject(new Error("自动保存已停止"));
    const snapshot = { ...chapter };
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pending = { chapter: snapshot, save, explicit: true };
    this.pendingAutosave = null;
    const signature = chapterDraftSignature(snapshot);
    const promise = new Promise<Chapter>((resolve, reject) => {
      this.waiters.push({ signature, resolve, reject });
    });
    void this.flush();
    return promise;
  }

  private async flush() {
    if (this.running || !this.pending || this.stopped) return;
    const request = this.pending;
    const snapshot = request.chapter;
    this.pending = null;
    this.running = true;
    try {
      const saved = await request.save(snapshot);
      this.retryCount = 0;
      if (!this.stopped) {
        this.onSaved(snapshot, saved);
        const signature = chapterDraftSignature(snapshot);
        const queued = this.pending as { explicit: boolean } | null;
        const completed = queued?.explicit
          ? this.waiters.filter((waiter) => waiter.signature === signature)
          : this.waiters;
        this.waiters = this.waiters.filter((waiter) => !completed.includes(waiter));
        completed.forEach((waiter) => {
          waiter.resolve(saved);
        });
      }
    } catch (error) {
      if (this.stopped) return;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /busy|locked|timeout|temporar|EAGAIN|EBUSY|disk busy|暂时|超时|繁忙|占用|连接中断/i.test(
        message,
      );
      const willRetry = transient && this.retryCount < this.maxRetries;
      this.onError(error, willRetry);
      if (willRetry) {
        this.retryCount += 1;
        this.pending ??= request;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.flush();
        }, this.retryDelayMs);
      } else {
        this.retryCount = 0;
        const terminal = error instanceof Error ? error : new Error(message);
        const failed = this.waiters.splice(0);
        failed.forEach((waiter) => {
          waiter.reject(terminal);
        });
      }
    } finally {
      this.running = false;
      if (!this.pending && this.pendingAutosave) {
        this.pending = { chapter: this.pendingAutosave, save: this.save, explicit: false };
        this.pendingAutosave = null;
      }
      if (this.pending && !this.retryTimer) void this.flush();
    }
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const error = new Error("自动保存已停止");
    this.waiters.splice(0).forEach((waiter) => {
      waiter.reject(error);
    });
  }
}
