import { mkdtempSync, rmSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDatabase, now } from "../electron/database";
import type { Chapter, LedgerFact, QualityIssue } from "../src/shared/types";

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-test-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

function createChapter(number: number, content = "这是一段用于验证章节版本和项目隔离的正文内容。".repeat(40)): Chapter {
  return { id: "", number, title: `第${number}章`, outline: "目标：验证状态；冲突：测试门禁；结果：保留证据。", content,
    wordCount: 0, status: "待质检", batchMode: "逐章", isKeyChapter: false, revision: 0, updatedAt: now() };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("per-book isolation and gates", () => {
  it("moves a title-confirmed project to the recoverable trash directory", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "待移除作品", genre: "都市脑洞", targetWords: 1000000, updateCadence: "每日1章" });
    database.saveChapter(project.id, createChapter(1));
    expect(() => database.deleteProject(project.id, "错误书名")).toThrow("书名");
    expect(database.listProjects().some((item) => item.id === project.id)).toBe(true);
    const result = database.deleteProject(project.id, project.title);
    expect(database.listProjects().some((item) => item.id === project.id)).toBe(false);
    expect(result).toContain("回收目录");
    const destination = path.join(database.trashRoot, readdirSync(database.trashRoot)[0]);
    expect(existsSync(destination)).toBe(true);
    expect(readdirSync(destination)).toContain("project.sqlite");
    expect(existsSync(path.join(database.projectsRoot, project.id))).toBe(false);
  });

  it("persists chapter intent and synchronizes the cross-chapter expectation ledger", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "期待账本", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const chapter = database.saveChapter(project.id, {
      ...createChapter(1), chapterPromise: "验证能力首次反馈", expectedPayoff: "救人成功但付出记忆代价",
      crisis: "七分钟内必须找到伤者", endingExpectation: "谁在制造事故", expectationTargetChapter: 6,
    });
    const detail = database.getProject(project.id);
    expect(chapter.endingExpectationId).toBeTruthy();
    expect(detail.expectations).toHaveLength(1);
    expect(detail.expectations[0]).toMatchObject({ sourceChapter: 1, expectedPayoffChapter: 6, status: "待兑现" });
    const fulfilled = database.saveExpectation(project.id, { ...detail.expectations[0], status: "已兑现", actualPayoffChapter: 5, payoffResult: "锁定第一名交易者" });
    expect(fulfilled.payoffResult).toContain("交易者");
  });

  it("keeps same-name entities inside their own project databases", () => {
    const database = createDatabase();
    const one = database.createProject({ title: "项目一", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const two = database.createProject({ title: "项目二", genre: "现言甜宠", targetWords: 3000000, updateCadence: "每日1章" });
    database.saveChapter(one.id, createChapter(1, "林舟在旧城发现异常。".repeat(80)));
    database.saveChapter(two.id, createChapter(1, "林舟在婚礼现场收到来信。".repeat(80)));
    database.saveFact(one.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "维修员", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    database.saveFact(two.id, { id: "", kind: "人物", subject: "林舟", predicate: "身份", value: "律师", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    expect(database.getProject(one.id).facts[0].value).toBe("维修员");
    expect(database.getProject(two.id).facts[0].value).toBe("律师");
    expect(database.getProject(one.id).chapters[0].content).not.toContain("婚礼现场");
  });

  it("blocks approval order and unresolved hard issues", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "门禁测试", genre: "玄幻/仙侠", targetWords: 3000000, updateCadence: "每日2章" });
    const plan = database.savePlan(project.id, { id: "", kind: "分卷", title: "第一卷", ordinal: 1, goal: "建立成长规则", conflict: "资源有限", outcome: "完成筑基", targetWords: 150000, status: "待审批", parentId: null });
    expect(() => database.approvePlan(project.id, plan.id)).toThrow("创作契约");
    const saved = database.saveChapter(project.id, createChapter(1));
    const issue: QualityIssue = { id: crypto.randomUUID(), projectId: project.id, chapterId: saved.id, severity: "硬性", category: "设定冲突", message: "境界冲突", evidence: "第一章", status: "待处理", createdAt: now() };
    database.saveIssues(project.id, saved.id, [issue]);
    database.transitionChapter(project.id, saved.id, "待质检");
    expect(() => database.resolveIssue(project.id, issue.id, "已忽略")).toThrow("不能忽略");
    expect(() => database.transitionChapter(project.id, saved.id, "待定稿")).toThrow("硬性问题");
    database.resolveIssue(project.id, issue.id, "已解决");
    database.transitionChapter(project.id, saved.id, "待定稿");
    expect(database.transitionChapter(project.id, saved.id, "已定稿").status).toBe("已定稿");
    expect(database.getProject(project.id).summaries.map((item) => item.layer)).toEqual(expect.arrayContaining(["场景", "章节", "十章阶段", "全书"]));
    expect(database.getProject(project.id).summaries.find((item) => item.layer === "章节")?.content).toContain("未解决事项：");
    expect(database.searchProject(project.id, "章节版本")[0].chapterNumber).toBe(1);
  });

  it("marks overlapping facts as conflicts and ranks relevant facts", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "事实测试", genre: "历史/架空", targetWords: 3000000, updateCadence: "每日1章" });
    const base: Omit<LedgerFact, "id" | "updatedAt"> = { kind: "地点", subject: "北仓", predicate: "控制方", value: "巡检司", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开" };
    database.saveFact(project.id, { ...base, id: "", updatedAt: now() });
    const conflict = database.saveFact(project.id, { ...base, id: "", value: "盐运司", evidenceChapter: 2, updatedAt: now() });
    database.saveFact(project.id, { id: "", kind: "人物", subject: "陆青", predicate: "武器", value: "长弓", validFromChapter: 1, validToChapter: null, evidenceChapter: 1, confidence: "已确认", knowledgeScope: "公开", updatedAt: now() });
    expect(conflict.confidence).toBe("有冲突");
    expect(database.searchRelevantFacts(project.id, "北仓控制方", 3, 2).some((fact) => fact.subject === "北仓")).toBe(true);
  });
});

describe("research firewall", () => {
  it("detects continuous-expression reuse without copying source into projects", () => {
    const database = createDatabase();
    const unique = "暮色沿着废弃钟楼的铜制排水管缓慢下降直到第七码头灯光熄灭";
    database.saveResearchBook({ id: "sample", title: "隔离样本", author: "作者", genre: "都市脑洞", sourceType: "TXT", chapterCount: 1, wordCount: unique.length, rightsConfirmed: true, cloudConsent: false, importedAt: now(), status: "待拆解" }, [{ title: "第一章", content: unique.repeat(2), wordCount: unique.length * 2 }]);
    const matches = database.findOriginalityMatches(`新正文开头。${unique}，后续内容。`);
    expect(matches[0].researchRef).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(matches)).not.toContain("隔离样本");
    expect(JSON.stringify(matches)).not.toContain(unique);
    const project = database.createProject({ title: "原创项目", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    expect(JSON.stringify(database.getProject(project.id))).not.toContain(unique);
  });
});

describe("approval gates", () => {
  it("requires an approved change request before editing an approved contract", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "门禁测试", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const initial = database.saveContract(project.id, {
      ...database.getProject(project.id).contract,
      premise: "主角发现异常规则", readerPromise: "持续解谜与成长", ending: "主角关闭规则源头",
    });
    database.approveContract(project.id);
    expect(() => database.saveContract(project.id, { ...initial, premise: "未经审批的新前提" })).toThrow(/变更单/);
    const change = database.saveChangeRequest(project.id, {
      id: "", targetKind: "创作契约", targetId: "contract", baseVersion: 0,
      title: "调整故事前提", reason: "阶段复盘", beforeValue: initial.premise,
      afterValue: "经审批的新前提", impact: "创作契约", rollback: "恢复上一版本", status: "待审批", createdAt: now(),
    });
    database.decideChangeRequest(project.id, change.id, "批准");
    const saved = database.saveContract(project.id, { ...initial, premise: "经审批的新前提" });
    expect(saved.premise).toBe("经审批的新前提");
    expect(database.getProject(project.id).changes.find((item) => item.id === change.id)?.status).toBe("已应用");
  });

  it("owns lifecycle status and binds approvals to one target version", () => {
    const database = createDatabase();
    const project = database.createProject({ title: "状态门禁", genre: "都市脑洞", targetWords: 3000000, updateCadence: "每日2章" });
    const first = database.saveChapter(project.id, { ...createChapter(1), status: "已发布" });
    const second = database.saveChapter(project.id, createChapter(2));
    expect(first.status).toBe("草稿");
    expect(database.saveChapter(project.id, { ...first, status: "已发布" }).status).toBe("草稿");
    expect(() => database.transitionChapter(project.id, first.id, "已发布")).toThrow("不允许");

    const contract = database.saveContract(project.id, { ...database.getProject(project.id).contract, premise: "前提", readerPromise: "承诺", ending: "终局" });
    database.approveContract(project.id);
    const unrelated = database.saveChangeRequest(project.id, {
      id: "伪造编号", targetKind: "章节", targetId: second.id, baseVersion: 999, title: "无关章节变更", reason: "测试",
      beforeValue: "旧", afterValue: "新", impact: "第二章", rollback: "恢复", status: "已批准", createdAt: "2000-01-01T00:00:00.000Z",
    });
    expect(unrelated.status).toBe("待审批");
    expect(unrelated.baseVersion).toBe(second.revision);
    expect(() => database.saveContract(project.id, { ...contract, premise: "不能挪用审批" })).toThrow("变更单");
  });
});
