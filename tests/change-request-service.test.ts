import { describe, expect, it, vi } from "vitest";
import {
  decideChangeRequest,
  prepareChangeRequest,
  resolveChangeTargetVersion,
} from "../src/shared/change-request-service";
import type { ChangeRequest } from "../src/shared/types";

const change: ChangeRequest = {
  id: "",
  targetKind: "规划",
  targetId: "plan-1",
  baseVersion: 0,
  title: "调整阶段目标",
  reason: "复盘",
  beforeValue: "旧目标",
  afterValue: "新目标",
  impact: "第一卷",
  rollback: "恢复旧目标",
  status: "已批准",
  createdAt: "2000-01-01T00:00:00.000Z",
};

describe("change request rules", () => {
  it("resolves versions through backend lookups and validates target identity", () => {
    const planVersion = vi.fn(() => 3);
    const chapterVersion = vi.fn(() => 7);
    const versions = { contractVersion: 2, planVersion, chapterVersion };

    expect(resolveChangeTargetVersion("创作契约", "contract", versions)).toBe(2);
    expect(resolveChangeTargetVersion("规划", "plan-1", versions)).toBe(3);
    expect(resolveChangeTargetVersion("章节", "chapter-1", versions)).toBe(7);
    expect(() => resolveChangeTargetVersion("创作契约", "forged", versions)).toThrow(
      "创作契约目标无效",
    );
    expect(() => resolveChangeTargetVersion("规划", "missing", {
      ...versions,
      planVersion: () => undefined,
    })).toThrow("变更目标规划不存在");
    expect(() => resolveChangeTargetVersion("章节", "missing", {
      ...versions,
      chapterVersion: () => undefined,
    })).toThrow("变更目标章节不存在");
  });

  it("owns generated metadata and rejects decisions for missing requests", () => {
    const prepared = prepareChangeRequest(change, {
      id: "change-1",
      baseVersion: 3,
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    expect(prepared).toMatchObject({
      id: "change-1",
      baseVersion: 3,
      status: "待审批",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    expect(decideChangeRequest(prepared, "批准").status).toBe("已批准");
    expect(decideChangeRequest(prepared, "拒绝").status).toBe("已拒绝");
    expect(() => decideChangeRequest(undefined, "批准")).toThrow("变更单不存在");
    expect(() => decideChangeRequest({ ...prepared, status: "已应用" }, "批准")).toThrow("只有待审批");
  });
});
