import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AiSettings,
  ChangeRequest,
  Chapter,
  ChapterStatus,
  CreateProjectInput,
  ExpectationEntry,
  InsightPack,
  LedgerFact,
  MetricSnapshot,
  PlanNode,
  ProjectDetail,
  ProjectPatch,
  ProjectSummary,
  QualityIssue,
  RankingSnapshot,
  ResearchBook,
  ResearchAnalysisRecord,
  ScheduleItem,
  SearchHit,
  RevisionRecord,
  StoryContract,
  StorySummary,
} from "../src/shared/types";
import { cosineSimilarity, localEmbedding } from "./semantic";
import {
  aggregateStorySummaries,
  buildChapterSummary,
} from "../src/shared/summaries";
import { volumeBoundaryChapters } from "../src/shared/planning";

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
  private readonly catalog: DatabaseSync;
  private readonly research: DatabaseSync;
  private readonly projectDbs = new Map<string, DatabaseSync>();

  constructor(root: string) {
    this.root = root;
    this.projectsRoot = path.join(root, "projects");
    this.researchRoot = path.join(root, "research");
    this.backupRoot = path.join(root, "backups");
    for (const directory of [
      root,
      this.projectsRoot,
      this.researchRoot,
      this.backupRoot,
    ])
      mkdirSync(directory, { recursive: true });
    this.catalog = openDatabase(path.join(root, "catalog.sqlite"));
    this.research = openDatabase(
      path.join(this.researchRoot, "research.sqlite"),
    );
    this.initCatalog();
    this.initResearch();
  }

  private initCatalog() {
    this.catalog.exec(`
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
    `);
    const projectColumns = this.catalog
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{ name: string }>;
    if (!projectColumns.some((column) => column.name === "safe_stock_line")) {
      this.catalog.exec(
        "ALTER TABLE projects ADD COLUMN safe_stock_line INTEGER NOT NULL DEFAULT 10",
      );
    }
  }

  private initResearch() {
    this.research.exec(`
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
    `);
    const rankingColumns = this.research
      .prepare("PRAGMA table_info(ranking_entries)")
      .all() as Array<{ name: string }>;
    for (const column of ["synopsis", "official_reader_url", "platform"])
      if (!rankingColumns.some((existing) => existing.name === column))
        this.research.exec(`ALTER TABLE ranking_entries ADD COLUMN ${column} TEXT`);
  }

  private initProject(db: DatabaseSync) {
    db.exec(`
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
    `);
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
      protagonistDesire: "",
      readerPromise: "",
      coreEmotion: "",
      ending: "",
      immutableRules: [],
      prohibitedPatterns: [],
      version: 1,
      approved: false,
      updatedAt: timestamp,
    };
    this.setState(db, "contract", contract);
    this.setState(db, "insightIds", []);
    return this.getProjectSummary(id);
  }

  listProjects(): ProjectSummary[] {
    const rows = this.catalog
      .prepare(
        "SELECT * FROM projects WHERE status != '归档' ORDER BY updated_at DESC",
      )
      .all() as unknown as CatalogRow[];
    return rows.map((row) => this.hydrateSummary(row));
  }

  getProjectSummary(id: string): ProjectSummary {
    const row = this.catalog
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as unknown as CatalogRow | undefined;
    if (!row) throw new Error("项目不存在");
    return this.hydrateSummary(row);
  }

  private hydrateSummary(row: CatalogRow): ProjectSummary {
    const db = this.projectDb(row.id);
    const chapters = this.listRecords<Chapter>(db, "chapters");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    const schedule = this.listRecords<ScheduleItem>(db, "schedule");
    const currentWords = chapters.reduce(
      (sum, chapter) => sum + chapter.wordCount,
      0,
    );
    const stockChapters = chapters.filter(
      (chapter) => chapter.status === "已定稿" || chapter.status === "待发布",
    ).length;
    const pendingHardIssues = issues.filter(
      (issue) => issue.status === "待处理" && issue.severity === "硬性",
    ).length;
    const next = schedule
      .filter((item) => item.status !== "已发布")
      .sort((a, b) => a.publishAt.localeCompare(b.publishAt))[0];
    return {
      id: row.id,
      title: row.title,
      genre: row.genre,
      status: row.status,
      targetWords: row.target_words,
      currentWords,
      chapterCount: chapters.length,
      stockChapters,
      safeStockLine: row.safe_stock_line,
      updateCadence: row.update_cadence,
      nextPublishAt: next?.publishAt ?? null,
      riskLevel:
        pendingHardIssues > 0
          ? "告警"
          : stockChapters < row.safe_stock_line && row.status === "连载中"
            ? "注意"
            : "正常",
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
      chapters: this.listRecords<Chapter>(db, "chapters").sort(
        (a, b) => a.number - b.number,
      ),
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
      insightIds: this.getState<string[]>(db, "insightIds", []),
      summaries: this.listRecords<StorySummary>(db, "summaries").sort(
        (a, b) => a.fromChapter - b.fromChapter,
      ),
      expectations: this.listRecords<ExpectationEntry>(db, "expectations").sort(
        (a, b) => a.sourceChapter - b.sourceChapter,
      ),
    };
  }

  saveContract(id: string, contract: StoryContract) {
    const db = this.projectDb(id);
    const previous = this.getState<StoryContract>(db, "contract");
    const changed =
      JSON.stringify({
        premise: contract.premise,
        genreSubtype: contract.genreSubtype,
        fanqieCategoryKey: contract.fanqieCategoryKey,
        protagonistDesire: contract.protagonistDesire,
        readerPromise: contract.readerPromise,
        coreEmotion: contract.coreEmotion,
        ending: contract.ending,
        immutableRules: contract.immutableRules,
        prohibitedPatterns: contract.prohibitedPatterns,
      }) !==
      JSON.stringify({
        premise: previous.premise,
        genreSubtype: previous.genreSubtype,
        fanqieCategoryKey: previous.fanqieCategoryKey,
        protagonistDesire: previous.protagonistDesire,
        readerPromise: previous.readerPromise,
        coreEmotion: previous.coreEmotion,
        ending: previous.ending,
        immutableRules: previous.immutableRules,
        prohibitedPatterns: previous.prohibitedPatterns,
      });
    if (!changed) return previous;
    if (
      previous.approved &&
      !this.consumeApprovedChange(db, "创作契约", "contract", previous.version)
    ) {
      throw new Error("已审批创作契约只能通过已批准的改纲变更单修改");
    }
    const next = {
      ...contract,
      approved: false,
      version: previous.version + 1,
      updatedAt: now(),
    };
    this.addRevision(db, "state", "contract", previous.version, previous);
    this.setState(db, "contract", next);
    this.touchProject(id);
    return next;
  }

  approveContract(id: string) {
    const db = this.projectDb(id);
    const contract = this.getState<StoryContract>(db, "contract");
    if (!contract.premise || !contract.readerPromise || !contract.ending)
      throw new Error("创作契约的故事前提、读者承诺和终局不能为空");
    const next = { ...contract, approved: true, updatedAt: now() };
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
    const next = {
      ...plan,
      id: plan.id || randomUUID(),
      status:
        previous?.status ?? (plan.status === "待审批" ? "待审批" : "草稿"),
    };
    const changed =
      previous &&
      JSON.stringify({ ...next, status: undefined }) !==
        JSON.stringify({ ...previous, status: undefined });
    if (
      previous?.status === "已批准" &&
      changed &&
      !this.consumeApprovedChange(
        db,
        "规划",
        previous.id,
        this.entityVersion(db, "plans", previous.id),
      )
    ) {
      throw new Error("已批准规划只能通过已批准的改纲变更单修改");
    }
    if (previous?.status === "已批准" && !changed) return previous;
    if (previous?.status === "已批准" && changed) next.status = "待审批";
    this.saveRecord(db, "plans", next.id, next);
    this.touchProject(id);
    return next;
  }

  approvePlan(id: string, planId: string) {
    const db = this.projectDb(id);
    const plan = this.getRecord<PlanNode>(db, "plans", planId);
    if (!plan) throw new Error("规划节点不存在");
    const contract = this.getState<StoryContract>(db, "contract");
    if (!contract.approved) throw new Error("必须先审批创作契约");
    this.saveRecord(db, "plans", planId, { ...plan, status: "已批准" });
    this.touchProject(id);
  }

  saveChapter(id: string, chapter: Chapter) {
    return this.persistChapter(id, chapter);
  }

  saveGeneratedChapter(id: string, chapter: Chapter) {
    if (!chapter.id || !chapter.content.trim())
      throw new Error("AI 草稿缺少章节或正文");
    return this.persistChapter(id, chapter, "待质检");
  }

  private persistChapter(
    id: string,
    chapter: Chapter,
    forcedStatus?: ChapterStatus,
  ) {
    const db = this.projectDb(id);
    const previous = chapter.id
      ? this.getRecord<Chapter>(db, "chapters", chapter.id)
      : undefined;
    const protectedContentChanged =
      previous &&
      JSON.stringify({
        number: chapter.number,
        title: chapter.title,
        outline: chapter.outline,
        content: chapter.content,
        batchMode: chapter.batchMode,
        isKeyChapter: chapter.isKeyChapter,
        chapterPromise: chapter.chapterPromise,
        expectedPayoff: chapter.expectedPayoff,
        crisis: chapter.crisis,
        endingExpectation: chapter.endingExpectation,
        expectationTargetChapter: chapter.expectationTargetChapter,
        linkedExpectationIds: chapter.linkedExpectationIds,
      }) !==
        JSON.stringify({
          number: previous.number,
          title: previous.title,
          outline: previous.outline,
          content: previous.content,
          batchMode: previous.batchMode,
          isKeyChapter: previous.isKeyChapter,
          chapterPromise: previous.chapterPromise,
          expectedPayoff: previous.expectedPayoff,
          crisis: previous.crisis,
          endingExpectation: previous.endingExpectation,
          expectationTargetChapter: previous.expectationTargetChapter,
          linkedExpectationIds: previous.linkedExpectationIds,
        });
    const protectedEdit = Boolean(
      previous &&
      ["已定稿", "待发布", "已发布"].includes(previous.status) &&
      protectedContentChanged,
    );
    if (
      protectedEdit &&
      !this.consumeApprovedChange(db, "章节", previous!.id, previous!.revision)
    ) {
      throw new Error(
        "已定稿或进入发布流程的章节只能通过匹配的已批准变更单修改",
      );
    }
    const hasFactConflict = this.listRecords<LedgerFact>(db, "facts").some(
      (fact) => fact.confidence === "有冲突",
    );
    const hasHardIssue = this.listRecords<QualityIssue>(db, "issues").some(
      (issue) =>
        issue.chapterId === chapter.id &&
        issue.severity === "硬性" &&
        issue.status === "待处理",
    );
    const isVolumeBoundary = volumeBoundaryChapters(
      this.listRecords<PlanNode>(db, "plans"),
    ).has(chapter.number);
    const contentChanged = Boolean(
      previous && previous.content !== chapter.content,
    );
    let status: ChapterStatus =
      previous?.status ?? (chapter.content.trim() ? "草稿" : "章纲");
    if (forcedStatus) status = forcedStatus;
    else if (protectedEdit) status = chapter.content.trim() ? "待质检" : "章纲";
    else if (previous?.status === "章纲" && chapter.content.trim())
      status = "草稿";
    else if (
      contentChanged &&
      (previous?.status === "待质检" || previous?.status === "待定稿")
    )
      status = "草稿";
    let endingExpectationId = chapter.endingExpectationId ?? null;
    if (chapter.endingExpectation?.trim()) {
      const existingExpectation = endingExpectationId
        ? this.getRecord<ExpectationEntry>(
            db,
            "expectations",
            endingExpectationId,
          )
        : undefined;
      const savedExpectation = this.saveExpectation(id, {
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
      });
      endingExpectationId = savedExpectation.id;
    }
    const next: Chapter = {
      ...chapter,
      endingExpectationId,
      linkedExpectationIds: chapter.linkedExpectationIds ?? [],
      id: chapter.id || randomUUID(),
      status,
      wordCount: [...chapter.content].filter((char) => !/\s/.test(char)).length,
      revision: previous ? previous.revision + 1 : 1,
      batchMode:
        chapter.isKeyChapter ||
        hasFactConflict ||
        hasHardIssue ||
        isVolumeBoundary ||
        majorStateChange.test(chapter.outline)
          ? "逐章"
          : chapter.batchMode,
      updatedAt: now(),
    };
    this.saveRecord(db, "chapters", next.id, next, previous?.revision);
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
    this.touchProject(id);
    return next;
  }

  saveExpectation(id: string, expectation: ExpectationEntry) {
    const db = this.projectDb(id);
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
    this.saveRecord(db, "expectations", next.id, next);
    this.touchProject(id);
    return next;
  }

  transitionChapter(id: string, chapterId: string, status: ChapterStatus) {
    const db = this.projectDb(id);
    const chapter = this.getRecord<Chapter>(db, "chapters", chapterId);
    if (!chapter) throw new Error("章节不存在");
    const issues = this.listRecords<QualityIssue>(db, "issues");
    const transitions: Partial<Record<ChapterStatus, ChapterStatus[]>> = {
      草稿: ["待质检"],
      待质检: ["待定稿"],
      待定稿: ["已定稿"],
      已定稿: ["待发布"],
      待发布: ["已发布"],
    };
    if (!transitions[chapter.status]?.includes(status))
      throw new Error(`不允许从“${chapter.status}”直接变为“${status}”`);
    if (
      (status === "待定稿" || status === "已定稿" || status === "待发布") &&
      issues.some(
        (issue) =>
          issue.chapterId === chapterId &&
          issue.severity === "硬性" &&
          issue.status !== "已解决",
      )
    ) {
      throw new Error("该章仍有未解决的硬性问题");
    }
    const saved = this.persistChapter(id, { ...chapter, status }, status);
    if (status === "已定稿" && chapter.status !== "已定稿")
      this.updateSummaries(id, saved);
    return saved;
  }

  saveFact(id: string, fact: LedgerFact) {
    const db = this.projectDb(id);
    const next = { ...fact, id: fact.id || randomUUID(), updatedAt: now() };
    const conflicts = this.listRecords<LedgerFact>(db, "facts").filter(
      (item) =>
        item.id !== next.id &&
        item.subject === next.subject &&
        item.predicate === next.predicate &&
        item.validToChapter === null &&
        next.validToChapter === null &&
        item.value !== next.value,
    );
    if (conflicts.length) next.confidence = "有冲突";
    this.saveRecord(db, "facts", next.id, next);
    this.saveEmbedding(
      db,
      "facts",
      next.id,
      `${next.kind} ${next.genreDimension ?? ""} ${next.subject} ${next.predicate} ${next.value} ${next.knowledgeScope}`,
    );
    this.touchProject(id);
    return next;
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
    const query = localEmbedding(queryText);
    const rows = db
      .prepare(
        "SELECT source_id, vector FROM embeddings WHERE source_type = 'facts'",
      )
      .all() as Array<{ source_id: string; vector: string }>;
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
          fact.validFromChapter <= chapterNumber &&
          (fact.validToChapter === null ||
            fact.validToChapter >= chapterNumber),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.fact);
  }

  searchProject(id: string, query: string): SearchHit[] {
    const normalized = query
      .trim()
      .replace(/["'*:^(){}\[\]]/g, " ")
      .trim();
    if (normalized.length < 2) return [];
    const db = this.projectDb(id);
    const chapters = new Map(
      this.listRecords<Chapter>(db, "chapters").map((chapter) => [
        chapter.id,
        chapter,
      ]),
    );
    const hits = db
      .prepare(
        "SELECT id, snippet(chapter_fts_tri, 2, '【', '】', '…', 24) AS excerpt FROM chapter_fts_tri WHERE chapter_fts_tri MATCH ? LIMIT 30",
      )
      .all(`"${normalized}"`) as Array<{ id: string; excerpt: string }>;
    return hits.flatMap((hit) => {
      const chapter = chapters.get(hit.id);
      return chapter
        ? [
            {
              id: chapter.id,
              type: "章节" as const,
              title: `第${chapter.number}章 ${chapter.title}`,
              excerpt: hit.excerpt,
              chapterNumber: chapter.number,
            },
          ]
        : [];
    });
  }

  listRevisions(
    id: string,
    collection: RevisionRecord["collection"],
    entityId: string,
  ): RevisionRecord[] {
    const db = this.projectDb(id);
    const rows = db
      .prepare(
        "SELECT id, collection, entity_id, revision, payload, created_at FROM revisions WHERE collection = ? AND entity_id = ? ORDER BY revision DESC",
      )
      .all(collection, entityId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      collection: row.collection as RevisionRecord["collection"],
      entityId: String(row.entity_id),
      revision: Number(row.revision),
      payload: parseJson<unknown>(row.payload),
      createdAt: String(row.created_at),
    }));
  }

  restoreRevision(id: string, revisionId: string) {
    const db = this.projectDb(id);
    const row = db
      .prepare(
        "SELECT collection, entity_id, payload FROM revisions WHERE id = ?",
      )
      .get(revisionId) as
      | {
          collection: RevisionRecord["collection"];
          entity_id: string;
          payload: string;
        }
      | undefined;
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
      const chapter = this.getRecord<Chapter>(db, "chapters", chapterId);
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
    const baseVersion = this.targetVersion(
      db,
      change.targetKind,
      change.targetId,
    );
    const next = {
      ...change,
      id: randomUUID(),
      baseVersion,
      createdAt: now(),
      status: "待审批" as const,
    };
    this.saveRecord(db, "changes", next.id, next);
    return next;
  }

  decideChangeRequest(id: string, changeId: string, decision: "批准" | "拒绝") {
    const db = this.projectDb(id);
    const change = this.getRecord<ChangeRequest>(db, "changes", changeId);
    if (!change) throw new Error("变更单不存在");
    this.saveRecord(db, "changes", changeId, {
      ...change,
      status: decision === "批准" ? "已批准" : "已拒绝",
    });
  }

  saveSchedule(id: string, item: ScheduleItem) {
    const db = this.projectDb(id);
    const project = this.getProjectSummary(id);
    const next = {
      ...item,
      id: item.id || randomUUID(),
      projectId: id,
      projectTitle: project.title,
    };
    this.saveRecord(db, "schedule", next.id, next);
    this.touchProject(id);
    return next;
  }

  saveMetrics(id: string, metrics: MetricSnapshot[]) {
    const db = this.projectDb(id);
    for (const metric of metrics)
      this.saveRecord(db, "metrics", metric.id, metric);
    this.touchProject(id);
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

  listResearchBooks(): ResearchBook[] {
    return (
      this.research
        .prepare("SELECT payload FROM research_books ORDER BY updated_at DESC")
        .all() as Array<{ payload: string }>
    ).map((row) => parseJson<ResearchBook>(row.payload));
  }

  saveResearchBook(
    book: ResearchBook,
    chapters: Array<{ title: string; content: string; wordCount: number }>,
  ) {
    this.research
      .prepare("INSERT OR REPLACE INTO research_books VALUES(?, ?, ?)")
      .run(book.id, JSON.stringify(book), now());
    const insert = this.research.prepare(
      "INSERT INTO research_chapters VALUES(?, ?, ?, ?, ?, ?)",
    );
    const insertFingerprint = this.research.prepare(
      "INSERT OR IGNORE INTO research_fingerprints VALUES(?, ?, ?)",
    );
    chapters.forEach((chapter, index) => {
      insert.run(
        randomUUID(),
        book.id,
        index + 1,
        chapter.title,
        chapter.content,
        chapter.wordCount,
      );
      for (const window of textWindows(chapter.content, 8))
        insertFingerprint.run(hashText(window), book.id, window);
    });
  }

  getResearchBook(bookId: string) {
    const row = this.research
      .prepare("SELECT payload FROM research_books WHERE id = ?")
      .get(bookId) as { payload: string } | undefined;
    if (!row) throw new Error("样本书不存在");
    const chapters = this.research
      .prepare(
        "SELECT ordinal, title, content, word_count FROM research_chapters WHERE book_id = ? ORDER BY ordinal",
      )
      .all(bookId) as Array<Record<string, unknown>>;
    return {
      book: parseJson<ResearchBook>(row.payload),
      chapters: chapters.map((item) => ({
        ordinal: Number(item.ordinal),
        title: String(item.title),
        content: String(item.content),
        wordCount: Number(item.word_count),
      })),
    };
  }

  saveResearchAnalyses(records: ResearchAnalysisRecord[]) {
    if (records[0])
      this.research
        .prepare("DELETE FROM research_analyses WHERE book_id = ?")
        .run(records[0].bookId);
    const insert = this.research.prepare(
      "INSERT OR REPLACE INTO research_analyses VALUES(?, ?, ?, ?, ?, ?, ?)",
    );
    for (const record of records)
      insert.run(
        record.id,
        record.bookId,
        record.layer,
        record.fromChapter,
        record.toChapter,
        JSON.stringify(record),
        record.createdAt,
      );
  }

  listResearchAnalyses(bookId: string): ResearchAnalysisRecord[] {
    return (
      this.research
        .prepare(
          "SELECT payload FROM research_analyses WHERE book_id = ? ORDER BY from_chapter, layer",
        )
        .all(bookId) as Array<{ payload: string }>
    ).map((row) => parseJson<ResearchAnalysisRecord>(row.payload));
  }

  updateResearchBook(book: ResearchBook) {
    this.research
      .prepare(
        "UPDATE research_books SET payload = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(book), now(), book.id);
  }

  listInsights(): InsightPack[] {
    return (
      this.research
        .prepare("SELECT payload FROM insights ORDER BY created_at DESC")
        .all() as Array<{ payload: string }>
    ).map((row) => parseJson<InsightPack>(row.payload));
  }

  saveInsight(insight: InsightPack) {
    this.research
      .prepare("INSERT OR REPLACE INTO insights VALUES(?, ?, ?)")
      .run(insight.id, JSON.stringify(insight), insight.createdAt);
  }

  getInsights(ids: string[]) {
    if (!ids.length) return [];
    return this.listInsights().filter((item) => ids.includes(item.id));
  }

  findOriginalityMatches(content: string) {
    const matches = new Map<
      string,
      { researchRef: string; fingerprint: string }
    >();
    const query = this.research.prepare(
      "SELECT book_id FROM research_fingerprints WHERE hash = ? LIMIT 5",
    );
    for (const window of textWindows(content, 1)) {
      const fingerprint = hashText(window);
      for (const row of query.all(fingerprint) as Array<{ book_id: string }>) {
        const key = `${row.book_id}:${fingerprint}`;
        matches.set(key, {
          researchRef: hashText(row.book_id).slice(0, 12),
          fingerprint: fingerprint.slice(0, 16),
        });
        if (matches.size >= 10) return [...matches.values()];
      }
    }
    return [...matches.values()];
  }

  findAiJob(
    taskType: string,
    inputHash: string,
    promptVersion: string,
    model: string,
  ) {
    const row = this.catalog
      .prepare(
        `
      SELECT output FROM ai_jobs WHERE task_type = ? AND input_hash = ? AND prompt_version = ? AND model = ? AND status = '成功'
    `,
      )
      .get(taskType, inputHash, promptVersion, model) as
      { output: string | null } | undefined;
    return row?.output ?? null;
  }

  startAiJob(
    projectId: string | null,
    taskType: string,
    inputHash: string,
    promptVersion: string,
    provider: string,
    model: string,
    inputSummary: string,
  ) {
    const id = randomUUID();
    const timestamp = now();
    this.catalog
      .prepare(
        `
      INSERT OR REPLACE INTO ai_jobs(id, project_id, task_type, input_hash, prompt_version, provider, model, status, input_summary, output, estimated_cost, error, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, '运行中', ?, NULL, 0, NULL, ?, ?)
    `,
      )
      .run(
        id,
        projectId,
        taskType,
        inputHash,
        promptVersion,
        provider,
        model,
        inputSummary,
        timestamp,
        timestamp,
      );
    return id;
  }

  finishAiJob(id: string, output: string, error?: string) {
    this.catalog
      .prepare(
        "UPDATE ai_jobs SET status = ?, output = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        error ? "失败" : "成功",
        error ? null : output,
        error ?? null,
        now(),
        id,
      );
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
    return {
      baseUrl,
      model,
      embeddingModel,
      hasApiKey: false,
      inputPricePerMillion,
      outputPricePerMillion,
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
    return this.getAiSettings();
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

  private targetVersion(
    db: DatabaseSync,
    targetKind: ChangeRequest["targetKind"],
    targetId: string,
  ) {
    if (targetKind === "创作契约") {
      if (targetId !== "contract") throw new Error("创作契约目标无效");
      return this.getState<StoryContract>(db, "contract").version;
    }
    if (targetKind === "规划") {
      if (!this.getRecord<PlanNode>(db, "plans", targetId))
        throw new Error("变更目标规划不存在");
      return this.entityVersion(db, "plans", targetId);
    }
    const chapter = this.getRecord<Chapter>(db, "chapters", targetId);
    if (!chapter) throw new Error("变更目标章节不存在");
    return chapter.revision;
  }

  projectPath(id: string) {
    return path.join(this.projectsRoot, id);
  }

  private touchProject(id: string) {
    this.catalog
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(now(), id);
  }

  private setState<T>(db: DatabaseSync, key: string, value: T) {
    db.prepare(
      "INSERT OR REPLACE INTO state(key, value, updated_at) VALUES(?, ?, ?)",
    ).run(key, JSON.stringify(value), now());
  }

  private getState<T>(db: DatabaseSync, key: string, fallback?: T): T {
    const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key) as
      { value: string } | undefined;
    if (!row) {
      if (fallback !== undefined) return fallback;
      throw new Error(`项目状态缺失: ${key}`);
    }
    return parseJson<T>(row.value);
  }

  private listRecords<T>(db: DatabaseSync, collection: string): T[] {
    return (
      db
        .prepare("SELECT payload FROM records WHERE collection = ?")
        .all(collection) as Array<{ payload: string }>
    ).map((row) => parseJson<T>(row.payload));
  }

  private getRecord<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
  ): T | undefined {
    const row = db
      .prepare("SELECT payload FROM records WHERE collection = ? AND id = ?")
      .get(collection, id) as { payload: string } | undefined;
    return row ? parseJson<T>(row.payload) : undefined;
  }

  private saveRecord<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
    payload: T,
    priorRevision?: number,
  ) {
    const previous = this.getRecord<T>(db, collection, id);
    if (previous)
      this.addRevision(
        db,
        collection,
        id,
        priorRevision ?? this.nextRevision(db, collection, id),
        previous,
      );
    db.prepare(
      "INSERT OR REPLACE INTO records(collection, id, payload, updated_at) VALUES(?, ?, ?, ?)",
    ).run(collection, id, JSON.stringify(payload), now());
  }

  private addRevision<T>(
    db: DatabaseSync,
    collection: string,
    id: string,
    revision: number,
    payload: T,
  ) {
    db.prepare("INSERT INTO revisions VALUES(?, ?, ?, ?, ?, ?)").run(
      randomUUID(),
      collection,
      id,
      revision,
      JSON.stringify(payload),
      now(),
    );
  }

  private nextRevision(db: DatabaseSync, collection: string, id: string) {
    const row = db
      .prepare(
        "SELECT MAX(revision) AS revision FROM revisions WHERE collection = ? AND entity_id = ?",
      )
      .get(collection, id) as { revision: number | null };
    return (row.revision ?? 0) + 1;
  }

  private saveEmbedding(
    db: DatabaseSync,
    sourceType: string,
    sourceId: string,
    text: string,
  ) {
    db.prepare(
      "INSERT OR REPLACE INTO embeddings(id, source_type, source_id, content_hash, vector, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
    ).run(
      `${sourceType}:${sourceId}`,
      sourceType,
      sourceId,
      hashText(text),
      JSON.stringify(localEmbedding(text)),
      now(),
    );
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

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const majorStateChange =
  /死亡|牺牲|突破|晋级|身份揭露|身份暴露|决裂|成婚|离婚|重生|穿越|失忆|叛变|真相揭晓|终局/;
