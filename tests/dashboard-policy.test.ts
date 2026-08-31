import { describe, expect, it } from "vitest";
import {
  assembleDashboard,
  assertSchedulePublishAt,
  collectDashboardActivity,
  deriveProjectRisk,
  localDayEndExclusive,
  visibleProjectSummaries,
} from "../src/shared/dashboard-policy";
import type { ProjectDetail, ProjectStatus, ProjectSummary, QualityIssue, ScheduleItem } from "../src/shared/types";

function projectSummary(id: string, status: ProjectStatus, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    title: id,
    genre: "都市脑洞",
    status,
    targetWords: 1_000_000,
    currentWords: 100,
    chapterCount: 1,
    stockChapters: 1,
    safeStockLine: 10,
    updateCadence: "每日1章",
    nextPublishAt: null,
    riskLevel: "正常",
    updatedAt: "2026-07-31T08:00:00.000Z",
    ...overrides,
  };
}

function schedule(id: string, publishAt: string, status: ScheduleItem["status"] = "待发布"): ScheduleItem {
  return {
    id,
    projectId: "project",
    projectTitle: "作品",
    chapterId: "chapter",
    chapterNumber: 1,
    chapterTitle: "第一章",
    publishAt,
    status,
  };
}

function issue(id: string, createdAt: string): QualityIssue {
  return {
    id,
    projectId: "project",
    chapterId: null,
    severity: "警告",
    category: "测试",
    message: id,
    evidence: "证据",
    status: "待处理",
    createdAt,
  };
}

function detail(summary: ProjectSummary, schedules: ScheduleItem[], issues: QualityIssue[]): ProjectDetail {
  return { summary, schedule: schedules, issues } as ProjectDetail;
}

describe("dashboard policy", () => {
  it("uses the next local midnight as an exclusive schedule cutoff", () => {
    const reference = new Date(2026, 6, 31, 0, 30);
    const cutoff = localDayEndExclusive(reference);
    const overdue = new Date(2026, 6, 30, 12).toISOString();
    const todayLate = new Date(2026, 6, 31, 23, 59).toISOString();
    const tomorrow = new Date(2026, 7, 1, 0).toISOString();
    expect(cutoff).toBe(tomorrow);

    const activity = collectDashboardActivity(
      [
        detail(
          projectSummary("visible", "连载中"),
          [
            schedule("overdue", overdue),
            schedule("offset-earlier", "2026-07-31T09:00:00+08:00"),
            schedule("utc-later", "2026-07-31T02:00:00.000Z"),
            schedule("same-b", todayLate),
            schedule("same-a", todayLate),
            schedule("tomorrow", tomorrow),
            schedule("published", overdue, "已发布"),
          ],
          [],
        ),
        detail(projectSummary("archived", "归档"), [schedule("archived", overdue)], []),
      ],
      cutoff,
    );

    expect(activity.dueToday.map((item) => item.id)).toEqual([
      "overdue",
      "offset-earlier",
      "utc-later",
      "same-a",
      "same-b",
    ]);
  });

  it("keeps project visibility, activity, totals, and ordering consistent", () => {
    const statuses: ProjectStatus[] = [
      "研究中",
      "候选立项",
      "设定中",
      "大纲审批",
      "连载准备",
      "连载中",
      "暂停",
      "完结",
      "归档",
    ];
    const projects = statuses.map((status, index) => projectSummary(`project-${index}`, status));

    const dashboard = assembleDashboard(projects, {
      dueToday: [],
      activeAlerts: [],
      pendingIssues: 0,
    });

    expect(dashboard.projects).toHaveLength(8);
    expect(dashboard.totals).toMatchObject({
      activeBooks: 6,
      totalWords: 800,
      stockChapters: 8,
    });
    expect(
      visibleProjectSummaries([projectSummary("b", "研究中"), projectSummary("a", "研究中")]).map(
        (project) => project.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("limits visible alerts without changing the pending issue count", () => {
    const issues = Array.from({ length: 15 }, (_, index) =>
      issue(`issue-${String(index).padStart(2, "0")}`, new Date(Date.UTC(2026, 6, 31, 0, index)).toISOString()),
    );
    const archivedIssue = issue("archived", "2026-08-01T00:00:00.000Z");
    const activity = collectDashboardActivity(
      [
        detail(projectSummary("visible", "连载中"), [], issues),
        detail(projectSummary("archived", "归档"), [], [archivedIssue]),
      ],
      "2026-08-01T00:00:00.000Z",
    );

    expect(activity.pendingIssues).toBe(15);
    expect(activity.activeAlerts).toHaveLength(12);
    expect(activity.activeAlerts[0].id).toBe("issue-14");
    expect(activity.activeAlerts).not.toContainEqual(archivedIssue);
  });

  it("warns about low stock only while serializing, with hard issues taking precedence", () => {
    expect(
      deriveProjectRisk({
        status: "连载准备",
        stockChapters: 0,
        safeStockLine: 10,
        pendingHardIssues: 0,
      }),
    ).toBe("正常");
    expect(
      deriveProjectRisk({
        status: "连载中",
        stockChapters: 0,
        safeStockLine: 10,
        pendingHardIssues: 0,
      }),
    ).toBe("注意");
    expect(
      deriveProjectRisk({
        status: "暂停",
        stockChapters: 20,
        safeStockLine: 10,
        pendingHardIssues: 1,
      }),
    ).toBe("告警");
  });

  it("requires absolute ISO timestamps at schedule and dashboard boundaries", () => {
    expect(() => assertSchedulePublishAt("2026-07-31T20:00:00")).toThrow("带时区");
    expect(() => assertSchedulePublishAt("2026-07-31T20:00:00+08:00")).not.toThrow();
    expect(() => collectDashboardActivity([], "invalid")).toThrow("仪表盘截止时间无效");
  });
});
