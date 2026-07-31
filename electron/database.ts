import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AiSettings,
  AiJobRecord,
  AutoBackupInput,
  AutoBackupSettings,
  ChangeRequest,
  Chapter,
  ChapterSaveMode,
  ChapterStatus,
  CreateProjectInput,
  ExpectationEntry,
  InsightPack,
  LedgerFact,
  MetricSnapshot,
  ReviewExperiment,
  PlanNode,
  ProjectDetail,
  ProjectPatch,
  ProjectSummary,
  QualityIssue,
  RankingSnapshot,
  RankingCaptureSchedule,
  ResearchBook,
  ResearchAnalysisRecord,
  ScheduleItem,
  SearchHit,
  RevisionRecord,
  StoryContract,
  StorySummary,
  SystemHealthReport,
} from "../src/shared/types";
import { normalizeAestheticProfile } from "../src/shared/aesthetic-profile";
import {
  approveContractDraft,
  prepareContractUpdate,
} from "../src/shared/contract-service";
import {
  decideChangeRequest as decideChangeRequestDraft,
  prepareChangeRequest,
  resolveChangeTargetVersion,
} from "../src/shared/change-request-service";
import { prepareFactSave } from "../src/shared/fact-service";
import { approvePlanDraft, preparePlanSave } from "../src/shared/plan-service";
import { prepareReviewExperiment } from "../src/shared/review-experiment-service";
import {
  assertDashboardCutoff,
  assertSchedulePublishAt,
  compareActiveAlerts,
  compareDueSchedules,
  deriveProjectRisk,
} from "../src/shared/dashboard-policy";
import {
  cosineSimilarity,
  HASH_BIGRAM_PROVIDER_ID,
  HashBigramEmbeddingProvider,
  validateEmbeddingVector,
  type EmbeddingProvider,
} from "./semantic";
import {
  aggregateStorySummaries,
  buildChapterSummary,
} from "../src/shared/summaries";
import {
  assertChapterTransition,
  deriveChapterBatchMode,
  isProtectedChapterEdit,
  prepareChapterSave,
} from "../src/shared/chapter-lifecycle";
import { hasColumn, runMigrations } from "./migration-runner";
import { AiAuditRepository } from "./repositories/ai-audit-repository";
import type { AiJobCompletion } from "./repositories/ai-audit-repository";
import { RevisionRepository } from "./repositories/revision-repository";
import { SearchRepository } from "./repositories/search-repository";
import { ProjectRepository } from "./repositories/project-repository";
import { ResearchRepository } from "./repositories/research-repository";
import { injectFault } from "./fault-injection";
import { chapterGenerationFingerprint, type ChapterGenerationGuard } from "./ai-retry";

const now = () => new Date().toISOString();

function openDatabase(filePath: string) {
  const db = new DatabaseSync(filePath);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );
  return db;
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function directoryBytes(root: string): number {
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += directoryBytes(target);
    else if (entry.isFile()) total += statSync(target).size;
  }
  return total;
}

interface CatalogRow {
  id: string;
  title: string;
  genre: ProjectSummary["genre"];
  status: ProjectSummary["status"];
  target_words: number;
  update_cadence: string;
  safe_stock_line: number;
  created_at: string;
  updated_at: string;
}

export class WorkspaceDatabase {
  readonly root: string;
  readonly projectsRoot: string;
  readonly researchRoot: string;
  readonly backupRoot: string;
  readonly trashRoot: string;
  private readonly catalog: DatabaseSync;
  private readonly research: DatabaseSync;
  private readonly projectDbs = new Map<string, DatabaseSync>();
  private readonly aiAudit: AiAuditRepository;
  private readonly projects: ProjectRepository;
  private readonly researchData: ResearchRepository;
  private readonly revisions = new RevisionRepository();
  private readonly search = new SearchRepository();
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(root: string, embeddingProvider: EmbeddingProvider = new HashBigramEmbeddingProvider()) {
    if (!embeddingProvider.id.trim()) throw new Error("嵌入 provider id 不能为空");
    if (!Number.isInteger(embeddingProvider.dimensions) || embeddingProvider.dimensions <= 0)
      throw new Error("嵌入向量维度必须是正整数");
    this.root = root;
    this.embeddingProvider = embeddingProvider;
    this.projectsRoot = path.join(root, "projects");
    this.researchRoot = path.join(root, "research");
    this.backupRoot = path.join(root, "backups");
    this.trashRoot = path.join(root, "trash");
    for (const directory of [
      root,
      this.projectsRoot,
      this.researchRoot,
      this.backupRoot,
      this.trashRoot,
    ])
      mkdirSync(directory, { recursive: true });
    this.catalog = openDatabase(path.join(root, "catalog.sqlite"));
    this.research = openDatabase(
      path.join(this.researchRoot, "research.sqlite"),
    );
    this.initCatalog();
    this.projects = new ProjectRepository(this.catalog);
    this.researchData = new ResearchRepository(this.research);
    this.aiAudit = new AiAuditRepository(this.catalog);
    this.aiAudit.recoverInterrupted();
    this.initResearch();
  }

  private initCatalog() {
    runMigrations(this.catalog, [
      (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT NOT NULL,
        status TEXT NOT NULL,
        target_words INTEGER NOT NULL,
        update_cadence TEXT NOT NULL,
        safe_stock_line INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY, project_id TEXT, task_type TEXT NOT NULL, input_hash TEXT NOT NULL,
        prompt_version TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
        input_summary TEXT NOT NULL, output TEXT, estimated_cost REAL NOT NULL DEFAULT 0,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_global_ai_jobs_dedupe ON ai_jobs(task_type, input_hash, prompt_version, model);
      `),
      (db) => {
        if (!hasColumn(db, "projects", "safe_stock_line"))
          db.exec("ALTER TABLE projects ADD COLUMN safe_stock_line INTEGER NOT NULL DEFAULT 10");
      },
      (db) => {
        for (const column of ["input_tokens INTEGER NOT NULL DEFAULT 0", "output_tokens INTEGER NOT NULL DEFAULT 0", "actual_cost REAL NOT NULL DEFAULT 0", "duration_ms INTEGER NOT NULL DEFAULT 0"]) {
          const name = column.split(" ")[0];
          if (!hasColumn(db, "ai_jobs", name)) db.exec(`ALTER TABLE ai_jobs ADD COLUMN ${column}`);
        }
      },
      (db) => {
        db.exec("DROP INDEX IF EXISTS idx_global_ai_jobs_dedupe");
        if (!hasColumn(db, "ai_jobs", "retry_context")) db.exec("ALTER TABLE ai_jobs ADD COLUMN retry_context TEXT");
        db.exec("CREATE INDEX IF NOT EXISTS idx_global_ai_jobs_cache ON ai_jobs(task_type, input_hash, prompt_version, model, status, updated_at)");
      },
      (db) => {
        db.exec("DROP INDEX IF EXISTS idx_global_ai_jobs_cache");
        db.exec("CREATE INDEX idx_global_ai_jobs_cache ON ai_jobs(task_type, input_hash, prompt_version, provider, model, status, updated_at)");
      },
      (db) => {
        for (const column of [
          "headers_at TEXT", "first_token_at TEXT", "completed_at TEXT",
          "chunk_count INTEGER NOT NULL DEFAULT 0", "attempt_count INTEGER NOT NULL DEFAULT 0",
        ]) {
          const name = column.split(" ")[0];
          if (!hasColumn(db, "ai_jobs", name)) db.exec(`ALTER TABLE ai_jobs ADD COLUMN ${column}`);
        }
      },
    ]);
  }

  private initResearch() {
    runMigrations(this.research, [
      (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS ranking_snapshots (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, list_name TEXT NOT NULL,
        captured_at TEXT NOT NULL, status TEXT NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS ranking_entries (
        id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, rank INTEGER NOT NULL,
        title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT NOT NULL,
        words INTEGER NOT NULL, status TEXT NOT NULL, tags TEXT NOT NULL, source_url TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ranking_entries_snapshot ON ranking_entries(snapshot_id);
      CREATE TABLE IF NOT EXISTS research_books (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_chapters (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, word_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_chapters_book ON research_chapters(book_id, ordinal);
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_analyses (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL, layer TEXT NOT NULL,
        from_chapter INTEGER NOT NULL, to_chapter INTEGER NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_analyses_book ON research_analyses(book_id, layer, from_chapter);
      CREATE TABLE IF NOT EXISTS research_fingerprints (
        hash TEXT NOT NULL, book_id TEXT NOT NULL, excerpt TEXT NOT NULL,
        PRIMARY KEY(hash, book_id)
      );
      CREATE INDEX IF NOT EXISTS idx_research_fingerprints_hash ON research_fingerprints(hash);
      `),
      (db) => {
        for (const column of ["synopsis", "official_reader_url", "platform"])
          if (!hasColumn(db, "ranking_entries", column))
            db.exec(`ALTER TABLE ranking_entries ADD COLUMN ${column} TEXT`);
      },
    ]);
  }

  private initProject(db: DatabaseSync) {
    runMigrations(db, [
      (database) => database.exec(`
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection, updated_at);
      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY, collection TEXT NOT NULL, entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_revisions_entity ON revisions(collection, entity_id, revision);
      CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts USING fts5(id UNINDEXED, title, content, tokenize='unicode61');
      CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts_tri USING fts5(id UNINDEXED, title, content, tokenize='trigram');
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
        content_hash TEXT NOT NULL, vector TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY, task_type TEXT NOT NULL, input_hash TEXT NOT NULL,
        prompt_version TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        status TEXT NOT NULL, input_summary TEXT NOT NULL, output TEXT,
        estimated_cost REAL NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_dedupe ON ai_jobs(task_type, input_hash, prompt_version, model);
      `),
      (database) => database.exec(`
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        outline TEXT NOT NULL,
        status TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        batch_mode TEXT NOT NULL,
        is_key_chapter INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_chapters_number ON chapters(number);
      CREATE INDEX idx_chapters_status ON chapters(status, number);
      CREATE TABLE chapter_contents (
        chapter_id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      );
      INSERT INTO chapters(
        id, number, title, outline, status, word_count, batch_mode,
        is_key_chapter, metadata, updated_at
      )
      SELECT id,
        CAST(json_extract(payload, '$.number') AS INTEGER),
        COALESCE(json_extract(payload, '$.title'), ''),
        COALESCE(json_extract(payload, '$.outline'), ''),
        COALESCE(json_extract(payload, '$.status'), '章纲'),
        COALESCE(CAST(json_extract(payload, '$.wordCount') AS INTEGER), 0),
        COALESCE(json_extract(payload, '$.batchMode'), '逐章'),
        COALESCE(CAST(json_extract(payload, '$.isKeyChapter') AS INTEGER), 0),
        json_remove(payload, '$.content'),
        updated_at
      FROM records WHERE collection = 'chapters';
      INSERT INTO chapter_contents(chapter_id, content)
      SELECT id, COALESCE(json_extract(payload, '$.content'), '')
      FROM records WHERE collection = 'chapters';
      DELETE FROM records WHERE collection = 'chapters';
      `),
      (database) => {
        if (!hasColumn(database, "embeddings", "provider_id"))
          database.exec(`ALTER TABLE embeddings ADD COLUMN provider_id TEXT NOT NULL DEFAULT '${HASH_BIGRAM_PROVIDER_ID}'`);
        if (!hasColumn(database, "embeddings", "dimensions"))
          database.exec("ALTER TABLE embeddings ADD COLUMN dimensions INTEGER NOT NULL DEFAULT 192");
        database.exec("CREATE INDEX IF NOT EXISTS idx_embeddings_provider ON embeddings(source_type, provider_id, dimensions)");
      },
    ]);
  }

  private projectDb(projectId: string) {
    const existing = this.projectDbs.get(projectId);
    if (existing) return existing;
    const directory = path.join(this.projectsRoot, projectId);
    mkdirSync(path.join(directory, "attachments"), { recursive: true });
    mkdirSync(path.join(directory, "exports"), { recursive: true });
    const db = openDatabase(path.join(directory, "project.sqlite"));
    this.initProject(db);
    this.projectDbs.set(projectId, db);
    return db;
  }

  createProject(input: CreateProjectInput): ProjectSummary {
    const id = randomUUID();
    const timestamp = now();
    this.catalog
      .prepare(
        `
      INSERT INTO projects(id, title, genre, status, target_words, update_cadence, safe_stock_line, created_at, updated_at)
      VALUES(?, ?, ?, '候选立项', ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        input.title.trim(),
        input.genre,
        input.targetWords,
        input.updateCadence,
        input.safeStockLine ?? 10,
        timestamp,
        timestamp,
      );
    const db = this.projectDb(id);
    const contract: StoryContract = {
      premise: "",
      genreSubtype: "",
      fanqieCategoryKey: "",
      secondaryGenres: input.secondaryGenres ?? [],
      genreElements: input.genreElements ?? [],
      customGenreDirection: input.customGenreDirection ?? "",
      audience: "",
      commercialHook: "",
      openingMechanism: "",
      growthCarrier: "",
      primaryPayoff: "",
      longFormEngine: "",
      protagonistDesire: "",
      protagonistArc: "",
      keyRelationships: [],
      worldRules: [],
      majorForces: [],
      timelineAnchors: [],
      readerPromise: "",
      coreEmotion: "",
      ending: "",
      immutableRules: [],
      prohibitedPatterns: [],
      majorStateChanges: { include: [], exclude: [] },
      aestheticProfile: normalizeAestheticProfile(),
      version: 1,
      approved: false,
      updatedAt: timestamp,
    };
    this.setState(db, "contract", contract);
    this.setState(db, "insightIds", []);
    return this.getProjectSummary(id);
  }

  createProjectFromConcept(input: CreateProjectInput, contractDraft: Omit<StoryContract, "version" | "approved" | "updatedAt">): ProjectSummary {
    const created = this.createProject(input);
    const project = this.getProject(created.id);
    this.saveContract(created.id, { ...project.contract, ...contractDraft, approved: false });
    return this.getProjectSummary(created.id);
  }

  listProjects(): ProjectSummary[] {
    const rows = this.catalog
      .prepare(
        "SELECT * FROM projects WHERE status != '归档' ORDER BY updated_at DESC, id",
      )
      .all() as unknown as CatalogRow[];
    return rows.map((row) => this.hydrateSummary(row));
  }

  deleteProject(id: string, confirmationTitle: string) {
    const row = this.catalog
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as unknown as CatalogRow | undefined;
    if (!row) throw new Error("作品不存在或已经删除");
    if (confirmationTitle.trim() !== row.title)
      throw new Error("输入的书名与作品名不一致");
    const open = this.projectDbs.get(id);
    if (open) {
      open.close();
      this.projectDbs.delete(id);
    }
    const source = path.resolve(this.projectsRoot, id);
    const destination = path.resolve(
      this.trashRoot,
      `${id}-${Date.now()}`,
    );
    if (!source.startsWith(`${path.resolve(this.projectsRoot)}${path.sep}`))
      throw new Error("作品目录校验失败");
    if (!destination.startsWith(`${path.resolve(this.trashRoot)}${path.sep}`))
      throw new Error("回收站目录校验失败");
    let moved = false;
    try {
      renameSync(source, destination);
      moved = true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!["EBUSY", "EPERM", "EACCES"].includes(code)) throw error;
    }
    try {
      this.catalog.exec("BEGIN IMMEDIATE");
      this.catalog.prepare("DELETE FROM ai_jobs WHERE project_id = ?").run(id);
      if (moved) this.catalog.prepare("DELETE FROM projects WHERE id = ?").run(id);
      else this.catalog.prepare("UPDATE projects SET status = '归档', updated_at = ? WHERE id = ?").run(now(), id);
      this.catalog.exec("COMMIT");
    } catch (error) {
      try { this.catalog.exec("ROLLBACK"); } catch { /* no active transaction */ }
      if (moved) renameSync(destination, source);
      throw error;
    }
    return moved
      ? `作品已移入回收目录：${destination}`
      : "作品已从工作台移除；项目文件正被另一个工作台窗口占用，已原地归档，关闭其他窗口后仍可人工恢复或移动。";
  }

  getProjectSummary(id: string): ProjectSummary {
    const row = this.catalog
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as unknown as CatalogRow | undefined;
    if (!row) throw new Error("项目不存在");
    return this.hydrateSummary(row);
  }

  getDashboardActivity(throughExclusive: string) {
    assertDashboardCutoff(throughExclusive);
    const dueToday: ScheduleItem[] = [];
    const activeAlerts: QualityIssue[] = [];
    let pendingIssues = 0;
    const projects = this.catalog
      .prepare("SELECT id FROM projects WHERE status != '归档'")
      .all() as Array<{ id: string }>;
    for (const project of projects) {
      const db = this.projectDb(project.id);
      dueToday.push(...(db.prepare(`
        SELECT payload FROM records
        WHERE collection = 'schedule'
          AND json_extract(payload, '$.status') != '已发布'
          AND julianday(json_extract(payload, '$.publishAt')) < julianday(?)
        ORDER BY julianday(json_extract(payload, '$.publishAt')), id
      `).all(throughExclusive) as Array<{ payload: string }>).map((row) => parseJson<ScheduleItem>(row.payload)));
      const issueCount = db.prepare(`
        SELECT COUNT(*) AS count FROM records
        WHERE collection = 'issues' AND json_extract(payload, '$.status') = '待处理'
      `).get() as { count: number };
      pendingIssues += Number(issueCount.count);
      activeAlerts.push(...(db.prepare(`
        SELECT payload FROM records
        WHERE collection = 'issues' AND json_extract(payload, '$.status') = '待处理'
        ORDER BY julianday(json_extract(payload, '$.createdAt')) DESC, id LIMIT 12
      `).all() as Array<{ payload: string }>).map((row) => parseJson<QualityIssue>(row.payload)));
    }
    return {
      dueToday: dueToday.sort(compareDueSchedules),
      activeAlerts: activeAlerts.sort(compareActiveAlerts).slice(0, 12),
      pendingIssues,
    };
  }

  private hydrateSummary(row: CatalogRow): ProjectSummary {
    const db = this.projectDb(row.id);
    const chapterStats = db.prepare(`
      SELECT COUNT(*) AS chapter_count,
        COALESCE(SUM(word_count), 0) AS current_words,
        COALESCE(SUM(CASE WHEN status IN ('已定稿', '待发布') THEN 1 ELSE 0 END), 0) AS stock_chapters
      FROM chapters
    `).get() as { chapter_count: number; current_words: number; stock_chapters: number };
    const pendingHardIssues = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM records
      WHERE collection = 'issues'
        AND json_extract(payload, '$.status') = '待处理'
        AND json_extract(payload, '$.severity') = '硬性'
    `).get() as { count: number }).count);
    const next = db.prepare(`
      SELECT json_extract(payload, '$.publishAt') AS publish_at FROM records
      WHERE collection = 'schedule' AND json_extract(payload, '$.status') != '已发布'
      ORDER BY publish_at LIMIT 1
    `).get() as { publish_at: string } | undefined;
    return {
      id: row.id,
      title: row.title,
      genre: row.genre,
      status: row.status,
      targetWords: row.target_words,
      currentWords: Number(chapterStats.current_words),
      chapterCount: Number(chapterStats.chapter_count),
      stockChapters: Number(chapterStats.stock_chapters),
      safeStockLine: row.safe_stock_line,
      updateCadence: row.update_cadence,
      nextPublishAt: next?.publish_at ?? null,
      riskLevel: deriveProjectRisk({
        status: row.status,
        stockChapters: Number(chapterStats.stock_chapters),
        safeStockLine: row.safe_stock_line,
        pendingHardIssues,
      }),
      updatedAt: row.updated_at,
    };
  }

  updateProject(id: string, patch: ProjectPatch): ProjectSummary {
    const current = this.getProjectSummary(id);
    this.catalog
      .prepare(
        `
      UPDATE projects SET title = ?, status = ?, target_words = ?, update_cadence = ?, safe_stock_line = ?, updated_at = ? WHERE id = ?
    `,
      )
      .run(
        patch.title?.trim() || current.title,
        patch.status ?? current.status,
        patch.targetWords ?? current.targetWords,
        patch.updateCadence ?? current.updateCadence,
        patch.safeStockLine ?? current.safeStockLine,
        now(),
        id,
      );
    return this.getProjectSummary(id);
  }

  getProject(id: string): ProjectDetail {
    const db = this.projectDb(id);
    return {
      summary: this.getProjectSummary(id),
      contract: this.getState<StoryContract>(db, "contract"),
      plans: this.listRecords<PlanNode>(db, "plans").sort(
        (a, b) => a.ordinal - b.ordinal,
      ),
      chapters: this.projects.listChapters(db),
      facts: this.listRecords<LedgerFact>(db, "facts").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      issues: this.listRecords<QualityIssue>(db, "issues").sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      changes: this.listRecords<ChangeRequest>(db, "changes").sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      schedule: this.listRecords<ScheduleItem>(db, "schedule").sort((a, b) =>
        a.publishAt.localeCompare(b.publishAt),
      ),
      metrics: this.listRecords<MetricSnapshot>(db, "metrics").sort((a, b) =>
        b.recordedAt.localeCompare(a.recordedAt),
      ),
      experiments: this.listRecords<ReviewExperiment>(db, "experiments").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      insightIds: this.getState<string[]>(db, "insightIds", []),
      summaries: this.listRecords<StorySummary>(db, "summaries").sort(
        (a, b) => a.fromChapter - b.fromChapter,
      ),
      expectations: this.listRecords<ExpectationEntry>(db, "expectations").sort(
        (a, b) => a.sourceChapter - b.sourceChapter,
      ),
    };
  }

  getProjectOverview(id: string): ProjectDetail {
    const db = this.projectDb(id);
    return {
      summary: this.getProjectSummary(id),
      contract: this.getState<StoryContract>(db, "contract"),
      plans: this.listRecords<PlanNode>(db, "plans").sort((a, b) => a.ordinal - b.ordinal),
      chapters: this.projects.listChapterMetadata(db),
      facts: this.listRecords<LedgerFact>(db, "facts").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      issues: this.listRecords<QualityIssue>(db, "issues").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      changes: this.listRecords<ChangeRequest>(db, "changes").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      schedule: this.listRecords<ScheduleItem>(db, "schedule").sort((a, b) => a.publishAt.localeCompare(b.publishAt)),
      metrics: this.listRecords<MetricSnapshot>(db, "metrics").sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      experiments: this.listRecords<ReviewExperiment>(db, "experiments").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      insightIds: this.getState<string[]>(db, "insightIds", []),
      summaries: this.listRecords<StorySummary>(db, "summaries").sort((a, b) => a.fromChapter - b.fromChapter),
      expectations: this.listRecords<ExpectationEntry>(db, "expectations").sort((a, b) => a.sourceChapter - b.sourceChapter),
    };
  }

  getChapter(id: string, chapterId: string): Chapter {
    const chapter = this.projects.getChapter(this.projectDb(id), chapterId);
    if (!chapter) throw new Error("章节不存在");
    return chapter;
  }

  saveContract(id: string, contract: StoryContract) {
    const db = this.projectDb(id);
    const previous = this.getState<StoryContract>(db, "contract");
    const update = prepareContractUpdate(previous, contract, now());
    if (!update.changed) return previous;
    if (
      previous.approved &&
      !this.consumeApprovedChange(db, "创作契约", "contract", previous.version)
    ) {
      throw new Error("已审批创作契约只能通过已批准的改纲变更单修改");
    }
    const next = update.contract;
    this.addRevision(db, "state", "contract", previous.version, previous);
    this.setState(db, "contract", next);
    this.touchProject(id);
    return next;
  }

  approveContract(id: string) {
    const db = this.projectDb(id);
    const contract = this.getState<StoryContract>(db, "contract");
    const next = approveContractDraft(contract, now());
    this.setState(db, "contract", next);
    this.updateProject(id, { status: "大纲审批" });
    return next;
  }

  attachInsights(id: string, insightIds: string[]) {
    this.setState(this.projectDb(id), "insightIds", [...new Set(insightIds)]);
    this.touchProject(id);
  }

  savePlan(id: string, plan: PlanNode) {
    const db = this.projectDb(id);
    const previous = plan.id
      ? this.getRecord<PlanNode>(db, "plans", plan.id)
      : undefined;
    const prepared = preparePlanSave(
      previous,
      plan,
      plan.id || randomUUID(),
    );
    if (prepared.noOp) return previous!;
    if (
      prepared.protectedEdit &&
      !this.consumeApprovedChange(
        db,
        "规划",
        previous!.id,
        this.entityVersion(db, "plans", previous!.id),
      )
    ) {
      throw new Error("已批准规划只能通过已批准的改纲变更单修改");
    }
    const next = prepared.plan;
    this.saveRecord(db, "plans", next.id, next);
    this.touchProject(id);
    return next;
  }

  approvePlan(id: string, planId: string) {
    const db = this.projectDb(id);
    const plan = this.getRecord<PlanNode>(db, "plans", planId);
    const contract = this.getState<StoryContract>(db, "contract");
    this.saveRecord(db, "plans", planId, approvePlanDraft(plan, contract));
    this.touchProject(id);
  }

  saveChapter(id: string, chapter: Chapter, mode: ChapterSaveMode = "version") {
    return this.persistChapter(id, chapter, undefined, mode === "version");
  }

  saveGeneratedChapter(id: string, chapter: Chapter, expected?: ChapterGenerationGuard) {
    if (!chapter.id || !chapter.content.trim())
      throw new Error("AI 草稿缺少章节或正文");
    return this.persistChapter(id, chapter, "待质检", true, expected);
  }

  private persistChapter(
    id: string,
    chapter: Chapter,
    forcedStatus?: ChapterStatus,
    createRevision = true,
    expected?: ChapterGenerationGuard,
  ) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.persistChapterInTransaction(db, id, chapter, forcedStatus, createRevision, expected);
      injectFault("power-loss-before-commit");
      db.exec("COMMIT");
      this.touchProject(id);
      return saved;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  private persistChapterInTransaction(
    db: DatabaseSync,
    id: string,
    chapter: Chapter,
    forcedStatus?: ChapterStatus,
    createRevision = true,
    expected?: ChapterGenerationGuard,
  ) {
    const previous = chapter.id
      ? this.projects.getChapter(db, chapter.id)
      : undefined;
    if (expected && (
      !previous ||
      previous.revision !== expected.revision ||
      chapterGenerationFingerprint(previous) !== expected.fingerprint
    )) {
      throw new Error("章节在 AI 生成期间已被修改，旧生成结果未保存");
    }
    const protectedEdit = isProtectedChapterEdit(previous, chapter);
    if (
      protectedEdit &&
      !this.consumeApprovedChange(db, "章节", previous!.id, previous!.revision)
    ) {
      throw new Error(
        "已定稿或进入发布流程的章节只能通过匹配的已批准变更单修改",
      );
    }
    const facts = this.listRecords<LedgerFact>(db, "facts");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    const plans = this.listRecords<PlanNode>(db, "plans");
    let endingExpectationId = chapter.endingExpectationId ?? null;
    if (chapter.endingExpectation?.trim()) {
      const existingExpectation = endingExpectationId
        ? this.getRecord<ExpectationEntry>(
            db,
            "expectations",
            endingExpectationId,
          )
        : undefined;
      const savedExpectation = this.persistExpectation(db, {
        id: endingExpectationId ?? "",
        title: chapter.endingExpectation.trim(),
        description: chapter.endingExpectation.trim(),
        sourceChapter: chapter.number,
        expectedPayoffChapter: chapter.expectationTargetChapter ?? null,
        actualPayoffChapter: existingExpectation?.actualPayoffChapter ?? null,
        status: existingExpectation?.status ?? "待兑现",
        payoffResult: existingExpectation?.payoffResult ?? "",
        createdAt: existingExpectation?.createdAt ?? now(),
        updatedAt: now(),
      }, createRevision);
      endingExpectationId = savedExpectation.id;
    }
    const genre = (this.catalog.prepare("SELECT genre FROM projects WHERE id = ?").get(id) as { genre: ProjectSummary["genre"] }).genre;
    const contract = this.getState<StoryContract>(db, "contract");
    const next = prepareChapterSave(chapter, {
      previous,
      forcedStatus,
      protectedEdit,
      createRevision,
      chapterId: chapter.id || randomUUID(),
      endingExpectationId,
      batchMode: deriveChapterBatchMode(chapter, {
        facts,
        issues,
        plans,
        genre,
        majorStateChanges: contract.majorStateChanges,
      }),
      updatedAt: now(),
    });
    this.projects.saveChapter(db, next, previous?.revision, createRevision);
    db.prepare("DELETE FROM chapter_fts WHERE id = ?").run(next.id);
    db.prepare(
      "INSERT INTO chapter_fts(id, title, content) VALUES(?, ?, ?)",
    ).run(next.id, next.title, next.content);
    db.prepare("DELETE FROM chapter_fts_tri WHERE id = ?").run(next.id);
    db.prepare(
      "INSERT INTO chapter_fts_tri(id, title, content) VALUES(?, ?, ?)",
    ).run(next.id, next.title, next.content);
    this.saveEmbedding(
      db,
      "chapters",
      next.id,
      `${next.title}\n${next.outline}\n${next.content.slice(0, 1600)}`,
    );
    return next;
  }

  saveExpectation(id: string, expectation: ExpectationEntry, createRevision = true) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.persistExpectation(db, expectation, createRevision);
      db.exec("COMMIT");
      this.touchProject(id);
      return saved;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  private persistExpectation(db: DatabaseSync, expectation: ExpectationEntry, createRevision = true) {
    const previous = expectation.id
      ? this.getRecord<ExpectationEntry>(db, "expectations", expectation.id)
      : undefined;
    const next: ExpectationEntry = {
      ...expectation,
      id: expectation.id || randomUUID(),
      title: expectation.title.trim(),
      description: expectation.description.trim(),
      createdAt: previous?.createdAt ?? expectation.createdAt ?? now(),
      updatedAt: now(),
    };
    if (!next.title) throw new Error("期待标题不能为空");
    if (
      next.expectedPayoffChapter !== null &&
      next.expectedPayoffChapter < next.sourceChapter
    ) {
      throw new Error("预计兑现章不能早于提出章");
    }
    if (next.status === "已兑现" && !next.actualPayoffChapter)
      throw new Error("已兑现期待必须填写实际兑现章");
    this.saveRecord(db, "expectations", next.id, next, undefined, createRevision);
    return next;
  }

  transitionChapter(id: string, chapterId: string, status: ChapterStatus) {
    const db = this.projectDb(id);
    const chapter = this.projects.getChapter(db, chapterId);
    if (!chapter) throw new Error("章节不存在");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    assertChapterTransition(chapter.status, status, chapterId, issues);
    const saved = this.persistChapter(id, { ...chapter, status }, status);
    if (status === "已定稿" && chapter.status !== "已定稿")
      this.updateSummaries(id, saved);
    return saved;
  }

  saveFact(id: string, fact: LedgerFact) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const facts = this.listRecords<LedgerFact>(db, "facts");
      const prepared = prepareFactSave(facts, fact, {
        factId: fact.id || randomUUID(),
        updatedAt: now(),
      });
      const { replacement } = prepared;
      if (replacement) {
        this.saveRecord(db, "facts", replacement.id, replacement);
      }
      const next = prepared.fact;
      this.saveRecord(db, "facts", next.id, next);
      this.saveEmbedding(
        db,
        "facts",
        next.id,
        factEmbeddingText(next),
      );
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  searchRelevantFacts(
    id: string,
    queryText: string,
    chapterNumber: number,
    limit = 80,
  ) {
    const db = this.projectDb(id);
    const facts = new Map(
      this.listRecords<LedgerFact>(db, "facts").map((fact) => [fact.id, fact]),
    );
    const storedRows = db.prepare(
      "SELECT source_id, content_hash, provider_id, dimensions FROM embeddings WHERE source_type = 'facts'",
    ).all() as Array<{ source_id: string; content_hash: string; provider_id: string; dimensions: number }>;
    const storedById = new Map(storedRows.map((row) => [row.source_id, row]));
    const staleEmbeddings: Array<{ sourceId: string; text: string }> = [];
    for (const fact of facts.values()) {
      const text = factEmbeddingText(fact);
      const stored = storedById.get(fact.id);
      if (
        !stored ||
        stored.content_hash !== hashText(text) ||
        stored.provider_id !== this.embeddingProvider.id ||
        Number(stored.dimensions) !== this.embeddingProvider.dimensions
      ) {
        staleEmbeddings.push({ sourceId: fact.id, text });
      }
    }
    this.saveEmbeddings(db, "facts", staleEmbeddings);
    const query = this.embedText(queryText);
    const rows = db
      .prepare(
        "SELECT source_id, vector FROM embeddings WHERE source_type = 'facts' AND provider_id = ? AND dimensions = ?",
      )
      .all(this.embeddingProvider.id, this.embeddingProvider.dimensions) as Array<{ source_id: string; vector: string }>;
    return rows
      .map((row) => ({
        fact: facts.get(row.source_id),
        score: cosineSimilarity(query, parseJson<number[]>(row.vector)),
      }))
      .filter((item): item is { fact: LedgerFact; score: number } =>
        Boolean(item.fact),
      )
      .filter(
        ({ fact }) =>
          (fact.confidence === "已确认" || fact.confidence === "有冲突") &&
          fact.validFromChapter <= chapterNumber &&
          (fact.validToChapter === null ||
            fact.validToChapter >= chapterNumber),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.fact);
  }

  searchProject(id: string, query: string, offset = 0, limit = 50): SearchHit[] {
    const db = this.projectDb(id);
    return this.search.search(db, query, this.projects.listChapters(db), offset, limit);
  }

  listRevisions(
    id: string,
    collection: RevisionRecord["collection"],
    entityId: string,
  ): RevisionRecord[] {
    const db = this.projectDb(id);
    return this.revisions.list(db, collection, entityId);
  }

  restoreRevision(id: string, revisionId: string) {
    const db = this.projectDb(id);
    const row = this.revisions.get(db, revisionId);
    if (!row) throw new Error("历史版本不存在");
    const payload = parseJson<any>(row.payload);
    if (row.collection === "chapters") this.saveChapter(id, payload as Chapter);
    else if (row.collection === "plans") this.savePlan(id, payload as PlanNode);
    else if (row.collection === "state" && row.entity_id === "contract")
      this.saveContract(id, payload as StoryContract);
    else this.saveRecord(db, row.collection, row.entity_id, payload);
    this.touchProject(id);
  }

  saveIssues(id: string, chapterId: string, issues: QualityIssue[]) {
    const db = this.projectDb(id);
    for (const current of this.listRecords<QualityIssue>(db, "issues")) {
      if (current.chapterId === chapterId && current.status === "待处理") {
        this.saveRecord(db, "issues", current.id, {
          ...current,
          status: "已解决",
        });
      }
    }
    for (const issue of issues) this.saveRecord(db, "issues", issue.id, issue);
    if (issues.some((issue) => issue.severity === "硬性")) {
      const chapter = this.projects.getChapter(db, chapterId);
      if (chapter && chapter.batchMode !== "逐章")
        this.saveChapter(id, { ...chapter, batchMode: "逐章" });
    }
    this.touchProject(id);
  }

  resolveIssue(id: string, issueId: string, status: QualityIssue["status"]) {
    const db = this.projectDb(id);
    const issue = this.getRecord<QualityIssue>(db, "issues", issueId);
    if (!issue) throw new Error("质检项不存在");
    if (issue.severity === "硬性" && status === "已忽略")
      throw new Error("硬性质检项不能忽略，必须解决后才能继续");
    this.saveRecord(db, "issues", issueId, { ...issue, status });
    this.touchProject(id);
  }

  saveChangeRequest(id: string, change: ChangeRequest) {
    const db = this.projectDb(id);
    const baseVersion = resolveChangeTargetVersion(
      change.targetKind,
      change.targetId,
      {
        contractVersion: this.getState<StoryContract>(db, "contract").version,
        planVersion: (targetId) =>
          this.getRecord<PlanNode>(db, "plans", targetId)
            ? this.entityVersion(db, "plans", targetId)
            : undefined,
        chapterVersion: (targetId) =>
          this.projects.getChapter(db, targetId)?.revision,
      },
    );
    const next = prepareChangeRequest(change, {
      id: randomUUID(),
      baseVersion,
      createdAt: now(),
    });
    this.saveRecord(db, "changes", next.id, next);
    return next;
  }

  decideChangeRequest(id: string, changeId: string, decision: "批准" | "拒绝") {
    const db = this.projectDb(id);
    const change = this.getRecord<ChangeRequest>(db, "changes", changeId);
    this.saveRecord(
      db,
      "changes",
      changeId,
      decideChangeRequestDraft(change, decision),
    );
  }

  saveSchedule(id: string, item: ScheduleItem) {
    assertSchedulePublishAt(item.publishAt);
    const db = this.projectDb(id);
    const project = this.getProjectSummary(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      let chapter = this.projects.getChapter(db, item.chapterId);
      if (!chapter) throw new Error("排期章节不存在");
      const targetStatus = item.status === "已发布" ? "已发布" : item.status === "待发布" ? "待发布" : null;
      if (targetStatus && chapter.status !== targetStatus) {
        const issues = this.listRecords<QualityIssue>(db, "issues");
        assertChapterTransition(chapter.status, targetStatus, chapter.id, issues);
        chapter = this.persistChapterInTransaction(db, id, { ...chapter, status: targetStatus }, targetStatus);
      }
      if (!targetStatus && !["已定稿", "待发布"].includes(chapter.status))
        throw new Error("只有已定稿或待发布章节可以安排发布");
      const next: ScheduleItem = {
        ...item,
        id: item.id || randomUUID(),
        projectId: id,
        projectTitle: project.title,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
      };
      this.saveRecord(db, "schedule", next.id, next);
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  saveMetrics(id: string, metrics: MetricSnapshot[]) {
    const db = this.projectDb(id);
    for (const metric of metrics)
      this.saveRecord(db, "metrics", metric.id, metric);
    this.touchProject(id);
  }

  saveReviewExperiment(id: string, experiment: ReviewExperiment) {
    const db = this.projectDb(id);
    const previous = experiment.id ? this.getRecord<ReviewExperiment>(db, "experiments", experiment.id) : undefined;
    const next = prepareReviewExperiment(previous, experiment, {
      id: experiment.id || randomUUID(),
      updatedAt: now(),
    });
    this.saveRecord(db, "experiments", next.id, next);
    this.touchProject(id);
    return next;
  }

  listRankings(): RankingSnapshot[] {
    const rows = this.research
      .prepare("SELECT * FROM ranking_snapshots ORDER BY captured_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      listName: String(row.list_name),
      capturedAt: String(row.captured_at),
      status: row.status as RankingSnapshot["status"],
      error: row.error ? String(row.error) : null,
      entries: (
        this.research
          .prepare(
            "SELECT * FROM ranking_entries WHERE snapshot_id = ? ORDER BY rank",
          )
          .all(String(row.id)) as Array<Record<string, unknown>>
      ).map((entry) => ({
        id: String(entry.id),
        snapshotId: String(entry.snapshot_id),
        rank: Number(entry.rank),
        title: String(entry.title),
        author: String(entry.author),
        genre: String(entry.genre),
        words: Number(entry.words),
        status: String(entry.status),
        tags: parseJson<string[]>(entry.tags),
        sourceUrl: String(entry.source_url),
        synopsis: entry.synopsis ? String(entry.synopsis) : undefined,
        officialReaderUrl: entry.official_reader_url ? String(entry.official_reader_url) : undefined,
        platform: entry.platform ? String(entry.platform) : undefined,
      })),
    }));
  }

  saveRanking(snapshot: RankingSnapshot) {
    this.research
      .prepare("INSERT INTO ranking_snapshots VALUES(?, ?, ?, ?, ?, ?)")
      .run(
        snapshot.id,
        snapshot.source,
        snapshot.listName,
        snapshot.capturedAt,
        snapshot.status,
        snapshot.error,
      );
    const insert = this.research.prepare(
      `INSERT INTO ranking_entries(
        id, snapshot_id, rank, title, author, genre, words, status, tags, source_url,
        synopsis, official_reader_url, platform
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of snapshot.entries)
      insert.run(
        entry.id,
        snapshot.id,
        entry.rank,
        entry.title,
        entry.author,
        entry.genre,
        entry.words,
        entry.status,
        JSON.stringify(entry.tags),
        entry.sourceUrl,
        entry.synopsis ?? null,
        entry.officialReaderUrl ?? null,
        entry.platform ?? null,
      );
  }

  listRankingSchedules(): RankingCaptureSchedule[] {
    return parseJson<RankingCaptureSchedule[]>(this.getSetting("ranking.schedules", "[]"));
  }

  saveRankingSchedule(schedule: RankingCaptureSchedule) {
    const schedules = this.listRankingSchedules();
    const index = schedules.findIndex((item) => item.id === schedule.id);
    if (index >= 0) schedules[index] = schedule;
    else schedules.push(schedule);
    this.setSetting("ranking.schedules", JSON.stringify(schedules));
    return schedule;
  }

  deleteRankingSchedule(id: string) {
    this.setSetting("ranking.schedules", JSON.stringify(this.listRankingSchedules().filter((item) => item.id !== id)));
  }

  listResearchBooks(): ResearchBook[] {
    return this.researchData.listBooks();
  }

  saveResearchBook(
    book: ResearchBook,
    chapters: Array<{ title: string; content: string; wordCount: number }>,
  ) {
    this.researchData.saveBook(book, chapters);
  }

  getResearchBook(bookId: string) {
    return this.researchData.getBook(bookId);
  }

  saveResearchAnalyses(records: ResearchAnalysisRecord[]) {
    this.researchData.saveAnalyses(records);
  }

  listResearchAnalyses(bookId: string): ResearchAnalysisRecord[] {
    return this.researchData.listAnalyses(bookId);
  }

  updateResearchBook(book: ResearchBook) {
    this.researchData.updateBook(book);
  }

  listInsights(): InsightPack[] {
    return this.researchData.listInsights();
  }

  saveInsight(insight: InsightPack) {
    this.researchData.saveInsight(insight);
  }

  getInsights(ids: string[]) {
    if (!ids.length) return [];
    return this.listInsights().filter((item) => ids.includes(item.id));
  }

  findOriginalityMatches(content: string) {
    return this.researchData.originalityMatches(content);
  }

  findAiJob(
    taskType: string,
    inputHash: string,
    promptVersion: string,
    provider: string,
    model: string,
  ) {
    return this.aiAudit.findSuccessful(taskType, inputHash, promptVersion, provider, model);
  }

  startAiJob(
    projectId: string | null,
    taskType: string,
    inputHash: string,
    promptVersion: string,
    provider: string,
    model: string,
    inputSummary: string,
    retryContext?: string,
  ) {
    return this.aiAudit.start(projectId, taskType, inputHash, promptVersion, provider, model, inputSummary, retryContext);
  }

  updateAiJobTelemetry(id: string, telemetry: Pick<AiJobCompletion, "headersAt" | "firstTokenAt" | "chunkCount" | "attemptCount">) {
    this.aiAudit.updateTelemetry(id, telemetry);
  }

  finishAiJob(id: string, output: string, error?: string, usage?: AiJobCompletion) {
    this.aiAudit.finish(id, output, error, usage);
    this.aiAudit.prune();
  }

  listAiJobs(projectId?: string): AiJobRecord[] {
    return this.aiAudit.list(projectId);
  }

  getAiJob(id: string): AiJobRecord | undefined {
    return this.aiAudit.get(id);
  }

  getAiJobRetryContext(id: string) {
    return this.aiAudit.retryContext(id);
  }

  pruneAiJobHistory(retentionDays = 90, maxRows = 5000) {
    return this.aiAudit.prune(retentionDays, maxRows);
  }

  getAiSettings(): AiSettings {
    const baseUrl = this.getSetting("ai.baseUrl", "https://api.openai.com/v1");
    const model = this.getSetting("ai.model", "gpt-4.1");
    const embeddingModel = this.getSetting(
      "ai.embeddingModel",
      "text-embedding-3-small",
    );
    const inputPricePerMillion = Number(
      this.getSetting("ai.inputPricePerMillion", "0"),
    );
    const outputPricePerMillion = Number(
      this.getSetting("ai.outputPricePerMillion", "0"),
    );
    const longTaskTimeoutMinutes = Math.min(15, Math.max(5, Number(this.getSetting("ai.longTaskTimeoutMinutes", "10")) || 10));
    return {
      baseUrl,
      model,
      embeddingModel,
      hasApiKey: false,
      inputPricePerMillion,
      outputPricePerMillion,
      longTaskTimeoutMinutes,
    };
  }

  saveAiSettings(settings: Omit<AiSettings, "hasApiKey">) {
    this.setSetting("ai.baseUrl", settings.baseUrl);
    this.setSetting("ai.model", settings.model);
    this.setSetting("ai.embeddingModel", settings.embeddingModel);
    this.setSetting(
      "ai.inputPricePerMillion",
      String(settings.inputPricePerMillion),
    );
    this.setSetting(
      "ai.outputPricePerMillion",
      String(settings.outputPricePerMillion),
    );
    this.setSetting("ai.longTaskTimeoutMinutes", String(settings.longTaskTimeoutMinutes));
    return this.getAiSettings();
  }

  getAutoBackupSettings(): AutoBackupSettings {
    const frequency = this.getSetting("backup.auto.frequency", "daily") === "weekly" ? "weekly" : "daily";
    const retentionCount = Math.min(30, Math.max(1, Number(this.getSetting("backup.auto.retentionCount", "7")) || 7));
    const lastStatus = this.getSetting("backup.auto.lastStatus", "未运行") as AutoBackupSettings["lastStatus"];
    return {
      enabled: this.getSetting("backup.auto.enabled", "false") === "true",
      frequency,
      retentionCount,
      hasPassword: false,
      lastRunAt: this.getSetting("backup.auto.lastRunAt", "") || null,
      lastStatus: ["未运行", "成功", "失败"].includes(lastStatus) ? lastStatus : "未运行",
      lastError: this.getSetting("backup.auto.lastError", "") || null,
      nextRunAt: this.getSetting("backup.auto.nextRunAt", "") || null,
    };
  }

  saveAutoBackupSettings(input: AutoBackupInput, nextRunAt: string | null) {
    if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 30)
      throw new Error("自动备份保留份数必须在 1–30 之间");
    this.setSetting("backup.auto.enabled", String(input.enabled));
    this.setSetting("backup.auto.frequency", input.frequency);
    this.setSetting("backup.auto.retentionCount", String(input.retentionCount));
    this.setSetting("backup.auto.nextRunAt", nextRunAt ?? "");
    return this.getAutoBackupSettings();
  }

  finishAutoBackup(status: "成功" | "失败", nextRunAt: string, error?: string) {
    this.setSetting("backup.auto.lastRunAt", now());
    this.setSetting("backup.auto.lastStatus", status);
    this.setSetting("backup.auto.lastError", error ?? "");
    this.setSetting("backup.auto.nextRunAt", nextRunAt);
    return this.getAutoBackupSettings();
  }

  runSystemHealthCheck(): SystemHealthReport {
    const checks: SystemHealthReport["checks"] = [];
    const addIntegrityCheck = (id: string, label: string, db: DatabaseSync, projectId: string | null) => {
      try {
        const rows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
        const messages = rows.map((row) => row.integrity_check).filter((message) => message !== "ok");
        checks.push({ id, label, status: messages.length ? "错误" : "正常", detail: messages.length ? messages.slice(0, 3).join("；") : "SQLite 完整性检查通过", projectId, repairable: false });
      } catch (error) {
        checks.push({ id, label, status: "错误", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), projectId, repairable: false });
      }
    };

    addIntegrityCheck("catalog-integrity", "目录数据库", this.catalog, null);
    addIntegrityCheck("research-integrity", "研究数据库", this.research, null);
    const projectRows = this.catalog.prepare("SELECT id, title FROM projects ORDER BY created_at").all() as Array<{ id: string; title: string }>;
    const catalogIds = new Set(projectRows.map((row) => row.id));
    let chapterCount = 0;
    let failedAiJobs = Number((this.catalog.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number }).count);

    for (const row of projectRows) {
      const databasePath = path.join(this.projectsRoot, row.id, "project.sqlite");
      if (!existsSync(databasePath)) {
        checks.push({ id: `project-missing-${row.id}`, label: row.title, status: "错误", detail: "目录库存在作品，但项目数据库文件缺失", projectId: row.id, repairable: false });
        continue;
      }
      const db = this.projectDb(row.id);
      addIntegrityCheck(`project-integrity-${row.id}`, `${row.title} · 项目数据库`, db, row.id);
      const records = Number((db.prepare("SELECT COUNT(*) AS count FROM chapters").get() as { count: number }).count);
      const fts = Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_fts").get() as { count: number }).count);
      const trigram = Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_fts_tri").get() as { count: number }).count);
      chapterCount += records;
      failedAiJobs += Number((db.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number }).count);
      const indexesMatch = records === fts && records === trigram;
      checks.push({ id: `project-search-${row.id}`, label: `${row.title} · 搜索索引`, status: indexesMatch ? "正常" : "警告", detail: indexesMatch ? `${records} 章索引完整` : `章节 ${records}，全文索引 ${fts}，中文索引 ${trigram}`, projectId: row.id, repairable: !indexesMatch });
    }

    for (const entry of readdirSync(this.projectsRoot, { withFileTypes: true }))
      if (entry.isDirectory() && !catalogIds.has(entry.name))
        checks.push({ id: `orphan-${entry.name}`, label: "孤立项目目录", status: "警告", detail: `projects/${entry.name} 不在目录库中，未做自动处理`, projectId: null, repairable: false });

    checks.push({ id: "failed-ai-jobs", label: "失败的 AI 任务", status: failedAiJobs ? "警告" : "正常", detail: failedAiJobs ? `共 ${failedAiJobs} 个失败任务，可在重新执行对应操作后保留审计记录` : "没有失败的 AI 任务", projectId: null, repairable: false });
    const status = checks.some((item) => item.status === "错误") ? "错误" : checks.some((item) => item.status === "警告") ? "警告" : "正常";
    return { checkedAt: now(), status, projectCount: projectRows.length, chapterCount, failedAiJobs, workspaceBytes: directoryBytes(this.root), backupBytes: directoryBytes(this.backupRoot), checks };
  }

  rebuildSearchIndexes(projectId: string, verify = true) {
    const row = this.catalog.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!row) throw new Error("项目不存在");
    const db = this.projectDb(projectId);
    const chapters = this.projects.listChapters(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM chapter_fts; DELETE FROM chapter_fts_tri;");
      const insertFts = db.prepare("INSERT INTO chapter_fts(id, title, content) VALUES(?, ?, ?)");
      const insertTrigram = db.prepare("INSERT INTO chapter_fts_tri(id, title, content) VALUES(?, ?, ?)");
      for (const chapter of chapters) {
        insertFts.run(chapter.id, chapter.title, chapter.content);
        insertTrigram.run(chapter.id, chapter.title, chapter.content);
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
    return verify ? this.runSystemHealthCheck() : null;
  }

  checkpointAll() {
    this.catalog.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.research.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    for (const db of this.projectDbs.values())
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close() {
    for (const db of this.projectDbs.values()) db.close();
    this.projectDbs.clear();
    this.research.close();
    this.catalog.close();
  }

  private getSetting(key: string, fallback: string) {
    const row = this.catalog
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  private setSetting(key: string, value: string) {
    this.catalog
      .prepare("INSERT OR REPLACE INTO settings VALUES(?, ?)")
      .run(key, value);
  }

  private consumeApprovedChange(
    db: DatabaseSync,
    targetKind: ChangeRequest["targetKind"],
    targetId: string,
    baseVersion: number,
  ) {
    const change = this.listRecords<ChangeRequest>(db, "changes")
      .filter(
        (item) =>
          item.status === "已批准" &&
          item.targetKind === targetKind &&
          item.targetId === targetId &&
          item.baseVersion === baseVersion,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!change) return false;
    this.saveRecord(db, "changes", change.id, { ...change, status: "已应用" });
    return true;
  }

  private entityVersion(
    db: DatabaseSync,
    collection: RevisionRecord["collection"],
    entityId: string,
  ) {
    const row = db
      .prepare(
        "SELECT MAX(revision) AS revision FROM revisions WHERE collection = ? AND entity_id = ?",
      )
      .get(collection, entityId) as { revision: number | null };
    return (row.revision ?? 0) + 1;
  }

  projectPath(id: string) {
    return path.join(this.projectsRoot, id);
  }

  private touchProject(id: string) {
    this.projects.touch(id);
  }

  private setState<T>(db: DatabaseSync, key: string, value: T) {
    this.projects.setState(db, key, value);
  }

  private getState<T>(db: DatabaseSync, key: string, fallback?: T): T {
    return this.projects.getState(db, key, fallback);
  }

  private listRecords<T>(db: DatabaseSync, collection: string): T[] {
    return this.projects.listRecords<T>(db, collection);
  }

  private getRecord<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
  ): T | undefined {
    return this.projects.getRecord<T>(db, collection, id);
  }

  private saveRecord<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
    payload: T,
    priorRevision?: number,
    createRevision = true,
  ) {
    this.projects.saveRecord(db, collection, id, payload, priorRevision, createRevision);
  }

  private addRevision<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
    revision: number,
    payload: T,
  ) {
    this.projects.addRevision(db, collection, id, revision, payload);
  }

  private nextRevision(db: DatabaseSync, collection: string, id: string) {
    return this.projects.nextRevision(db, collection, id);
  }

  private saveEmbedding(
    db: DatabaseSync,
    sourceType: string,
    sourceId: string,
    text: string,
  ) {
    this.saveEmbeddings(db, sourceType, [{ sourceId, text }]);
  }

  private saveEmbeddings(
    db: DatabaseSync,
    sourceType: string,
    entries: Array<{ sourceId: string; text: string }>,
  ) {
    if (!entries.length) return;
    const vectors = this.embedTexts(entries.map((entry) => entry.text));
    const insert = db.prepare(
      "INSERT OR REPLACE INTO embeddings(id, source_type, source_id, content_hash, vector, provider_id, dimensions, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    );
    entries.forEach((entry, index) => insert.run(
      `${sourceType}:${entry.sourceId}`,
      sourceType,
      entry.sourceId,
      hashText(entry.text),
      JSON.stringify(vectors[index]),
      this.embeddingProvider.id,
      this.embeddingProvider.dimensions,
      now(),
    ));
  }

  private embedText(text: string) {
    return this.embedTexts([text])[0];
  }

  private embedTexts(texts: readonly string[]) {
    const vectors = this.embeddingProvider.embed(texts);
    if (vectors.length !== texts.length)
      throw new Error(`嵌入 provider ${this.embeddingProvider.id} 必须为每段文本返回一个向量`);
    for (const vector of vectors) validateEmbeddingVector(this.embeddingProvider, vector);
    return vectors;
  }

  private updateSummaries(projectId: string, chapter: Chapter) {
    const db = this.projectDb(projectId);
    const project = this.getProject(projectId);
    const finalized = project.chapters.filter((item) =>
      ["已定稿", "待发布", "已发布"].includes(item.status),
    );
    const saveSummary = (
      summary: Omit<StorySummary, "version" | "updatedAt">,
    ) => {
      const previous = this.getRecord<StorySummary>(
        db,
        "summaries",
        summary.id,
      );
      this.saveRecord(
        db,
        "summaries",
        summary.id,
        { ...summary, version: (previous?.version ?? 0) + 1, updatedAt: now() },
        previous?.version,
      );
    };
    const scenes = chapter.content
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
    scenes.forEach((scene, index) =>
      saveSummary({
        id: `scene:${chapter.id}:${index + 1}`,
        layer: "场景",
        title: `第${chapter.number}章·场景${index + 1}`,
        fromChapter: chapter.number,
        toChapter: chapter.number,
        content: scene.slice(0, 220),
      }),
    );
    saveSummary({
      id: `chapter:${chapter.id}`,
      layer: "章节",
      title: `第${chapter.number}章 ${chapter.title}`,
      fromChapter: chapter.number,
      toChapter: chapter.number,
      content: buildChapterSummary(chapter),
    });
    const stageStart = Math.floor((chapter.number - 1) / 10) * 10 + 1;
    const stageEnd = stageStart + 9;
    const stageItems = this.listRecords<StorySummary>(db, "summaries").filter(
      (item) =>
        item.layer === "章节" &&
        item.fromChapter >= stageStart &&
        item.fromChapter <= stageEnd,
    );
    saveSummary({
      id: `stage:${stageStart}`,
      layer: "十章阶段",
      title: `第${stageStart}–${stageEnd}章`,
      fromChapter: stageStart,
      toChapter: Math.max(
        ...stageItems.map((item) => item.toChapter),
        chapter.number,
      ),
      content: aggregateStorySummaries(stageItems, 6000),
    });
    const volumes = project.plans
      .filter((plan) => plan.kind === "分卷" && plan.status === "已批准")
      .sort((a, b) => a.ordinal - b.ordinal);
    let cursor = 1;
    for (const volume of volumes) {
      const estimatedChapters = Math.max(
        1,
        Math.ceil(volume.targetWords / 2500),
      );
      const end = cursor + estimatedChapters - 1;
      if (chapter.number >= cursor && chapter.number <= end) {
        const items = this.listRecords<StorySummary>(db, "summaries").filter(
          (item) =>
            item.layer === "十章阶段" &&
            item.fromChapter >= cursor &&
            item.fromChapter <= end,
        );
        saveSummary({
          id: `volume:${volume.id}`,
          layer: "分卷",
          title: volume.title,
          fromChapter: cursor,
          toChapter: Math.min(
            end,
            Math.max(...finalized.map((item) => item.number)),
          ),
          content: `分卷目标：${volume.goal}\n${aggregateStorySummaries(items, 10000 - volume.goal.length - 6)}`,
        });
        break;
      }
      cursor = end + 1;
    }
    const stages = this.listRecords<StorySummary>(db, "summaries").filter(
      (item) => item.layer === "十章阶段",
    );
    saveSummary({
      id: "book",
      layer: "全书",
      title: "全书进展摘要",
      fromChapter: 1,
      toChapter: Math.max(...finalized.map((item) => item.number)),
      content: aggregateStorySummaries(stages, 16000),
    });
  }
}

export { now };

function normalizeForFingerprint(text: string) {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

function textWindows(text: string, step: number) {
  const normalized = normalizeForFingerprint(text);
  const windows: string[] = [];
  for (let index = 0; index <= normalized.length - 24; index += step)
    windows.push(normalized.slice(index, index + 24));
  return windows;
}

function factEmbeddingText(fact: LedgerFact) {
  return `${fact.kind} ${fact.genreDimension ?? ""} ${fact.subject} ${fact.predicate} ${fact.value} ${fact.knowledgeScope}`;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
