import type { DatabaseSync } from "node:sqlite";

export function hasColumn(db: DatabaseSync, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

export interface Migration {
  /** 稳定标识：一经发布不得改动或删除，新增迁移只能追加新 id。 */
  id: string;
  run: (database: DatabaseSync) => void;
}

function recordApplied(db: DatabaseSync, id: string) {
  db.prepare("INSERT OR IGNORE INTO schema_migrations(id, applied_at) VALUES(?, ?)").run(id, new Date().toISOString());
}

/**
 * 按稳定 id 记账的迁移器。
 *
 * 历史库只有 `PRAGMA user_version`（迁移条数），首次运行时把前 N 条标记为已应用；此后新增
 * 迁移无论写在数组哪个位置，只要 id 是新的就会执行——在数组中间插入迁移不会再让老库跳过
 * 它（此前按下标记账时发生过，`incubations` 表与 `projects.words_per_chapter` 因此在既有
 * 工作区永久缺失）。`user_version` 保留为降级保护。
 */
export function runMigrations(db: DatabaseSync, migrations: ReadonlyArray<Migration>) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const legacy = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (legacy > migrations.length) throw new Error(`数据库版本 ${legacy} 高于当前程序支持的版本 ${migrations.length}`);

  // 历史库的 user_version 只在没有稳定迁移记录时作为一次性播种依据。
  // 必须在写锁内再次确认，避免两个工作台同时启动时互相覆盖判断。
  db.exec("BEGIN IMMEDIATE");
  try {
    const hasStableRecords = Boolean(db.prepare("SELECT 1 FROM schema_migrations LIMIT 1").get());
    if (!hasStableRecords && legacy > 0) {
      for (const migration of migrations.slice(0, legacy)) recordApplied(db, migration.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* transaction already closed */
    }
    throw new Error("数据库迁移记录初始化失败", { cause: error });
  }

  for (const migration of migrations) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // 已应用状态只能在取得写锁后判断。否则另一实例完成迁移后，本实例仍会
      // 基于旧快照重复执行包含非幂等 DDL 的迁移（例如 project-0002）。
      const applied = Boolean(db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(migration.id));
      if (!applied) {
        migration.run(db);
        recordApplied(db, migration.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw new Error(`数据库升级到 ${migration.id} 失败`, { cause: error });
    }
  }
  if (legacy < migrations.length) db.exec(`PRAGMA user_version = ${migrations.length}`);
}

export interface StructureSpec {
  /** 表名 → 建表语句（必须是 `CREATE TABLE IF NOT EXISTS`）。 */
  tables?: Readonly<Record<string, string>>;
  /** 表名 → 列名 → 列定义。 */
  columns?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * 幂等的结构自检：补齐缺失的表与列，兜底修复「迁移记账跳过了某条迁移」的历史工作区。
 * 只做新增，不删改既有结构。
 */
export function ensureStructure(db: DatabaseSync, spec: StructureSpec) {
  const missingTables = Object.keys(spec.tables ?? {}).some(
    (table) => !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
  const missingColumns = Object.entries(spec.columns ?? {}).some(([table, columns]) =>
    Object.keys(columns).some((column) => !hasColumn(db, table, column)),
  );
  if (!missingTables && !missingColumns) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, ddl] of Object.entries(spec.tables ?? {})) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) db.exec(ddl);
    }
    // 建表后重新探测列，保证新建表的后续字段在本次启动内一起补齐。
    for (const [table, columns] of Object.entries(spec.columns ?? {})) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
      for (const [column, definition] of Object.entries(columns)) {
        if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* transaction already closed */
    }
    throw error;
  }
}
