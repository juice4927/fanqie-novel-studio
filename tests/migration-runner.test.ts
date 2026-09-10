import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ensureStructure, hasColumn, type Migration, runMigrations } from "../electron/migration-runner";

const roots: string[] = [];
const databases: DatabaseSync[] = [];

function openDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "novel-migration-test-"));
  roots.push(root);
  const db = new DatabaseSync(path.join(root, "test.sqlite"));
  databases.push(db);
  return db;
}

function tableExists(db: DatabaseSync, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function migration(id: string, run: (db: DatabaseSync) => void = () => {}): Migration {
  return { id, run };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("ensureStructure", () => {
  it("补齐缺失的表与列，并给既有行填默认值", () => {
    const db = openDatabase();
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    db.exec("INSERT INTO projects(id, title) VALUES('p1', '旧书')");
    ensureStructure(db, {
      tables: { incubations: "CREATE TABLE IF NOT EXISTS incubations (id TEXT PRIMARY KEY)" },
      columns: { projects: { words_per_chapter: "INTEGER NOT NULL DEFAULT 2500" } },
    });
    expect(tableExists(db, "incubations")).toBe(true);
    expect(hasColumn(db, "projects", "words_per_chapter")).toBe(true);
    expect(
      (db.prepare("SELECT words_per_chapter FROM projects WHERE id = 'p1'").get() as { words_per_chapter: number })
        .words_per_chapter,
    ).toBe(2500);
  });

  it("可重复运行且不覆盖已有结构", () => {
    const db = openDatabase();
    const spec = {
      tables: { incubations: "CREATE TABLE IF NOT EXISTS incubations (id TEXT PRIMARY KEY)" },
      columns: { projects: { words_per_chapter: "INTEGER NOT NULL DEFAULT 2500" } },
    };
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY)");
    ensureStructure(db, spec);
    db.prepare("INSERT INTO projects(id, words_per_chapter) VALUES('p1', 3200)").run();
    ensureStructure(db, spec);
    expect(
      (db.prepare("SELECT words_per_chapter FROM projects WHERE id = 'p1'").get() as { words_per_chapter: number })
        .words_per_chapter,
    ).toBe(3200);
  });

  it("表不存在时跳过其补列", () => {
    const db = openDatabase();
    expect(() => ensureStructure(db, { columns: { projects: { words_per_chapter: "INTEGER" } } })).not.toThrow();
  });

  it("新建表在同一次修复中补齐后续字段", () => {
    const db = openDatabase();
    ensureStructure(db, {
      tables: { ai_jobs: "CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY)" },
      columns: { ai_jobs: { retry_context: "TEXT", input_tokens: "INTEGER NOT NULL DEFAULT 0" } },
    });
    db.prepare("INSERT INTO ai_jobs(id, retry_context) VALUES('job', 'retry')").run();
    expect(db.prepare("SELECT retry_context, input_tokens FROM ai_jobs WHERE id = 'job'").get()).toMatchObject({
      retry_context: "retry",
      input_tokens: 0,
    });
  });

  it("补列失败时同时回滚本轮创建的表", () => {
    const db = openDatabase();
    expect(() =>
      ensureStructure(db, {
        tables: { ai_jobs: "CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY)" },
        columns: { ai_jobs: { invalid_column: "INTEGER PRIMARY KEY" } },
      }),
    ).toThrow();
    expect(tableExists(db, "ai_jobs")).toBe(false);
  });
});

describe("runMigrations", () => {
  it("在数组中间插入的新迁移对已记账的库仍会执行", () => {
    const db = openDatabase();
    const first = migration("a", (database) => database.exec("CREATE TABLE a(id TEXT PRIMARY KEY)"));
    const second = migration("b", (database) => database.exec("CREATE TABLE b(id TEXT PRIMARY KEY)"));
    runMigrations(db, [first, second]);
    expect(tableExists(db, "a")).toBe(true);
    expect(tableExists(db, "b")).toBe(true);
    const inserted = migration("ab", (database) => database.exec("CREATE TABLE ab(id TEXT PRIMARY KEY)"));
    runMigrations(db, [first, inserted, second]);
    expect(tableExists(db, "ab")).toBe(true);
  });

  it("在取得写锁后重新读取迁移记录，避免按启动快照重复非幂等 DDL", () => {
    const db = openDatabase();
    const first = migration("first", (database) => {
      // 模拟另一启动实例在本次启动读取初始快照之后，已经完成了 second。
      database.exec("CREATE TABLE second_table(id TEXT PRIMARY KEY)");
      database
        .prepare("INSERT INTO schema_migrations(id, applied_at) VALUES('second', '2026-09-09T00:00:00.000Z')")
        .run();
    });
    const second = migration("second", (database) => database.exec("CREATE TABLE second_table(id TEXT PRIMARY KEY)"));

    expect(() => runMigrations(db, [first, second])).not.toThrow();
    expect(tableExists(db, "second_table")).toBe(true);
  });

  it("历史库按 user_version 播种一次后不再重复执行", () => {
    const db = openDatabase();
    db.exec("PRAGMA user_version = 2");
    const ran: string[] = [];
    const migrations = ["a", "b", "c"].map((id) => migration(id, () => ran.push(id)));
    runMigrations(db, migrations);
    expect(ran).toEqual(["c"]);
    runMigrations(db, migrations);
    expect(ran).toEqual(["c"]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
  });

  it("迁移失败时回滚且不记账", () => {
    const db = openDatabase();
    const broken = migration("broken", (database) => {
      database.exec("CREATE TABLE broken(id TEXT PRIMARY KEY)");
      throw new Error("boom");
    });
    expect(() => runMigrations(db, [broken])).toThrow(/数据库升级到 broken 失败/);
    expect(tableExists(db, "broken")).toBe(false);
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE id = 'broken'").get()).toBeUndefined();
  });

  it("数据库版本高于程序支持时拒绝打开", () => {
    const db = openDatabase();
    db.exec("PRAGMA user_version = 5");
    expect(() => runMigrations(db, [migration("a")])).toThrow(/高于当前程序支持的版本/);
  });
});
