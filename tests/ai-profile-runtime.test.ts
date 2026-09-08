import { describe, expect, it } from "vitest";
import { createProfileRuntime } from "../electron/ai/profile-runtime";

describe("来源熔断与并发", () => {
  it("连续可重试失败达到阈值后熔断，成功后重置", () => {
    const runtime = createProfileRuntime({ failureThreshold: 2, cooldownMs: 60_000 });

    runtime.noteFailure("p1", "主力", true);
    expect(() => runtime.assertReady("p1", "主力")).not.toThrow();

    runtime.noteFailure("p1", "主力", true);
    expect(() => runtime.assertReady("p1", "主力")).toThrow(/暂停服务/);
    expect(runtime.snapshot()).toEqual([{ profileId: "p1", failures: 2, degradedUntil: expect.any(String) }]);

    runtime.noteSuccess("p1");
    expect(() => runtime.assertReady("p1", "主力")).not.toThrow();
    expect(runtime.snapshot()).toEqual([]);
  });

  it("非可重试失败不触发熔断", () => {
    const runtime = createProfileRuntime({ failureThreshold: 1 });
    runtime.noteFailure("p1", "主力", false);
    expect(() => runtime.assertReady("p1", "主力")).not.toThrow();
  });

  it("并发达到上限时排队，释放后唤醒", async () => {
    const runtime = createProfileRuntime({ maxConcurrent: 1, maxWaitMs: 1000 });
    const controller = new AbortController();

    const releaseFirst = await runtime.acquire("p1", "主力", controller.signal);
    let acquired = false;
    const pending = runtime.acquire("p1", "主力", controller.signal).then((release) => {
      acquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquired).toBe(false);

    releaseFirst();
    const releaseSecond = await pending;
    expect(acquired).toBe(true);
    releaseSecond();
  });

  it("等待超时与取消都会拒绝", async () => {
    const runtime = createProfileRuntime({ maxConcurrent: 1, maxWaitMs: 20 });
    const controller = new AbortController();
    const release = await runtime.acquire("p1", "主力", controller.signal);

    await expect(runtime.acquire("p1", "主力", controller.signal)).rejects.toThrow(/并发已达上限/);

    const aborter = new AbortController();
    const waiting = runtime.acquire("p1", "主力", aborter.signal);
    aborter.abort();
    await expect(waiting).rejects.toThrow(/已取消/);

    release();
  });
});
