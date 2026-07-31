import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

const initialTime = "2026-07-31T00:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
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

describe("browser fact workflow", () => {
  it("ends valid replacements and preserves closed historical facts", async () => {
    const api = createBrowserApi();
    const [summary] = await api.listProjects();
    const project = await api.getProject(summary.id);
    const current = project.facts[0];
    const replacementAt = "2026-08-03T01:00:00.000Z";
    vi.setSystemTime(replacementAt);

    const replacement = await api.saveFact(summary.id, {
      ...current,
      id: "",
      value: "事故前五分钟听见求救回声",
      validFromChapter: 2,
      evidenceChapter: 2,
      replacesFactId: current.id,
    });
    const afterReplacement = await api.getProject(summary.id);

    expect(replacement).toMatchObject({
      confidence: "已确认",
      validFromChapter: 2,
      updatedAt: replacementAt,
    });
    expect(
      afterReplacement.facts.find((fact) => fact.id === current.id),
    ).toMatchObject({ validToChapter: 1, updatedAt: replacementAt });
    expect(afterReplacement.summary.updatedAt).toBe(replacementAt);

    const historical = await api.saveFact(summary.id, {
      ...replacement,
      id: "",
      value: "事故前六分钟听见求救回声",
      validFromChapter: 1,
      validToChapter: 1,
      evidenceChapter: 1,
      replacesFactId: undefined,
    });

    expect(historical.confidence).toBe("已确认");
  });
});
