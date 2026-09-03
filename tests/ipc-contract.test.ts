import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../electron/ipc-validation";

describe("IPC contract coherence", () => {
  it("exposes a unique, sorted channel list derived from AppApi", () => {
    expect(IPC_CHANNELS.length).toBeGreaterThan(50);
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
    expect(IPC_CHANNELS).toEqual([...IPC_CHANNELS].sort());
    expect(IPC_CHANNELS).not.toContain("onChapterFactsExtracted");
  });

  it("uses only studio-scoped, snake-cased channel names", () => {
    for (const channel of IPC_CHANNELS) expect(channel).toMatch(/^[a-z][a-zA-Z0-9]+$/);
  });

  it("covers the core write and read surface", () => {
    for (const required of [
      "getDashboard",
      "listProjects",
      "createProject",
      "getProject",
      "saveChapter",
      "saveContract",
      "savePlan",
      "saveFact",
      "resolveIssue",
      "saveChangeRequest",
      "saveSchedule",
      "saveAiSettings",
      "exportDiagnosticBundle",
      "createBackup",
      "restoreBackup",
      "runQualityCheck",
      "capturePublicRanking",
      "importMetricsCsv",
    ])
      expect(IPC_CHANNELS).toContain(required);
  });
});
