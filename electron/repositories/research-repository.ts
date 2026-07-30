import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { InsightPack, ResearchAnalysisRecord, ResearchBook } from "../../src/shared/types";

const now = () => new Date().toISOString();
const hashText = (value: string) => createHash("sha256").update(value).digest("hex");
const textWindows = (text: string, stride: number) => {
  const normalized = text.replace(/\s+/g, "");
  const result: string[] = [];
  for (let index = 0; index + 24 <= normalized.length; index += stride) result.push(normalized.slice(index, index + 24));
  return result;
};

export class ResearchRepository {
  constructor(private readonly db: DatabaseSync) {}

  listBooks(): ResearchBook[] {
    return (this.db.prepare("SELECT payload FROM research_books ORDER BY updated_at DESC").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as ResearchBook);
  }

  saveBook(book: ResearchBook, chapters: Array<{ title: string; content: string; wordCount: number }>) {
    this.db.prepare("INSERT OR REPLACE INTO research_books VALUES(?, ?, ?)").run(book.id, JSON.stringify(book), now());
    const insert = this.db.prepare("INSERT INTO research_chapters VALUES(?, ?, ?, ?, ?, ?)");
    const fingerprint = this.db.prepare("INSERT OR IGNORE INTO research_fingerprints VALUES(?, ?, ?)");
    chapters.forEach((chapter, index) => {
      insert.run(randomUUID(), book.id, index + 1, chapter.title, chapter.content, chapter.wordCount);
      for (const window of textWindows(chapter.content, 8)) fingerprint.run(hashText(window), book.id, window);
    });
  }

  getBook(bookId: string) {
    const row = this.db.prepare("SELECT payload FROM research_books WHERE id = ?").get(bookId) as { payload: string } | undefined;
    if (!row) throw new Error("样本书不存在");
    const chapters = this.db.prepare("SELECT ordinal, title, content, word_count FROM research_chapters WHERE book_id = ? ORDER BY ordinal").all(bookId) as Array<Record<string, unknown>>;
    return { book: JSON.parse(row.payload) as ResearchBook, chapters: chapters.map((item) => ({ ordinal: Number(item.ordinal), title: String(item.title), content: String(item.content), wordCount: Number(item.word_count) })) };
  }

  saveAnalyses(records: ResearchAnalysisRecord[]) {
    if (records[0]) this.db.prepare("DELETE FROM research_analyses WHERE book_id = ?").run(records[0].bookId);
    const insert = this.db.prepare("INSERT OR REPLACE INTO research_analyses VALUES(?, ?, ?, ?, ?, ?, ?)");
    for (const record of records) insert.run(record.id, record.bookId, record.layer, record.fromChapter, record.toChapter, JSON.stringify(record), record.createdAt);
  }

  listAnalyses(bookId: string): ResearchAnalysisRecord[] {
    return (this.db.prepare("SELECT payload FROM research_analyses WHERE book_id = ? ORDER BY from_chapter, layer").all(bookId) as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as ResearchAnalysisRecord);
  }

  updateBook(book: ResearchBook) {
    this.db.prepare("UPDATE research_books SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(book), now(), book.id);
  }

  listInsights(): InsightPack[] {
    return (this.db.prepare("SELECT payload FROM insights ORDER BY created_at DESC").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as InsightPack);
  }

  saveInsight(insight: InsightPack) {
    this.db.prepare("INSERT OR REPLACE INTO insights VALUES(?, ?, ?)").run(insight.id, JSON.stringify(insight), insight.createdAt);
  }

  originalityMatches(content: string) {
    const matches = new Map<string, { researchRef: string; fingerprint: string }>();
    const query = this.db.prepare("SELECT book_id FROM research_fingerprints WHERE hash = ? LIMIT 5");
    for (const window of textWindows(content, 1)) {
      const fingerprint = hashText(window);
      for (const row of query.all(fingerprint) as Array<{ book_id: string }>) {
        matches.set(`${row.book_id}:${fingerprint}`, { researchRef: hashText(row.book_id).slice(0, 12), fingerprint: fingerprint.slice(0, 16) });
        if (matches.size >= 10) return [...matches.values()];
      }
    }
    return [...matches.values()];
  }
}
