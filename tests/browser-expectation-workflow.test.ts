import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-31T00:00:00.000Z");
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
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

describe("browser expectation workflow", () => {
  it("uses the shared normalization rules and preserves creation time", async () => {
    const api = createBrowserApi();
    const [summary] = await api.listProjects();
    const project = await api.getProject(summary.id);
    const existing = project.expectations[0];
    const savedAt = "2026-08-02T01:00:00.000Z";
    vi.setSystemTime(savedAt);

    const saved = await api.saveExpectation(summary.id, {
      ...existing,
      title: "  修订后的期待  ",
      description: "  修订后的描述  ",
    });
    const reloaded = await api.getProject(summary.id);

    expect(saved).toMatchObject({
      title: "修订后的期待",
      description: "修订后的描述",
      createdAt: existing.createdAt,
      updatedAt: savedAt,
    });
    expect(reloaded.expectations.find((item) => item.id === existing.id)).toEqual(saved);
  });
});
