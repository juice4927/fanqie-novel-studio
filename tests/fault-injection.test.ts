import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEncryptedBackup } from "../electron/backup";
import { readApiCredential } from "../electron/credential-store";
import { WorkspaceDatabase } from "../electron/database";
import { scanSystemHealth } from "../electron/health-service";

const roots: string[] = [];
afterEach(() => {
  delete process.env.NOVEL_STUDIO_FAULTS;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("real boundary fault injection", () => {
  it("reports a genuinely corrupted project database", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-corrupt-"));
    roots.push(root);
    const db = new WorkspaceDatabase(root);
    const project = db.createProject({
      title: "损坏测试",
      genre: "都市脑洞",
      targetWords: 100000,
      updateCadence: "每日1章",
    });
    db.close();
    writeFileSync(path.join(root, "projects", project.id, "project.sqlite"), Buffer.from("not a sqlite database"));
    const report = await scanSystemHealth(root);
    expect(report.status).toBe("错误");
    expect(report.checks.find((check) => check.id === `project-integrity-${project.id}`)).toMatchObject({
      status: "错误",
    });
  });

  it("rolls back chapter writes interrupted before commit", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-power-"));
    roots.push(root);
    const db = new WorkspaceDatabase(root);
    const project = db.createProject({
      title: "断电测试",
      genre: "都市脑洞",
      targetWords: 100000,
      updateCadence: "每日1章",
    });
    process.env.NOVEL_STUDIO_FAULTS = "power-loss-before-commit";
    expect(() =>
      db.saveChapter(project.id, {
        id: "",
        number: 1,
        title: "第一章",
        outline: "推进",
        content: "正文",
        wordCount: 0,
        status: "草稿",
        batchMode: "逐章",
        isKeyChapter: false,
        revision: 0,
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow("power loss");
    delete process.env.NOVEL_STUDIO_FAULTS;
    expect(db.getProject(project.id).chapters).toHaveLength(0);
    db.close();
  });

  it("surfaces disk-full and credential-service failures without partial success", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-full-"));
    roots.push(root);
    const backup = path.join(root, "failed.novelbak");
    writeFileSync(backup, "previous-valid-backup");
    process.env.NOVEL_STUDIO_FAULTS = "disk-full";
    await expect(createEncryptedBackup(root, backup, "strong-password")).rejects.toMatchObject({ code: "ENOSPC" });
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe("previous-valid-backup");
    process.env.NOVEL_STUDIO_FAULTS = "credential-unavailable";
    await expect(readApiCredential()).rejects.toThrow("credential service unavailable");
  });
});
