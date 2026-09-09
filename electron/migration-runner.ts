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
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((row) => row.id),
  );
  const legacy = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (legacy > migrations.length) throw new Error(`数据库版本 ${legacy} 高于当前程序支持的版本 ${migrations.length}`);
  if (!applied.size && legacy > 0)
    for (const migration of migrations.slice(0, legacy)) {
      recordApplied(db, migration.id);
      applied.add(migration.id);
    }
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.run(db);
      recordApplied(db, migration.id);
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
  const statements: string[] = [];
  for (const [table, ddl] of Object.entries(spec.tables ?? {})) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) statements.push(ddl);
  }
  for (const [table, columns] of Object.entries(spec.columns ?? {})) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
    for (const [column, definition] of Object.entries(columns)) {
      if (!hasColumn(db, table, column)) statements.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!statements.length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) db.exec(statement);
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
