import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEncryptedBackup, restoreEncryptedBackup } from "../electron/backup";
import { WorkspaceDatabase } from "../electron/database";

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("encrypted backup", () => {
  it("encrypts the workspace and restores a verified copy", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "novel-backup-test-")); roots.push(root);
    const database = new WorkspaceDatabase(root);
    database.createProject({ title: "备份作品", genre: "年代重生", targetWords: 3000000, updateCadence: "每日1章" });
    database.checkpointAll();
    const backup = path.join(os.tmpdir(), `novel-${crypto.randomUUID()}.novelbak`); roots.push(backup);
    await createEncryptedBackup(root, backup, "strong-password");
    expect(readFileSync(backup).subarray(0, 2).toString()).not.toBe("PK");
    const restored = await restoreEncryptedBackup(backup, root, "strong-password");
    expect(readFileSync(path.join(restored, "catalog.sqlite")).byteLength).toBeGreaterThan(0);
    await expect(restoreEncryptedBackup(backup, root, "wrong-password")).rejects.toThrow(/密码错误|损坏/);
    database.close();
  });
});
