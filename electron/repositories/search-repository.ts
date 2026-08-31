import type { DatabaseSync } from "node:sqlite";
import type { Chapter, SearchHit } from "../../src/shared/types";

export class SearchRepository {
  search(db: DatabaseSync, query: string, chapters: readonly Chapter[], offset = 0, limit = 50): SearchHit[] {
    const normalized = query.trim().replace(/["'*:^(){}\[\]]/g, " ").trim();
    if (normalized.length < 2) return [];
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    if ([...normalized].length < 3) {
      const escaped = normalized.replace(/[\\%_]/g, "\\$&");
      const hits = db.prepare(`
        SELECT c.id, c.title, COALESCE(b.content, '') AS content
        FROM chapters c
        LEFT JOIN chapter_contents b ON b.chapter_id = c.id
        WHERE c.title LIKE ? ESCAPE '\\' OR b.content LIKE ? ESCAPE '\\'
        ORDER BY c.number
        LIMIT ? OFFSET ?
      `).all(`%${escaped}%`, `%${escaped}%`, limit, offset) as Array<{ id: string; title: string; content: string }>;
      return hits.flatMap((hit) => {
        const chapter = byId.get(hit.id);
        if (!chapter) return [];
        const source = hit.content.includes(normalized) ? hit.content : hit.title;
        const index = source.indexOf(normalized);
        const from = Math.max(0, index - 20);
        const to = Math.min(source.length, index + normalized.length + 20);
        const excerpt = `${from ? "…" : ""}${source.slice(from, index)}【${normalized}】${source.slice(index + normalized.length, to)}${to < source.length ? "…" : ""}`;
        return [{ id: chapter.id, type: "章节" as const, title: `第${chapter.number}章 ${chapter.title}`, excerpt, chapterNumber: chapter.number }];
      });
    }
    const hits = db.prepare("SELECT id, snippet(chapter_fts_tri, 2, '【', '】', '…', 24) AS excerpt FROM chapter_fts_tri WHERE chapter_fts_tri MATCH ? LIMIT ? OFFSET ?")
      .all(`"${normalized}"`, limit, offset) as Array<{ id: string; excerpt: string }>;
    return hits.flatMap((hit) => {
      const chapter = byId.get(hit.id);
      return chapter ? [{ id: chapter.id, type: "章节" as const, title: `第${chapter.number}章 ${chapter.title}`, excerpt: hit.excerpt, chapterNumber: chapter.number }] : [];
    });
  }
}
