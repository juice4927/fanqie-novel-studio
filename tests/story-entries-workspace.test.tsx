// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seed } from "../src/lib/browser-demo";
import { StoryEntriesPage } from "../src/pages/StoryEntriesWorkspace";
import type { AppApi, Chapter, ProjectDetail, StoryEntry } from "../src/shared/types";

afterEach(cleanup);

function entry(patch: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id: "entry-1",
    kind: "人物",
    name: "林舟",
    aliases: [],
    summary: "调查员",
    detail: "市局调查员",
    aiContext: "detected",
    effectiveFrom: 1,
    effectiveTo: null,
    revealChapter: null,
    knownBy: [],
    exclusionTerms: [],
    sourceContractItem: null,
    pinned: false,
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...patch,
  };
}

function chapter(number: number, outline: string, content: string): Chapter {
  return {
    id: `chapter-${number}`,
    number,
    title: `标题${number}`,
    outline,
    content,
    wordCount: 100,
    status: "草稿",
    batchMode: "逐章",
    isKeyChapter: false,
    revision: 1,
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

function projectWith(patch: Partial<ProjectDetail>): ProjectDetail {
  return { ...seed().projects[0], ...patch };
}

function renderPage(project: ProjectDetail) {
  return render(
    <StoryEntriesPage project={project} api={{} as AppApi} reload={vi.fn(async () => undefined)} notify={vi.fn()} />,
  );
}

describe("story entries workspace", () => {
  it("filters by query and kind", () => {
    renderPage(
      projectWith({
        storyEntries: [entry({ id: "a", name: "林舟" }), entry({ id: "b", name: "旧站", kind: "地点" })],
      }),
    );
    expect(screen.getByText("林舟")).toBeTruthy();
    expect(screen.getByText("旧站")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索设定条目"), { target: { value: "旧站" } });
    expect(screen.queryByText("林舟")).toBeNull();
    expect(screen.getByText("旧站")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("按类型筛选"), { target: { value: "人物" } });
    expect(screen.queryByText("旧站")).toBeNull();
    expect(screen.getByText("没有符合筛选条件的条目")).toBeTruthy();
  });

  it("audits appearance chapters across outline and content", () => {
    renderPage(
      projectWith({
        chapters: [chapter(1, "林舟出场", ""), chapter(2, "没有关键人物", "林舟出现")],
        storyEntries: [entry({ id: "a", name: "林舟" })],
      }),
    );

    fireEvent.click(screen.getByText("出现章节"));
    expect(screen.getByText(/共出现在 2 章/)).toBeTruthy();
    expect(screen.getByText("第1章")).toBeTruthy();
    expect(screen.getByText("第2章")).toBeTruthy();
  });
});
