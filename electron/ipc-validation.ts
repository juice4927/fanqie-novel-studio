import { z } from "zod";
import { GENRES } from "../src/shared/types";
import { NARRATIVE_GENRES } from "../src/shared/genre-composition";
import type { AppApi } from "../src/shared/types";

const id = z.string().trim().min(1).max(200);
const shortText = z.string().max(500);
const mediumText = z.string().max(10_000);
const longText = z.string().max(200_000);
const timestamp = z.string().max(64);
const genre = z.enum(GENRES);
const secondaryGenres = z.array(z.enum(NARRATIVE_GENRES)).max(3).optional();
const genreElements = z.array(shortText).max(8).optional();
const customGenreDirection = z.string().max(2000).optional();
const positiveInt = z.number().int().positive().max(10_000_000);
const httpUrl = z.url().max(2000).refine((value) => /^https?:\/\//i.test(value), "只允许 HTTP/HTTPS 地址");

const createProject = z.object({
  title: z.string().trim().min(1).max(100),
  genre,
  targetWords: z.number().int().min(10_000).max(20_000_000),
  updateCadence: z.string().trim().min(1).max(100),
  safeStockLine: z.number().int().min(0).max(1000).optional(),
  secondaryGenres,
  genreElements,
  customGenreDirection,
}).strict();

const bookConceptInput = z.object({
  genre,
  targetWords: z.number().int().min(10_000).max(20_000_000),
  updateCadence: z.string().trim().min(1).max(100),
  seed: z.string().max(5000),
  secondaryGenres,
  genreElements,
  customGenreDirection,
}).strict();

const bookConcept = z.object({
  id,
  title: z.string().trim().min(1).max(100),
  premise: mediumText,
  genreSubtype: shortText,
  protagonistDesire: mediumText,
  readerPromise: mediumText,
  coreEmotion: shortText,
  ending: mediumText,
  immutableRules: z.array(shortText).max(30),
  prohibitedPatterns: z.array(shortText).max(30),
  audience: mediumText,
  commercialHook: mediumText,
  longFormEngine: mediumText,
}).strict();

const contract = z.object({
  premise: mediumText,
  genreSubtype: shortText.optional(),
  fanqieCategoryKey: shortText.optional(),
  secondaryGenres,
  genreElements,
  customGenreDirection,
  protagonistDesire: mediumText,
  readerPromise: mediumText,
  coreEmotion: mediumText,
  ending: mediumText,
  immutableRules: z.array(shortText).max(100),
  prohibitedPatterns: z.array(shortText).max(100),
  aestheticProfile: z.object({
    narrativeDistance: z.enum(["贴身", "适中", "远距"]),
    emotionalTemperature: z.enum(["冷峻", "克制", "均衡", "热烈"]),
    proseTexture: mediumText,
    dialogueStyle: mediumText,
    emotionalExpression: mediumText,
    signatureTechniques: z.array(shortText).max(50),
    avoidPatterns: z.array(shortText).max(50),
  }).strict().optional(),
  version: z.number().int().min(0).max(1_000_000),
  approved: z.boolean(),
  updatedAt: timestamp,
}).strict();

const plan = z.object({
  id: z.string().max(200),
  kind: z.enum(["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"]),
  title: z.string().max(500),
  ordinal: positiveInt,
  goal: mediumText,
  conflict: mediumText,
  outcome: mediumText,
  targetWords: z.number().int().min(0).max(20_000_000),
  status: z.enum(["草稿", "待审批", "已批准"]),
  parentId: id.nullable(),
}).strict();

const chapter = z.object({
  id: z.string().max(200),
  number: positiveInt,
  title: z.string().max(500),
  outline: mediumText,
  content: longText,
  wordCount: z.number().int().min(0).max(20_000_000),
  status: z.enum(["章纲", "草稿", "待质检", "待定稿", "已定稿", "待发布", "已发布"]),
  batchMode: z.enum(["逐章", "五章批次"]),
  isKeyChapter: z.boolean(),
  chapterPromise: mediumText.optional(),
  expectedPayoff: mediumText.optional(),
  crisis: mediumText.optional(),
  endingExpectation: mediumText.optional(),
  expectationTargetChapter: positiveInt.nullable().optional(),
  endingExpectationId: id.nullable().optional(),
  linkedExpectationIds: z.array(id).max(1000).optional(),
  revision: z.number().int().min(0).max(1_000_000),
  updatedAt: timestamp,
}).strict();

const expectation = z.object({
  id: z.string().max(200), title: shortText, description: mediumText,
  sourceChapter: positiveInt, expectedPayoffChapter: positiveInt.nullable(),
  actualPayoffChapter: positiveInt.nullable(),
  status: z.enum(["待兑现", "部分兑现", "已兑现", "已放弃"]),
  payoffResult: mediumText, createdAt: timestamp, updatedAt: timestamp,
}).strict();

const fact = z.object({
  id: z.string().max(200),
  kind: z.enum(["人物", "关系", "能力", "资源", "地点", "时间线", "秘密", "承诺", "伏笔", "支线", "事件"]),
  genreDimension: shortText.optional(), subject: shortText, predicate: shortText,
  value: mediumText, validFromChapter: positiveInt, validToChapter: positiveInt.nullable(),
  evidenceChapter: positiveInt, confidence: z.enum(["待确认", "已确认", "有冲突", "已忽略"]),
  knowledgeScope: shortText, replacesFactId: id.nullable().optional(),
  changeType: z.enum(["新增", "状态替换", "数值变化", "知情范围变更"]).optional(),
  numericDelta: z.number().finite().nullable().optional(), updatedAt: timestamp,
}).strict();

const changeRequest = z.object({
  id: z.string().max(200), targetKind: z.enum(["创作契约", "规划", "章节"]),
  targetId: id, baseVersion: z.number().int().min(0).max(1_000_000),
  title: shortText, reason: mediumText, beforeValue: longText, afterValue: longText,
  impact: mediumText, rollback: mediumText,
  status: z.enum(["待审批", "已批准", "已拒绝", "已应用"]), createdAt: timestamp,
}).strict();

const reviewExperiment = z.object({
  id: z.string().max(200), title: shortText, hypothesis: mediumText, changeSummary: mediumText,
  fromChapter: positiveInt, toChapter: positiveInt,
  baselineStart: z.string().date(), baselineEnd: z.string().date(), observationStart: z.string().date(), observationEnd: z.string().date(),
  primaryMetric: z.enum(["点击率", "首章读完率", "三章留存", "追读率", "书架率", "收益"]),
  successCriteria: mediumText, confounders: mediumText,
  status: z.enum(["计划中", "观察中", "已结论", "已取消"]), conclusion: mediumText,
  decision: z.enum(["保留改动", "撤销改动", "继续观察"]).nullable(), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  if (value.fromChapter > value.toChapter) context.addIssue({ code: "custom", message: "影响起始章不能晚于结束章", path: ["fromChapter"] });
  if (value.status === "已结论" && (!value.conclusion.trim() || !value.decision)) context.addIssue({ code: "custom", message: "结束实验必须填写结论和处理决定", path: ["conclusion"] });
});

const importPreview = z.object({
  fileName: z.string().max(1000), sourceType: z.enum(["TXT", "EPUB", "DOCX", "粘贴"]),
  detectedEncoding: shortText,
  chapters: z.array(z.object({ title: z.string().max(1000), content: z.string().max(2_000_000), wordCount: z.number().int().min(0).max(2_000_000) }).strict()).max(10_000),
  totalWords: z.number().int().min(0).max(50_000_000), warnings: z.array(shortText).max(1000),
}).strict().superRefine((value, context) => {
  const totalCharacters = value.chapters.reduce((sum, item) => sum + item.content.length, 0);
  if (totalCharacters > 50_000_000)
    context.addIssue({ code: "custom", message: "导入正文总量不能超过 5000 万字符", path: ["chapters"] });
});

const insightInput = z.object({
  name: shortText, genre, audienceNeed: mediumText, openingPromise: mediumText,
  conflictEngine: mediumText, emotionalRhythm: mediumText, retentionDevices: mediumText,
  longFormEngine: mediumText, marketGap: mediumText, risks: mediumText,
  evidenceCount: z.number().int().min(0).max(10_000_000), confidence: z.enum(["低", "中", "高"]),
}).strict();

const schemas: Partial<Record<keyof AppApi, z.ZodType<unknown[]>>> = {
  createProject: z.tuple([createProject]),
  generateBookConcepts: z.tuple([bookConceptInput]),
  createProjectFromConcept: z.tuple([bookConceptInput, bookConcept]),
  deleteProject: z.tuple([id, z.string().max(100)]),
  updateProject: z.tuple([id, z.object({ title: z.string().max(100).optional(), status: z.enum(["研究中", "候选立项", "设定中", "大纲审批", "连载准备", "连载中", "暂停", "完结", "归档"]).optional(), targetWords: z.number().int().min(10_000).max(20_000_000).optional(), updateCadence: z.string().max(100).optional(), safeStockLine: z.number().int().min(0).max(1000).optional() }).strict()]),
  saveContract: z.tuple([id, contract]),
  suggestAestheticProfile: z.tuple([id]),
  savePlan: z.tuple([id, plan]),
  generatePlanningDraft: z.tuple([id, z.object({ mode: z.enum(["全书结构", "后续章纲"]), fromChapter: positiveInt.optional(), chapterCount: z.union([z.literal(10), z.literal(30)]).optional() }).strict()]),
  saveChapter: z.tuple([id, chapter, z.enum(["version", "autosave"]).optional()]),
  saveExpectation: z.tuple([id, expectation]),
  transitionChapter: z.tuple([id, id, z.enum(["章纲", "草稿", "待质检", "待定稿", "已定稿", "待发布", "已发布"])]),
  reviseChapterFromQuality: z.tuple([id, id]),
  searchProject: z.tuple([id, z.string().max(500), z.number().int().min(0).max(1_000_000).optional(), z.number().int().min(1).max(200).optional()]),
  saveFact: z.tuple([id, fact]),
  resolveIssue: z.tuple([id, id, z.enum(["待处理", "已忽略", "已解决"])]),
  saveChangeRequest: z.tuple([id, changeRequest]),
  decideChangeRequest: z.tuple([id, id, z.enum(["批准", "拒绝"])]),
  saveSchedule: z.tuple([id, z.object({ id: z.string().max(200), projectId: id, projectTitle: shortText, chapterId: id, chapterNumber: positiveInt, chapterTitle: shortText, publishAt: timestamp, status: z.enum(["待排期", "待发布", "已发布"]) }).strict()]),
  importRankingCsv: z.tuple([z.string().max(20_000_000), z.string().trim().min(1).max(200)]),
  capturePublicRanking: z.tuple([httpUrl, z.string().trim().min(1).max(200)]),
  saveRankingSchedule: z.tuple([z.object({ id: z.string().max(200).optional(), url: httpUrl, listName: z.string().trim().min(1).max(200), frequency: z.enum(["每日", "每周"]), enabled: z.boolean() }).strict()]),
  importResearchBook: z.tuple([importPreview, genre, z.boolean(), z.boolean()]),
  importPublicResearchSample: z.tuple([httpUrl, genre, z.boolean()]),
  createInsight: z.tuple([insightInput]),
  attachInsights: z.tuple([id, z.array(id).max(1000)]),
  generateChapterDraft: z.tuple([id, id, id.optional()]),
  saveAiSettings: z.tuple([z.object({ baseUrl: httpUrl, model: z.string().trim().min(1).max(200), embeddingModel: z.string().trim().min(1).max(200), inputPricePerMillion: z.number().min(0).max(1_000_000), outputPricePerMillion: z.number().min(0).max(1_000_000), longTaskTimeoutMinutes: z.number().int().min(5).max(15) }).strict(), z.string().max(10_000).optional()]),
  listAiJobs: z.tuple([id.optional()]),
  cancelAiJob: z.tuple([id]),
  retryAiJob: z.tuple([id]),
  exportProject: z.tuple([id, z.enum(["txt", "md", "docx"])]),
  importMetricsCsv: z.tuple([id, z.string().max(20_000_000)]),
  saveReviewExperiment: z.tuple([id, reviewExperiment]),
  createBackup: z.tuple([z.string().min(8).max(1000)]),
  restoreBackup: z.tuple([z.string().min(8).max(1000)]),
  saveAutoBackupSettings: z.tuple([z.object({ enabled: z.boolean(), frequency: z.enum(["daily", "weekly"]), retentionCount: z.number().int().min(1).max(30) }).strict(), z.string().min(8).max(1000).optional()]),
  rebuildSearchIndexes: z.tuple([id]),
  exportDiagnosticBundle: z.tuple([]),
  getSystemHealthCheck: z.tuple([id]),
  cancelSystemHealthCheck: z.tuple([id]),
};

export function validateIpcArgs(channel: keyof AppApi, args: unknown[]) {
  const schema = schemas[channel];
  if (!schema) return args;
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const location = issue.path.length ? issue.path.join(".") : "参数";
  throw new Error(`参数无效（${String(channel)}.${location}）：${issue.message}`);
}
