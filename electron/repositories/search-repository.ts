import type { DatabaseSync } from "node:sqlite";
import type { Chapter, SearchHit } from "../../src/shared/types";

export class SearchRepository {
  search(db: DatabaseSync, query: string, chapters: readonly Chapter[], offset = 0, limit = 50): SearchHit[] {
    const normalized = query.trim().replace(/["'*:^(){}\[\]]/g, " ").trim();
    if (normalized.length < 2) return [];
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const hits = db.prepare("SELECT id, snippet(chapter_fts_tri, 2, '【', '】', '…', 24) AS excerpt FROM chapter_fts_tri WHERE chapter_fts_tri MATCH ? LIMIT ? OFFSET ?")
      .all(`"${normalized}"`, limit, offset) as Array<{ id: string; excerpt: string }>;
    return hits.flatMap((hit) => {
      const chapter = byId.get(hit.id);
      return chapter ? [{ id: chapter.id, type: "章节" as const, title: `第${chapter.number}章 ${chapter.title}`, excerpt: hit.excerpt, chapterNumber: chapter.number }] : [];
    });
  }
}
