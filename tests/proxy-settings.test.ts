import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDatabase } from "../electron/database";

const roots: string[] = [];
const databases: WorkspaceDatabase[] = [];

function createDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-studio-proxy-"));
  roots.push(root);
  const database = new WorkspaceDatabase(root);
  databases.push(database);
  return database;
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("出站代理设置持久化", () => {
  it("默认关闭且为空", () => {
    expect(createDatabase().getProxySettings()).toEqual({
      enabled: false,
      url: "",
      username: "",
      hasPassword: false,
    });
  });

  it("保存后往返一致，密码不进数据库", () => {
    const database = createDatabase();
    const saved = database.saveProxySettings({
      enabled: true,
      url: "  http://127.0.0.1:7897  ",
      username: "user",
      password: "secret",
    });
    expect(saved).toEqual({ enabled: true, url: "http://127.0.0.1:7897", username: "user", hasPassword: false });
    expect(database.getProxySettings()).toEqual(saved);
  });
});
