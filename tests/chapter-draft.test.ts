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
});
