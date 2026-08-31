import type { DashboardData, ProjectDetail, ProjectStatus, ProjectSummary, QualityIssue, ScheduleItem } from "./types";

export interface DashboardActivity {
  dueToday: ScheduleItem[];
  activeAlerts: QualityIssue[];
  pendingIssues: number;
}

const ABSOLUTE_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isAbsoluteIsoTimestamp(value: string): boolean {
  return ABSOLUTE_ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

export function assertSchedulePublishAt(publishAt: string): void {
  if (!isAbsoluteIsoTimestamp(publishAt)) {
    throw new Error("计划发布时间必须是带时区的有效 ISO 时间");
  }
}

export function assertDashboardCutoff(throughExclusive: string): void {
  if (!isAbsoluteIsoTimestamp(throughExclusive)) {
    throw new Error("仪表盘截止时间无效");
  }
}

export function isVisibleProjectStatus(status: ProjectStatus): boolean {
  return status !== "归档";
}

export function isActiveProjectStatus(status: ProjectStatus): boolean {
  return !["暂停", "完结", "归档"].includes(status);
}

export function localDayEndExclusive(reference: Date): string {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1).toISOString();
}

export function deriveProjectRisk(input: {
  status: ProjectStatus;
  stockChapters: number;
  safeStockLine: number;
  pendingHardIssues: number;
}): ProjectSummary["riskLevel"] {
  if (input.pendingHardIssues > 0) return "告警";
  if (input.status === "连载中" && input.stockChapters < input.safeStockLine) {
    return "注意";
  }
  return "正常";
}

function compareTimestamps(left: string, right: string, direction: 1 | -1): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return direction * (leftTime - rightTime);
  }
  return direction * left.localeCompare(right);
}

export function compareDashboardProjects(left: ProjectSummary, right: ProjectSummary): number {
  return compareTimestamps(left.updatedAt, right.updatedAt, -1) || left.id.localeCompare(right.id);
}

export function compareDueSchedules(left: ScheduleItem, right: ScheduleItem): number {
  return compareTimestamps(left.publishAt, right.publishAt, 1) || left.id.localeCompare(right.id);
}

export function compareActiveAlerts(left: QualityIssue, right: QualityIssue): number {
  return compareTimestamps(left.createdAt, right.createdAt, -1) || left.id.localeCompare(right.id);
}

export function visibleProjectSummaries(projects: ReadonlyArray<ProjectSummary>): ProjectSummary[] {
  return projects.filter((project) => isVisibleProjectStatus(project.status)).sort(compareDashboardProjects);
}

export function collectDashboardActivity(
  projects: ReadonlyArray<ProjectDetail>,
  throughExclusive: string,
): DashboardActivity {
  assertDashboardCutoff(throughExclusive);
  const cutoff = Date.parse(throughExclusive);

  const visible = projects.filter((project) => isVisibleProjectStatus(project.summary.status));
  const pending = visible.flatMap((project) => project.issues).filter((issue) => issue.status === "待处理");
  return {
    dueToday: visible
      .flatMap((project) => project.schedule)
      .filter((item) => item.status !== "已发布" && Date.parse(item.publishAt) < cutoff)
      .sort(compareDueSchedules),
    activeAlerts: [...pending].sort(compareActiveAlerts).slice(0, 12),
    pendingIssues: pending.length,
  };
}

export function assembleDashboard(
  projectInput: ReadonlyArray<ProjectSummary>,
  activity: DashboardActivity,
): DashboardData {
  const projects = visibleProjectSummaries(projectInput);
  return {
    projects,
    dueToday: [...activity.dueToday].sort(compareDueSchedules),
    activeAlerts: [...activity.activeAlerts].sort(compareActiveAlerts).slice(0, 12),
    totals: {
      activeBooks: projects.filter((project) => isActiveProjectStatus(project.status)).length,
      totalWords: projects.reduce((sum, project) => sum + project.currentWords, 0),
      stockChapters: projects.reduce((sum, project) => sum + project.stockChapters, 0),
      pendingIssues: activity.pendingIssues,
    },
  };
}
