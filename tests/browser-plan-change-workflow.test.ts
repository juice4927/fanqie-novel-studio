import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import type { ChangeRequest } from "../src/shared/types";

const initialTime = "2026-07-31T00:00:00.000Z";

function changeRequest(targetId: string): ChangeRequest {
  return {
    id: "",
    targetKind: "规划",
    targetId,
    baseVersion: 0,
    title: "调整阶段目标",
    reason: "阶段复盘",
    beforeValue: "旧目标",
    afterValue: "新目标",
    impact: "第一卷",
    rollback: "恢复旧目标",
    status: "待审批",
    createdAt: initialTime,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser plan and change workflow", () => {
  it("tracks SQLite-compatible plan versions through edit and approval", async () => {
    const api = createBrowserApi();
    const [summary] = await api.listProjects();
    const project = await api.getProject(summary.id);
    const plan = project.plans[0];

    const first = await api.saveChangeRequest(summary.id, changeRequest(plan.id));
    expect(first.baseVersion).toBe(2);
    const persisted = JSON.parse(
      vi.mocked(localStorage.setItem).mock.calls.at(-1)![1],
    ) as { planVersions?: Record<string, number> };
    delete persisted.planVersions;
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => JSON.stringify(persisted)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 1,
    });
    const migratedApi = createBrowserApi();
    expect((await migratedApi.saveChangeRequest(
      summary.id,
      changeRequest(plan.id),
    )).baseVersion).toBe(2);

    await api.decideChangeRequest(summary.id, first.id, "批准");
    const edited = await api.savePlan(summary.id, {
      ...plan,
      goal: "建立并验证能力规则",
    });
    expect(edited.status).toBe("待审批");
    expect((await api.getProject(summary.id)).changes.find(
      (item) => item.id === first.id,
    )?.status).toBe("已应用");

    const second = await api.saveChangeRequest(summary.id, changeRequest(plan.id));
    expect(second.baseVersion).toBe(3);
    await api.approvePlan(summary.id, plan.id);
    const third = await api.saveChangeRequest(summary.id, changeRequest(plan.id));
    expect(third.baseVersion).toBe(4);
  });

  it("rejects invalid targets and missing decisions", async () => {
    const api = createBrowserApi();
    const [summary] = await api.listProjects();
    await expect(api.saveChangeRequest(summary.id, {
      ...changeRequest("forged"),
      targetKind: "创作契约",
    })).rejects.toThrow("创作契约目标无效");
    await expect(
      api.saveChangeRequest(summary.id, changeRequest("missing-plan")),
    ).rejects.toThrow("变更目标规划不存在");
    await expect(
      api.decideChangeRequest(summary.id, "missing-change", "批准"),
    ).rejects.toThrow("变更单不存在");
  });
});
