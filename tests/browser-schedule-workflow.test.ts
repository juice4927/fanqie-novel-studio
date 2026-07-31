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

describe("browser schedule workflow", () => {
  it("persists trusted metadata and revisions only for real transitions", async () => {
    const api = createBrowserApi();
    const project = await api.getProject("demo-project");
    const chapter = project.chapters[0];
    const scheduledAt = "2026-08-01T01:00:00.000Z";
    vi.setSystemTime(scheduledAt);

    const scheduled = await api.saveSchedule("demo-project", {
      id: "",
      projectId: "forged-project",
      projectTitle: "伪造书名",
      chapterId: chapter.id,
      chapterNumber: 999,
      chapterTitle: "伪造标题",
      publishAt: "2026-08-02T08:00:00.000Z",
      status: "待发布",
    });
    let reloaded = await api.getProject("demo-project");

    expect(scheduled).toMatchObject({
      projectId: "demo-project",
      projectTitle: project.summary.title,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
    });
    expect(reloaded.chapters[0]).toMatchObject({
      status: "待发布",
      revision: chapter.revision + 1,
      updatedAt: scheduledAt,
    });
    expect(reloaded.summary.updatedAt).toBe(scheduledAt);

    vi.setSystemTime("2026-08-01T02:00:00.000Z");
    await api.saveSchedule("demo-project", scheduled);
    reloaded = await api.getProject("demo-project");
    expect(reloaded.chapters[0].revision).toBe(chapter.revision + 1);

    const publishedAt = "2026-08-01T03:00:00.000Z";
    vi.setSystemTime(publishedAt);
    await api.saveSchedule("demo-project", {
      ...scheduled,
      status: "已发布",
    });
    reloaded = await api.getProject("demo-project");
    expect(reloaded.chapters[0]).toMatchObject({
      status: "已发布",
      revision: chapter.revision + 2,
      updatedAt: publishedAt,
    });
    expect(reloaded.summary.updatedAt).toBe(publishedAt);
  });
});
