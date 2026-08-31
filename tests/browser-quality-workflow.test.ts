import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

let storedState: string | null;

beforeEach(() => {
  storedState = null;
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-31T00:00:00.000Z");
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

describe("browser quality workflow", () => {
  it("replaces pending results and applies shared resolution rules", async () => {
    const api = createBrowserApi();
    const first = await api.runQualityCheck("demo-project", "demo-chapter-1");
    const savedAt = "2026-08-01T01:00:00.000Z";
    vi.setSystemTime(savedAt);
    const second = await api.runQualityCheck("demo-project", "demo-chapter-1");
    const project = await api.getProject("demo-project");

    expect(project.issues.find((item) => item.id === "issue-1")?.status).toBe("已解决");
    expect(project.issues.find((item) => item.id === first[0].id)?.status).toBe("已解决");
    expect(project.issues.find((item) => item.id === second[0].id)?.status).toBe("待处理");
    expect(project.issues.filter((item) => item.status === "待处理")).toHaveLength(second.length);
    expect(project.summary.updatedAt).toBe(savedAt);

    await api.resolveIssue("demo-project", second[0].id, "已忽略");
    await expect(api.resolveIssue("demo-project", "missing", "已解决")).rejects.toThrow("质检项不存在");
  });

  it("forces sequential review and rejects ignoring a hard result", async () => {
    const api = createBrowserApi();
    await api.resolveIssue("demo-project", "issue-1", "已解决");
    const state = JSON.parse(storedState!);
    const chapter = state.projects[0].chapters[0];
    chapter.batchMode = "五章批次";
    storedState = JSON.stringify(state);

    const reloaded = createBrowserApi();
    const issues = await reloaded.runQualityCheck("demo-project", "demo-chapter-1");
    const hardIssue = issues.find((item) => item.severity === "硬性")!;
    const project = await reloaded.getProject("demo-project");

    expect(project.chapters[0].batchMode).toBe("逐章");
    await expect(reloaded.resolveIssue("demo-project", hardIssue.id, "已忽略")).rejects.toThrow(
      "硬性质检项不能忽略，必须解决后才能继续",
    );
  });

  it("versions a draft when quality checking advances its status", async () => {
    const api = createBrowserApi();
    const project = await api.getProject("demo-project");
    const outline = project.chapters[1];
    const draft = await api.saveChapter("demo-project", {
      ...outline,
      content: "短正文",
    });
    const checkedAt = "2026-08-01T02:00:00.000Z";
    vi.setSystemTime(checkedAt);

    await api.runQualityCheck("demo-project", draft.id);
    const reloaded = await api.getProject("demo-project");
    const checked = reloaded.chapters.find((item) => item.id === draft.id);

    expect(checked).toMatchObject({
      status: "待质检",
      revision: draft.revision + 1,
      updatedAt: checkedAt,
    });
    expect(reloaded.summary.updatedAt).toBe(checkedAt);
    await expect(api.runQualityCheck("demo-project", "missing")).rejects.toThrow("章节不存在");
  });
});
