import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Chapter } from "../../src/shared/types";

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

  listChapters(db: DatabaseSync): Chapter[] {
    return (db.prepare(`
      SELECT c.*, b.content FROM chapters c
      LEFT JOIN chapter_contents b ON b.chapter_id = c.id
      ORDER BY c.number
    `).all() as unknown as ChapterRow[]).map(hydrateChapter);
  }

  listChapterMetadata(db: DatabaseSync): Chapter[] {
    return (db.prepare("SELECT * FROM chapters ORDER BY number").all() as unknown as ChapterRow[])
      .map((row) => hydrateChapter({ ...row, content: "" }));
  }

  getChapter(db: DatabaseSync, id: string): Chapter | undefined {
    const row = db.prepare(`
      SELECT c.*, b.content FROM chapters c
      LEFT JOIN chapter_contents b ON b.chapter_id = c.id
      WHERE c.id = ?
    `).get(id) as ChapterRow | undefined;
    return row ? hydrateChapter(row) : undefined;
  }

  saveChapter(db: DatabaseSync, chapter: Chapter, priorRevision?: number, createRevision = true) {
    const previous = this.getChapter(db, chapter.id);
    if (previous && createRevision)
      this.addRevision(db, "chapters", chapter.id, priorRevision ?? this.nextRevision(db, "chapters", chapter.id), previous);
    const metadata = JSON.stringify({ ...chapter, content: "" });
    db.prepare(`
      INSERT OR REPLACE INTO chapters(
        id, number, title, outline, status, word_count, batch_mode,
        is_key_chapter, metadata, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chapter.id, chapter.number, chapter.title, chapter.outline, chapter.status,
      chapter.wordCount, chapter.batchMode, chapter.isKeyChapter ? 1 : 0,
      metadata, chapter.updatedAt,
    );
    db.prepare("INSERT OR REPLACE INTO chapter_contents(chapter_id, content) VALUES(?, ?)")
      .run(chapter.id, chapter.content);
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

interface ChapterRow {
  id: string;
  number: number;
  title: string;
  outline: string;
  status: Chapter["status"];
  word_count: number;
  batch_mode: Chapter["batchMode"];
  is_key_chapter: number;
  metadata: string;
  updated_at: string;
  content?: string | null;
}

function hydrateChapter(row: ChapterRow): Chapter {
  return {
    ...(JSON.parse(row.metadata) as Chapter),
    id: row.id,
    number: Number(row.number),
    title: row.title,
    outline: row.outline,
    content: row.content ?? "",
    status: row.status,
    wordCount: Number(row.word_count),
    batchMode: row.batch_mode,
    isKeyChapter: Boolean(row.is_key_chapter),
    updatedAt: row.updated_at,
  };
}
