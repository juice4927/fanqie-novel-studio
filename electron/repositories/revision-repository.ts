import type { DatabaseSync } from "node:sqlite";
import type { RevisionRecord } from "../../src/shared/types";

export class RevisionRepository {
  list(db: DatabaseSync, collection: RevisionRecord["collection"], entityId: string): RevisionRecord[] {
    const rows = db.prepare("SELECT id, collection, entity_id, revision, payload, created_at FROM revisions WHERE collection = ? AND entity_id = ? ORDER BY revision DESC")
      .all(collection, entityId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), collection: row.collection as RevisionRecord["collection"], entityId: String(row.entity_id), revision: Number(row.revision), payload: JSON.parse(String(row.payload)) as unknown, createdAt: String(row.created_at) }));
  }

  get(db: DatabaseSync, revisionId: string) {
    return db.prepare("SELECT collection, entity_id, payload FROM revisions WHERE id = ?").get(revisionId) as
      { collection: RevisionRecord["collection"]; entity_id: string; payload: string } | undefined;
  }
}
