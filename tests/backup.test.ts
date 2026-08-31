import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoBackupFileName,
  createEncryptedBackup,
  nextAutoBackupAt,
  pruneAutoBackups,
  restoreEncryptedBackup,
  verifyEncryptedBackup,
} from "../electron/backup";
import { WorkspaceDatabase } from "../electron/database";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("encrypted backup", () => {
  it("schedules daily and weekly runs deterministically", () => {
    const start = new Date("2026-07-30T08:00:00.000Z");
    expect(nextAutoBackupAt("daily", start)).toBe("2026-07-31T08:00:00.000Z");
    expect(nextAutoBackupAt("weekly", start)).toBe("2026-08-06T08:00:00.000Z");
    expect(autoBackupFileName(start)).toBe("auto-2026-07-30T08-00-00-000Z.novelbak");
  });

  it("rotates only managed automatic backups", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-backup-rotation-"));
    roots.push(root);
    const managed = [
      "auto-2026-07-28T08-00-00-000Z.novelbak",
      "auto-2026-07-29T08-00-00-000Z.novelbak",
      "auto-2026-07-30T08-00-00-000Z.novelbak",
    ];
    for (const name of managed) writeFileSync(path.join(root, name), name);
    writeFileSync(path.join(root, "manual.novelbak"), "manual");
    await pruneAutoBackups(root, 2);
    expect(existsSync(path.join(root, managed[0]))).toBe(false);
    expect(existsSync(path.join(root, managed[1]))).toBe(true);
    expect(existsSync(path.join(root, managed[2]))).toBe(true);
    expect(existsSync(path.join(root, "manual.novelbak"))).toBe(true);
  });

  it("encrypts the workspace and restores a verified copy", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-backup-test-"));
    roots.push(root);
    const database = new WorkspaceDatabase(root);
    database.createProject({ title: "备份作品", genre: "年代重生", targetWords: 3000000, updateCadence: "每日1章" });
    database.checkpointAll();
    const backup = path.join(os.tmpdir(), `novel-${crypto.randomUUID()}.novelbak`);
    roots.push(backup);
    await createEncryptedBackup(root, backup, "strong-password");
    expect(await verifyEncryptedBackup(backup, "strong-password")).toMatchObject({ fileCount: expect.any(Number) });
    expect(readFileSync(backup).subarray(0, 2).toString()).not.toBe("PK");
    const restored = await restoreEncryptedBackup(backup, root, "strong-password");
    expect(readFileSync(path.join(restored, "catalog.sqlite")).byteLength).toBeGreaterThan(0);
    await expect(restoreEncryptedBackup(backup, root, "wrong-password")).rejects.toThrow(/密码错误|损坏/);
    database.close();
  });
});
