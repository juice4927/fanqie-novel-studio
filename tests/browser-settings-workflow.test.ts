import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

let storedState: string | null;

beforeEach(() => {
  storedState = null;
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => storedState),
    setItem: vi.fn((_key: string, value: string) => { storedState = value; }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("browser AI settings", () => {
  it("migrates legacy settings to the compatible protocol", async () => {
    const api = createBrowserApi();
    const current = await api.getAiSettings();
    const { hasApiKey: _hasApiKey, ...input } = current;
    await api.saveAiSettings(input);
    const legacy = JSON.parse(storedState!);
    delete legacy.settings.protocol;
    storedState = JSON.stringify(legacy);

    await expect(createBrowserApi().getAiSettings()).resolves.toMatchObject({
      protocol: "openai-compatible",
    });
  });

  it("persists Anthropic Messages settings", async () => {
    const api = createBrowserApi();
    const current = await api.getAiSettings();
    const { hasApiKey: _hasApiKey, ...input } = current;
    const saved = await api.saveAiSettings({
      ...input,
      protocol: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
    }, "sk-ant-test");

    expect(saved).toMatchObject({
      protocol: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      hasApiKey: true,
    });
  });
});
