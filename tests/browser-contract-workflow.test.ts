import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import type { ChangeRequest, StoryContract } from "../src/shared/types";

const initialTime = "2026-07-31T00:00:00.000Z";

function changeRequest(afterValue: string): ChangeRequest {
  return {
    id: "",
    targetKind: "创作契约",
    targetId: "contract",
    baseVersion: 0,
    title: "调整故事前提",
    reason: "阶段复盘",
    beforeValue: "旧前提",
    afterValue,
    impact: "创作契约",
    rollback: "恢复旧前提",
    status: "待审批",
    createdAt: initialTime,
  };
}

function completeContract(contract: StoryContract): StoryContract {
  return {
    ...contract,
    openingMechanism: "异常事故迫使主角主动调查",
    growthCarrier: "专业能力与关系网络同步积累",
    primaryPayoff: "解决现实问题并改变人物处境",
    longFormEngine: "个人困境、组织阻力和规则真相逐轮升级",
    protagonistArc: "主角从逃避责任走到主动承担调查代价",
    keyRelationships: ["主角与搭档逐步互信", "主角与对手争夺解释权"],
    worldRules: ["异常必须有可验证条件", "能力使用必有现实代价"],
    majorForces: ["主角调查团队", "掩盖真相的利益组织"],
    timelineAnchors: ["旧事故发生", "主角重启调查", "中期证据曝光"],
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

describe("browser contract workflow", () => {
  it("keeps an approved contract unchanged when the form writes empty defaults", async () => {
    const api = createBrowserApi();
    const [projectSummary] = await api.listProjects();
    const project = await api.getProject(projectSummary.id);

    const saved = await api.saveContract(projectSummary.id, {
      ...project.contract,
      fanqieCategoryKey: "",
    });

    expect(saved).toMatchObject({
      version: project.contract.version,
      approved: true,
      updatedAt: project.contract.updatedAt,
    });
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("requires approval, consumes the earliest match, and updates timestamps", async () => {
    const api = createBrowserApi();
    const [projectSummary] = await api.listProjects();
    const project = await api.getProject(projectSummary.id);
    const nextContract = {
      ...completeContract(project.contract),
      premise: "主角发现旧城事故仍在重复",
    };

    await expect(api.saveContract(projectSummary.id, nextContract)).rejects.toThrow("匹配的已批准变更单");

    vi.setSystemTime("2026-08-01T01:00:00.000Z");
    const earlier = await api.saveChangeRequest(projectSummary.id, changeRequest(nextContract.premise));
    await api.decideChangeRequest(projectSummary.id, earlier.id, "批准");
    vi.setSystemTime("2026-08-01T02:00:00.000Z");
    const later = await api.saveChangeRequest(projectSummary.id, changeRequest(nextContract.premise));
    await api.decideChangeRequest(projectSummary.id, later.id, "批准");

    const savedAt = "2026-08-01T03:00:00.000Z";
    vi.setSystemTime(savedAt);
    const saved = await api.saveContract(projectSummary.id, nextContract);
    const afterSave = await api.getProject(projectSummary.id);

    expect(saved).toMatchObject({
      version: project.contract.version + 1,
      approved: false,
      updatedAt: savedAt,
    });
    expect(afterSave.summary.updatedAt).toBe(savedAt);
    expect(afterSave.changes.find((change) => change.id === earlier.id)?.status).toBe("已应用");
    expect(afterSave.changes.find((change) => change.id === later.id)?.status).toBe("已批准");

    const approvedAt = "2026-08-01T04:00:00.000Z";
    vi.setSystemTime(approvedAt);
    const approved = await api.approveContract(projectSummary.id);
    const afterApproval = await api.getProject(projectSummary.id);

    expect(approved).toMatchObject({ approved: true, updatedAt: approvedAt });
    expect(afterApproval.summary).toMatchObject({
      status: "大纲审批",
      updatedAt: approvedAt,
    });
  });
});
