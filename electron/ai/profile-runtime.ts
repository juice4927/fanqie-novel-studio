import type { AiProfileHealth } from "../../src/shared/ai/types";

export type ProfileHealthSnapshot = AiProfileHealth;

export interface ProfileRuntime {
  /** 熔断期内直接拒绝，避免继续打一个正在失败的服务。 */
  assertReady(profileId: string, label: string): void;
  /** 取得一个并发槽位；超时或取消时拒绝。返回释放函数。 */
  acquire(profileId: string, label: string, signal: AbortSignal): Promise<() => void>;
  noteSuccess(profileId: string): void;
  noteFailure(profileId: string, label: string, retryable: boolean): void;
  snapshot(): ProfileHealthSnapshot[];
}

export interface ProfileRuntimeOptions {
  /** 同一来源同时在途的请求上限。 */
  maxConcurrent?: number;
  /** 连续可重试失败多少次后熔断。 */
  failureThreshold?: number;
  /** 熔断冷却时长。 */
  cooldownMs?: number;
  /** 等待并发槽位的最长时间。 */
  maxWaitMs?: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
}

/**
 * 来源级熔断与并发控制（内存态，随进程重启清零）。
 * 只统计可重试类失败：取消、鉴权/参数错误不触发熔断。
 */
export function createProfileRuntime(options: ProfileRuntimeOptions = {}): ProfileRuntime {
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
  const failureThreshold = Math.max(1, options.failureThreshold ?? 3);
  const cooldownMs = Math.max(1000, options.cooldownMs ?? 5 * 60_000);
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 60_000);

  const states = new Map<string, { failures: number; openUntil: number }>();
  const inFlight = new Map<string, number>();
  const waiters = new Map<string, Waiter[]>();

  const enter = (profileId: string) => inFlight.set(profileId, (inFlight.get(profileId) ?? 0) + 1);
  const releaseSlot = (profileId: string) => {
    const next = (inFlight.get(profileId) ?? 1) - 1;
    inFlight.set(profileId, Math.max(0, next));
    const queue = waiters.get(profileId);
    while (queue?.length && (inFlight.get(profileId) ?? 0) < maxConcurrent) {
      const waiter = queue.shift() as Waiter;
      clearTimeout(waiter.timer);
      waiter.resolve();
      return; // 被唤醒者自己调用 enter()
    }
  };

  return {
    assertReady(profileId, label) {
      const state = states.get(profileId);
      if (!state || state.openUntil <= Date.now()) return;
      const seconds = Math.ceil((state.openUntil - Date.now()) / 1000);
      throw new Error(`来源「${label}」连续失败已暂停服务，约 ${seconds} 秒后自动恢复；也可切换其它来源`);
    },

    async acquire(profileId, label, signal) {
      if ((inFlight.get(profileId) ?? 0) < maxConcurrent) {
        enter(profileId);
        return () => releaseSlot(profileId);
      }
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve: () => {
            signal.removeEventListener("abort", waiter.onAbort);
            enter(profileId);
            resolve();
          },
          reject,
          timer: setTimeout(() => {
            const queue = waiters.get(profileId);
            if (queue)
              waiters.set(
                profileId,
                queue.filter((item) => item !== waiter),
              );
            signal.removeEventListener("abort", waiter.onAbort);
            reject(new Error(`来源「${label}」并发已达上限（${maxConcurrent}），请稍后重试`));
          }, maxWaitMs),
          onAbort: () => {
            const queue = waiters.get(profileId);
            if (queue)
              waiters.set(
                profileId,
                queue.filter((item) => item !== waiter),
              );
            clearTimeout(waiter.timer);
            reject(new Error("任务已取消"));
          },
        };
        const queue = waiters.get(profileId) ?? [];
        queue.push(waiter);
        waiters.set(profileId, queue);
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      });
      return () => releaseSlot(profileId);
    },

    noteSuccess(profileId) {
      states.delete(profileId);
    },

    noteFailure(profileId, _label, retryable) {
      if (!retryable) return;
      const state = states.get(profileId) ?? { failures: 0, openUntil: 0 };
      state.failures += 1;
      if (state.failures >= failureThreshold) state.openUntil = Date.now() + cooldownMs;
      states.set(profileId, state);
    },

    snapshot() {
      return [...states.entries()].map(([profileId, state]) => ({
        profileId,
        failures: state.failures,
        degradedUntil: state.openUntil > Date.now() ? new Date(state.openUntil).toISOString() : null,
      }));
    },
  };
}
