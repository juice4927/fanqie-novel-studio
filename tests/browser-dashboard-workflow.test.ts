import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

let storedState: string | null;

beforeEach(() => {
  storedState = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 31, 0, 30));
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => storedState),
    setItem: vi.fn((_key: string, value: string) => {
      storedState = value;
    }),
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

describe("browser dashboard workflow", () => {
  it("matches SQLite visibility, date, activity, and risk semantics", async () => {
    const api = createBrowserApi();
    await api.createProject({
      title: "暂停样本",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });
    await api.createProject({
      title: "归档样本",
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日1章",
    });

    const state = JSON.parse(storedState!);
    const seed = state.projects.find(
      (project: any) => project.summary.id === "demo-project",
    );
    const paused = state.projects.find(
      (project: any) => project.summary.title === "暂停样本",
    );
    const archived = state.projects.find(
      (project: any) => project.summary.title === "归档样本",
    );
    seed.summary.status = "连载中";
    seed.summary.updatedAt = "2026-07-31T08:00:00.000Z";
    paused.summary.status = "暂停";
    paused.summary.updatedAt = "2026-08-01T08:00:00.000Z";
    archived.summary.status = "归档";
    archived.summary.updatedAt = "2026-08-02T08:00:00.000Z";
    archived.chapters = [{
      id: "archived-chapter",
      number: 1,
      title: "归档正文",
      outline: "章纲",
      content: "归档内容",
      wordCount: 999,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 1,
      updatedAt: "2026-07-31T00:00:00.000Z",
    }];
    const todayLate = new Date(2026, 6, 31, 23, 59).toISOString();
    const tomorrow = new Date(2026, 7, 1, 0).toISOString();
    const schedule = (id: string, project: any, publishAt: string) => ({
      id,
      projectId: project.summary.id,
      projectTitle: project.summary.title,
      chapterId: project.chapters[0]?.id ?? "chapter",
      chapterNumber: 1,
      chapterTitle: "第一章",
      publishAt,
      status: "待发布",
    });
    seed.schedule = [
      schedule("today", seed, todayLate),
      schedule("tomorrow", seed, tomorrow),
    ];
    archived.schedule = [schedule("archived", archived, todayLate)];
    const pendingIssue = (id: string, project: any) => ({
      id,
      projectId: project.summary.id,
      chapterId: null,
      severity: "警告",
      category: "测试",
      message: id,
      evidence: "证据",
      status: "待处理",
      createdAt: "2026-07-31T08:00:00.000Z",
    });
    seed.issues = [pendingIssue("visible-issue", seed)];
    archived.issues = [pendingIssue("archived-issue", archived)];
    storedState = JSON.stringify(state);

    const reloaded = createBrowserApi();
    const projects = await reloaded.listProjects();
    const dashboard = await reloaded.getDashboard();

    expect(projects.map((project) => project.title)).toEqual([
      "暂停样本",
      "回声备忘录",
    ]);
    expect(projects.map((project) => project.riskLevel)).toEqual([
      "正常",
      "注意",
    ]);
    expect(dashboard.dueToday.map((item) => item.id)).toEqual(["today"]);
    expect(dashboard.activeAlerts.map((item) => item.id)).toEqual([
      "visible-issue",
    ]);
    expect(dashboard.totals).toEqual({
      activeBooks: 1,
      totalWords: 125,
      stockChapters: 1,
      pendingIssues: 1,
    });
    const seedProject = await reloaded.getProject("demo-project");
    await expect(reloaded.saveSchedule("demo-project", {
      id: "",
      projectId: "demo-project",
      projectTitle: seedProject.summary.title,
      chapterId: seedProject.chapters[0].id,
      chapterNumber: 1,
      chapterTitle: seedProject.chapters[0].title,
      publishAt: "2026-07-31T20:00:00",
      status: "待发布",
    })).rejects.toThrow("带时区");
  });
});
