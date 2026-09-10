// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaunchPackReview } from "../src/components/LaunchPackReview";
import { seed } from "../src/lib/browser-demo";
import type { AppApi, ProjectDetail } from "../src/shared/types";

afterEach(cleanup);

function draftProject(): ProjectDetail {
  const project = seed().projects[0];
  project.contract.approved = false;
  project.launchPack = {
    status: "待确认",
    phase: "完成",
    targetChapters: 45,
    completedChapters: 45,
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
  project.contract.worldRules = ["消息只能沿既定线路传递，跨区需要有人承担代价。"];
  project.plans = project.plans.map((plan) => ({ ...plan, status: "草稿" }));
  project.chapters = Array.from({ length: 45 }, (_, index) => ({
    ...project.chapters[0],
    id: `chapter-${index + 1}`,
    number: index + 1,
    title: `事件 ${index + 1}`,
    outline: `第 ${index + 1} 次行动的起因与结果。`,
    content: "",
    status: "章纲" as const,
  }));
  return project;
}

function renderReview(project = draftProject(), approve = vi.fn(async () => undefined)) {
  const notify = vi.fn();
  const reload = vi.fn(async () => undefined);
  const generate = vi.fn(async () => ({ plans: 2, chapters: 20 }));
  const api = { approveLaunchPack: approve, generateLaunchPack: generate } as unknown as AppApi;
  render(
    <LaunchPackReview
      project={project}
      api={api}
      reload={reload}
      notify={notify}
      onEditContract={vi.fn()}
      onEditPlans={vi.fn()}
    />,
  );
  return { approve, notify, reload, generate };
}

describe("launch pack review", () => {
  it("keeps drafts unapproved while browsing and confirms only on an explicit author action", async () => {
    const project = draftProject();
    const { approve, reload } = renderReview(project);
    expect(screen.getByText(project.contract.worldRules![0])).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "分层大纲" }));
    expect(screen.getByText(project.plans[0].title)).toBeTruthy();
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认创作包" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith(project.summary.id));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("makes every generated chapter available through bounded pages", () => {
    const { approve } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "全书章纲" }));
    expect(screen.getByRole("heading", { name: "第 1 章 · 事件 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "第 45 章 · 事件 45" })).toBeNull();
    fireEvent.change(screen.getByLabelText("内容页码"), { target: { value: "2" } });
    expect(screen.getByRole("heading", { name: "第 45 章 · 事件 45" })).toBeTruthy();
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps the review open and reports approval failures", async () => {
    const { approve, notify, reload } = renderReview(
      draftProject(),
      vi.fn(async () => {
        throw new Error("世界规则尚未完整");
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认创作包" }));
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    await waitFor(() => expect(notify).toHaveBeenCalledWith("世界规则尚未完整", "error"));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认创作包" })).toBeTruthy();
  });

  it("shows generation progress and prevents confirmation of an incomplete package", () => {
    const project = draftProject();
    project.launchPack = { ...project.launchPack!, status: "生成中", phase: "逐章规划", completedChapters: 20 };
    const { approve } = renderReview(project);
    expect(screen.getByRole("status").textContent).toContain("20 / 45");
    expect((screen.getByRole("button", { name: "确认创作包" }) as HTMLButtonElement).disabled).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });

  it("resumes a paused package without approving existing drafts", async () => {
    const project = draftProject();
    project.launchPack = { ...project.launchPack!, status: "已暂停", completedChapters: 20, error: "服务暂时不可用" };
    const { approve, generate, reload } = renderReview(project);
    expect(screen.getByText("服务暂时不可用")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认创作包" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith(project.summary.id));
    expect(reload).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
  });
});
