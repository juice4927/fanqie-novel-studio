import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const now = () => new Date().toISOString();

export class ProjectRepository {
  constructor(private readonly catalog: DatabaseSync) {}

  touch(projectId: string) {
    this.catalog.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
  }

  setState<T>(db: DatabaseSync, key: string, value: T) {
    db.prepare("INSERT OR REPLACE INTO state(key, value, updated_at) VALUES(?, ?, ?)").run(key, JSON.stringify(value), now());
  }

  getState<T>(db: DatabaseSync, key: string, fallback?: T): T {
    const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
    if (row) return JSON.parse(row.value) as T;
    if (fallback !== undefined) return fallback;
    throw new Error(`项目状态缺失: ${key}`);
  }

  listRecords<T>(db: DatabaseSync, collection: string): T[] {
    return (db.prepare("SELECT payload FROM records WHERE collection = ?").all(collection) as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as T);
  }

  getRecord<T>(db: DatabaseSync, collection: string, id: string): T | undefined {
    const row = db.prepare("SELECT payload FROM records WHERE collection = ? AND id = ?").get(collection, id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }

  saveRecord<T>(db: DatabaseSync, collection: string, id: string, payload: T, priorRevision?: number, createRevision = true) {
    const previous = this.getRecord<T>(db, collection, id);
    if (previous && createRevision) this.addRevision(db, collection, id, priorRevision ?? this.nextRevision(db, collection, id), previous);
    db.prepare("INSERT OR REPLACE INTO records(collection, id, payload, updated_at) VALUES(?, ?, ?, ?)").run(collection, id, JSON.stringify(payload), now());
  }

  addRevision<T>(db: DatabaseSync, collection: string, id: string, revision: number, payload: T) {
    db.prepare("INSERT INTO revisions VALUES(?, ?, ?, ?, ?, ?)").run(randomUUID(), collection, id, revision, JSON.stringify(payload), now());
  }

  nextRevision(db: DatabaseSync, collection: string, id: string) {
    const row = db.prepare("SELECT MAX(revision) AS revision FROM revisions WHERE collection = ? AND entity_id = ?").get(collection, id) as { revision: number | null };
    return (row.revision ?? 0) + 1;
  }
}
