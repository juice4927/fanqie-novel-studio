import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AestheticProfileSuggestion,
  Chapter,
  BookConceptCandidate,
  BookConceptInput,
  ConceptCandidate,
  ContextPackage,
  Genre,
  InsightPack,
  LedgerFact,
  MarketOpportunity,
  PlanningGenerationInput,
  PlanningGenerationResult,
  ProjectDetail,
  QualityIssue,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../src/shared/types";
import { GENRE_PLUGINS } from "../src/shared/genre-plugins";
import { WorkspaceDatabase, now } from "./database";
import { compileCommercialGuidance, compileDeconstructionFramework } from "../src/shared/commercial-knowledge";
import { aiEndpoint, inferProviderCapabilities, JsonStringFieldExtractor, normalizeProviderUrl, parseProviderUsage, parseResponsesOutput, providerError, readChatCompletionStream, readResponsesStream, rejectsJsonMode, rejectsStreaming, usesResponsesApi } from "./ai-provider";
import { PROMPT_VERSION } from "../src/shared/prompt-version";
import { contextForModel } from "../src/shared/context-diagnostics";
import { parseStoryNumber } from "../src/shared/story-constraints";
import { compileAestheticGuidance } from "../src/shared/aesthetic-profile";

export function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("任务已取消")); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("任务已取消")); }, { once: true });
  });
}

const InsightSchema = z.object({
  audienceNeed: z.string(),
  openingPromise: z.string(),
  conflictEngine: z.string(),
  emotionalRhythm: z.string(),
  retentionDevices: z.string(),
  longFormEngine: z.string(),
  marketGap: z.string(),
  risks: z.string(),
  confidence: z.enum(["低", "中", "高"]),
});

const BatchAnalysisSchema = z.object({
  chapters: z.array(z.object({
    ordinal: z.number(),
    finding: z.string(),
    conflict: z.string(),
    hook: z.string(),
    stateChange: z.string(),
    risk: z.string(),
    enteringExpectation: z.string(),
    protagonistGoal: z.string(),
    coreInterest: z.string(),
    emotionalPayoff: z.string(),
    payoffImpact: z.string(),
    nextExpectation: z.string(),
  })),
  synthesis: InsightSchema,
});

const CandidateSchema = z.object({
  candidates: z.array(z.object({
    title: z.string(),
    oneLinePitch: z.string(),
    audience: z.string(),
    coreConflict: z.string(),
    differentiation: z.string(),
    longFormCapacity: z.string(),
    originalityRisk: z.enum(["低", "中", "高"]),
  })).length(3),
});

const BookConceptSchema = z.object({
  candidates: z.array(z.object({
    title: z.string().min(4).max(40),
    premise: z.string().min(20).max(500),
    genreSubtype: z.string().min(2).max(40),
    protagonistDesire: z.string().min(8).max(200),
    readerPromise: z.string().min(10).max(300),
    coreEmotion: z.string().min(2).max(80),
    ending: z.string().min(10).max(300),
    immutableRules: z.array(z.string().min(2).max(120)).min(2).max(6),
    prohibitedPatterns: z.array(z.string().min(2).max(120)).min(2).max(6),
    audience: z.string().min(5).max(200),
    commercialHook: z.string().min(8).max(300),
    longFormEngine: z.string().min(10).max(400),
  })).length(3),
});

const DraftSchema = z.object({
  title: z.string(),
  content: z.string().min(500),
});

const ChapterDraftSchema = z.object({
  title: z.string().min(1).max(80),
  content: z.string().min(500).refine((value) => {
    const characters = [...value].filter((character) => !/\s/.test(character)).length;
    return characters >= 1600 && characters <= 3000;
  }, "正文有效字符数必须在 1600-3000 之间"),
});

const AestheticProfileSuggestionSchema = z.object({
  profile: z.object({
    narrativeDistance: z.enum(["贴身", "适中", "远距"]),
    emotionalTemperature: z.enum(["冷峻", "克制", "均衡", "热烈"]),
    proseTexture: z.string().min(2).max(300),
    dialogueStyle: z.string().min(2).max(300),
    emotionalExpression: z.string().min(2).max(300),
    signatureTechniques: z.array(z.string().min(2).max(120)).min(2).max(8),
    avoidPatterns: z.array(z.string().min(2).max(120)).min(2).max(8),
  }),
  diagnosis: z.string().min(10).max(600),
  rationale: z.array(z.string().min(4).max(240)).min(2).max(6),
});

const QualityReviewSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(["硬性", "警告", "建议"]),
    category: z.string().min(1).max(40),
    message: z.string().min(1).max(500),
    evidence: z.string().max(500),
  })).max(12),
});

const FactCandidateSchema = z.object({
  facts: z.array(z.object({
    kind: z.enum(["人物", "关系", "能力", "资源", "地点", "时间线", "秘密", "承诺", "伏笔", "支线", "事件"]),
    subject: z.string().min(1).max(80),
    predicate: z.string().min(1).max(80),
    value: z.string().min(1).max(300),
    knowledgeScope: z.string().max(200),
    evidence: z.string().min(4).max(300),
  })).max(12),
});

const StructurePlanningSchema = z.object({
  stages: z.array(z.object({
    title: z.string().min(2).max(80), startChapter: z.number().int().positive(),
    goal: z.string().min(10).max(500), conflict: z.string().min(10).max(500), outcome: z.string().min(10).max(500), targetWords: z.number().int().positive(),
  })).length(6),
  volumes: z.array(z.object({
    title: z.string().min(2).max(80),
    goal: z.string().min(10).max(500), conflict: z.string().min(10).max(500), outcome: z.string().min(10).max(500), targetWords: z.number().int().positive(),
  })).min(3).max(6),
});

const ChapterPlanningSchema = z.object({
  batchGoal: z.string().min(10).max(800),
  batchConflict: z.string().min(10).max(800),
  batchOutcome: z.string().min(10).max(800),
  chapters: z.array(z.object({
    title: z.string().min(2).max(80), goal: z.string().min(5).max(300),
    conflict: z.string().min(5).max(300), outcome: z.string().min(5).max(300),
    chapterPromise: z.string().min(5).max(300), expectedPayoff: z.string().min(5).max(300),
    crisis: z.string().min(5).max(300), endingExpectation: z.string().min(5).max(300),
    payoffOffset: z.number().int().min(1).max(30), isKeyChapter: z.boolean(),
  })).min(1).max(30),
});

type InsightResult = z.infer<typeof InsightSchema>;
const DECONSTRUCT_BATCH_SIZE = 5;
const CHAPTER_PLANNING_BATCH_SIZE = 10;

function insightText(insight: InsightResult) {
  return `读者需求：${insight.audienceNeed}\n开篇承诺：${insight.openingPromise}\n冲突发动机：${insight.conflictEngine}\n情绪节奏：${insight.emotionalRhythm}\n留存手段：${insight.retentionDevices}\n长篇发动机：${insight.longFormEngine}\n市场空位：${insight.marketGap}\n风险：${insight.risks}`;
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export interface ResearchSanitizationContext {
  replacements: Map<string, string>;
  characterIndex: number;
  placeIndex: number;
}

export function createResearchSanitizationContext(): ResearchSanitizationContext {
  return { replacements: new Map(), characterIndex: 0, placeIndex: 0 };
}

export function sanitizeResearchText(text: string, context = createResearchSanitizationContext()) {
  const replaceStable = (value: string, kind: "角色" | "地点组织") => {
    const existing = context.replacements.get(value);
    if (existing) return existing;
    const replacement = kind === "角色" ? `<角色${++context.characterIndex}>` : `<地点组织${++context.placeIndex}>`;
    context.replacements.set(value, replacement);
    return replacement;
  };

  return text
    .replace(/作者[：:]\s*[^\n]{1,30}/g, "")
    .replace(/https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.\w+\b/g, "<联系方式>")
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, "<联系方式>")
    .replace(/《[^》\n]{1,40}》/g, "《作品》")
    .replace(/(?:番茄小说|起点中文网|晋江文学城)/g, "内容平台")
    .replace(/(去了?|前往|返回|进入|离开|住在|位于|在|到|至|从|往)([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))/gu, (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`)
    .replace(/(^|[\s，。！？；：、“”‘’])([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))(?=[\s，。！？；：、“”‘’]|$)/gu, (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`)
    .replace(/([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾江童颜郭梅林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫柯房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公][\p{Script=Han}]{1,2}?)(?=说|问|答|道|看|走|来|去|笑|哭|皱|摇|点|抬|低|拿|转|站|坐|听|想|喊|叫)/gu, (value) => replaceStable(value, "角色"))
    .replace(/(?:名叫|叫做|名字是|自称|人称)([\p{Script=Han}A-Za-z0-9·_-]{2,16})/gu, (_value, name: string) => `名为${replaceStable(name, "角色")}`)
    .replace(/((?:欧阳|司马|上官|诸葛|东方|皇甫|尉迟|公孙|慕容|令狐|宇文|长孙|端木|独孤|南宫|夏侯|轩辕)[\p{Script=Han}]{1,2}|[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢苏潘范彭鲁韦马方任袁柳史唐薛雷贺罗毕郝安乐傅齐康伍余顾孟黄萧姚邵汪毛戴宋庞熊纪舒项董梁杜阮蓝贾江童郭林钟徐高夏蔡田樊胡凌霍莫房邓洪左石崔吉龚程陆荣白黎叶龙刘陈][\p{Script=Han}]{1,2})(?=[\s，。！？；：、“”‘’]|$)/gu, (value) => replaceStable(value, "角色"))
    .slice(0, 3500);
}

export function sanitizeResearchBatch<T extends { content: string }>(chapters: T[]) {
  const context = createResearchSanitizationContext();
  return chapters.map((chapter) => sanitizeResearchText(chapter.content, context));
}

function hashInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class AiService {
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly cancelledJobs = new Set<string>();

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly getApiKey: () => string,
    private readonly requestTimeoutMs = 120_000,
    private readonly longTaskTimeoutOverrideMs = 0,
    private readonly log: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  cancelJob(id: string) {
    const controller = this.activeRequests.get(id);
    if (!controller) return false;
    this.cancelledJobs.add(id);
    controller.abort();
    return true;
  }

  private async runJson<T>(options: {
    projectId: string | null;
    taskType: string;
    inputSummary: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    timeoutMs?: number;
    retryContext?: string;
    stream?: boolean;
    longTask?: boolean;
    reasoningEffort?: "low" | "medium" | "high";
    onAttempt?: (attempt: number) => void;
    onDelta?: (delta: string, attempt: number) => void;
  }): Promise<T> {
    const settings = this.database.getAiSettings();
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("尚未配置 AI API 密钥");
    const provider = normalizeProviderUrl(settings.baseUrl);
    const inputHash = hashInput(`${options.system}\n${options.user}`);
    const cached = this.database.findAiJob(options.taskType, inputHash, PROMPT_VERSION, provider, settings.model);
    if (cached) return options.schema.parse(JSON.parse(cached));
    const jobId = this.database.startAiJob(
      options.projectId, options.taskType, inputHash, PROMPT_VERSION, provider, settings.model, options.inputSummary,
      options.retryContext,
    );
    const startedAt = Date.now();
    let lastError = "模型输出不符合结构要求";
    let repairInstruction = "";
    const useResponses = usesResponsesApi(settings.model);
    let useJsonMode = !useResponses && inferProviderCapabilities(settings.baseUrl).jsonMode;
    let useStreaming = options.stream ?? false;
    let includeStreamUsage = useStreaming;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let headersAt: string | null = null;
    let firstTokenAt: string | null = null;
    let chunkCount = 0;
    let attemptCount = 0;
    const controller = new AbortController();
    const configuredLongTimeoutMs = Math.min(15, Math.max(5, settings.longTaskTimeoutMinutes ?? 10)) * 60_000;
    const timeoutMs = options.timeoutMs ?? (options.longTask ? this.longTaskTimeoutOverrideMs || configuredLongTimeoutMs : this.requestTimeoutMs);
    const deadline = startedAt + timeoutMs;
    const responseSchema = useResponses ? (() => {
      const { $schema: _metaSchema, ...schema } = z.toJSONSchema(options.schema) as Record<string, unknown>;
      return {
        type: "json_schema",
        name: options.taskType.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_response",
        strict: true,
        schema,
      };
    })() : null;
    this.activeRequests.set(jobId, controller);
    const telemetry = (status?: "失败" | "已取消") => ({
      ...usage,
      actualCost: usage.inputTokens / 1_000_000 * settings.inputPricePerMillion + usage.outputTokens / 1_000_000 * settings.outputPricePerMillion,
      durationMs: Date.now() - startedAt,
      status,
      headersAt,
      firstTokenAt,
      completedAt: new Date().toISOString(),
      chunkCount,
      attemptCount,
    });
    const persistLiveTelemetry = () => this.database.updateAiJobTelemetry?.(jobId, { headersAt, firstTokenAt, chunkCount, attemptCount });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let attemptStartedAt = Date.now();
      try {
        const endpoint = aiEndpoint(settings.baseUrl, settings.model);
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error(`模型请求超时：超过总时长上限（${Math.ceil(timeoutMs / 1000)} 秒）`);
        let timeoutError = "";
        const totalTimeout = setTimeout(() => { timeoutError = `模型请求超时：超过总时长上限（${Math.ceil(timeoutMs / 1000)} 秒）`; controller.abort(); }, remainingMs);
        let idleTimeout: ReturnType<typeof setTimeout> | null = null;
        const resetIdleTimeout = () => {
          if (!useStreaming) return;
          if (idleTimeout) clearTimeout(idleTimeout);
          const idleMs = Math.min(options.longTask ? 180_000 : 90_000, remainingMs);
          idleTimeout = setTimeout(() => { timeoutError = `模型请求超时：流式响应连续 ${Math.ceil(idleMs / 1000)} 秒无数据`; controller.abort(); }, idleMs);
        };
        resetIdleTimeout();
        attemptCount += 1;
        const httpAttempt = attemptCount;
        attemptStartedAt = Date.now();
        let attemptChunkCount = 0;
        let attemptFirstContentAt: string | null = null;
        options.onAttempt?.(httpAttempt);
        const contentExtractor = options.onDelta
          ? new JsonStringFieldExtractor("content", (delta) => options.onDelta?.(delta, httpAttempt))
          : null;
        this.log("info", "ai.request.attempt_started", { jobId, taskType: options.taskType, attempt: httpAttempt, endpoint, streaming: useStreaming });
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(useResponses ? {
              model: settings.model,
              reasoning: { effort: options.reasoningEffort ?? "medium" },
              ...(useStreaming ? { stream: true } : {}),
              instructions: `${options.system}\n只返回合法 JSON，不使用 Markdown。`,
              input: `${options.user}${repairInstruction}`,
              text: { format: responseSchema },
            } : {
              model: settings.model,
              temperature: options.taskType === "draft-chapter" ? 0.85 : 0.35,
              ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
              ...(useStreaming ? { stream: true } : {}),
              ...(useStreaming && includeStreamUsage ? { stream_options: { include_usage: true } } : {}),
              messages: [
                { role: "system", content: `${options.system}\n只返回合法 JSON，不使用 Markdown。` },
                { role: "user", content: `${options.user}${repairInstruction}` },
              ],
            }),
          });
          const currentHeadersAt = new Date().toISOString();
          headersAt ??= currentHeadersAt;
          persistLiveTelemetry();
          this.log("info", "ai.request.headers_received", {
            jobId, taskType: options.taskType, attempt: httpAttempt, status: response.status,
            headersLatencyMs: Date.now() - attemptStartedAt,
          });
          if (!response.ok) {
            const detail = (await response.text()).slice(0, 300);
            if (!useResponses && includeStreamUsage && response.status === 400 && /stream.?options|include.?usage/i.test(detail)) {
              this.log("warn", "ai.request.compatibility_retry", { jobId, taskType: options.taskType, attempt: httpAttempt, reason: "stream_options unsupported" });
              includeStreamUsage = false;
              attempt -= 1;
              continue;
            }
            if (useStreaming && rejectsStreaming(response.status, detail)) {
              this.log("warn", "ai.request.compatibility_retry", { jobId, taskType: options.taskType, attempt: httpAttempt, reason: "streaming unsupported" });
              useStreaming = false;
              includeStreamUsage = false;
              attempt -= 1;
              continue;
            }
            if (useJsonMode && rejectsJsonMode(response.status, detail)) {
              this.log("warn", "ai.request.compatibility_retry", { jobId, taskType: options.taskType, attempt: httpAttempt, reason: "JSON mode unsupported" });
              useJsonMode = false;
              attempt -= 1;
              continue;
            }
            throw new Error(providerError(response.status, detail));
          }
          let raw: string;
          if (useStreaming && /text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
            const onActivity = () => { chunkCount += 1; attemptChunkCount += 1; resetIdleTimeout(); };
            const onContent = (delta: string) => {
              if (!attemptFirstContentAt) {
                attemptFirstContentAt = new Date().toISOString();
                this.log("info", "ai.request.first_content", {
                  jobId, taskType: options.taskType, attempt: httpAttempt, ttftMs: Date.now() - attemptStartedAt,
                });
              }
              if (!firstTokenAt) {
                firstTokenAt = attemptFirstContentAt;
                persistLiveTelemetry();
              }
              contentExtractor?.push(delta);
            };
            const streamed = useResponses
              ? await readResponsesStream(response, onActivity, onContent)
              : await readChatCompletionStream(response, onActivity, onContent);
            raw = streamed.content;
            usage = streamed.usage;
          } else {
            const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } };
            usage = parseProviderUsage(body);
            raw = useResponses ? parseResponsesOutput(body) : body.choices?.[0]?.message?.content ?? "";
          }
          if (!raw) throw new Error("模型没有返回内容");
          const parsed = options.schema.parse(JSON.parse(stripCodeFence(raw)));
          this.database.finishAiJob(jobId, JSON.stringify(parsed), undefined, telemetry());
          this.log("info", "ai.request.attempt_completed", {
            jobId, taskType: options.taskType, attempt: httpAttempt, durationMs: Date.now() - attemptStartedAt,
            chunkCount: attemptChunkCount, totalChunkCount: chunkCount, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          });
          this.activeRequests.delete(jobId);
          return parsed;
        } catch (error) {
          if (controller.signal.aborted) {
            if (this.cancelledJobs.has(jobId)) throw new Error("任务已取消");
            if (timeoutError) throw new Error(timeoutError);
          }
          throw error;
        } finally {
          clearTimeout(totalTimeout);
          if (idleTimeout) clearTimeout(idleTimeout);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.log("error", "ai.request.attempt_failed", {
          jobId, taskType: options.taskType, attempt: attemptCount, durationMs: Date.now() - startedAt, error: lastError,
          attemptDurationMs: Date.now() - attemptStartedAt,
        });
        if (lastError === "任务已取消") {
          this.database.finishAiJob(jobId, "", lastError, { ...telemetry("已取消"), actualCost: 0 });
          this.cancelledJobs.delete(jobId);
          this.activeRequests.delete(jobId);
          throw new Error(lastError);
        }
        if (lastError.startsWith("模型请求超时")) {
          this.database.finishAiJob(jobId, "", lastError, { ...telemetry("失败"), actualCost: 0 });
          this.activeRequests.delete(jobId);
          throw new Error(lastError);
        }
        if (lastError.startsWith("模型接口返回")) {
          this.database.finishAiJob(jobId, "", lastError, { ...telemetry("失败"), actualCost: 0 });
          this.activeRequests.delete(jobId);
          throw new Error(lastError);
        }
        if (lastError.startsWith("模型服务暂时不可用") && attempt < 2) {
          try {
            const remainingMs = Math.max(0, deadline - Date.now());
            const delayMs = Math.min(1000 * 2 ** attempt, remainingMs);
            this.log("warn", "ai.request.retry_scheduled", { jobId, taskType: options.taskType, attempt: attemptCount, nextAttempt: attemptCount + 1, delayMs, reason: lastError });
            await abortableDelay(delayMs, controller.signal);
          } catch {
            lastError = "任务已取消";
            this.database.finishAiJob(jobId, "", lastError, { ...telemetry("已取消"), actualCost: 0 });
            this.cancelledJobs.delete(jobId);
            this.activeRequests.delete(jobId);
            throw new Error(lastError);
          }
        }
        if (!lastError.startsWith("模型服务暂时不可用") && attempt < 2)
          this.log("warn", "ai.request.retry_scheduled", { jobId, taskType: options.taskType, attempt: attemptCount, nextAttempt: attemptCount + 1, delayMs: 0, reason: lastError });
        repairInstruction = `\n上一次输出校验失败：${lastError}。请修复结构并重新输出完整 JSON。`;
      }
    }
    this.database.finishAiJob(jobId, "", lastError, { ...telemetry("失败"), actualCost: 0 });
    this.activeRequests.delete(jobId);
    throw new Error(lastError);
  }

  async deconstruct(book: ResearchBook, chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>): Promise<{ insight: InsightPack; analyses: ResearchAnalysisRecord[] }> {
    if (!book.cloudConsent || !this.getApiKey()) return this.localInsight(book, chapters);
    const partials: Array<{ fromChapter: number; toChapter: number; insight: InsightResult }> = [];
    const analyses: ResearchAnalysisRecord[] = [];
    for (let start = 0; start < chapters.length; start += DECONSTRUCT_BATCH_SIZE) {
      const batch = chapters.slice(start, start + DECONSTRUCT_BATCH_SIZE);
      const sanitizedBatch = sanitizeResearchBatch(batch);
      const fromChapter = batch[0].ordinal;
      const toChapter = batch.at(-1)!.ordinal;
      let result: z.infer<typeof BatchAnalysisSchema>;
      try {
        result = await this.runJson({
          projectId: null,
          taskType: "deconstruct-batch",
          inputSummary: `${book.title} 第${fromChapter}-${toChapter}章脱敏分析`,
          system: `你是中国商业网文结构研究员。只能抽象情节机制和读者体验，不得复述句子、输出作品专名、角色名、独特设定名或模仿文风。\n${compileDeconstructionFramework(book.genre)}`,
          user: `题材：${book.genre}\n章节范围：${fromChapter}-${toChapter}\n输出 chapters 数组，逐章给出 ordinal、finding、conflict、hook、stateChange、risk、enteringExpectation、protagonistGoal、coreInterest、emotionalPayoff、payoffImpact、nextExpectation；没有证据时写“证据不足”，不得臆测。再输出 synthesis，字段为 audienceNeed、openingPromise、conflictEngine、emotionalRhythm、retentionDevices、longFormEngine、marketGap、risks、confidence。所有结论必须抽象，不得引用原句或专名。\n` +
            batch.map((chapter, index) => `【章节${chapter.ordinal}】\n${sanitizedBatch[index]}`).join("\n"),
          schema: BatchAnalysisSchema,
          longTask: true,
          stream: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`第${fromChapter}-${toChapter}章拆解失败：${message}。已完成批次会保留，重新拆书可从缓存继续。`);
      }
      partials.push({ fromChapter, toChapter, insight: result.synthesis });
      for (const finding of result.chapters) analyses.push({ id: randomUUID(), bookId: book.id, layer: "章节", fromChapter: finding.ordinal, toChapter: finding.ordinal, findings: `进入期待：${finding.enteringExpectation}\n主角目标：${finding.protagonistGoal}\n核心利益：${finding.coreInterest}\n结构：${finding.finding}\n冲突：${finding.conflict}\n情绪回报：${finding.emotionalPayoff}\n回报影响：${finding.payoffImpact}\n下一期待：${finding.nextExpectation}\n章末钩子：${finding.hook}\n状态变化：${finding.stateChange}\n风险：${finding.risk}`, evidenceChapters: [finding.ordinal], confidence: result.synthesis.confidence, createdAt: now() });
    }

    const stages: Array<{ fromChapter: number; toChapter: number; insight: InsightResult }> = [];
    for (let start = 0; start < partials.length; start += 2) {
      const group = partials.slice(start, start + 2);
      const fromChapter = group[0].fromChapter;
      const toChapter = group.at(-1)!.toChapter;
      const stage = group.length === 1 ? group[0].insight : await this.runJson({
        projectId: null,
        taskType: "deconstruct-stage",
        inputSummary: `${book.title} 第${fromChapter}-${toChapter}章阶段汇总`,
        system: "你是网络小说开篇阶段研究员。输入只有两个脱敏小批次结论，合并重复规律并保留阶段变化，不得还原作品内容。",
        user: `题材：${book.genre}\n范围：第${fromChapter}-${toChapter}章\n请汇总为同字段 JSON：\n${JSON.stringify(group.map((item) => item.insight))}`,
        schema: InsightSchema,
        longTask: true,
        stream: true,
      });
      stages.push({ fromChapter, toChapter, insight: stage });
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "十章阶段", fromChapter, toChapter, findings: insightText(stage), evidenceChapters: chapters.filter((chapter) => chapter.ordinal >= fromChapter && chapter.ordinal <= toChapter).map((chapter) => chapter.ordinal), confidence: stage.confidence, createdAt: now() });
    }
    const volumes: InsightResult[] = [];
    for (let start = 0; start < stages.length; start += 10) {
      const group = stages.slice(start, start + 10);
      const fromChapter = group[0].fromChapter;
      const toChapter = group.at(-1)!.toChapter;
      const volume = group.length === 1 ? group[0].insight : await this.runJson({
        projectId: null, taskType: "deconstruct-volume", inputSummary: `${book.title} 第${fromChapter}-${toChapter}章分卷汇总`,
        system: "你是长篇小说分卷结构研究员。输入只有脱敏十章阶段结论，输出同字段抽象汇总，不得还原作品内容。",
        user: `题材：${book.genre}\n范围：第${fromChapter}-${toChapter}章\n${JSON.stringify(group.map((item) => item.insight))}`, schema: InsightSchema,
        longTask: true,
        stream: true,
      });
      volumes.push(volume);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "分卷", fromChapter, toChapter, findings: insightText(volume), evidenceChapters: chapters.slice(fromChapter - 1, toChapter).map((chapter) => chapter.ordinal), confidence: volume.confidence, createdAt: now() });
    }
    const aggregate = volumes.length === 1 ? volumes[0] : await this.runJson({
      projectId: null,
      taskType: "deconstruct-aggregate",
      inputSummary: `${book.title} 全书抽象汇总（${volumes.length}卷）`,
      system: "你是网络小说市场分析师。输入只包含抽象拆解结论。合并重复规律，保留阶段变化和风险，禁止推测或还原原作专名与具体表达。",
      user: `题材：${book.genre}\n请汇总为同字段 JSON：\n${JSON.stringify(volumes)}`,
      schema: InsightSchema,
      longTask: true,
      stream: true,
    });
    analyses.push({ id: randomUUID(), bookId: book.id, layer: "全书", fromChapter: 1, toChapter: chapters.length, findings: insightText(aggregate), evidenceChapters: chapters.map((chapter) => chapter.ordinal), confidence: aggregate.confidence, createdAt: now() });
    return { insight: {
      id: randomUUID(), name: `${book.title} · 脱敏结构洞察`, genre: book.genre,
      ...aggregate, evidenceCount: chapters.length, createdAt: now(),
    }, analyses };
  }

  private localInsight(book: ResearchBook, chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>): { insight: InsightPack; analyses: ResearchAnalysisRecord[] } {
    const average = Math.round(chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) / Math.max(chapters.length, 1));
    const hookRate = Math.round(chapters.filter((chapter) => /[？?!！…]$/.test(chapter.content.trim())).length / Math.max(chapters.length, 1) * 100);
    const dialogueRate = Math.round(chapters.reduce((sum, chapter) => sum + (chapter.content.match(/[“"]/g)?.length ?? 0), 0) / Math.max(book.wordCount, 1) * 1000);
    const insight: InsightPack = {
      id: randomUUID(), name: `${book.title} · 本地结构统计`, genre: book.genre,
      audienceNeed: "未配置云模型，当前仅建立可复核的篇幅与节奏基线。",
      openingPromise: `样本共 ${chapters.length} 章，平均每章约 ${average} 字；需人工补充开篇承诺判断。`,
      conflictEngine: "请在配置模型后运行语义拆解，或根据章节证据人工填写冲突发动机。",
      emotionalRhythm: `章末强标点比例约 ${hookRate}%，对话标记密度约 ${dialogueRate}‰。`,
      retentionDevices: "已完成章节长度、章末形式和对话密度统计，尚未作语义归因。",
      longFormEngine: "待人工确认主线资源、关系变化和阶段升级是否可持续。",
      marketGap: "单本样本不足以形成市场空位结论，应与榜单快照和其他样本交叉验证。",
      risks: "此洞察包由本地规则生成，不包含语义级判断，不应直接作为立项依据。",
      evidenceCount: chapters.length, confidence: "低", createdAt: now(),
    };
    const analyses: ResearchAnalysisRecord[] = chapters.map((chapter) => ({ id: randomUUID(), bookId: book.id, layer: "章节", fromChapter: chapter.ordinal, toChapter: chapter.ordinal, findings: `章节字数：${chapter.wordCount}\n对话标记：${chapter.content.match(/[“”]/g)?.length ?? 0}\n章末形式：${chapter.content.trim().slice(-1) || "无"}`, evidenceChapters: [chapter.ordinal], confidence: "低", createdAt: now() }));
    for (let start = 0; start < chapters.length; start += 10) {
      const group = chapters.slice(start, start + 10);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "十章阶段", fromChapter: group[0].ordinal, toChapter: group.at(-1)!.ordinal, findings: `平均章长 ${Math.round(group.reduce((sum, chapter) => sum + chapter.wordCount, 0) / group.length)} 字；仅本地统计，待人工补充语义判断。`, evidenceChapters: group.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    }
    for (let start = 0; start < chapters.length; start += 100) {
      const group = chapters.slice(start, start + 100);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "分卷", fromChapter: group[0].ordinal, toChapter: group.at(-1)!.ordinal, findings: `本段共 ${group.length} 章、${group.reduce((sum, chapter) => sum + chapter.wordCount, 0)} 字；未启用云端语义拆解。`, evidenceChapters: group.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    }
    analyses.push({ id: randomUUID(), bookId: book.id, layer: "全书", fromChapter: 1, toChapter: chapters.length, findings: insightText(insight), evidenceChapters: chapters.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    return { insight, analyses };
  }

  async generateConcepts(project: ProjectDetail, insights: InsightPack[], marketOpportunities: MarketOpportunity[] = []): Promise<ConceptCandidate[]> {
    if (!insights.length) throw new Error("请先为项目关联至少一个脱敏洞察包");
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "generate-concepts",
      inputSummary: `${project.summary.title} 三案立项`,
      system: "你是原创中国商业网文策划。你只能使用输入中的抽象市场洞察，不得假定、复原或模仿任何样本作品。三个方案必须在主角身份、核心矛盾和长篇发动机上明显不同，并能持续制造逐级升级的期待与回报。",
      user: `项目题材：${project.summary.genre}\n目标字数：${project.summary.targetWords}\n商业知识：${compileCommercialGuidance(project.summary.genre, 1, { currentWords: project.summary.currentWords, targetWords: project.summary.targetWords, fanqieCategoryKey: project.contract.fanqieCategoryKey })}\n番茄市场机会（仅作证据，不得机械追热点）：${JSON.stringify(marketOpportunities)}\n脱敏洞察：${JSON.stringify(insights)}\n输出 candidates 数组，每项包含 title、oneLinePitch、audience、coreConflict、differentiation、longFormCapacity、originalityRisk。longFormCapacity 必须说明冲突、资源/关系/地图或规则如何至少三轮升级；每个方案要说明如何借鉴市场机会的读者需求但避开同质化。`,
      schema: CandidateSchema,
    });
    return result.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  }

  async generateBookConcepts(input: BookConceptInput): Promise<BookConceptCandidate[]> {
    const plugin = GENRE_PLUGINS[input.genre];
    const result = await this.runJson({
      projectId: null,
      taskType: "generate-book-concepts",
      inputSummary: `${input.genre} 从零开书三案`,
      system: "你是面向番茄小说的原创商业网文总编。为没有书名和完整创意的作者提供三套可立项方案。三案必须在主角身份、核心矛盾、关系结构和长篇发动机上显著不同；书名应清楚传达题材、身份反差或核心看点，禁止照搬已有作品、热榜书名或独特设定。结局必须明确主线如何收束，不能只写开放式占位语。",
      user: `频道题材：${input.genre}\n目标字数：${input.targetWords}\n更新节奏：${input.updateCadence}\n作者灵感（可为空）：${input.seed.trim() || "无，请从题材规则独立原创"}\n题材子类型（genreSubtype 必须从中选择）：${plugin.subtypes.map((item) => item.name).join("、")}\n核心幻想：${plugin.coreFantasies.join("；")}\n目标读者：${plugin.targetAudience.join("；")}\n题材禁忌：${plugin.tabooBoundaries.join("；")}\n商业规则：${compileCommercialGuidance(input.genre, 1, { currentWords: 0, targetWords: input.targetWords })}\n输出 candidates，严格三项。每项包含 title、premise、genreSubtype、protagonistDesire、readerPromise、coreEmotion、ending、immutableRules、prohibitedPatterns、audience、commercialHook、longFormEngine。长篇发动机需说明至少三轮冲突与回报升级；所有方案是原创草案，不引用或模仿具体作品。`,
      schema: BookConceptSchema,
      longTask: true,
      stream: true,
    });
    return result.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  }

  async generatePlanning(
    project: ProjectDetail,
    input: PlanningGenerationInput,
    onChapterBatch?: (batch: PlanningGenerationResult) => void | Promise<void>,
  ): Promise<PlanningGenerationResult> {
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    const startChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const shared = `项目：${project.summary.title}\n题材：${project.summary.genre}\n目标字数：${project.summary.targetWords}\n创作契约：${JSON.stringify(project.contract)}\n商业规则：${compileCommercialGuidance(project.summary.genre, startChapter, { currentWords: project.summary.currentWords, targetWords: project.summary.targetWords, subtype: project.contract.genreSubtype, fanqieCategoryKey: project.contract.fanqieCategoryKey })}\n已批准规划：${JSON.stringify(project.plans.filter((plan) => plan.status === "已批准"))}\n已有章节：${JSON.stringify(project.chapters.slice(-20).map((chapter) => ({ number: chapter.number, title: chapter.title, outline: chapter.outline, endingExpectation: chapter.endingExpectation })))}`;
    if (input.mode === "全书结构") {
      const result = await this.runJson({
        projectId: project.summary.id, taskType: "generate-story-structure", inputSummary: `${project.summary.title} 六阶段与分卷`,
        system: "你是中国商业网文总编。根据已审批契约规划六阶段和分卷，只细化结构，不写正文。阶段必须依次覆盖开篇、追读、扩张、中期、高潮、收束；总字数接近项目目标，冲突和回报逐层升级，终局必须兑现契约。",
        user: `${shared}\n输出 stages（必须6项）和 volumes（3至6项）。每项包含 title、goal、conflict、outcome、targetWords；stage 额外包含 startChapter。不得照抄商业规则文字。`,
        schema: StructurePlanningSchema,
        longTask: true,
        stream: true,
      });
      return {
        startChapter: 1,
        chapters: [],
        plans: [
          ...result.stages.map((item, index) => ({ id: randomUUID(), kind: "宏观阶段" as const, title: item.title, ordinal: item.startChapter || index + 1, goal: item.goal, conflict: item.conflict, outcome: item.outcome, targetWords: item.targetWords, status: "草稿" as const, parentId: null })),
          ...result.volumes.map((item, index) => ({ id: randomUUID(), kind: "分卷" as const, title: item.title, ordinal: index + 1, goal: item.goal, conflict: item.conflict, outcome: item.outcome, targetWords: item.targetWords, status: "草稿" as const, parentId: null })),
        ],
      };
    }
    const count = input.chapterCount ?? 10;
    const batches: PlanningGenerationResult[] = [];
    for (let offset = 0; offset < count; offset += CHAPTER_PLANNING_BATCH_SIZE) {
      const batchStart = startChapter + offset;
      const batchCount = Math.min(CHAPTER_PLANNING_BATCH_SIZE, count - offset);
      const priorChapters = batches.flatMap((batch) => batch.chapters).map((chapter) => ({
        number: chapter.number,
        title: chapter.title,
        outline: chapter.outline,
        endingExpectation: chapter.endingExpectation,
      }));
      const result = await this.runJson({
        projectId: project.summary.id, taskType: "generate-chapter-plans", inputSummary: `${project.summary.title} 第${batchStart}-${batchStart + batchCount - 1}章章纲`,
        system: "你是中国商业网文连载编辑。生成可直接执行的连续章纲，不写正文。每章必须承接上一章状态，包含目标、阻碍、主动行动、结果影响和自然续读问题；回报类型要变化，禁止连续重复打脸、误会或突发事故。",
        user: `${shared}\n本次任务前面刚生成且必须承接的章纲：${JSON.stringify(priorChapters)}\n从第${batchStart}章开始，严格输出${batchCount}个 chapters，并给出整个批次的 batchGoal、batchConflict、batchOutcome。每章填写 title、goal、conflict、outcome、chapterPromise、expectedPayoff、crisis、endingExpectation、payoffOffset、isKeyChapter。payoffOffset 表示该章结尾期待预计在几章后兑现。`,
        schema: ChapterPlanningSchema,
        longTask: true,
        stream: true,
      });
      if (result.chapters.length !== batchCount) throw new Error(`模型返回 ${result.chapters.length} 章，预期 ${batchCount} 章，请重试`);
      const roughPlan = { id: randomUUID(), kind: "粗纲" as const, title: `第${batchStart}–${batchStart + batchCount - 1}章滚动粗纲`, ordinal: batchStart, goal: result.batchGoal, conflict: result.batchConflict, outcome: result.batchOutcome, targetWords: batchCount * 2300, status: "草稿" as const, parentId: null };
      const chapters = result.chapters.map((item, index) => {
        const number = batchStart + index;
        return { id: randomUUID(), number, title: item.title, outline: `目标：${item.goal}；冲突：${item.conflict}；结果：${item.outcome}`, content: "", wordCount: 0, status: "章纲" as const, batchMode: item.isKeyChapter ? "逐章" as const : "五章批次" as const, isKeyChapter: item.isKeyChapter, chapterPromise: item.chapterPromise, expectedPayoff: item.expectedPayoff, crisis: item.crisis, endingExpectation: item.endingExpectation, expectationTargetChapter: number + item.payoffOffset, revision: 0, updatedAt: now() };
      });
      const detailPlans = result.chapters.map((item, index) => ({ id: randomUUID(), kind: "细纲" as const, title: `第${batchStart + index}章 ${item.title}`, ordinal: batchStart + index, goal: item.goal, conflict: item.conflict, outcome: item.outcome, targetWords: 2300, status: "草稿" as const, parentId: roughPlan.id }));
      const scenePlans = result.chapters.flatMap((item, index) => {
        const number = batchStart + index;
        const parentId = detailPlans[index].id;
        return [
          { id: randomUUID(), kind: "场景卡" as const, title: `第${number}章·入场与压力`, ordinal: number * 10 + 1, goal: `让主角明确并主动推进：${item.goal}`, conflict: item.crisis, outcome: "落下本章必须处理的具体压力与第一步行动", targetWords: 700, status: "草稿" as const, parentId },
          { id: randomUUID(), kind: "场景卡" as const, title: `第${number}章·对抗与选择`, ordinal: number * 10 + 2, goal: "让行动遭遇有效反作用，并迫使主角作出有代价的选择", conflict: item.conflict, outcome: item.outcome, targetWords: 900, status: "草稿" as const, parentId },
          { id: randomUUID(), kind: "场景卡" as const, title: `第${number}章·回报与转向`, ordinal: number * 10 + 3, goal: `兑现或推进：${item.expectedPayoff}`, conflict: "回报必须改变人物、关系、资源或局势，不能停在口头胜利", outcome: `${item.outcome}；章末转向：${item.endingExpectation}`, targetWords: 700, status: "草稿" as const, parentId },
        ];
      });
      const batch = { startChapter: batchStart, plans: [roughPlan, ...detailPlans, ...scenePlans], chapters };
      await onChapterBatch?.(batch);
      batches.push(batch);
    }
    return {
      startChapter,
      plans: batches.flatMap((batch) => batch.plans),
      chapters: batches.flatMap((batch) => batch.chapters),
    };
  }

  async suggestAestheticProfile(
    project: ProjectDetail,
  ): Promise<AestheticProfileSuggestion> {
    const approvedPlans = project.plans
      .filter((plan) => plan.status === "已批准")
      .slice(-30)
      .map((plan) => ({
        kind: plan.kind,
        title: plan.title,
        goal: plan.goal,
        conflict: plan.conflict,
        outcome: plan.outcome,
      }));
    const manuscriptSamples = project.chapters
      .filter((chapter) => ["已定稿", "待发布", "已发布"].includes(chapter.status) && chapter.content.trim())
      .slice(-6)
      .map((chapter) => ({
        chapter: chapter.number,
        title: chapter.title,
        outline: chapter.outline,
        content: chapter.content.slice(0, 2800),
      }));
    return this.runJson({
      projectId: project.summary.id,
      taskType: "suggest-aesthetic-profile",
      inputSummary: "生成本书专属审美优化提案",
      system: [
        "你是中文长篇商业小说的审美总编。为当前这一部作品建立专属、可执行、内部一致的审美档案。",
        "依据作品契约、题材、规划和本书自己的定稿样本判断，不套用全局风格模板，不模仿研究样本或特定作者。",
        "优化不是一律升温、降温或增加辞藻。先识别这本书真正需要的叙事距离、情绪温度与表达质地，再明确可执行手法和避用模式。",
        "现有正文只用于诊断本书已经形成的倾向；有价值的特征可以保留，机械、单调或与读者承诺冲突的特征应校正。",
        "所有字段必须具体到写作时能执行，避免‘细腻生动、增强代入感’等空泛表述。",
      ].join("\n"),
      user: `作品：${project.summary.title}\n题材：${project.summary.genre}\n创作契约：${JSON.stringify(project.contract)}\n已批准规划：${JSON.stringify(approvedPlans)}\n本书定稿样本：${manuscriptSamples.length ? JSON.stringify(manuscriptSamples) : "暂无；请依据契约和规划保守提案"}\n输出 profile、diagnosis 和 rationale。diagnosis 说明当前审美倾向及主要风险；rationale 给出本方案最关键的取舍依据。`,
      schema: AestheticProfileSuggestionSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "medium",
    });
  }

  async draftChapter(
    projectId: string,
    chapter: Chapter,
    context: ContextPackage,
    retryContext?: string,
    onStream?: (event: { type: "attempt-start"; attempt: number } | { type: "delta"; attempt: number; delta: string } | { type: "complete"; attempt: number }) => void,
  ): Promise<Chapter> {
    let currentAttempt = 0;
    const result = await this.runJson({
      projectId,
      taskType: "draft-chapter",
      inputSummary: `第${chapter.number}章 ${chapter.title || "未命名"}`,
      system: "你是中文长篇商业网文协作写作者。严格遵守已审批创作契约、项目审美、章纲和事实账本，不自行改纲，不引入上下文之外的关键设定，不泄露角色尚未知晓的信息。商业知识用于明确目标、压力、行动、回报影响和续读问题，不能凌驾于人物逻辑、契约或本书审美。项目审美是本书唯一的文风基准：冷峻、克制、均衡、热烈都可能是正确答案，不得默认采用清冷克制风，也不得把任一温度写成所有作品共用的模板。",
      user: `本章章纲：${chapter.outline}\n上下文包：${JSON.stringify(contextForModel(context))}\n请输出 title 和 content。正文目标 1800-2600 个非空白字符，完整结果必须落在 1600-3000 个非空白字符内。完成本章目标，使事件产生可观察的状态变化；若本章承担回报，展示其实际影响。把上下文中的叙事距离、情绪温度、文字质地、对话风格、情绪表达和标志手法落实到具体句段；不要只在措辞上贴风格标签。遵守审美避用项。留下来自未完成行动、新问题或局势变化的自然续读动力，禁止无因强行反转。`,
      schema: ChapterDraftSchema,
      retryContext,
      timeoutMs: 300_000,
      stream: true,
      onAttempt: (attempt) => { currentAttempt = attempt; onStream?.({ type: "attempt-start", attempt }); },
      onDelta: (delta, attempt) => onStream?.({ type: "delta", attempt, delta }),
    });
    onStream?.({ type: "complete", attempt: currentAttempt });
    return { ...chapter, title: result.title, content: result.content, status: "待质检", updatedAt: now() };
  }

  async extractChapterFacts(project: ProjectDetail, chapter: Chapter): Promise<LedgerFact[]> {
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "extract-chapter-facts",
      inputSummary: `第${chapter.number}章状态候选`,
      system: "你是长篇小说状态记录员。只提取本章正文明确发生且会影响后续连续性的持久状态变化。不得推测心理、补全设定或把临时动作当成长期事实；无可靠变化时返回空数组。",
      user: `题材：${project.summary.genre}\n章节：第${chapter.number}章 ${chapter.title}\n章纲：${chapter.outline}\n已确认事实：${JSON.stringify(project.facts.filter((fact) => fact.confidence === "已确认").slice(0, 120))}\n正文：\n${chapter.content.slice(0, 16000)}\n输出 facts；每项包含 kind、subject、predicate、value、knowledgeScope、evidence。evidence 必须是正文中的连续短句。秘密必须说明当前知情角色，公开事实的 knowledgeScope 写“公开”。`,
      schema: FactCandidateSchema,
    });
    const compactContent = chapter.content.replace(/\s+/g, "");
    const activeFacts = project.facts
      .filter((fact) =>
        fact.confidence === "已确认" &&
        fact.validFromChapter < chapter.number &&
        (fact.validToChapter === null || fact.validToChapter >= chapter.number)
      )
      .sort((left, right) => right.validFromChapter - left.validFromChapter);
    return result.facts
      .filter((fact) => compactContent.includes(fact.evidence.replace(/\s+/g, "")))
      .map((fact) => {
        const subject = fact.subject.trim();
        const predicate = fact.predicate.trim();
        const value = fact.value.trim();
        const replaced = activeFacts.find((current) =>
          current.kind === fact.kind &&
          current.subject === subject &&
          current.predicate === predicate &&
          (current.value !== value || current.knowledgeScope !== (fact.knowledgeScope.trim() || "公开"))
        );
        const knowledgeScope = fact.knowledgeScope.trim() || "公开";
        const previousNumber = replaced && fact.kind === "资源" ? parseStoryNumber(replaced.value) : null;
        const nextNumber = fact.kind === "资源" ? parseStoryNumber(value) : null;
        const numericDelta = previousNumber !== null && nextNumber !== null
          ? nextNumber - previousNumber
          : null;
        const changeType = numericDelta !== null
          ? "数值变化" as const
          : replaced?.value === value && replaced.knowledgeScope !== knowledgeScope
            ? "知情范围变更" as const
            : replaced
              ? "状态替换" as const
              : "新增" as const;
        return {
          id: randomUUID(),
          kind: fact.kind,
          genreDimension: replaced ? `定稿${changeType}候选` : "定稿自动候选",
          subject,
          predicate,
          value,
          validFromChapter: chapter.number,
          validToChapter: null,
          evidenceChapter: chapter.number,
          confidence: "待确认" as const,
          knowledgeScope,
          replacesFactId: replaced?.id ?? null,
          changeType,
          numericDelta,
          updatedAt: now(),
        };
      });
  }

  async reviewChapter(project: ProjectDetail, chapter: Chapter, context: ContextPackage): Promise<QualityIssue[]> {
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "quality-review",
      inputSummary: `第${chapter.number}章语义质检`,
      system: [
        "你是中文长篇网络小说的严格审校员。只报告能够引用本章证据的问题，不做文风偏好式改写。",
        "检查：章纲兑现、人物动机、事件因果、设定与状态一致性、角色知识边界、重复信息、节奏停滞、读者承诺、具体压力、主动行动、情绪回报、回报实际影响与章末推动力。",
        `项目审美设定：${compileAestheticGuidance(project.contract?.aestheticProfile)}`,
        "审美质检必须以本项目设定为标准，不得把某一种叙事温度或人物表达方式当成通用优点。只有正文与明确设定冲突，或在未设专项审美时出现严重影响可读性的失衡，才标记审美类问题并引用证据。",
        `题材专项检查：${GENRE_PLUGINS[project.summary.genre].qualityChecks.join("；")}。`,
        "只有正文明确违反已审批契约、事实账本或知识边界时才标记为硬性；可以优化但不构成矛盾的问题标记为警告或建议。",
        "evidence 必须是本章中的简短原文或明确的契约/事实条目。没有可验证问题时返回空数组。",
      ].join("\n"),
      user: `题材：${project.summary.genre}\n章节：第${chapter.number}章 ${chapter.title}\n章纲：${chapter.outline}\n上下文：${JSON.stringify(contextForModel(context))}\n正文：\n${chapter.content.slice(0, 16000)}\n输出 issues 数组，每项包含 severity、category、message、evidence。`,
      schema: QualityReviewSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "low",
    });
    const evidenceSource = [chapter.content, context.contract, context.volumeGoal, context.rollingOutline, context.relevantFacts, context.forbiddenKnowledge]
      .join("\n").replace(/\s+/g, "");
    return result.issues.map((issue) => {
      const evidence = issue.evidence.trim();
      const supported = evidence.length >= 4 && evidenceSource.includes(evidence.replace(/\s+/g, ""));
      return {
        ...issue,
        severity: issue.severity === "硬性" && !supported ? "警告" as const : issue.severity,
        evidence,
        id: randomUUID(),
        projectId: project.summary.id,
        chapterId: chapter.id,
        status: "待处理" as const,
        createdAt: now(),
      };
    });
  }

  async reviseChapter(
    project: ProjectDetail,
    chapter: Chapter,
    context: ContextPackage,
    issues: readonly QualityIssue[],
  ): Promise<Chapter> {
    const pending = issues.filter((issue) => issue.status === "待处理");
    if (!pending.length) throw new Error("本章没有可供 AI 修订的待处理问题");
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "revise-chapter-quality",
      inputSummary: `第${chapter.number}章按质检修订`,
      system: [
        "你是中文长篇商业网文修订编辑。只修复列出的质检问题，保留原章目标、事件结果、人物动机、叙事视角和未被指出的有效内容。",
        "不得改纲、增加上下文之外的关键设定、改变已确认事实或泄露角色未知秘密。硬性问题必须修复；警告和建议在不破坏原意时修复。",
        `项目审美设定：${compileAestheticGuidance(project.contract?.aestheticProfile)}`,
        "若问题涉及审美或叙事温度，只按本项目设定修复，不得擅自把人物改得更克制、更热烈、更幽默或更煽情。",
        "输出完整修订稿，不输出修改说明。title 没有必要时保持不变。",
      ].join("\n"),
      user: `题材：${project.summary.genre}\n章节：第${chapter.number}章 ${chapter.title}\n章纲：${chapter.outline}\n上下文：${JSON.stringify(contextForModel(context))}\n待处理问题：${JSON.stringify(pending.map((issue) => ({ severity: issue.severity, category: issue.category, message: issue.message, evidence: issue.evidence })))}\n原正文：\n${chapter.content.slice(0, 16000)}\n输出 title 和完整 content。`,
      schema: DraftSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "low",
    });
    if (result.content.trim() === chapter.content.trim())
      throw new Error("模型未产生有效修订，请检查质检问题后重试");
    return {
      ...chapter,
      title: result.title,
      content: result.content,
      status: "待质检",
      updatedAt: now(),
    };
  }
}
