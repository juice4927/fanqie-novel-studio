import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDatabase } from "../electron/database";
import type { LaunchPackProgress, PlanNode, PlanningGenerationResult } from "../src/shared/types";

const resources: Array<{ database: WorkspaceDatabase; root: string }> = [];
const timestamp = "2026-09-09T00:00:00.000Z";

function createBook() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-launch-pack-"));
  const database = new WorkspaceDatabase(root);
  resources.push({ database, root });
  const project = database.createProject({
    title: "旧站调查",
    genre: "都市脑洞",
    targetWords: 10_000,
    wordsPerChapter: 2500,
    updateCadence: "每日一章",
  });
  const { contract } = database.getProject(project.id);
  database.saveContract(project.id, {
    ...contract,
    premise: "调查员重新调查封闭车站的旧事故",
    protagonistDesire: "还原事故真相并保护证人",
    readerPromise: "每轮调查提供可验证的真相推进",
    coreEmotion: "责任与信任",
    ending: "公开证据并建立独立事故复核制度",
    openingMechanism: "即将拆除的车站出现新证据",
    growthCarrier: "调查方法与证人网络逐步成熟",
    primaryPayoff: "证据改变事故责任归属",
    longFormEngine: "事故调查扩展为组织追责与制度重建",
    protagonistArc: "从独自行动转向与证人共同承担风险，最后以公开程序守护真相",
    keyRelationships: ["许澄与顾闻围绕证据是否公开冲突", "许澄与主管围绕程序与时限持续对抗"],
    worldRules: ["责任结论需要两类独立证据相互验证", "证人的公开作证将改变其职业处境"],
    majorForces: ["调查组掌握现场勘验能力与证人联系", "承包组织控制设备日志和事故资料"],
    timelineAnchors: ["事故导致旧站封闭", "新证言触发调查重启", "核心证据公开完成制度追责"],
  });
  return { database, project };
}

function batch(): PlanningGenerationResult {
  const node = (id: string, kind: PlanNode["kind"], ordinal: number, parentId: string | null): PlanNode => ({
    id,
    kind,
    ordinal,
    parentId,
    title: `${kind} ${ordinal}`,
    goal: "找到证据并推进调查",
    conflict: "面对证言不一致的问题",
    outcome: "明确下一阶段调查目标",
    targetWords: 2500,
    status: "草稿",
  });
  return {
    startChapter: 1,
    plans: [
      node("stage", "宏观阶段", 1, null),
      node("volume", "分卷", 1, "stage"),
      node("rough", "粗纲", 1, "volume"),
      ...Array.from({ length: 4 }, (_, index) => node(`detail-${index}`, "细纲", index + 1, "rough")),
      ...Array.from({ length: 4 }, (_, index) =>
        node(`scene-${index}`, "场景卡", (index + 1) * 10 + 1, `detail-${index}`),
      ),
    ],
    chapters: Array.from({ length: 4 }, (_, index) => ({
      id: `chapter-${index}`,
      number: index + 1,
      title: `调查进展 ${index + 1}`,
      outline: "前往现场复核证据，发现证词矛盾并获得下一条线索",
      content: "",
      wordCount: 0,
      status: "章纲",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 0,
      updatedAt: timestamp,
    })),
  };
}

const ready: LaunchPackProgress = {
  status: "待确认",
  phase: "完成",
  targetChapters: 4,
  completedChapters: 4,
  updatedAt: timestamp,
};

afterEach(() => {
  for (const { database, root } of resources.splice(0)) {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

describe("launch pack persistence and approval", () => {
  it("persists unapproved drafts and confirms contract and all plan levels only on explicit approval", () => {
    const { database, project } = createBook();
    database.saveLaunchPackBatch(project.id, batch(), ready);
    const draft = database.getProject(project.id);
    expect(draft.contract.approved).toBe(false);
    expect(draft.plans.every((plan) => plan.status === "草稿")).toBe(true);
    database.approveLaunchPack(project.id);
    const approved = database.getProject(project.id);
    expect(approved.contract.approved).toBe(true);
    expect(approved.plans.every((plan) => plan.status === "已批准")).toBe(true);
    expect(approved.chapters.every((chapter) => chapter.status === "章纲" && !chapter.content)).toBe(true);
    expect(approved.launchPack?.status).toBe("已确认");
    expect(approved.summary.status).toBe("连载准备");
    expect(() => database.savePlan(project.id, { ...approved.plans[0], goal: "未经变更审批的替换目标" })).toThrow(
      "已批准的改纲变更单",
    );
  });

  it("rolls back every write and progress update when a later plan in the batch conflicts", () => {
    const { database, project } = createBook();
    const input = batch();
    const starting: LaunchPackProgress = { ...ready, status: "生成中", phase: "全书结构", completedChapters: 0 };
    database.saveLaunchPackProgress(project.id, starting);
    input.plans[1].id = input.plans[0].id;
    expect(() => database.saveLaunchPackBatch(project.id, input, ready)).toThrow("规划节点已存在");
    const persisted = database.getProject(project.id);
    expect(persisted.plans).toEqual([]);
    expect(persisted.chapters).toEqual([]);
    expect(persisted.launchPack).toEqual(starting);
  });

  it("re-points child plans to the existing node when a slot is already covered", () => {
    const { database, project } = createBook();
    const structural = batch();
    structural.plans = structural.plans.filter((plan) => plan.kind === "粗纲");
    structural.chapters = [];
    database.saveLaunchPackBatch(project.id, structural, ready);
    const existingRough = database.getProject(project.id).plans.find((plan) => plan.kind === "粗纲")!;
    const chapterBatch = batch();
    chapterBatch.plans = chapterBatch.plans
      .filter((plan) => plan.kind === "细纲" || plan.kind === "粗纲")
      .map((plan) => ({ ...plan, id: `b-${plan.id}`, parentId: plan.parentId ? `b-${plan.parentId}` : null }));
    chapterBatch.chapters = [];
    database.saveLaunchPackBatch(project.id, chapterBatch, ready);
    const plans = database.getProject(project.id).plans;
    expect(plans.filter((plan) => plan.kind === "粗纲")).toHaveLength(1);
    expect(plans.filter((plan) => plan.kind === "细纲").every((plan) => plan.parentId === existingRough.id)).toBe(true);
  });

  it("rejects duplicate chapter numbers without changing an existing draft", () => {
    const { database, project } = createBook();
    database.saveLaunchPackBatch(project.id, batch(), ready);
    expect(() => database.saveLaunchPackBatch(project.id, batch(), ready)).toThrow("第1章已存在");
    expect(database.getProjectOverview(project.id).chapters).toHaveLength(4);
  });

  it("refuses incomplete chapter coverage and preserves every approval gate", () => {
    const { database, project } = createBook();
    const input = batch();
    input.chapters.pop();
    database.saveLaunchPackBatch(project.id, input, ready);
    expect(() => database.approveLaunchPack(project.id)).toThrow("第4章章纲缺失");
    const persisted = database.getProject(project.id);
    expect(persisted.contract.approved).toBe(false);
    expect(persisted.plans.every((plan) => plan.status === "草稿")).toBe(true);
    expect(persisted.launchPack?.status).toBe("待确认");
  });

  it.each(["细纲", "场景卡"] as const)("refuses approval when one chapter has no %s", (kind) => {
    const { database, project } = createBook();
    const input = batch();
    input.plans = input.plans.filter(
      (plan) => !(plan.kind === kind && (kind === "细纲" ? plan.ordinal === 4 : plan.parentId === "detail-3")),
    );
    database.saveLaunchPackBatch(project.id, input, ready);
    expect(() => database.approveLaunchPack(project.id)).toThrow(`第4章${kind}缺失`);
    const persisted = database.getProject(project.id);
    expect(persisted.contract.approved).toBe(false);
    expect(persisted.plans.every((plan) => plan.status === "草稿")).toBe(true);
  });
});
