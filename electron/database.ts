import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AiProfile, AiRoleRoute, StoredModelCapability } from "../src/shared/ai/types";
import {
  decideChangeRequest as decideChangeRequestDraft,
  prepareChangeRequest,
  resolveChangeTargetVersion,
} from "../src/shared/change-request-service";
import {
  assertChapterTransition,
  deriveChapterBatchMode,
  isProtectedChapterEdit,
  PROTECTED_CHAPTER_STATUSES,
  prepareChapterSave,
} from "../src/shared/chapter-lifecycle";
import { approveContractDraft, prepareContractUpdate } from "../src/shared/contract-service";
import {
  assertDashboardCutoff,
  compareActiveAlerts,
  compareDueSchedules,
  deriveProjectRisk,
} from "../src/shared/dashboard-policy";
import { prepareExpectationSave } from "../src/shared/expectation-service";
import { planFactConflictResolution, prepareFactSave } from "../src/shared/fact-service";
import { computeGenerationQuality, type GenerationDecision } from "../src/shared/generation-quality";
import { approvePlanDraft, preparePlanSave } from "../src/shared/plan-service";
import { COARSE_BLOCK_CHAPTERS } from "../src/shared/planning";
import { prepareProjectCreation, prepareProjectUpdate } from "../src/shared/project-service";
import { prepareQualityIssueSave, resolveQualityIssue } from "../src/shared/quality-issue-service";
import { prepareReviewExperiment } from "../src/shared/review-experiment-service";
import { prepareScheduleSave } from "../src/shared/schedule-service";
import { prepareStoryEntrySave, seedStoryEntriesFromContract } from "../src/shared/story-entry-service";
import { prepareFinalizedChapterSummaries } from "../src/shared/summaries";
import type {
  AiJobRecord,
  AiSettings,
  AutoBackupInput,
  AutoBackupSettings,
  ChangeRequest,
  Chapter,
  ChapterSaveMode,
  ChapterStatus,
  CreateProjectInput,
  ExpectationEntry,
  IncubationDraft,
  InsightPack,
  LaunchPackProgress,
  LedgerFact,
  MetricSnapshot,
  PlanNode,
  PlanningGenerationResult,
  ProjectDetail,
  ProjectPatch,
  ProjectSummary,
  ProxySettings,
  ProxySettingsInput,
  QualityIssue,
  RankingCaptureSchedule,
  RankingSnapshot,
  ResearchAnalysisRecord,
  ResearchBook,
  ReviewExperiment,
  RevisionRecord,
  ScheduleItem,
  SearchHit,
  StoryContract,
  StoryEntry,
  StorySummary,
  SystemHealthReport,
} from "../src/shared/types";
import { type ChapterGenerationGuard, chapterGenerationFingerprint } from "./ai-retry";
import { injectFault } from "./fault-injection";
import { ensureStructure, hasColumn, runMigrations, type StructureSpec } from "./migration-runner";
import type { AiJobCompletion } from "./repositories/ai-audit-repository";
import { AiAuditRepository } from "./repositories/ai-audit-repository";
import { AiProfileRepository } from "./repositories/ai-profile-repository";
import { ProjectRepository } from "./repositories/project-repository";
import { ResearchRepository } from "./repositories/research-repository";
import { RevisionRepository } from "./repositories/revision-repository";
import { SearchRepository } from "./repositories/search-repository";
import {
  cosineSimilarity,
  type EmbeddingProvider,
  HASH_BIGRAM_PROVIDER_ID,
  HashBigramEmbeddingProvider,
  validateEmbeddingVector,
} from "./semantic";

const now = () => new Date().toISOString();

function openDatabase(filePath: string) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
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
  words_per_chapter: number | null;
  update_cadence: string;
  safe_stock_line: number;
  created_at: string;
  updated_at: string;
}

/**
 * catalog 的权威结构：迁移与启动自检共用同一份定义。
 * 启动自检负责兜底修复「迁移记账跳过了某条迁移」的历史工作区（见 migration-runner.ts）。
 */
const CATALOG_TABLES = {
  projects: `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT NOT NULL,
        status TEXT NOT NULL,
        target_words INTEGER NOT NULL,
        words_per_chapter INTEGER NOT NULL DEFAULT 2500,
        update_cadence TEXT NOT NULL,
        safe_stock_line INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
  settings: `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  ai_jobs: `CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY, project_id TEXT, task_type TEXT NOT NULL, input_hash TEXT NOT NULL,
        prompt_version TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
        input_summary TEXT NOT NULL, output TEXT, estimated_cost REAL NOT NULL DEFAULT 0,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );`,
  incubations: `CREATE TABLE IF NOT EXISTS incubations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        step TEXT NOT NULL,
        payload TEXT NOT NULL,
        project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
  ai_profiles: `CREATE TABLE IF NOT EXISTS ai_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_surface TEXT NOT NULL DEFAULT 'auto',
            base_url TEXT NOT NULL,
            default_model TEXT NOT NULL DEFAULT '',
            auth_scheme TEXT NOT NULL DEFAULT 'bearer',
            extra_headers TEXT NOT NULL DEFAULT '{}',
            extra_query TEXT NOT NULL DEFAULT '{}',
            local_endpoint INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',
            last_used_at TEXT,
            last_test_at TEXT,
            last_test_ok INTEGER,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );`,
  ai_role_routes: `CREATE TABLE IF NOT EXISTS ai_role_routes (
            role TEXT PRIMARY KEY,
            profile_id TEXT,
            model_id TEXT,
            updated_at TEXT NOT NULL
          );`,
  model_capabilities: `CREATE TABLE IF NOT EXISTS model_capabilities (
            profile_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            api_surface TEXT NOT NULL,
            supports_json_schema INTEGER,
            supports_json_mode INTEGER,
            supports_streaming INTEGER,
            supports_stream_usage INTEGER,
            supports_reasoning INTEGER,
            max_output_tokens INTEGER,
            context_window INTEGER,
            probed_at TEXT NOT NULL,
            source TEXT NOT NULL,
            PRIMARY KEY (profile_id, model_id, api_surface)
          );`,
} as const;

const CATALOG_COLUMNS = {
  projects: {
    safe_stock_line: "INTEGER NOT NULL DEFAULT 10",
    words_per_chapter: "INTEGER NOT NULL DEFAULT 2500",
  },
  ai_jobs: {
    input_tokens: "INTEGER NOT NULL DEFAULT 0",
    output_tokens: "INTEGER NOT NULL DEFAULT 0",
    actual_cost: "REAL NOT NULL DEFAULT 0",
    duration_ms: "INTEGER NOT NULL DEFAULT 0",
    retry_context: "TEXT",
    headers_at: "TEXT",
    first_token_at: "TEXT",
    completed_at: "TEXT",
    chunk_count: "INTEGER NOT NULL DEFAULT 0",
    attempt_count: "INTEGER NOT NULL DEFAULT 0",
    profile_id: "TEXT",
    role: "TEXT",
  },
} as const;

const CATALOG_STRUCTURE: StructureSpec = { tables: CATALOG_TABLES, columns: CATALOG_COLUMNS };

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
  private readonly aiProfiles: AiProfileRepository;
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
    for (const directory of [root, this.projectsRoot, this.researchRoot, this.backupRoot, this.trashRoot])
      mkdirSync(directory, { recursive: true });
    this.catalog = openDatabase(path.join(root, "catalog.sqlite"));
    this.research = openDatabase(path.join(this.researchRoot, "research.sqlite"));
    this.initCatalog();
    this.projects = new ProjectRepository(this.catalog);
    this.researchData = new ResearchRepository(this.research);
    this.aiAudit = new AiAuditRepository(this.catalog);
    this.aiAudit.recoverInterrupted();
    this.aiProfiles = new AiProfileRepository(this.catalog);
    this.initResearch();
  }

  private initCatalog() {
    runMigrations(this.catalog, [
      {
        id: "catalog-0001-initial",
        run: (db) =>
          db.exec(
            [
              CATALOG_TABLES.projects,
              CATALOG_TABLES.settings,
              CATALOG_TABLES.ai_jobs,
              "CREATE UNIQUE INDEX IF NOT EXISTS idx_global_ai_jobs_dedupe ON ai_jobs(task_type, input_hash, prompt_version, model);",
            ].join("\n"),
          ),
      },
      {
        id: "catalog-0002-safe-stock-line",
        run: (db) => {
          if (!hasColumn(db, "projects", "safe_stock_line"))
            db.exec("ALTER TABLE projects ADD COLUMN safe_stock_line INTEGER NOT NULL DEFAULT 10");
        },
      },
      {
        id: "catalog-0003-words-per-chapter",
        run: (db) => {
          if (!hasColumn(db, "projects", "words_per_chapter"))
            db.exec("ALTER TABLE projects ADD COLUMN words_per_chapter INTEGER NOT NULL DEFAULT 2500");
        },
      },
      {
        id: "catalog-0004-incubations",
        run: (db) => db.exec(CATALOG_TABLES.incubations),
      },
      {
        id: "catalog-0005-ai-job-tokens",
        run: (db) => {
          for (const column of [
            "input_tokens INTEGER NOT NULL DEFAULT 0",
            "output_tokens INTEGER NOT NULL DEFAULT 0",
            "actual_cost REAL NOT NULL DEFAULT 0",
            "duration_ms INTEGER NOT NULL DEFAULT 0",
          ]) {
            const name = column.split(" ")[0];
            if (!hasColumn(db, "ai_jobs", name)) db.exec(`ALTER TABLE ai_jobs ADD COLUMN ${column}`);
          }
        },
      },
      {
        id: "catalog-0006-ai-job-cache-index",
        run: (db) => {
          db.exec("DROP INDEX IF EXISTS idx_global_ai_jobs_dedupe");
          if (!hasColumn(db, "ai_jobs", "retry_context")) db.exec("ALTER TABLE ai_jobs ADD COLUMN retry_context TEXT");
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_global_ai_jobs_cache ON ai_jobs(task_type, input_hash, prompt_version, model, status, updated_at)",
          );
        },
      },
      {
        id: "catalog-0007-ai-job-cache-provider",
        run: (db) => {
          db.exec("DROP INDEX IF EXISTS idx_global_ai_jobs_cache");
          db.exec(
            "CREATE INDEX idx_global_ai_jobs_cache ON ai_jobs(task_type, input_hash, prompt_version, provider, model, status, updated_at)",
          );
        },
      },
      {
        id: "catalog-0008-ai-job-telemetry",
        run: (db) => {
          for (const column of [
            "headers_at TEXT",
            "first_token_at TEXT",
            "completed_at TEXT",
            "chunk_count INTEGER NOT NULL DEFAULT 0",
            "attempt_count INTEGER NOT NULL DEFAULT 0",
          ]) {
            const name = column.split(" ")[0];
            if (!hasColumn(db, "ai_jobs", name)) db.exec(`ALTER TABLE ai_jobs ADD COLUMN ${column}`);
          }
        },
      },
      {
        id: "catalog-0009-ai-profiles",
        run: (db) => {
          db.exec(
            [CATALOG_TABLES.ai_profiles, CATALOG_TABLES.ai_role_routes, CATALOG_TABLES.model_capabilities].join("\n"),
          );
          for (const column of ["profile_id TEXT", "role TEXT"]) {
            const name = column.split(" ")[0];
            if (!hasColumn(db, "ai_jobs", name)) db.exec(`ALTER TABLE ai_jobs ADD COLUMN ${column}`);
          }
        },
      },
    ]);
    // 兜底修复历史上被版本记账跳过的结构（incubations 表、projects.words_per_chapter 等）。
    ensureStructure(this.catalog, CATALOG_STRUCTURE);
  }

  private initResearch() {
    runMigrations(this.research, [
      {
        id: "research-0001-initial",
        run: (db) =>
          db.exec(`
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
      },
      {
        id: "research-0002-ranking-columns",
        run: (db) => {
          for (const column of ["synopsis", "official_reader_url", "platform"])
            if (!hasColumn(db, "ranking_entries", column))
              db.exec(`ALTER TABLE ranking_entries ADD COLUMN ${column} TEXT`);
        },
      },
    ]);
  }

  private initProject(db: DatabaseSync) {
    runMigrations(db, [
      {
        id: "project-0001-initial",
        run: (database) =>
          database.exec(`
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
      },
      {
        id: "project-0002-chapter-tables",
        run: (database) =>
          database.exec(`
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
        COALESCE(CAST(json_extract(payload, '$.number') AS INTEGER), 1),
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
      DELETE FROM chapter_fts;
      DELETE FROM chapter_fts_tri;
      INSERT INTO chapter_fts(id, title, content)
      SELECT c.id, c.title, COALESCE(b.content, '') FROM chapters c LEFT JOIN chapter_contents b ON b.chapter_id = c.id;
      INSERT INTO chapter_fts_tri(id, title, content)
      SELECT c.id, c.title, COALESCE(b.content, '') FROM chapters c LEFT JOIN chapter_contents b ON b.chapter_id = c.id;
      `),
      },
      {
        id: "project-0003-embedding-provider",
        run: (database) => {
          if (!hasColumn(database, "embeddings", "provider_id"))
            database.exec(
              `ALTER TABLE embeddings ADD COLUMN provider_id TEXT NOT NULL DEFAULT '${HASH_BIGRAM_PROVIDER_ID}'`,
            );
          if (!hasColumn(database, "embeddings", "dimensions"))
            database.exec("ALTER TABLE embeddings ADD COLUMN dimensions INTEGER NOT NULL DEFAULT 192");
          database.exec(
            "CREATE INDEX IF NOT EXISTS idx_embeddings_provider ON embeddings(source_type, provider_id, dimensions)",
          );
        },
      },
    ]);
  }

  private projectDb(projectId: string) {
    const existing = this.projectDbs.get(projectId);
    if (existing) return existing;
    if (!this.catalog.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new Error("项目不存在");
    const root = path.resolve(this.projectsRoot);
    const directory = path.resolve(root, projectId);
    if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("项目目录校验失败");
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
    const prepared = prepareProjectCreation(input, {
      projectId: id,
      updatedAt: timestamp,
    });
    this.catalog
      .prepare(
        `
      INSERT INTO projects(id, title, genre, status, target_words, words_per_chapter, update_cadence, safe_stock_line, created_at, updated_at)
      VALUES(?, ?, ?, '候选立项', ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        prepared.summary.title,
        prepared.summary.genre,
        prepared.summary.targetWords,
        prepared.summary.wordsPerChapter,
        prepared.summary.updateCadence,
        prepared.summary.safeStockLine,
        timestamp,
        timestamp,
      );
    const db = this.projectDb(id);
    this.setState(db, "contract", prepared.contract);
    this.setState(db, "insightIds", []);
    return this.getProjectSummary(id);
  }

  createProjectFromConcept(
    input: CreateProjectInput,
    contractDraft: Omit<StoryContract, "version" | "approved" | "updatedAt">,
  ): ProjectSummary {
    const created = this.createProject(input);
    const project = this.getProject(created.id);
    this.saveContract(created.id, { ...project.contract, ...contractDraft, approved: false });
    return this.getProjectSummary(created.id);
  }

  listIncubations(): IncubationDraft[] {
    return (
      this.catalog.prepare("SELECT payload FROM incubations ORDER BY updated_at DESC, id").all() as Array<{
        payload: string;
      }>
    ).map((row) => parseJson<IncubationDraft>(row.payload));
  }

  getIncubation(id: string): IncubationDraft {
    const row = this.catalog.prepare("SELECT payload FROM incubations WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;
    if (!row) throw new Error("立项草稿不存在或已被删除");
    return parseJson<IncubationDraft>(row.payload);
  }

  saveIncubation(draft: IncubationDraft): IncubationDraft {
    this.catalog
      .prepare(
        `
      INSERT OR REPLACE INTO incubations(id, status, step, payload, project_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        draft.id,
        draft.status,
        draft.step,
        JSON.stringify(draft),
        draft.createdProjectId,
        draft.createdAt,
        draft.updatedAt,
      );
    return this.getIncubation(draft.id);
  }

  deleteIncubation(id: string) {
    const row = this.catalog.prepare("SELECT id FROM incubations WHERE id = ?").get(id);
    if (!row) throw new Error("立项草稿不存在或已被删除");
    this.catalog.prepare("DELETE FROM incubations WHERE id = ?").run(id);
  }

  markIncubationPromoted(id: string, projectId: string, updatedAt: string): IncubationDraft {
    const draft = this.getIncubation(id);
    if (draft.createdProjectId) throw new Error("该立项草稿已经创建过作品");
    const next: IncubationDraft = {
      ...draft,
      status: "已立项",
      step: "开书包",
      createdProjectId: projectId,
      updatedAt,
    };
    return this.saveIncubation(next);
  }

  listProjects(): ProjectSummary[] {
    const rows = this.catalog
      .prepare("SELECT * FROM projects WHERE status != '归档' ORDER BY updated_at DESC, id")
      .all() as unknown as CatalogRow[];
    return rows.map((row) => this.hydrateSummary(row));
  }

  /** 立项体检用的最小契约指纹：只暴露书名、前提与开局机制，不含正文或账本。 */
  listProjectSignatures(): Array<{ title: string; premise: string; openingMechanism: string }> {
    return this.listProjects().map((summary) => {
      const contract = this.getState<StoryContract>(this.projectDb(summary.id), "contract");
      return {
        title: summary.title,
        premise: contract.premise ?? "",
        openingMechanism: contract.openingMechanism ?? "",
      };
    });
  }

  deleteProject(id: string, confirmationTitle: string) {
    const row = this.catalog.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as
      | CatalogRow
      | undefined;
    if (!row) throw new Error("作品不存在或已经删除");
    if (confirmationTitle.trim() !== row.title) throw new Error("输入的书名与作品名不一致");
    const open = this.projectDbs.get(id);
    if (open) {
      open.close();
      this.projectDbs.delete(id);
    }
    const source = path.resolve(this.projectsRoot, id);
    const destination = path.resolve(this.trashRoot, `${id}-${Date.now()}`);
    if (!source.startsWith(`${path.resolve(this.projectsRoot)}${path.sep}`)) throw new Error("作品目录校验失败");
    if (!destination.startsWith(`${path.resolve(this.trashRoot)}${path.sep}`)) throw new Error("回收站目录校验失败");
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
      try {
        this.catalog.exec("ROLLBACK");
      } catch {
        /* no active transaction */
      }
      if (moved) renameSync(destination, source);
      throw error;
    }
    return moved
      ? `作品已移入回收目录：${destination}`
      : "作品已从工作台移除；项目文件正被另一个工作台窗口占用，已原地归档，关闭其他窗口后仍可人工恢复或移动。";
  }

  getProjectSummary(id: string): ProjectSummary {
    const row = this.catalog.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as
      | CatalogRow
      | undefined;
    if (!row) throw new Error("项目不存在");
    return this.hydrateSummary(row);
  }

  getDashboardActivity(throughExclusive: string) {
    assertDashboardCutoff(throughExclusive);
    const dueToday: ScheduleItem[] = [];
    const activeAlerts: QualityIssue[] = [];
    let pendingIssues = 0;
    const projects = this.catalog.prepare("SELECT id FROM projects WHERE status != '归档'").all() as Array<{
      id: string;
    }>;
    for (const project of projects) {
      const db = this.projectDb(project.id);
      dueToday.push(
        ...(
          db
            .prepare(`
        SELECT payload FROM records
        WHERE collection = 'schedule'
          AND json_extract(payload, '$.status') != '已发布'
          AND julianday(json_extract(payload, '$.publishAt')) < julianday(?)
        ORDER BY julianday(json_extract(payload, '$.publishAt')), id
      `)
            .all(throughExclusive) as Array<{ payload: string }>
        ).map((row) => parseJson<ScheduleItem>(row.payload)),
      );
      const alertRows = db
        .prepare(`
        SELECT payload, COUNT(*) OVER () AS total
        FROM records
        WHERE collection = 'issues' AND json_extract(payload, '$.status') = '待处理'
        ORDER BY julianday(json_extract(payload, '$.createdAt')) DESC, id
        LIMIT 12
      `)
        .all() as Array<{ payload: string; total: number }>;
      pendingIssues += alertRows.length ? Number(alertRows[0].total) : 0;
      activeAlerts.push(...alertRows.map((row) => parseJson<QualityIssue>(row.payload)));
    }
    return {
      dueToday: dueToday.sort(compareDueSchedules),
      activeAlerts: activeAlerts.sort(compareActiveAlerts).slice(0, 12),
      pendingIssues,
    };
  }

  private hydrateSummary(row: CatalogRow): ProjectSummary {
    const db = this.projectDb(row.id);
    const chapterStats = db
      .prepare(`
      SELECT COUNT(*) AS chapter_count,
        COALESCE(SUM(word_count), 0) AS current_words,
        COALESCE(SUM(CASE WHEN status IN ('已定稿', '待发布') THEN 1 ELSE 0 END), 0) AS stock_chapters
      FROM chapters
    `)
      .get() as { chapter_count: number; current_words: number; stock_chapters: number };
    const pendingHardIssues = Number(
      (
        db
          .prepare(`
      SELECT COUNT(*) AS count FROM records
      WHERE collection = 'issues'
        AND json_extract(payload, '$.status') = '待处理'
        AND json_extract(payload, '$.severity') = '硬性'
    `)
          .get() as { count: number }
      ).count,
    );
    const next = db
      .prepare(`
      SELECT json_extract(payload, '$.publishAt') AS publish_at FROM records
      WHERE collection = 'schedule' AND json_extract(payload, '$.status') != '已发布'
      ORDER BY publish_at LIMIT 1
    `)
      .get() as { publish_at: string } | undefined;
    return {
      id: row.id,
      title: row.title,
      genre: row.genre,
      status: row.status,
      targetWords: row.target_words,
      wordsPerChapter: row.words_per_chapter ?? 2500,
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
    const updatedAt = now();
    const next = prepareProjectUpdate(current, patch, updatedAt);
    this.catalog
      .prepare(
        `
      UPDATE projects SET title = ?, status = ?, target_words = ?, words_per_chapter = ?, update_cadence = ?, safe_stock_line = ?, updated_at = ? WHERE id = ?
    `,
      )
      .run(
        next.title,
        next.status,
        next.targetWords,
        next.wordsPerChapter,
        next.updateCadence,
        next.safeStockLine,
        updatedAt,
        id,
      );
    return this.getProjectSummary(id);
  }

  getProject(id: string): ProjectDetail {
    const db = this.projectDb(id);
    return {
      summary: this.getProjectSummary(id),
      contract: this.getState<StoryContract>(db, "contract"),
      plans: this.listRecords<PlanNode>(db, "plans").sort((a, b) => a.ordinal - b.ordinal),
      chapters: this.projects.listChapters(db),
      facts: this.listRecords<LedgerFact>(db, "facts").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      issues: this.listRecords<QualityIssue>(db, "issues").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      changes: this.listRecords<ChangeRequest>(db, "changes").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      schedule: this.listRecords<ScheduleItem>(db, "schedule").sort((a, b) => a.publishAt.localeCompare(b.publishAt)),
      metrics: this.listRecords<MetricSnapshot>(db, "metrics").sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      experiments: this.listRecords<ReviewExperiment>(db, "experiments").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      insightIds: this.getState<string[]>(db, "insightIds", []),
      summaries: this.listRecords<StorySummary>(db, "summaries").sort((a, b) => a.fromChapter - b.fromChapter),
      expectations: this.listRecords<ExpectationEntry>(db, "expectations").sort(
        (a, b) => a.sourceChapter - b.sourceChapter,
      ),
      storyEntries: this.listRecords<StoryEntry>(db, "story_entries").sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN"),
      ),
      aiFlavorWhitelist: this.getState<string[]>(db, "aiFlavorWhitelist", []),
      directorNotes: this.getDirectorNotes(id),
      launchPack: this.getState<LaunchPackProgress | null>(db, "launchPack", null) ?? undefined,
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
      experiments: this.listRecords<ReviewExperiment>(db, "experiments").sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      insightIds: this.getState<string[]>(db, "insightIds", []),
      summaries: this.listRecords<StorySummary>(db, "summaries").sort((a, b) => a.fromChapter - b.fromChapter),
      expectations: this.listRecords<ExpectationEntry>(db, "expectations").sort(
        (a, b) => a.sourceChapter - b.sourceChapter,
      ),
      storyEntries: this.listRecords<StoryEntry>(db, "story_entries").sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN"),
      ),
      aiFlavorWhitelist: this.getState<string[]>(db, "aiFlavorWhitelist", []),
      directorNotes: this.getDirectorNotes(id),
      launchPack: this.getState<LaunchPackProgress | null>(db, "launchPack", null) ?? undefined,
    };
  }

  getChapter(id: string, chapterId: string): Chapter {
    const chapter = this.projects.getChapter(this.projectDb(id), chapterId);
    if (!chapter) throw new Error("章节不存在");
    return chapter;
  }

  saveLaunchPackProgress(id: string, progress: LaunchPackProgress): LaunchPackProgress {
    this.setState(this.projectDb(id), "launchPack", progress);
    this.touchProject(id);
    return progress;
  }

  /** 落盘一批开书包内容；同一层级同一位置的节点只保留一个（粗纲与章纲批次会重叠）。 */
  saveLaunchPackBatch(id: string, batch: PlanningGenerationResult, progress?: LaunchPackProgress): void {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const chapterNumbers = new Set(this.projects.listChapterMetadata(db).map((chapter) => chapter.number));
      for (const chapter of batch.chapters) {
        if (chapterNumbers.has(chapter.number)) throw new Error(`第${chapter.number}章已存在，开书包未覆盖现有内容`);
        if (chapter.content.trim()) throw new Error("开书包只能保存章纲草稿");
        chapterNumbers.add(chapter.number);
      }
      const existingPlans = this.listRecords<PlanNode>(db, "plans");
      const existingIds = new Set(existingPlans.map((plan) => plan.id));
      const existingBySlot = new Map(existingPlans.map((plan) => [`${plan.kind}:${plan.ordinal}`, plan]));
      const batchIds = new Set<string>();
      const idRemap = new Map<string, string>();
      for (const plan of batch.plans) {
        if (existingIds.has(plan.id) || batchIds.has(plan.id)) throw new Error("开书包规划节点已存在");
        batchIds.add(plan.id);
        const existing = existingBySlot.get(`${plan.kind}:${plan.ordinal}`);
        if (existing) {
          // 同一层级同一位置已存在（粗纲先由全书粗纲生成）；子节点改指向已存在的节点。
          idRemap.set(plan.id, existing.id);
          continue;
        }
        existingBySlot.set(`${plan.kind}:${plan.ordinal}`, plan);
        const parentId = plan.parentId ? (idRemap.get(plan.parentId) ?? plan.parentId) : plan.parentId;
        this.saveRecord(db, "plans", plan.id, { ...plan, parentId, status: "草稿" });
      }
      for (const chapter of batch.chapters) {
        this.persistChapterInTransaction(db, id, { ...chapter, status: "章纲" }, "章纲", false);
      }
      if (progress) this.setState(db, "launchPack", progress);
      db.exec("COMMIT");
      this.touchProject(id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  approveLaunchPack(id: string): void {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    let catalogTransaction = false;
    try {
      const progress = this.getState<LaunchPackProgress | null>(db, "launchPack", null);
      if (progress?.status !== "待确认") throw new Error("创作包生成完毕后才能统一确认");
      const summary = this.getProjectSummary(id);
      const targetChapters = Math.ceil(summary.targetWords / (summary.wordsPerChapter || 2500));
      if (progress.targetChapters !== targetChapters) throw new Error("目标篇幅已改变，请继续生成后再确认");
      const horizon = Math.min(progress.horizonChapters ?? targetChapters, targetChapters);
      const chapters = this.projects.listChapterMetadata(db);
      const chapterNumbers = new Set(chapters.map((chapter) => chapter.number));
      for (let number = 1; number <= horizon; number += 1) {
        if (!chapterNumbers.has(number)) throw new Error(`第${number}章章纲缺失，暂时不能确认创作包`);
      }
      const contract = this.getState<StoryContract>(db, "contract");
      const approved = contract.approved ? contract : approveContractDraft(contract, now());
      const plans = this.listRecords<PlanNode>(db, "plans");
      if (!["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"].every((kind) => plans.some((plan) => plan.kind === kind))) {
        throw new Error("创作包的规划层级尚不完整");
      }
      const coarseOrdinals = new Set(plans.filter((plan) => plan.kind === "粗纲").map((plan) => plan.ordinal));
      for (let start = 1; start <= targetChapters; start += COARSE_BLOCK_CHAPTERS) {
        if (!coarseOrdinals.has(start)) throw new Error(`第${start}章起的粗纲缺失，暂时不能确认创作包`);
      }
      const detailPlans = plans.filter((plan) => plan.kind === "细纲");
      const scenePlans = plans.filter((plan) => plan.kind === "场景卡");
      for (let number = 1; number <= horizon; number += 1) {
        const detail = detailPlans.find((plan) => plan.ordinal === number);
        if (!detail) throw new Error(`第${number}章细纲缺失，暂时不能确认创作包`);
        if (!scenePlans.some((plan) => plan.parentId === detail.id))
          throw new Error(`第${number}章场景卡缺失，暂时不能确认创作包`);
      }
      this.setState(db, "contract", approved);
      for (const plan of plans) this.saveRecord(db, "plans", plan.id, approvePlanDraft(plan, approved));
      this.setState(db, "launchPack", { ...progress, status: "已确认", updatedAt: now() });
      this.catalog.exec("BEGIN IMMEDIATE");
      catalogTransaction = true;
      this.catalog.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run("连载准备", now(), id);
      db.exec("COMMIT");
      this.catalog.exec("COMMIT");
      catalogTransaction = false;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      if (catalogTransaction) this.catalog.exec("ROLLBACK");
      throw error;
    }
  }

  saveContract(id: string, contract: StoryContract, changeRequestId?: string) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.getState<StoryContract>(db, "contract");
      const update = prepareContractUpdate(previous, contract, now());
      if (!update.changed) {
        db.exec("COMMIT");
        return previous;
      }
      if (
        previous.approved &&
        !this.consumeApprovedChange(db, "创作契约", "contract", previous.version, changeRequestId)
      )
        throw new Error("已审批创作契约只能通过已批准的改纲变更单修改");
      const next = update.contract;
      this.addRevision(db, "state", "contract", previous.version, previous);
      this.setState(db, "contract", next);
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  approveContract(id: string) {
    const db = this.projectDb(id);
    const contract = this.getState<StoryContract>(db, "contract");
    const next = approveContractDraft(contract, now());
    db.exec("BEGIN IMMEDIATE");
    this.catalog.exec("BEGIN IMMEDIATE");
    try {
      this.setState(db, "contract", next);
      this.catalog.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run("大纲审批", now(), id);
      db.exec("COMMIT");
      this.catalog.exec("COMMIT");
      return next;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      try {
        this.catalog.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  attachInsights(id: string, insightIds: string[]) {
    this.setState(this.projectDb(id), "insightIds", [...new Set(insightIds)]);
    this.touchProject(id);
  }

  savePlan(id: string, plan: PlanNode, changeRequestId?: string) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = plan.id ? this.getRecord<PlanNode>(db, "plans", plan.id) : undefined;
      const prepared = preparePlanSave(previous, plan, plan.id || randomUUID());
      if (prepared.noOp) {
        db.exec("COMMIT");
        return previous!;
      }
      if (
        prepared.protectedEdit &&
        !this.consumeApprovedChange(
          db,
          "规划",
          previous!.id,
          this.entityVersion(db, "plans", previous!.id),
          changeRequestId,
        )
      ) {
        throw new Error("已批准规划只能通过已批准的改纲变更单修改");
      }
      const next = prepared.plan;
      this.saveRecord(db, "plans", next.id, next);
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  approvePlan(id: string, planId: string) {
    const db = this.projectDb(id);
    const plan = this.getRecord<PlanNode>(db, "plans", planId);
    const contract = this.getState<StoryContract>(db, "contract");
    this.saveRecord(db, "plans", planId, approvePlanDraft(plan, contract));
    this.touchProject(id);
  }

  saveChapter(id: string, chapter: Chapter, mode: ChapterSaveMode = "version", changeRequestId?: string) {
    return this.persistChapter(id, chapter, undefined, mode === "version", undefined, changeRequestId);
  }

  saveGeneratedChapter(id: string, chapter: Chapter, expected?: ChapterGenerationGuard) {
    if (!chapter.id || !chapter.content.trim()) throw new Error("AI 草稿缺少章节或正文");
    return this.persistChapter(id, chapter, "待质检", true, expected);
  }

  private persistChapter(
    id: string,
    chapter: Chapter,
    forcedStatus?: ChapterStatus,
    createRevision = true,
    expected?: ChapterGenerationGuard,
    changeRequestId?: string,
  ) {
    const db = this.projectDb(id);
    const previous = chapter.id ? this.projects.getChapter(db, chapter.id) : undefined;
    db.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.persistChapterInTransaction(
        db,
        id,
        chapter,
        forcedStatus,
        createRevision,
        expected,
        changeRequestId,
      );
      injectFault("power-loss-before-commit");
      db.exec("COMMIT");
      this.touchProject(id);
      // 章节被变更单拉出定稿集后，旧正文的摘要会继续进入生成上下文；这里按新正文重建。
      if (
        previous &&
        PROTECTED_CHAPTER_STATUSES.includes(previous.status) &&
        !PROTECTED_CHAPTER_STATUSES.includes(saved.status)
      )
        this.updateSummaries(id, saved);
      return saved;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
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
    changeRequestId?: string,
  ) {
    const previous = chapter.id ? this.projects.getChapter(db, chapter.id) : undefined;
    if (
      expected &&
      (!previous ||
        previous.revision !== expected.revision ||
        chapterGenerationFingerprint(previous) !== expected.fingerprint)
    ) {
      throw new Error("章节在 AI 生成期间已被修改，旧生成结果未保存");
    }
    const protectedEdit = isProtectedChapterEdit(previous, chapter);
    if (protectedEdit && !this.consumeApprovedChange(db, "章节", previous!.id, previous!.revision, changeRequestId)) {
      throw new Error("已定稿或进入发布流程的章节只能通过匹配的已批准变更单修改");
    }
    const facts = this.listRecords<LedgerFact>(db, "facts");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    const plans = this.listRecords<PlanNode>(db, "plans");
    let endingExpectationId = chapter.endingExpectationId ?? null;
    if (chapter.endingExpectation?.trim()) {
      const existingExpectation = endingExpectationId
        ? this.getRecord<ExpectationEntry>(db, "expectations", endingExpectationId)
        : undefined;
      const savedExpectation = this.persistExpectation(
        db,
        {
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
        },
        createRevision,
      );
      endingExpectationId = savedExpectation.id;
    }
    const projectRow = this.catalog.prepare("SELECT genre, words_per_chapter FROM projects WHERE id = ?").get(id) as
      | { genre: ProjectSummary["genre"]; words_per_chapter: number | null }
      | undefined;
    if (!projectRow) throw new Error("项目不存在");
    const genre = projectRow.genre;
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
        wordsPerChapter: projectRow.words_per_chapter ?? 2500,
      }),
      updatedAt: now(),
    });
    if (protectedEdit) {
      for (const schedule of this.listRecords<ScheduleItem>(db, "schedule").filter(
        (item) => item.chapterId === next.id && item.status !== "已发布",
      ))
        this.saveRecord(db, "schedule", schedule.id, { ...schedule, status: "待排期" });
    }
    this.projects.saveChapter(db, next, previous?.revision, createRevision);
    db.prepare("DELETE FROM chapter_fts WHERE id = ?").run(next.id);
    db.prepare("INSERT INTO chapter_fts(id, title, content) VALUES(?, ?, ?)").run(next.id, next.title, next.content);
    db.prepare("DELETE FROM chapter_fts_tri WHERE id = ?").run(next.id);
    db.prepare("INSERT INTO chapter_fts_tri(id, title, content) VALUES(?, ?, ?)").run(
      next.id,
      next.title,
      next.content,
    );
    this.saveEmbedding(db, "chapters", next.id, `${next.title}\n${next.outline}\n${next.content.slice(0, 1600)}`);
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
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  private persistExpectation(db: DatabaseSync, expectation: ExpectationEntry, createRevision = true) {
    const previous = expectation.id ? this.getRecord<ExpectationEntry>(db, "expectations", expectation.id) : undefined;
    const next = prepareExpectationSave(previous, expectation, {
      expectationId: expectation.id || randomUUID(),
      createdAt: now(),
      updatedAt: now(),
    });
    this.saveRecord(db, "expectations", next.id, next, undefined, createRevision);
    return next;
  }

  saveStoryEntry(id: string, entry: StoryEntry) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = entry.id ? this.getRecord<StoryEntry>(db, "story_entries", entry.id) : undefined;
      const next = prepareStoryEntrySave(previous, entry, {
        id: entry.id || randomUUID(),
        updatedAt: now(),
      });
      this.saveRecord(db, "story_entries", next.id, next, undefined, false);
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  deleteStoryEntry(id: string, entryId: string) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run("story_entries", entryId);
      db.exec("COMMIT");
      this.touchProject(id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  /**
   * 从契约长列表生成设定条目种子。幂等：已存在同 id 条目时跳过，
   * 不覆盖作者编辑过的内容，也不删除任何条目。
   */
  /** AI 味白名单：本书有意使用的词句，质检统计时从命中与字数里排除。 */
  saveAiFlavorWhitelist(id: string, terms: readonly string[]) {
    const db = this.projectDb(id);
    const cleaned = [...new Set(terms.map((item) => item.trim()).filter(Boolean))].slice(0, 200);
    this.setState(db, "aiFlavorWhitelist", cleaned);
    this.touchProject(id);
    return cleaned;
  }

  seedStoryEntries(id: string) {
    const db = this.projectDb(id);
    const contract = this.getState<StoryContract>(db, "contract");
    const existing = new Set(this.listRecords<StoryEntry>(db, "story_entries").map((entry) => entry.id));
    const created = seedStoryEntriesFromContract(contract, now()).filter((entry) => !existing.has(entry.id));
    if (!created.length) return this.listRecords<StoryEntry>(db, "story_entries");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of created) this.saveRecord(db, "story_entries", entry.id, entry, undefined, false);
      db.exec("COMMIT");
      this.touchProject(id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
    return this.listRecords<StoryEntry>(db, "story_entries");
  }

  transitionChapter(id: string, chapterId: string, status: ChapterStatus) {
    const db = this.projectDb(id);
    const chapter = this.projects.getChapter(db, chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (status !== "章纲" && !chapter.content.trim()) throw new Error("空正文不能进入质检、定稿或发布流程");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    assertChapterTransition(chapter.status, status, chapterId, issues);
    const saved = this.persistChapter(id, { ...chapter, status }, status);
    if (status === "已定稿" && chapter.status !== "已定稿") this.updateSummaries(id, saved);
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
      this.saveEmbedding(db, "facts", next.id, factEmbeddingText(next));
      db.exec("COMMIT");
      this.touchProject(id);
      return next;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  resolveFactConflict(id: string, factId: string, resolution: "keep" | "ignore") {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const facts = this.listRecords<LedgerFact>(db, "facts");
      const plan = planFactConflictResolution(facts, factId, resolution, now());
      for (const superseded of plan.superseded) {
        this.saveRecord(db, "facts", superseded.id, superseded);
        this.saveEmbedding(db, "facts", superseded.id, factEmbeddingText(superseded));
      }
      this.saveRecord(db, "facts", plan.fact.id, plan.fact);
      this.saveEmbedding(db, "facts", plan.fact.id, factEmbeddingText(plan.fact));
      db.exec("COMMIT");
      this.touchProject(id);
      return plan.fact;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  searchRelevantFacts(id: string, queryText: string, chapterNumber: number, limit = 80) {
    const db = this.projectDb(id);
    const facts = new Map(this.listRecords<LedgerFact>(db, "facts").map((fact) => [fact.id, fact]));
    const storedRows = db
      .prepare("SELECT source_id, content_hash, provider_id, dimensions FROM embeddings WHERE source_type = 'facts'")
      .all() as Array<{ source_id: string; content_hash: string; provider_id: string; dimensions: number }>;
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
      .all(this.embeddingProvider.id, this.embeddingProvider.dimensions) as Array<{
      source_id: string;
      vector: string;
    }>;
    return rows
      .map((row) => ({
        fact: facts.get(row.source_id),
        score: cosineSimilarity(query, parseJson<number[]>(row.vector)),
      }))
      .filter((item): item is { fact: LedgerFact; score: number } => Boolean(item.fact))
      .filter(
        ({ fact }) =>
          (fact.confidence === "已确认" || fact.confidence === "有冲突") &&
          fact.validFromChapter <= chapterNumber &&
          (fact.validToChapter === null || fact.validToChapter >= chapterNumber),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.fact);
  }

  searchProject(id: string, query: string, offset = 0, limit = 50): SearchHit[] {
    const db = this.projectDb(id);
    // Search only needs chapter metadata. Full正文 is loaded lazily by getChapter.
    return this.search.search(db, query, this.projects.listChapterMetadata(db), offset, limit);
  }

  listRevisions(id: string, collection: RevisionRecord["collection"], entityId: string): RevisionRecord[] {
    const db = this.projectDb(id);
    return this.revisions.list(db, collection, entityId);
  }

  restoreRevision(id: string, revisionId: string) {
    const db = this.projectDb(id);
    const row = this.revisions.get(db, revisionId);
    if (!row) throw new Error("历史版本不存在");
    // 变更单是审批与消耗的审计账本，回写历史状态会让"已应用"重新变回"已批准"。
    if (row.collection === "changes") throw new Error("变更单是审计账本，不支持恢复历史版本");
    const payload = parseJson<unknown>(row.payload);
    const authorizeRestore = (
      targetKind: ChangeRequest["targetKind"],
      targetId: string,
      baseVersion: number,
      current: unknown,
    ) => {
      const change: ChangeRequest = {
        id: randomUUID(),
        targetKind,
        targetId,
        baseVersion,
        title: "恢复历史版本",
        reason: `恢复修订 ${revisionId}`,
        beforeValue: JSON.stringify(current),
        afterValue: JSON.stringify(payload),
        impact: "受保护内容将恢复为选定历史版本",
        rollback: "可再次从历史版本恢复",
        status: "已批准",
        createdAt: now(),
      };
      this.saveRecord(db, "changes", change.id, change);
      return change.id;
    };
    // 保存链路按 id 精确消耗恢复变更单，避免误耗用户自己同目标、同版本的合法变更单；
    // 保存失败时删除恢复变更单，避免留下一条永远用不上的"已批准"。
    const saveWithRestoreChange = (changeId: string | null, save: () => unknown) => {
      try {
        save();
      } catch (error) {
        if (changeId) db.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run("changes", changeId);
        throw error;
      }
    };
    if (row.collection === "chapters") {
      const current = this.projects.getChapter(db, row.entity_id);
      const changeId =
        current && isProtectedChapterEdit(current, payload as Chapter)
          ? authorizeRestore("章节", current.id, current.revision, current)
          : null;
      saveWithRestoreChange(changeId, () => this.saveChapter(id, payload as Chapter, "version", changeId ?? undefined));
    } else if (row.collection === "plans") {
      const current = this.getRecord<PlanNode>(db, "plans", row.entity_id);
      const changeId =
        current?.status === "已批准"
          ? authorizeRestore("规划", current.id, this.entityVersion(db, "plans", current.id), current)
          : null;
      saveWithRestoreChange(changeId, () => this.savePlan(id, payload as PlanNode, changeId ?? undefined));
    } else if (row.collection === "state" && row.entity_id === "contract") {
      const current = this.getState<StoryContract>(db, "contract");
      const changeId = current.approved ? authorizeRestore("创作契约", "contract", current.version, current) : null;
      saveWithRestoreChange(changeId, () => this.saveContract(id, payload as StoryContract, changeId ?? undefined));
    } else this.saveRecord(db, row.collection, row.entity_id, payload);
    this.touchProject(id);
  }

  saveIssues(id: string, chapterId: string, issues: QualityIssue[]) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const plan = prepareQualityIssueSave(this.listRecords<QualityIssue>(db, "issues"), chapterId, issues);
      for (const issue of plan.upserts) this.saveRecord(db, "issues", issue.id, issue);
      if (plan.forceSequentialReview) {
        // 逐章复核是工作流派生标记，不是用户内容修改：直接改列，
        // 不走受保护内容门禁（否则一次质检会消耗变更单，或整批质检结果回滚）。
        const chapter = this.projects.getChapter(db, chapterId);
        if (chapter && chapter.batchMode !== "逐章")
          db.prepare("UPDATE chapters SET batch_mode = ? WHERE id = ?").run("逐章", chapterId);
      }
      injectFault("power-loss-before-commit");
      db.exec("COMMIT");
      this.touchProject(id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  resolveIssue(id: string, issueId: string, status: QualityIssue["status"]) {
    const db = this.projectDb(id);
    const issue = this.getRecord<QualityIssue>(db, "issues", issueId);
    this.saveRecord(db, "issues", issueId, resolveQualityIssue(issue, status));
    this.touchProject(id);
  }

  saveChangeRequest(id: string, change: ChangeRequest) {
    const db = this.projectDb(id);
    const baseVersion = resolveChangeTargetVersion(change.targetKind, change.targetId, {
      contractVersion: this.getState<StoryContract>(db, "contract").version,
      planVersion: (targetId) =>
        this.getRecord<PlanNode>(db, "plans", targetId) ? this.entityVersion(db, "plans", targetId) : undefined,
      chapterVersion: (targetId) => this.projects.getChapter(db, targetId)?.revision,
    });
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
    this.saveRecord(db, "changes", changeId, decideChangeRequestDraft(change, decision));
  }

  saveSchedule(id: string, item: ScheduleItem) {
    const db = this.projectDb(id);
    const project = this.getProjectSummary(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      let chapter = this.projects.getChapter(db, item.chapterId);
      const plan = prepareScheduleSave(item, {
        scheduleId: item.id || randomUUID(),
        projectId: id,
        projectTitle: project.title,
        chapter,
        issues: this.listRecords<QualityIssue>(db, "issues"),
      });
      if (plan.transitionTo) {
        chapter = this.persistChapterInTransaction(
          db,
          id,
          { ...chapter!, status: plan.transitionTo },
          plan.transitionTo,
        );
      }
      this.saveRecord(db, "schedule", plan.schedule.id, plan.schedule);
      db.exec("COMMIT");
      this.touchProject(id);
      return plan.schedule;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
  }

  saveMetrics(id: string, metrics: MetricSnapshot[]) {
    const db = this.projectDb(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const metric of metrics) this.saveRecord(db, "metrics", metric.id, metric);
      injectFault("power-loss-before-commit");
      db.exec("COMMIT");
      this.touchProject(id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
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
    const rows = this.research.prepare("SELECT * FROM ranking_snapshots ORDER BY captured_at DESC").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      listName: String(row.list_name),
      capturedAt: String(row.captured_at),
      status: row.status as RankingSnapshot["status"],
      error: row.error ? String(row.error) : null,
      entries: (
        this.research
          .prepare("SELECT * FROM ranking_entries WHERE snapshot_id = ? ORDER BY rank")
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
    this.research.exec("BEGIN IMMEDIATE");
    try {
      this.research
        .prepare("INSERT INTO ranking_snapshots VALUES(?, ?, ?, ?, ?, ?)")
        .run(snapshot.id, snapshot.source, snapshot.listName, snapshot.capturedAt, snapshot.status, snapshot.error);
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
      injectFault("power-loss-before-commit");
      this.research.exec("COMMIT");
    } catch (error) {
      try {
        this.research.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
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

  saveResearchBook(book: ResearchBook, chapters: Array<{ title: string; content: string; wordCount: number }>) {
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

  findAiJob(taskType: string, inputHash: string, promptVersion: string, provider: string, model: string) {
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
    profileId?: string | null,
    role?: string | null,
  ) {
    return this.aiAudit.start(
      projectId,
      taskType,
      inputHash,
      promptVersion,
      provider,
      model,
      inputSummary,
      retryContext,
      profileId,
      role,
    );
  }

  updateAiJobTelemetry(
    id: string,
    telemetry: Pick<AiJobCompletion, "headersAt" | "firstTokenAt" | "chunkCount" | "attemptCount">,
  ) {
    this.aiAudit.updateTelemetry(id, telemetry);
  }

  finishAiJob(id: string, output: string, error?: string, usage?: AiJobCompletion) {
    this.aiAudit.finish(id, output, error, usage);
    this.aiAudit.prune();
  }

  markAiJobApplicationFailed(id: string, error: string) {
    this.aiAudit.markApplicationFailed(id, error);
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
    const storedProtocol = this.getSetting("ai.protocol", "");
    let inferredAnthropic = false;
    try {
      inferredAnthropic = new URL(baseUrl).hostname.toLowerCase().endsWith("anthropic.com");
    } catch {
      /* invalid legacy values remain editable in settings */
    }
    const protocol =
      storedProtocol === "anthropic-messages" || (!storedProtocol && inferredAnthropic)
        ? "anthropic-messages"
        : "openai-compatible";
    const model = this.getSetting("ai.model", "gpt-6");
    const embeddingModel = this.getSetting("ai.embeddingModel", "text-embedding-3-small");
    const inputPricePerMillion = Number(this.getSetting("ai.inputPricePerMillion", "0"));
    const outputPricePerMillion = Number(this.getSetting("ai.outputPricePerMillion", "0"));
    const longTaskTimeoutMinutes = Math.min(
      15,
      Math.max(5, Number(this.getSetting("ai.longTaskTimeoutMinutes", "10")) || 10),
    );
    // 未显式保存过时不返回默认值，让各任务使用自己的推理档位；作者一旦在设置页选定，就对所有任务生效。
    const storedReasoningEffort = this.getSetting("ai.reasoningEffort", "");
    const reasoningEffort = ["low", "medium", "high"].includes(storedReasoningEffort)
      ? (storedReasoningEffort as AiSettings["reasoningEffort"])
      : undefined;
    const storedTemperature = this.getSetting("ai.temperatureOverride", "").trim();
    const parsedTemperature = storedTemperature ? Number(storedTemperature) : Number.NaN;
    const temperatureOverride =
      Number.isFinite(parsedTemperature) && parsedTemperature >= 0 && parsedTemperature <= 1.5
        ? parsedTemperature
        : undefined;
    const storedSurface = this.getSetting("ai.apiSurface", "");
    const apiSurface = ["auto", "openai-chat", "openai-responses", "anthropic-messages"].includes(storedSurface)
      ? (storedSurface as AiSettings["apiSurface"])
      : undefined;
    return {
      protocol,
      apiSurface,
      baseUrl,
      model,
      embeddingModel,
      hasApiKey: false,
      inputPricePerMillion,
      outputPricePerMillion,
      longTaskTimeoutMinutes,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(temperatureOverride !== undefined ? { temperatureOverride } : {}),
    };
  }

  saveAiSettings(settings: Omit<AiSettings, "hasApiKey">) {
    this.setSetting("ai.protocol", settings.protocol);
    this.setSetting("ai.apiSurface", settings.apiSurface ?? "");
    this.setSetting("ai.baseUrl", settings.baseUrl);
    this.setSetting("ai.model", settings.model);
    this.setSetting("ai.embeddingModel", settings.embeddingModel);
    this.setSetting("ai.inputPricePerMillion", String(settings.inputPricePerMillion));
    this.setSetting("ai.outputPricePerMillion", String(settings.outputPricePerMillion));
    this.setSetting("ai.longTaskTimeoutMinutes", String(settings.longTaskTimeoutMinutes));
    this.setSetting("ai.reasoningEffort", settings.reasoningEffort ?? "");
    this.setSetting(
      "ai.temperatureOverride",
      settings.temperatureOverride === undefined ? "" : String(settings.temperatureOverride),
    );
    return this.getAiSettings();
  }

  /** 旧版单来源设置首次读取时迁移为一条“默认来源”，幂等。 */
  ensureDefaultAiProfile(): AiProfile | null {
    if (this.aiProfiles.countProfiles() > 0) return null;
    const legacyBaseUrl = this.getSetting("ai.baseUrl", "").trim();
    if (!legacyBaseUrl) return null;
    const anthropic = this.getSetting("ai.protocol", "") === "anthropic-messages";
    const profile: AiProfile = {
      id: randomUUID(),
      name: "默认来源",
      apiSurface: anthropic ? "anthropic-messages" : "auto",
      baseUrl: legacyBaseUrl,
      defaultModel: this.getSetting("ai.model", ""),
      authScheme: anthropic ? "x-api-key" : "bearer",
      extraHeaders: {},
      extraQuery: {},
      localEndpoint: false,
      enabled: true,
      sortOrder: 0,
      notes: "由旧版模型设置迁移",
      lastUsedAt: null,
      lastTestAt: null,
      lastTestOk: null,
      lastError: null,
    };
    this.aiProfiles.saveProfile(profile);
    this.aiProfiles.setDefaultProfileId(profile.id);
    return profile;
  }

  listAiProfiles(): AiProfile[] {
    this.ensureDefaultAiProfile();
    return this.aiProfiles.listProfiles();
  }

  getAiProfile(id: string): AiProfile | null {
    return this.aiProfiles.findProfile(id);
  }

  saveAiProfile(profile: AiProfile): AiProfile {
    return this.aiProfiles.saveProfile(profile);
  }

  deleteAiProfile(id: string): void {
    this.aiProfiles.deleteProfile(id);
    if (this.aiProfiles.getDefaultProfileId() === id) this.aiProfiles.setDefaultProfileId(null);
  }

  getDefaultAiProfileId(): string | null {
    this.ensureDefaultAiProfile();
    return this.aiProfiles.getDefaultProfileId();
  }

  setDefaultAiProfileId(id: string | null): void {
    this.aiProfiles.setDefaultProfileId(id);
  }

  listAiRoleRoutes(): AiRoleRoute[] {
    return this.aiProfiles.listRoleRoutes();
  }

  saveAiRoleRoute(route: AiRoleRoute): AiRoleRoute {
    return this.aiProfiles.saveRoleRoute(route);
  }

  listModelCapabilities(profileId: string): StoredModelCapability[] {
    return this.aiProfiles.listCapabilities(profileId);
  }

  saveModelCapability(record: StoredModelCapability): StoredModelCapability {
    return this.aiProfiles.saveCapability(record);
  }

  getProxySettings(): ProxySettings {
    return {
      enabled: this.getSetting("network.proxy.enabled", "false") === "true",
      url: this.getSetting("network.proxy.url", ""),
      username: this.getSetting("network.proxy.username", ""),
      hasPassword: false,
    };
  }

  saveProxySettings(input: ProxySettingsInput): ProxySettings {
    this.setSetting("network.proxy.enabled", String(input.enabled));
    this.setSetting("network.proxy.url", input.url.trim());
    this.setSetting("network.proxy.username", input.username.trim());
    return this.getProxySettings();
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
        checks.push({
          id,
          label,
          status: messages.length ? "错误" : "正常",
          detail: messages.length ? messages.slice(0, 3).join("；") : "SQLite 完整性检查通过",
          projectId,
          repairable: false,
        });
      } catch (error) {
        checks.push({
          id,
          label,
          status: "错误",
          detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
          projectId,
          repairable: false,
        });
      }
    };

    addIntegrityCheck("catalog-integrity", "目录数据库", this.catalog, null);
    addIntegrityCheck("research-integrity", "研究数据库", this.research, null);
    const projectRows = this.catalog.prepare("SELECT id, title FROM projects ORDER BY created_at").all() as Array<{
      id: string;
      title: string;
    }>;
    const catalogIds = new Set(projectRows.map((row) => row.id));
    let chapterCount = 0;
    let failedAiJobs = Number(
      (this.catalog.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number })
        .count,
    );

    for (const row of projectRows) {
      const databasePath = path.join(this.projectsRoot, row.id, "project.sqlite");
      if (!existsSync(databasePath)) {
        checks.push({
          id: `project-missing-${row.id}`,
          label: row.title,
          status: "错误",
          detail: "目录库存在作品，但项目数据库文件缺失",
          projectId: row.id,
          repairable: false,
        });
        continue;
      }
      const db = this.projectDb(row.id);
      addIntegrityCheck(`project-integrity-${row.id}`, `${row.title} · 项目数据库`, db, row.id);
      const records = Number((db.prepare("SELECT COUNT(*) AS count FROM chapters").get() as { count: number }).count);
      const fts = Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_fts").get() as { count: number }).count);
      const trigram = Number(
        (db.prepare("SELECT COUNT(*) AS count FROM chapter_fts_tri").get() as { count: number }).count,
      );
      chapterCount += records;
      failedAiJobs += Number(
        (db.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status = '失败'").get() as { count: number }).count,
      );
      const indexesMatch = records === fts && records === trigram;
      checks.push({
        id: `project-search-${row.id}`,
        label: `${row.title} · 搜索索引`,
        status: indexesMatch ? "正常" : "警告",
        detail: indexesMatch ? `${records} 章索引完整` : `章节 ${records}，全文索引 ${fts}，中文索引 ${trigram}`,
        projectId: row.id,
        repairable: !indexesMatch,
      });
    }

    for (const entry of readdirSync(this.projectsRoot, { withFileTypes: true }))
      if (entry.isDirectory() && !catalogIds.has(entry.name))
        checks.push({
          id: `orphan-${entry.name}`,
          label: "孤立项目目录",
          status: "警告",
          detail: `projects/${entry.name} 不在目录库中，未做自动处理`,
          projectId: null,
          repairable: false,
        });

    checks.push({
      id: "failed-ai-jobs",
      label: "失败的 AI 任务",
      status: failedAiJobs ? "警告" : "正常",
      detail: failedAiJobs ? `共 ${failedAiJobs} 个失败任务，可在重新执行对应操作后保留审计记录` : "没有失败的 AI 任务",
      projectId: null,
      repairable: false,
    });
    const status = checks.some((item) => item.status === "错误")
      ? "错误"
      : checks.some((item) => item.status === "警告")
        ? "警告"
        : "正常";
    return {
      checkedAt: now(),
      status,
      projectCount: projectRows.length,
      chapterCount,
      failedAiJobs,
      workspaceBytes: directoryBytes(this.root),
      backupBytes: directoryBytes(this.backupRoot),
      checks,
    };
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
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction already closed */
      }
      throw error;
    }
    return verify ? this.runSystemHealthCheck() : null;
  }

  checkpointAll() {
    const checkpoint = (db: DatabaseSync) => {
      try {
        const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy?: number } | undefined;
        if (result?.busy) db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
      } catch (error) {
        if (!/busy|locked/i.test(error instanceof Error ? error.message : String(error))) throw error;
        db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
      }
    };
    checkpoint(this.catalog);
    checkpoint(this.research);
    for (const db of this.projectDbs.values()) checkpoint(db);
  }

  close() {
    for (const db of this.projectDbs.values()) db.close();
    this.projectDbs.clear();
    this.research.close();
    this.catalog.close();
  }

  private getSetting(key: string, fallback: string) {
    const row = this.catalog.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? fallback;
  }

  private setSetting(key: string, value: string) {
    this.catalog.prepare("INSERT OR REPLACE INTO settings VALUES(?, ?)").run(key, value);
  }
  getDirectorNotes(projectId: string): string[] {
    return parseJson<string[]>(this.getSetting(`directorNotes.${projectId}`, "[]"));
  }

  saveDirectorNotes(projectId: string, notes: string[]): string[] {
    const cleaned = [...new Set(notes.map((note) => note.trim()).filter(Boolean))].slice(-50);
    this.setSetting(`directorNotes.${projectId}`, JSON.stringify(cleaned));
    return cleaned;
  }
  recordGenerationDecision(projectId: string, chapterId: string, action: GenerationDecision["action"]): void {
    const current = parseJson<GenerationDecision[]>(this.getSetting(`genDecisions.${projectId}`, "[]"));
    current.push({ chapterId, action, at: now() });
    this.setSetting(`genDecisions.${projectId}`, JSON.stringify(current.slice(-50)));
  }

  getGenerationQuality(projectId: string) {
    const decisions = parseJson<GenerationDecision[]>(this.getSetting(`genDecisions.${projectId}`, "[]"));
    return computeGenerationQuality(decisions);
  }

  getUpdateSettings() {
    return {
      autoCheck: this.getSetting("update.autoCheck", "1") !== "0",
      autoInstallOnQuit: this.getSetting("update.autoInstallOnQuit", "0") === "1",
    };
  }

  saveUpdateSettings(input: { autoCheck: boolean; autoInstallOnQuit: boolean }) {
    this.setSetting("update.autoCheck", input.autoCheck ? "1" : "0");
    this.setSetting("update.autoInstallOnQuit", input.autoInstallOnQuit ? "1" : "0");
    return this.getUpdateSettings();
  }

  private consumeApprovedChange(
    db: DatabaseSync,
    targetKind: ChangeRequest["targetKind"],
    targetId: string,
    baseVersion: number,
    changeRequestId?: string,
  ) {
    const matches = (item: ChangeRequest) =>
      item.status === "已批准" &&
      item.targetKind === targetKind &&
      item.targetId === targetId &&
      item.baseVersion === baseVersion;
    const change = changeRequestId
      ? this.listRecords<ChangeRequest>(db, "changes").find((item) => item.id === changeRequestId && matches(item))
      : this.listRecords<ChangeRequest>(db, "changes")
          .filter(matches)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!change) return false;
    this.saveRecord(db, "changes", change.id, { ...change, status: "已应用" });
    return true;
  }

  private entityVersion(db: DatabaseSync, collection: RevisionRecord["collection"], entityId: string) {
    const row = db
      .prepare("SELECT MAX(revision) AS revision FROM revisions WHERE collection = ? AND entity_id = ?")
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

  private getRecord<T>(db: DatabaseSync, collection: string, id: string): T | undefined {
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

  private addRevision<T>(db: DatabaseSync, collection: string, id: string, revision: number, payload: T) {
    this.projects.addRevision(db, collection, id, revision, payload);
  }

  private nextRevision(db: DatabaseSync, collection: string, id: string) {
    return this.projects.nextRevision(db, collection, id);
  }

  private saveEmbedding(db: DatabaseSync, sourceType: string, sourceId: string, text: string) {
    this.saveEmbeddings(db, sourceType, [{ sourceId, text }]);
  }

  private saveEmbeddings(db: DatabaseSync, sourceType: string, entries: Array<{ sourceId: string; text: string }>) {
    if (!entries.length) return;
    const vectors = this.embedTexts(entries.map((entry) => entry.text));
    const insert = db.prepare(
      "INSERT OR REPLACE INTO embeddings(id, source_type, source_id, content_hash, vector, provider_id, dimensions, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    );
    entries.forEach((entry, index) => {
      insert.run(
        `${sourceType}:${entry.sourceId}`,
        sourceType,
        entry.sourceId,
        hashText(entry.text),
        JSON.stringify(vectors[index]),
        this.embeddingProvider.id,
        this.embeddingProvider.dimensions,
        now(),
      );
    });
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
    const project = this.getProjectOverview(projectId);
    const updates = prepareFinalizedChapterSummaries(
      { ...project, wordsPerChapter: project.summary.wordsPerChapter },
      chapter,
      now(),
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const summary of updates) {
        const previous = this.getRecord<StorySummary>(db, "summaries", summary.id);
        this.saveRecord(db, "summaries", summary.id, summary, previous?.version);
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
}

export { now };

function factEmbeddingText(fact: LedgerFact) {
  return `${fact.kind} ${fact.genreDimension ?? ""} ${fact.subject} ${fact.predicate} ${fact.value} ${fact.knowledgeScope}`;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
