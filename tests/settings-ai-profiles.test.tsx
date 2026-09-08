// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import type { AiProfileView, AiRoleRoute } from "../src/shared/ai/types";
import type { AiSettings, AppApi, AutoBackupSettings, UpdateStatus } from "../src/shared/types";

const settings: AiSettings = {
  protocol: "openai-compatible",
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

const updateStatus: UpdateStatus = {
  phase: "idle",
  currentVersion: "0.2.1",
  availableVersion: null,
  progressPercent: null,
  releaseNotes: null,
  lastCheckedAt: null,
  error: null,
  autoCheck: true,
  autoInstallOnQuit: false,
  backupPasswordRequired: false,
  canInstall: false,
};

function profile(overrides: Partial<AiProfileView> = {}): AiProfileView {
  return {
    id: "p-main",
    name: "DeepSeek 主力",
    apiSurface: "openai-chat",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    authScheme: "bearer",
    extraHeaders: {},
    extraQuery: {},
    localEndpoint: false,
    enabled: true,
    sortOrder: 0,
    notes: "",
    lastUsedAt: null,
    lastTestAt: null,
    lastTestOk: null,
    lastError: null,
    hasApiKey: true,
    ...overrides,
  };
}

function createApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getAiSettings: vi.fn().mockResolvedValue(settings),
    getWorkspacePath: vi.fn().mockResolvedValue("C:\\workspace"),
    getAutoBackupSettings: vi.fn().mockResolvedValue(autoBackup),
    getUpdateStatus: vi.fn().mockResolvedValue(updateStatus),
    onUpdateStatus: vi.fn(() => () => undefined),
    listAiJobs: vi.fn().mockResolvedValue([]),
    listAiProfiles: vi.fn().mockResolvedValue([profile()]),
    getDefaultAiProfileId: vi.fn().mockResolvedValue(null),
    listAiRoleRoutes: vi.fn().mockResolvedValue([] as AiRoleRoute[]),
    testAiProfile: vi.fn().mockResolvedValue({ ok: true, message: "连接成功：deepseek-chat" }),
    setDefaultAiProfile: vi.fn().mockResolvedValue(undefined),
    setAiRoleRoute: vi.fn().mockResolvedValue({ role: "draft", profileId: "p-main", modelId: "deepseek-reasoner" }),
    refreshAiProfileModels: vi.fn().mockResolvedValue([]),
    exportAiProfiles: vi.fn().mockResolvedValue("{}"),
    importAiProfiles: vi.fn().mockResolvedValue([]),
    deleteAiProfile: vi.fn().mockResolvedValue(undefined),
    saveAiProfile: vi.fn(async (input: AiProfileView) => input),
    saveAiSettings: vi.fn(async (input, apiKey) => ({ ...input, hasApiKey: Boolean(apiKey) })),
    ...overrides,
  } as unknown as AppApi;
}

afterEach(() => cleanup());

describe("settings model sources", () => {
  it("lists sources, tests the connection, and sets the default", async () => {
    const api = createApi();
    const notify = vi.fn();
    render(<SettingsPage api={api} notify={notify} />);

    const nameNodes = await screen.findAllByText("DeepSeek 主力");
    expect(nameNodes.some((node) => node.tagName === "STRONG")).toBe(true);
    expect(screen.getByText(/api\.deepseek\.com\/v1/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /设为默认/ }));
    await waitFor(() => expect(api.setDefaultAiProfile).toHaveBeenCalledWith("p-main"));

    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(api.testAiProfile).toHaveBeenCalledWith("p-main"));
  });

  it("saves a role route when the role model changes", async () => {
    const api = createApi({
      listAiRoleRoutes: vi.fn().mockResolvedValue([{ role: "draft", profileId: "p-main", modelId: "deepseek-chat" }]),
    });
    render(<SettingsPage api={api} notify={vi.fn()} />);

    const modelInput = await screen.findByDisplayValue("deepseek-chat");
    await userEvent.clear(modelInput);
    await userEvent.type(modelInput, "deepseek-reasoner");
    await userEvent.tab();

    await waitFor(() => expect(api.setAiRoleRoute).toHaveBeenCalledWith("draft", "p-main", "deepseek-reasoner"));
  });

  it("saves the outbound proxy settings", async () => {
    const api = createApi({
      getProxySettings: vi.fn().mockResolvedValue({ enabled: false, url: "", username: "", hasPassword: false }),
      saveProxySettings: vi.fn(async (input) => ({ ...input, hasPassword: Boolean(input.password) })),
      testProxyConnection: vi.fn().mockResolvedValue({ ok: true, message: "代理连通" }),
    });
    render(<SettingsPage api={api} notify={vi.fn()} />);

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /启用代理/ }), "yes");
    await userEvent.type(screen.getByLabelText(/代理地址/), "http://127.0.0.1:7897");
    await userEvent.click(screen.getByRole("button", { name: "保存代理设置" }));

    await waitFor(() =>
      expect(api.saveProxySettings).toHaveBeenCalledWith({
        enabled: true,
        url: "http://127.0.0.1:7897",
        username: "",
      }),
    );
  });

  it("keeps the legacy single-source form when the build has no profile support", async () => {
    const api = createApi({ listAiProfiles: undefined });
    render(<SettingsPage api={api} notify={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: /接口协议/ })).toBeTruthy();
    expect(screen.queryByText("模型来源")).toBeNull();
  });
});
