import type { GenreComposition, NarrativeGenre } from "./genre-composition";

export const GENRES = [
  "都市脑洞",
  "玄幻/仙侠",
  "历史/架空",
  "现言甜宠",
  "古言宅斗",
  "年代重生",
] as const;

export type Genre = (typeof GENRES)[number];
export type ProjectStatus =
  | "研究中"
  | "候选立项"
  | "设定中"
  | "大纲审批"
  | "连载准备"
  | "连载中"
  | "暂停"
  | "完结"
  | "归档";

export type ChapterStatus =
  "章纲" | "草稿" | "待质检" | "待定稿" | "已定稿" | "待发布" | "已发布";

export const CHAPTER_FUNCTIONS = ["行动", "调查", "关系", "经营", "训练", "生存", "群像", "氛围", "过渡", "揭秘", "高潮"] as const;
export type ChapterFunction = (typeof CHAPTER_FUNCTIONS)[number];

export interface ProjectSummary {
  id: string;
  title: string;
  genre: Genre;
  status: ProjectStatus;
  targetWords: number;
  currentWords: number;
  chapterCount: number;
  stockChapters: number;
  safeStockLine: number;
  updateCadence: string;
  nextPublishAt: string | null;
  riskLevel: "正常" | "注意" | "告警";
  updatedAt: string;
}

export interface DashboardData {
  projects: ProjectSummary[];
  dueToday: ScheduleItem[];
  activeAlerts: QualityIssue[];
  totals: {
    activeBooks: number;
    totalWords: number;
    stockChapters: number;
    pendingIssues: number;
  };
}

export interface RankingEntry {
  id: string;
  snapshotId: string;
  rank: number;
  title: string;
  author: string;
  genre: string;
  words: number;
  status: string;
  tags: string[];
  sourceUrl: string;
  synopsis?: string;
  officialReaderUrl?: string;
  platform?: string;
}

export interface RankingSnapshot {
  id: string;
  source: string;
  listName: string;
  capturedAt: string;
  status: "成功" | "部分成功" | "失败";
  error: string | null;
  entries: RankingEntry[];
}

export interface RankingCaptureSchedule {
  id: string;
  url: string;
  listName: string;
  frequency: "每日" | "每周";
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  lastStatus: RankingSnapshot["status"] | "未运行";
  lastError: string | null;
}

export interface RankingAnalytics {
  snapshotCount: number;
  sampleSize: number;
  timeRange: string;
  confidence: "低" | "中" | "高";
  genreDistribution: Array<{ name: string; count: number }>;
  wordBands: Array<{ name: string; count: number }>;
  statusDistribution: Array<{ name: string; count: number }>;
  newEntrants: string[];
  movers: Array<{ title: string; from: number; to: number; change: number }>;
  continuousAppearances: Array<{ title: string; snapshots: number }>;
  marketOpportunities: MarketOpportunity[];
}

export interface MarketOpportunity {
  listName: string;
  categoryKey?: string;
  categoryName: string;
  genre: Genre | "待校对";
  snapshots: number;
  latestSampleSize: number;
  newEntrantRate: number;
  averageRankChange: number;
  stabilityRate: number;
  competition: "未知" | "低" | "中" | "高";
  momentumScore: number | null;
  dataSufficiency: number;
  evidenceLevel: "基线" | "暂定" | "可参考";
  opportunityScore: number | null;
  scoreRange: [number, number] | null;
  sampleWarning: string | null;
  formulaVersion: string;
  confidence: "低" | "中" | "高";
  recommendation: string;
}

export interface ResearchBook {
  id: string;
  title: string;
  author: string;
  genre: Genre;
  sourceType: "TXT" | "EPUB" | "DOCX" | "粘贴" | "公开试读";
  sourceUrl?: string;
  sampleScope?: string;
  chapterCount: number;
  wordCount: number;
  rightsConfirmed: boolean;
  cloudConsent: boolean;
  importedAt: string;
  status: "待拆解" | "拆解中" | "已拆解" | "失败";
}

export interface ResearchAnalysisRecord {
  id: string;
  bookId: string;
  layer: "章节" | "十章阶段" | "分卷" | "全书";
  fromChapter: number;
  toChapter: number;
  findings: string;
  evidenceChapters: number[];
  confidence: "低" | "中" | "高";
  createdAt: string;
}

export interface InsightPack {
  id: string;
  name: string;
  genre: Genre;
  audienceNeed: string;
  openingPromise: string;
  conflictEngine: string;
  emotionalRhythm: string;
  retentionDevices: string;
  longFormEngine: string;
  marketGap: string;
  risks: string;
  evidenceCount: number;
  confidence: "低" | "中" | "高";
  createdAt: string;
}

export interface AestheticProfile {
  narrativeDistance: "贴身" | "适中" | "远距";
  emotionalTemperature: "冷峻" | "克制" | "均衡" | "热烈";
  proseTexture: string;
  dialogueStyle: string;
  emotionalExpression: string;
  signatureTechniques: string[];
  avoidPatterns: string[];
}

export interface AestheticProfileSuggestion {
  profile: AestheticProfile;
  diagnosis: string;
  rationale: string[];
}

export interface StoryContract extends GenreComposition {
  premise: string;
  genreSubtype?: string;
  fanqieCategoryKey?: string;
  audience?: string;
  commercialHook?: string;
  openingMechanism?: string;
  growthCarrier?: string;
  primaryPayoff?: string;
  longFormEngine?: string;
  protagonistDesire: string;
  protagonistArc?: string;
  keyRelationships?: string[];
  worldRules?: string[];
  majorForces?: string[];
  timelineAnchors?: string[];
  readerPromise: string;
  coreEmotion: string;
  ending: string;
  immutableRules: string[];
  prohibitedPatterns: string[];
  aestheticProfile?: AestheticProfile;
  version: number;
  approved: boolean;
  updatedAt: string;
}

export interface PlanNode {
  id: string;
  kind: "宏观阶段" | "分卷" | "粗纲" | "细纲" | "场景卡";
  title: string;
  ordinal: number;
  goal: string;
  conflict: string;
  outcome: string;
  targetWords: number;
  status: "草稿" | "待审批" | "已批准";
  parentId: string | null;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  outline: string;
  content: string;
  wordCount: number;
  status: ChapterStatus;
  batchMode: "逐章" | "五章批次";
  isKeyChapter: boolean;
  chapterFunction?: ChapterFunction;
  targetWords?: number;
  chapterPromise?: string;
  expectedPayoff?: string;
  crisis?: string;
  endingExpectation?: string;
  expectationTargetChapter?: number | null;
  endingExpectationId?: string | null;
  linkedExpectationIds?: string[];
  revision: number;
  updatedAt: string;
}

export type ExpectationStatus = "待兑现" | "部分兑现" | "已兑现" | "已放弃";

export interface ExpectationEntry {
  id: string;
  title: string;
  description: string;
  sourceChapter: number;
  expectedPayoffChapter: number | null;
  actualPayoffChapter: number | null;
  status: ExpectationStatus;
  payoffResult: string;
  createdAt: string;
  updatedAt: string;
}

export type LedgerKind =
  | "人物"
  | "关系"
  | "能力"
  | "资源"
  | "地点"
  | "时间线"
  | "秘密"
  | "承诺"
  | "伏笔"
  | "支线"
  | "事件";

export interface LedgerFact {
  id: string;
  kind: LedgerKind;
  genreDimension?: string;
  subject: string;
  predicate: string;
  value: string;
  validFromChapter: number;
  validToChapter: number | null;
  evidenceChapter: number;
  confidence: "待确认" | "已确认" | "有冲突" | "已忽略";
  knowledgeScope: string;
  replacesFactId?: string | null;
  changeType?: "新增" | "状态替换" | "数值变化" | "知情范围变更";
  numericDelta?: number | null;
  updatedAt: string;
}

export interface ChapterTransitionResult {
  chapter: Chapter;
  ledgerExtraction: {
    status: "不适用" | "未配置" | "已完成" | "失败";
    candidateCount: number;
    message?: string;
  };
}

export interface QualityIssue {
  id: string;
  projectId: string;
  chapterId: string | null;
  severity: "硬性" | "警告" | "建议";
  category: string;
  message: string;
  evidence: string;
  status: "待处理" | "已忽略" | "已解决";
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  targetKind: "创作契约" | "规划" | "章节";
  targetId: string;
  baseVersion: number;
  title: string;
  reason: string;
  beforeValue: string;
  afterValue: string;
  impact: string;
  rollback: string;
  status: "待审批" | "已批准" | "已拒绝" | "已应用";
  createdAt: string;
}

export interface ScheduleItem {
  id: string;
  projectId: string;
  projectTitle: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  publishAt: string;
  status: "待排期" | "待发布" | "已发布";
}

export interface MetricSnapshot {
  id: string;
  chapterNumber: number | null;
  recordedAt: string;
  exposure: number;
  clicks?: number;
  reads: number;
  firstChapterCompletion?: number;
  threeChapterRetention?: number;
  retention: number;
  follows: number;
  bookshelfAdds?: number;
  revenue: number;
  comments: string;
}

export interface ReviewSuggestion {
  id: string;
  category: "开篇" | "节奏" | "简介" | "章纲" | "转化" | "数据质量";
  observation: string;
  recommendation: string;
  evidence: string;
  confidence: "低" | "中" | "高";
}

export interface ReviewExperiment {
  id: string;
  title: string;
  hypothesis: string;
  changeSummary: string;
  fromChapter: number;
  toChapter: number;
  baselineStart: string;
  baselineEnd: string;
  observationStart: string;
  observationEnd: string;
  primaryMetric: "点击率" | "首章读完率" | "三章留存" | "追读率" | "书架率" | "收益";
  successCriteria: string;
  confounders: string;
  status: "计划中" | "观察中" | "已结论" | "已取消";
  conclusion: string;
  decision: "保留改动" | "撤销改动" | "继续观察" | null;
  createdAt: string;
  updatedAt: string;
}

export type SummaryLayer = "场景" | "章节" | "十章阶段" | "分卷" | "全书";

export interface StorySummary {
  id: string;
  layer: SummaryLayer;
  title: string;
  fromChapter: number;
  toChapter: number;
  content: string;
  version: number;
  updatedAt: string;
}

export interface AiSettings {
  baseUrl: string;
  model: string;
  embeddingModel: string;
  hasApiKey: boolean;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  longTaskTimeoutMinutes: number;
}

export type AiJobStatus = "运行中" | "成功" | "失败" | "已取消" | "已中断";

export interface AiJobRecord {
  id: string;
  projectId: string | null;
  taskType: string;
  inputSummary: string;
  promptVersion: string;
  provider: string;
  model: string;
  status: AiJobStatus;
  inputTokens: number;
  outputTokens: number;
  actualCost: number;
  durationMs: number;
  headersAt: string | null;
  firstTokenAt: string | null;
  completedAt: string | null;
  chunkCount: number;
  attemptCount: number;
  error: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ChapterDraftStreamEvent =
  | { type: "attempt-start"; attempt: number }
  | { type: "delta"; attempt: number; delta: string }
  | { type: "complete"; attempt: number };

export interface ProjectDetail {
  summary: ProjectSummary;
  contract: StoryContract;
  plans: PlanNode[];
  chapters: Chapter[];
  facts: LedgerFact[];
  issues: QualityIssue[];
  changes: ChangeRequest[];
  schedule: ScheduleItem[];
  metrics: MetricSnapshot[];
  experiments: ReviewExperiment[];
  insightIds: string[];
  summaries: StorySummary[];
  expectations: ExpectationEntry[];
}

export interface ConceptCandidate {
  id: string;
  title: string;
  oneLinePitch: string;
  audience: string;
  coreConflict: string;
  differentiation: string;
  longFormCapacity: string;
  originalityRisk: "低" | "中" | "高";
}

export interface BookConceptInput extends GenreComposition {
  genre: Genre;
  targetWords: number;
  updateCadence: string;
  seed: string;
}

export type { NarrativeGenre };

export interface BookConceptCandidate {
  id: string;
  title: string;
  premise: string;
  genreSubtype: string;
  secondaryGenres: NarrativeGenre[];
  genreElements: string[];
  openingMechanism: string;
  growthCarrier: string;
  primaryPayoff: string;
  protagonistDesire: string;
  readerPromise: string;
  coreEmotion: string;
  ending: string;
  immutableRules: string[];
  prohibitedPatterns: string[];
  audience: string;
  commercialHook: string;
  longFormEngine: string;
}

export interface CreateProjectInput extends GenreComposition {
  title: string;
  genre: Genre;
  targetWords: number;
  updateCadence: string;
  safeStockLine?: number;
}

export interface ProjectPatch {
  title?: string;
  status?: ProjectStatus;
  targetWords?: number;
  updateCadence?: string;
  safeStockLine?: number;
}

export interface ImportPreview {
  fileName: string;
  sourceType: ResearchBook["sourceType"];
  detectedEncoding: string;
  chapters: Array<{ title: string; content: string; wordCount: number }>;
  totalWords: number;
  warnings: string[];
}

export interface ContextPackage {
  contract: string;
  commercialGuidance: string;
  chapterIntent: string;
  expectationLedger: string;
  longTermMemory: string;
  volumeGoal: string;
  rollingOutline: string;
  recentSummary: string;
  relevantFacts: string;
  forbiddenKnowledge: string;
  authorStyle: string;
  estimatedTokens: number;
  diagnostics?: ContextDiagnostics;
}

export interface ContextSectionDiagnostic {
  key: Exclude<keyof ContextPackage, "estimatedTokens" | "diagnostics">;
  label: string;
  source: string;
  reason: string;
  characters: number;
  includedItems: number;
  totalItems: number;
  status: "已包含" | "已截断" | "缺失";
}

export interface ContextDiagnostics {
  generatedAt: string;
  sections: ContextSectionDiagnostic[];
  warnings: string[];
}

export interface BatchGenerationPreview {
  chapters: Array<{ id: string; number: number; title: string }>;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  canRun: boolean;
  blockingReason: string | null;
}

export type PlanningGenerationMode = "全书结构" | "后续章纲";

export interface PlanningGenerationInput {
  mode: PlanningGenerationMode;
  fromChapter?: number;
  chapterCount?: 10 | 30;
}

export interface PlanningGenerationResult {
  plans: PlanNode[];
  chapters: Chapter[];
  startChapter: number;
}

export interface PlanningReviewInput {
  fromChapter: number;
  chapterCount: 10 | 30;
}

export interface PlanningReviewIssue {
  severity: "硬性" | "警告" | "建议";
  category: "因果" | "人物动机" | "设定" | "结构覆盖" | "章节承接" | "节奏重复" | "期待兑现" | "篇幅";
  targetType: "规划" | "章节" | "全局";
  targetId: string | null;
  location: string;
  message: string;
  evidence: string;
  repairSummary: string;
}

export interface PlanningPlanRepair {
  targetId: string;
  after: Pick<PlanNode, "title" | "goal" | "conflict" | "outcome" | "targetWords">;
  blockedReason: string | null;
}

export interface PlanningChapterRepair {
  targetId: string;
  after: Pick<Chapter, "title" | "outline" | "chapterFunction" | "targetWords" | "chapterPromise" | "expectedPayoff" | "crisis" | "endingExpectation" | "expectationTargetChapter">;
  blockedReason: string | null;
}

export interface PlanningReviewResult {
  summary: string;
  verdict: "可执行" | "建议修复" | "存在硬伤";
  issues: PlanningReviewIssue[];
  planRepairs: PlanningPlanRepair[];
  chapterRepairs: PlanningChapterRepair[];
  reviewedPlanCount: number;
  reviewedChapterCount: number;
}

export interface PlanningRepairInput {
  plans: Array<{ targetId: string; after: PlanningPlanRepair["after"] }>;
  chapters: Array<{ targetId: string; after: PlanningChapterRepair["after"] }>;
}

export interface PlanningRepairResult {
  appliedPlanIds: string[];
  appliedChapterIds: string[];
}

export interface SearchHit {
  id: string;
  type: "章节" | "规划" | "事实";
  title: string;
  excerpt: string;
  chapterNumber: number | null;
}

export interface RevisionRecord {
  id: string;
  collection: "state" | "plans" | "chapters" | "facts" | "changes";
  entityId: string;
  revision: number;
  payload: unknown;
  createdAt: string;
}

export type ChapterSaveMode = "version" | "autosave";

export type AutoBackupFrequency = "daily" | "weekly";

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  retentionCount: number;
  hasPassword: boolean;
  lastRunAt: string | null;
  lastStatus: "未运行" | "成功" | "失败";
  lastError: string | null;
  nextRunAt: string | null;
}

export interface AutoBackupInput {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  retentionCount: number;
}

export interface HealthCheckItem {
  id: string;
  label: string;
  status: "正常" | "警告" | "错误";
  detail: string;
  projectId: string | null;
  repairable: boolean;
}

export interface SystemHealthReport {
  checkedAt: string;
  status: "正常" | "警告" | "错误";
  projectCount: number;
  chapterCount: number;
  failedAiJobs: number;
  workspaceBytes: number;
  backupBytes: number;
  checks: HealthCheckItem[];
}

export interface HealthCheckTask {
  id: string;
  status: "运行中" | "完成" | "已取消" | "失败";
  completed: number;
  total: number;
  label: string;
  report: SystemHealthReport | null;
  error: string | null;
}

export interface AppApi {
  getDashboard(): Promise<DashboardData>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<ProjectSummary>;
  generateBookConcepts(input: BookConceptInput): Promise<BookConceptCandidate[]>;
  createProjectFromConcept(input: BookConceptInput, concept: BookConceptCandidate): Promise<ProjectSummary>;
  deleteProject(id: string, confirmationTitle: string): Promise<string>;
  getProject(id: string): Promise<ProjectDetail>;
  updateProject(id: string, patch: ProjectPatch): Promise<ProjectSummary>;
  saveContract(id: string, contract: StoryContract): Promise<StoryContract>;
  suggestAestheticProfile(id: string, contract: StoryContract): Promise<AestheticProfileSuggestion>;
  approveContract(id: string): Promise<StoryContract>;
  savePlan(id: string, plan: PlanNode): Promise<PlanNode>;
  approvePlan(id: string, planId: string): Promise<void>;
  generatePlanningDraft(id: string, input: PlanningGenerationInput): Promise<PlanningGenerationResult>;
  reviewPlanning(id: string, input: PlanningReviewInput): Promise<PlanningReviewResult>;
  applyPlanningRepairs(id: string, input: PlanningRepairInput): Promise<PlanningRepairResult>;
  saveChapter(id: string, chapter: Chapter, mode?: ChapterSaveMode): Promise<Chapter>;
  saveExpectation(
    id: string,
    expectation: ExpectationEntry,
  ): Promise<ExpectationEntry>;
  transitionChapter(
    id: string,
    chapterId: string,
    status: ChapterStatus,
  ): Promise<ChapterTransitionResult>;
  compileContext(id: string, chapterId: string): Promise<ContextPackage>;
  searchProject(id: string, query: string, offset?: number, limit?: number): Promise<SearchHit[]>;
  listRevisions(
    id: string,
    collection: RevisionRecord["collection"],
    entityId: string,
  ): Promise<RevisionRecord[]>;
  restoreRevision(id: string, revisionId: string): Promise<void>;
  runQualityCheck(id: string, chapterId: string): Promise<QualityIssue[]>;
  reviseChapterFromQuality(id: string, chapterId: string): Promise<Chapter>;
  extractChapterFacts(id: string, chapterId: string): Promise<LedgerFact[]>;
  saveFact(id: string, fact: LedgerFact): Promise<LedgerFact>;
  resolveIssue(
    id: string,
    issueId: string,
    status: QualityIssue["status"],
  ): Promise<void>;
  saveChangeRequest(id: string, change: ChangeRequest): Promise<ChangeRequest>;
  decideChangeRequest(
    id: string,
    changeId: string,
    decision: "批准" | "拒绝",
  ): Promise<void>;
  saveSchedule(id: string, item: ScheduleItem): Promise<ScheduleItem>;
  listRankings(): Promise<RankingSnapshot[]>;
  importRankingCsv(csvText: string, listName: string): Promise<RankingSnapshot>;
  capturePublicRanking(url: string, listName: string): Promise<RankingSnapshot>;
  listRankingSchedules(): Promise<RankingCaptureSchedule[]>;
  saveRankingSchedule(input: Omit<RankingCaptureSchedule, "id" | "lastRunAt" | "nextRunAt" | "lastStatus" | "lastError"> & { id?: string }): Promise<RankingCaptureSchedule>;
  runRankingSchedule(id: string): Promise<RankingSnapshot>;
  deleteRankingSchedule(id: string): Promise<void>;
  getRankingAnalytics(): Promise<RankingAnalytics>;
  listResearchBooks(): Promise<ResearchBook[]>;
  previewResearchFile(): Promise<ImportPreview | null>;
  importResearchBook(
    preview: ImportPreview,
    genre: Genre,
    rightsConfirmed: boolean,
    cloudConsent: boolean,
  ): Promise<ResearchBook>;
  importPublicResearchSample(
    sourceUrl: string,
    genre: Genre,
    cloudConsent: boolean,
  ): Promise<ResearchBook>;
  listInsights(): Promise<InsightPack[]>;
  createInsight(
    input: Omit<InsightPack, "id" | "createdAt">,
  ): Promise<InsightPack>;
  deconstructResearchBook(bookId: string): Promise<InsightPack>;
  listResearchAnalyses(bookId: string): Promise<ResearchAnalysisRecord[]>;
  attachInsights(id: string, insightIds: string[]): Promise<void>;
  generateConcepts(id: string): Promise<ConceptCandidate[]>;
  generateChapterDraft(
    id: string,
    chapterId: string,
    onStream?: (event: ChapterDraftStreamEvent) => void,
  ): Promise<Chapter>;
  previewChapterBatch(
    id: string,
    chapterId: string,
  ): Promise<BatchGenerationPreview>;
  generateChapterBatch(id: string, chapterId: string): Promise<Chapter[]>;
  getAiSettings(): Promise<AiSettings>;
  saveAiSettings(
    settings: Omit<AiSettings, "hasApiKey">,
    apiKey?: string,
  ): Promise<AiSettings>;
  listAiJobs(projectId?: string): Promise<AiJobRecord[]>;
  cancelAiJob(id: string): Promise<boolean>;
  retryAiJob(id: string): Promise<AiJobRecord>;
  exportProject(
    id: string,
    format: "txt" | "md" | "docx",
  ): Promise<string | null>;
  importMetricsCsv(id: string, csvText: string): Promise<number>;
  getReviewSuggestions(id: string): Promise<ReviewSuggestion[]>;
  saveReviewExperiment(id: string, experiment: ReviewExperiment): Promise<ReviewExperiment>;
  createBackup(password: string): Promise<string | null>;
  restoreBackup(password: string): Promise<string | null>;
  getAutoBackupSettings(): Promise<AutoBackupSettings>;
  saveAutoBackupSettings(input: AutoBackupInput, password?: string): Promise<AutoBackupSettings>;
  runAutoBackup(): Promise<AutoBackupSettings>;
  runSystemHealthCheck(): Promise<SystemHealthReport>;
  startSystemHealthCheck(): Promise<HealthCheckTask>;
  getSystemHealthCheck(id: string): Promise<HealthCheckTask>;
  cancelSystemHealthCheck(id: string): Promise<boolean>;
  rebuildSearchIndexes(projectId: string): Promise<SystemHealthReport>;
  exportDiagnosticBundle(): Promise<string | null>;
  getWorkspacePath(): Promise<string>;
}
