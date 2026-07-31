// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import type {
  AiJobRecord,
  AiSettings,
  AppApi,
  AutoBackupSettings,
} from "../src/shared/types";

const settings: AiSettings = {
  baseUrl: "https://model.invalid/v1",
  model: "test-model",
  embeddingModel: "local",
  hasApiKey: true,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
  longTaskTimeoutMinutes: 10,
};

const autoBackup: AutoBackupSettings = {
  enabled: false,
  frequency: "daily",
  retentionCount: 7,
  hasPassword: false,
  lastRunAt: null,
  lastStatus: "未运行",
  lastError: null,
  nextRunAt: null,
};

afterEach(() => cleanup());

function createJob(
  id: string,
  inputSummary: string,
  overrides: Partial<AiJobRecord> = {},
): AiJobRecord {
  return {
    id,
    projectId: "project-1",
    taskType: "draft-chapter",
    inputSummary,
    promptVersion: "v1",
    provider: "test-provider",
    model: "test-model",
    status: "失败",
    inputTokens: 10,
    outputTokens: 0,
    actualCost: 0,
    durationMs: 100,
    headersAt: null,
    firstTokenAt: null,
    completedAt: "2026-07-31T00:00:01.000Z",
    chunkCount: 0,
    attemptCount: 1,
    error: "请求失败",
    retryable: true,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:01.000Z",
    ...overrides,
  };
}

describe("settings AI task center", () => {
  it("uses the returned retry record without reloading the job list", async () => {
    const source = createJob("job-source", "原失败任务");
    const staleRetry = createJob("job-retry", "旧重试记录");
    const newer = createJob("job-newer", "同时运行的更新任务", {
      status: "成功",
      retryable: false,
      error: null,
      createdAt: "2026-07-31T00:00:03.000Z",
      updatedAt: "2026-07-31T00:00:03.000Z",
    });
    const retried = createJob("job-retry", "新重试任务", {
      status: "运行中",
      completedAt: null,
      error: null,
      retryable: false,
      createdAt: "2026-07-31T00:00:02.000Z",
      updatedAt: "2026-07-31T00:00:02.000Z",
    });
    const listAiJobs = vi.fn().mockResolvedValue([newer, source, staleRetry]);
    const retryAiJob = vi.fn().mockResolvedValue(retried);
    const notify = vi.fn();
    const api = {
      getAiSettings: vi.fn().mockResolvedValue(settings),
      getWorkspacePath: vi.fn().mockResolvedValue("C:\\workspace"),
      getAutoBackupSettings: vi.fn().mockResolvedValue(autoBackup),
      listAiJobs,
      retryAiJob,
    } as unknown as AppApi;

    const { container } = render(<SettingsPage api={api} notify={notify} />);

    const sourceSummary = await screen.findByText("原失败任务");
    const sourceArticle = sourceSummary.closest("article");
    expect(sourceArticle).not.toBeNull();
    await userEvent.click(
      within(sourceArticle!).getByRole("button", { name: "重试" }),
    );

    expect(await screen.findByText("新重试任务")).toBeTruthy();
    expect(screen.getByText("原失败任务")).toBeTruthy();
    expect(screen.queryByText("旧重试记录")).toBeNull();
    expect(screen.getAllByText("新重试任务")).toHaveLength(1);
    expect(
      [...container.querySelectorAll(".ai-job-list strong")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["同时运行的更新任务", "新重试任务", "原失败任务"]);
    expect(retryAiJob).toHaveBeenCalledWith("job-source");
    expect(listAiJobs).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("AI 任务已重新开始");
  });

  it("keeps the current list when retrying fails", async () => {
    const source = createJob("job-source", "原失败任务");
    const listAiJobs = vi.fn().mockResolvedValue([source]);
    const retryAiJob = vi.fn().mockRejectedValue(new Error("重试启动失败"));
    const notify = vi.fn();
    const api = {
      getAiSettings: vi.fn().mockResolvedValue(settings),
      getWorkspacePath: vi.fn().mockResolvedValue("C:\\workspace"),
      getAutoBackupSettings: vi.fn().mockResolvedValue(autoBackup),
      listAiJobs,
      retryAiJob,
    } as unknown as AppApi;

    render(<SettingsPage api={api} notify={notify} />);

    await userEvent.click(
      within((await screen.findByText("原失败任务")).closest("article")!)
        .getByRole("button", { name: "重试" }),
    );

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("重试启动失败", "error"),
    );
    expect(screen.getByText("原失败任务")).toBeTruthy();
    expect(listAiJobs).toHaveBeenCalledTimes(1);
  });
});
