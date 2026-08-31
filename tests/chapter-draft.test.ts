import { describe, expect, it, vi } from "vitest";
import { AutosaveCoordinator, chapterRecoveryKey, readRecoveredChapter, writeRecoveredChapter } from "../src/lib/chapter-draft";
import type { Chapter } from "../src/shared/types";

const chapter = (content: string, id = "chapter-1"): Chapter => ({
  id, number: 1, title: "第一章", outline: "推进", content, wordCount: content.length,
  status: "草稿", batchMode: "逐章", isKeyChapter: false, revision: 1, updatedAt: new Date().toISOString(),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("chapter draft reliability", () => {
  it("serializes in-flight saves and persists the newest rapid edit", async () => {
    const first = deferred<Chapter>();
    const saved: string[] = [];
    const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (value: Chapter) => value);
    const coordinator = new AutosaveCoordinator(save, (snapshot) => saved.push(snapshot.content), vi.fn());
    coordinator.enqueue(chapter("一"));
    coordinator.enqueue(chapter("二"));
    coordinator.enqueue(chapter("三"));
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve(chapter("一"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(saved).toEqual(["一", "三"]));
  });

  it("retries a failed autosave without requiring another keystroke", async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(new Error("disk busy")).mockImplementation(async (value: Chapter) => value);
    const coordinator = new AutosaveCoordinator(save, (snapshot) => saved.push(snapshot.content), vi.fn(), 50);
    coordinator.enqueue(chapter("需要重试"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(saved).toEqual(["需要重试"]));
    vi.useRealTimers();
  });

  it("ignores a completed request after switching chapters and recovers local drafts", async () => {
    const pending = deferred<Chapter>();
    const onSaved = vi.fn();
    const coordinator = new AutosaveCoordinator(() => pending.promise, onSaved, vi.fn());
    coordinator.enqueue(chapter("旧章"));
    coordinator.stop();
    pending.resolve(chapter("旧章"));
    await Promise.resolve();
    expect(onSaved).not.toHaveBeenCalled();
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeRecoveredChapter("project", chapter("崩溃前草稿"), storage);
    expect(values.has(chapterRecoveryKey("project", chapter("")))).toBe(true);
    expect(readRecoveredChapter("project", chapter("服务端旧稿"), storage).content).toBe("崩溃前草稿");
  });

  it("reports when the local recovery copy cannot be written", () => {
    const storage = { setItem: () => { throw new Error("quota exceeded"); } };
    expect(writeRecoveredChapter("project", chapter("无法落盘"), storage)).toBe(false);
  });

  it("does not let an older recovery copy replace a newer server revision", () => {
    const values = new Map<string, string>();
    const server = { ...chapter("服务器新稿"), revision: 3, updatedAt: "2026-08-01T03:00:00.000Z" };
    const stale = { ...chapter("本地旧稿"), revision: 2, updatedAt: "2026-08-01T02:00:00.000Z" };
    values.set(chapterRecoveryKey("project", server), JSON.stringify(stale));
    expect(readRecoveredChapter("project", server, { getItem: (key) => values.get(key) ?? null })).toBe(server);
  });

  it("lets an explicit action wait until the newest draft wins an in-flight autosave race", async () => {
    const first = deferred<Chapter>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (value: Chapter) => value);
    const coordinator = new AutosaveCoordinator(save, vi.fn(), vi.fn());
    coordinator.enqueue(chapter("旧内容"));
    const latest = coordinator.saveLatest(chapter("生成前最新内容"));
    first.resolve(chapter("旧内容"));
    await expect(latest).resolves.toMatchObject({ content: "生成前最新内容" });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("resolves coalesced explicit saves with the final persisted draft", async () => {
    const first = deferred<Chapter>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (value: Chapter) => value);
    const coordinator = new AutosaveCoordinator(save, vi.fn(), vi.fn());
    coordinator.enqueue(chapter("自动保存中"));
    const earlier = coordinator.saveLatest(chapter("较早操作"));
    const final = coordinator.saveLatest(chapter("最终操作"));
    first.resolve(chapter("自动保存中"));
    await expect(Promise.all([earlier, final])).resolves.toEqual([
      expect.objectContaining({ content: "最终操作" }),
      expect.objectContaining({ content: "最终操作" }),
    ]);
  });

  it("rejects persistent failures instead of retrying forever", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error("参数无效：content 超过上限"));
    const onError = vi.fn();
    const coordinator = new AutosaveCoordinator(save, vi.fn(), onError, 50);
    const explicit = coordinator.saveLatest(chapter("过长正文"));
    await expect(explicit).rejects.toThrow("超过上限");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), false);
    vi.useRealTimers();
  });
});
