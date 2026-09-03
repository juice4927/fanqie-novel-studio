// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";
import { WritingPage } from "../src/pages/WritingWorkspace";
import type { Chapter, QualityIssue } from "../src/shared/types";

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => cleanup());

const text = "雨落在旧城的玻璃窗上，林舟把红伞线索写进了笔记。";

async function mountWritingPage(overrides: Partial<AppApiLike> = {}) {
  const baseApi = createBrowserApi();
  const project = await baseApi.getProject("demo-project");
  const target = project.chapters[0];
  const generated: Chapter = { ...target, content: text.repeat(12) };
  const api = {
    ...baseApi,
    getChapter: vi.fn(async (_id: string, chapterId: string) => project.chapters.find((item) => item.id === chapterId)),
    generateChapterDraft: vi.fn(async () => generated),
    runQualityCheck: vi.fn(async () => []),
    transitionChapter: vi.fn(async (_id: string, _chapterId: string, status: string) => ({
      chapter: { ...generated, status },
      ledgerExtraction: { status: "不适用", candidateCount: 0 },
    })),
    saveChapter: vi.fn(async (_id: string, chapter: Chapter) => chapter),
    ...overrides,
  } as AppApiLike;
  const notify = vi.fn();
  const view = render(
    <WritingPage project={project} api={api as never} reload={vi.fn(async () => {})} notify={notify} />,
  );
  return { api, project, target, notify, ...view };
}

type AppApiLike = ReturnType<typeof createBrowserApi> & Record<string, unknown>;

describe("AI generated draft review (director mode)", () => {
  it("opens the review panel and accepts into 待定稿 when clean", async () => {
    const { api, target, notify, unmount } = await mountWritingPage();
    try {
      await userEvent.click(await screen.findByRole("button", { name: "AI 生成草稿" }));
      await screen.findByRole("dialog", { name: /审阅 AI 产出/ });
      await waitFor(() => expect(document.body.textContent ?? "").toContain("未发现硬性问题"));
      const accept = screen.getByRole("button", { name: "采纳并进入待定稿" }) as HTMLButtonElement;
      expect(accept.disabled).toBe(false);
      await userEvent.click(accept);
      await waitFor(() =>
        expect(api.transitionChapter as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
          "demo-project",
          target.id,
          "待定稿",
        ),
      );
      expect(notify).toHaveBeenCalledWith("已采纳 AI 产出并进入待定稿");
    } finally {
      unmount();
    }
  });

  it("reverts to the previous content when the author rejects the draft", async () => {
    const { api, target, unmount } = await mountWritingPage();
    try {
      await userEvent.click(await screen.findByRole("button", { name: "AI 生成草稿" }));
      await screen.findByRole("dialog", { name: /审阅 AI 产出/ });
      await waitFor(() => expect(document.body.textContent ?? "").toContain("未发现硬性问题"));
      await userEvent.click(screen.getByRole("button", { name: "打回重写" }));
      await waitFor(() => expect(api.saveChapter).toHaveBeenCalled());
      const restored = (api.saveChapter as ReturnType<typeof vi.fn>).mock.calls[0][1] as Chapter;
      expect(restored.content).toBe(target.content);
    } finally {
      unmount();
    }
  });

  it("blocks acceptance when a hard issue exists", async () => {
    const hardIssue: QualityIssue = {
      id: "issue-1",
      projectId: "demo-project",
      chapterId: "chapter-1",
      severity: "硬性",
      category: "设定冲突",
      message: "主角能力与契约不符",
      evidence: "第3段",
      status: "待处理",
      createdAt: "2026-09-03T00:00:00.000Z",
    };
    const { api, unmount } = await mountWritingPage({
      runQualityCheck: vi.fn(async () => [hardIssue]),
    });
    try {
      await userEvent.click(await screen.findByRole("button", { name: "AI 生成草稿" }));
      await screen.findByRole("dialog", { name: /审阅 AI 产出/ });
      await waitFor(() => expect(document.body.textContent ?? "").toContain("存在硬性问题"));
      expect(screen.queryByRole("button", { name: "采纳并进入待定稿" })).toBeNull();
      expect(screen.getByRole("button", { name: "先保留草稿，去处理问题" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "先保留草稿，去处理问题" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /审阅 AI 产出/ })).toBeNull());
      expect(api.transitionChapter).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
