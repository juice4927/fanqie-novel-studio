// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../src/pages/DashboardPage";
import type { DashboardData } from "../src/shared/types";

const emptyDashboard: DashboardData = {
  projects: [],
  dueToday: [],
  activeAlerts: [],
  totals: { activeBooks: 0, totalWords: 0, stockChapters: 0, pendingIssues: 0 },
};

afterEach(() => cleanup());

describe("空态首启清单", () => {
  it("未配置密钥时显示去配置并能跳到设置页", async () => {
    const onOpenSettings = vi.fn();
    render(
      <DashboardPage
        data={emptyDashboard}
        hasApiKey={false}
        onCreate={() => {}}
        onOpenProject={() => {}}
        onOpenSettings={onOpenSettings}
        onDeleteProject={() => {}}
      />,
    );
    expect(screen.getByText("配置 AI 密钥")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "去配置" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("已配置密钥时标记完成并隐藏跳转按钮", () => {
    render(
      <DashboardPage
        data={emptyDashboard}
        hasApiKey
        onCreate={() => {}}
        onOpenProject={() => {}}
        onDeleteProject={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "去配置" })).toBeNull();
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("密钥状态未知时不显示跳转按钮，避免误导", () => {
    render(
      <DashboardPage
        data={emptyDashboard}
        hasApiKey={null}
        onCreate={() => {}}
        onOpenProject={() => {}}
        onDeleteProject={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "去配置" })).toBeNull();
  });
});
