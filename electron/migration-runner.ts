import type { DatabaseSync } from "node:sqlite";

export function hasColumn(db: DatabaseSync, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

export function runMigrations(db: DatabaseSync, migrations: ReadonlyArray<(database: DatabaseSync) => void>) {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (current > migrations.length) throw new Error(`数据库版本 ${current} 高于当前程序支持的版本 ${migrations.length}`);
  for (let version = current + 1; version <= migrations.length; version += 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      migrations[version - 1](db);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw new Error(`数据库升级到版本 ${version} 失败`, { cause: error });
    }
  }
}
