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
  genre: Genre;
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
  sourceType: "TXT" | "EPUB" | "DOCX" | "粘贴";
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

export interface StoryContract {
  premise: string;
  genreSubtype?: string;
  fanqieCategoryKey?: string;
  protagonistDesire: string;
  readerPromise: string;
  coreEmotion: string;
  ending: string;
  immutableRules: string[];
  prohibitedPatterns: string[];
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
  confidence: "待确认" | "已确认" | "有冲突";
  knowledgeScope: string;
  updatedAt: string;
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
}

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

export interface CreateProjectInput {
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
  volumeGoal: string;
  rollingOutline: string;
  recentSummary: string;
  relevantFacts: string;
  forbiddenKnowledge: string;
  authorStyle: string;
  estimatedTokens: number;
}

export interface BatchGenerationPreview {
  chapters: Array<{ id: string; number: number; title: string }>;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  canRun: boolean;
  blockingReason: string | null;
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

export interface AppApi {
  getDashboard(): Promise<DashboardData>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<ProjectSummary>;
  getProject(id: string): Promise<ProjectDetail>;
  updateProject(id: string, patch: ProjectPatch): Promise<ProjectSummary>;
  saveContract(id: string, contract: StoryContract): Promise<StoryContract>;
  approveContract(id: string): Promise<StoryContract>;
  savePlan(id: string, plan: PlanNode): Promise<PlanNode>;
  approvePlan(id: string, planId: string): Promise<void>;
  saveChapter(id: string, chapter: Chapter): Promise<Chapter>;
  saveExpectation(
    id: string,
    expectation: ExpectationEntry,
  ): Promise<ExpectationEntry>;
  transitionChapter(
    id: string,
    chapterId: string,
    status: ChapterStatus,
  ): Promise<Chapter>;
  compileContext(id: string, chapterId: string): Promise<ContextPackage>;
  searchProject(id: string, query: string): Promise<SearchHit[]>;
  listRevisions(
    id: string,
    collection: RevisionRecord["collection"],
    entityId: string,
  ): Promise<RevisionRecord[]>;
  restoreRevision(id: string, revisionId: string): Promise<void>;
  runQualityCheck(id: string, chapterId: string): Promise<QualityIssue[]>;
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
  listInsights(): Promise<InsightPack[]>;
  createInsight(
    input: Omit<InsightPack, "id" | "createdAt">,
  ): Promise<InsightPack>;
  deconstructResearchBook(bookId: string): Promise<InsightPack>;
  listResearchAnalyses(bookId: string): Promise<ResearchAnalysisRecord[]>;
  attachInsights(id: string, insightIds: string[]): Promise<void>;
  generateConcepts(id: string): Promise<ConceptCandidate[]>;
  generateChapterDraft(id: string, chapterId: string): Promise<Chapter>;
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
  exportProject(
    id: string,
    format: "txt" | "md" | "docx",
  ): Promise<string | null>;
  importMetricsCsv(id: string, csvText: string): Promise<number>;
  getReviewSuggestions(id: string): Promise<ReviewSuggestion[]>;
  createBackup(password: string): Promise<string | null>;
  restoreBackup(password: string): Promise<string | null>;
  getWorkspacePath(): Promise<string>;
}
