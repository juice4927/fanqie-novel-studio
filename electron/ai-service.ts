import { randomUUID } from "node:crypto";
import { z } from "zod";
import { compileAestheticGuidance } from "../src/shared/aesthetic-profile";
import {
  compileCommercialGuidance,
  compileDeconstructionFramework,
  resolveStoryStage,
} from "../src/shared/commercial-knowledge";
import { contextForModel } from "../src/shared/context-diagnostics";
import { AppError, isAppError } from "../src/shared/error-codes";
import { NARRATIVE_GENRES } from "../src/shared/genre-composition";
import { GENRE_PLUGINS } from "../src/shared/genre-plugins";
import { chapterRevisionSnapshot, contractFieldText, planRevisionSnapshot } from "../src/shared/novel-revision";
import { PROMPT_VERSION } from "../src/shared/prompt-version";
import { parseStoryNumber } from "../src/shared/story-constraints";
import type {
  AestheticProfileSuggestion,
  BookConceptCandidate,
  BookConceptInput,
  BookConceptSkeleton,
  Chapter,
  ChapterDraftStreamEvent,
  ConceptCandidate,
  ContextPackage,
  InsightPack,
  LedgerFact,
  MarketOpportunity,
  NovelRevisionInput,
  NovelRevisionProposal,
  PlanningGenerationInput,
  PlanningGenerationResult,
  PlanningReviewInput,
  PlanningReviewResult,
  ProjectDetail,
  QualityIssue,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../src/shared/types";
import type {
  AiCachePolicy,
  GeneratedBookConcept,
  InsightResult,
  ResearchSanitizationContext,
  StartDraftChapterOptions,
  StartedAiTask,
} from "./ai-definitions";
import {
  AestheticProfileSuggestionSchema,
  abortableDelay,
  authorRequestsDebtAccounting,
  BatchAnalysisSchema,
  BookConceptSchema,
  BookConceptSkeletonSchema,
  CandidateSchema,
  CHAPTER_PLANNING_BATCH_SIZE,
  ChapterPlanningSchema,
  chapterDraftSchema,
  conceptDefaultMotifIssues,
  conceptDiversityIssues,
  createResearchSanitizationContext,
  DECONSTRUCT_BATCH_SIZE,
  DraftSchema,
  FactCandidateSchema,
  hashInput,
  InsightSchema,
  insightText,
  NovelRevisionSchema,
  PlanningReviewSchema,
  QualityReviewSchema,
  StructurePlanningSchema,
  sameJson,
  sanitizeResearchBatch,
  sanitizeResearchText,
  stripCodeFence,
} from "./ai-definitions";
import {
  aiEndpoint,
  inferProviderCapabilities,
  JsonStringFieldExtractor,
  normalizeProviderUrl,
  parseAnthropicOutput,
  parseProviderUsage,
  parseResponsesOutput,
  providerError,
  readAnthropicStream,
  readChatCompletionStream,
  readResponsesStream,
  rejectsJsonMode,
  rejectsResponsesApi,
  rejectsStreaming,
  usesResponsesApi,
} from "./ai-provider";
import { now, type WorkspaceDatabase } from "./database";
import { fetchPublicHttpResponse } from "./netguard";

export type { AiCachePolicy, ResearchSanitizationContext, StartDraftChapterOptions, StartedAiTask };
export {
  abortableDelay,
  authorRequestsDebtAccounting,
  conceptDefaultMotifIssues,
  conceptDiversityIssues,
  createResearchSanitizationContext,
  sanitizeResearchBatch,
  sanitizeResearchText,
};

export class AiService {
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly cancelledJobs = new Set<string>();

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly getApiKey: () => string,
    private readonly requestTimeoutMs = 120_000,
    private readonly longTaskTimeoutOverrideMs = 0,
    private readonly log: (
      level: "info" | "warn" | "error",
      event: string,
      data: Record<string, unknown>,
    ) => void = () => {},
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
    cachePolicy?: AiCachePolicy;
    onJobStarted?: (jobId: string) => void;
    onCacheHit?: () => void;
  }): Promise<T> {
    const settings = this.database.getAiSettings();
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("尚未配置 AI API 密钥");
    const protocol = settings.protocol ?? "openai-compatible";
    const providerBase = normalizeProviderUrl(settings.baseUrl);
    const provider = protocol === "anthropic-messages" ? `anthropic:${providerBase}` : providerBase;
    const inputHash = hashInput(`${options.system}\n${options.user}`);
    const cached =
      options.cachePolicy === "bypass"
        ? null
        : this.database.findAiJob(options.taskType, inputHash, PROMPT_VERSION, provider, settings.model);
    if (cached) {
      options.onCacheHit?.();
      return options.schema.parse(JSON.parse(cached));
    }
    const jobId = this.database.startAiJob(
      options.projectId,
      options.taskType,
      inputHash,
      PROMPT_VERSION,
      provider,
      settings.model,
      options.inputSummary,
      options.retryContext,
    );
    options.onJobStarted?.(jobId);
    const startedAt = Date.now();
    let lastError = "模型输出不符合结构要求";
    let repairInstruction = "";
    const useAnthropic = protocol === "anthropic-messages";
    let useResponses = !useAnthropic && usesResponsesApi(settings.model);
    let useJsonMode = !useAnthropic && !useResponses && inferProviderCapabilities(settings.baseUrl).jsonMode;
    let useStreaming = options.stream ?? false;
    let includeStreamUsage = useStreaming;
    let cumulativeUsage = { inputTokens: 0, outputTokens: 0 };
    let headersAt: string | null = null;
    let firstTokenAt: string | null = null;
    let chunkCount = 0;
    let attemptCount = 0;
    const controller = new AbortController();
    const configuredLongTimeoutMs = Math.min(15, Math.max(5, settings.longTaskTimeoutMinutes ?? 10)) * 60_000;
    const timeoutMs =
      options.timeoutMs ??
      (options.longTask ? this.longTaskTimeoutOverrideMs || configuredLongTimeoutMs : this.requestTimeoutMs);
    const deadline = startedAt + timeoutMs;
    const responseSchema = useResponses
      ? (() => {
          const { $schema: _metaSchema, ...schema } = z.toJSONSchema(options.schema) as Record<string, unknown>;
          return {
            type: "json_schema",
            name: options.taskType.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_response",
            strict: true,
            schema,
          };
        })()
      : null;
    this.activeRequests.set(jobId, controller);
    const telemetry = (status?: "失败" | "已取消") => ({
      ...cumulativeUsage,
      actualCost:
        (cumulativeUsage.inputTokens / 1_000_000) * settings.inputPricePerMillion +
        (cumulativeUsage.outputTokens / 1_000_000) * settings.outputPricePerMillion,
      durationMs: Date.now() - startedAt,
      status,
      headersAt,
      firstTokenAt,
      completedAt: new Date().toISOString(),
      chunkCount,
      attemptCount,
    });
    const persistLiveTelemetry = () =>
      this.database.updateAiJobTelemetry?.(jobId, { headersAt, firstTokenAt, chunkCount, attemptCount });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let attemptStartedAt = Date.now();
      let attemptUsage = { inputTokens: 0, outputTokens: 0 };
      try {
        const endpoint = aiEndpoint(settings.baseUrl, settings.model, useResponses, protocol);
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0)
          throw new AppError("PROVIDER_TIMEOUT", `模型请求超时：超过总时长上限（${Math.ceil(timeoutMs / 1000)} 秒）`);
        let timeoutError = "";
        const totalTimeout = setTimeout(() => {
          timeoutError = `模型请求超时：超过总时长上限（${Math.ceil(timeoutMs / 1000)} 秒）`;
          controller.abort();
        }, remainingMs);
        let idleTimeout: ReturnType<typeof setTimeout> | null = null;
        const resetIdleTimeout = () => {
          if (!useStreaming) return;
          if (idleTimeout) clearTimeout(idleTimeout);
          const idleMs = Math.min(options.longTask ? 180_000 : 90_000, remainingMs);
          idleTimeout = setTimeout(() => {
            timeoutError = `模型请求超时：流式响应连续 ${Math.ceil(idleMs / 1000)} 秒无数据`;
            controller.abort();
          }, idleMs);
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
        this.log("info", "ai.request.attempt_started", {
          jobId,
          taskType: options.taskType,
          attempt: httpAttempt,
          endpoint,
          streaming: useStreaming,
        });
        try {
          const response = await fetchPublicHttpResponse(
            endpoint,
            {
              method: "POST",
              signal: controller.signal,
              headers: useAnthropic
                ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
                : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(
                useAnthropic
                  ? {
                      model: settings.model,
                      max_tokens: 8192,
                      temperature: options.taskType === "draft-chapter" ? 0.85 : 0.35,
                      ...(useStreaming ? { stream: true } : {}),
                      system: `${options.system}\n只返回合法 JSON，不使用 Markdown。`,
                      messages: [{ role: "user", content: `${options.user}${repairInstruction}` }],
                    }
                  : useResponses
                    ? {
                        model: settings.model,
                        reasoning: { effort: options.reasoningEffort ?? "medium" },
                        ...(useStreaming ? { stream: true } : {}),
                        instructions: `${options.system}\n只返回合法 JSON，不使用 Markdown。`,
                        input: `${options.user}${repairInstruction}`,
                        text: { format: responseSchema },
                      }
                    : {
                        model: settings.model,
                        temperature: options.taskType === "draft-chapter" ? 0.85 : 0.35,
                        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
                        ...(useStreaming ? { stream: true } : {}),
                        ...(useStreaming && includeStreamUsage ? { stream_options: { include_usage: true } } : {}),
                        messages: [
                          { role: "system", content: `${options.system}\n只返回合法 JSON，不使用 Markdown。` },
                          { role: "user", content: `${options.user}${repairInstruction}` },
                        ],
                      },
              ),
            },
            { allowCrossOriginRedirect: false },
          );
          const currentHeadersAt = new Date().toISOString();
          headersAt ??= currentHeadersAt;
          persistLiveTelemetry();
          this.log("info", "ai.request.headers_received", {
            jobId,
            taskType: options.taskType,
            attempt: httpAttempt,
            status: response.status,
            headersLatencyMs: Date.now() - attemptStartedAt,
          });
          if (!response.ok) {
            const detail = (await response.text()).slice(0, 300);
            if (useResponses && rejectsResponsesApi(response.status, detail)) {
              this.log("warn", "ai.request.compatibility_retry", {
                jobId,
                taskType: options.taskType,
                attempt: httpAttempt,
                reason: "Responses API unsupported",
              });
              useResponses = false;
              useJsonMode = inferProviderCapabilities(settings.baseUrl).jsonMode;
              attempt -= 1;
              continue;
            }
            if (
              !useResponses &&
              includeStreamUsage &&
              response.status === 400 &&
              /stream.?options|include.?usage/i.test(detail)
            ) {
              this.log("warn", "ai.request.compatibility_retry", {
                jobId,
                taskType: options.taskType,
                attempt: httpAttempt,
                reason: "stream_options unsupported",
              });
              includeStreamUsage = false;
              attempt -= 1;
              continue;
            }
            if (useStreaming && rejectsStreaming(response.status, detail)) {
              this.log("warn", "ai.request.compatibility_retry", {
                jobId,
                taskType: options.taskType,
                attempt: httpAttempt,
                reason: "streaming unsupported",
              });
              useStreaming = false;
              includeStreamUsage = false;
              attempt -= 1;
              continue;
            }
            if (useJsonMode && rejectsJsonMode(response.status, detail)) {
              this.log("warn", "ai.request.compatibility_retry", {
                jobId,
                taskType: options.taskType,
                attempt: httpAttempt,
                reason: "JSON mode unsupported",
              });
              useJsonMode = false;
              attempt -= 1;
              continue;
            }
            throw providerError(response.status, detail);
          }
          let raw: string;
          let anthropicStopReason: string | null = null;
          if (useStreaming && /text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
            const onActivity = () => {
              chunkCount += 1;
              attemptChunkCount += 1;
              resetIdleTimeout();
            };
            const onContent = (delta: string) => {
              if (!attemptFirstContentAt) {
                attemptFirstContentAt = new Date().toISOString();
                this.log("info", "ai.request.first_content", {
                  jobId,
                  taskType: options.taskType,
                  attempt: httpAttempt,
                  ttftMs: Date.now() - attemptStartedAt,
                });
              }
              if (!firstTokenAt) {
                firstTokenAt = attemptFirstContentAt;
                persistLiveTelemetry();
              }
              contentExtractor?.push(delta);
            };
            const streamed = useAnthropic
              ? await readAnthropicStream(response, onActivity, onContent)
              : useResponses
                ? await readResponsesStream(response, onActivity, onContent)
                : await readChatCompletionStream(response, onActivity, onContent);
            if (useAnthropic && "stopReason" in streamed)
              anthropicStopReason = typeof streamed.stopReason === "string" ? streamed.stopReason : null;
            raw = streamed.content;
            attemptUsage = streamed.usage;
          } else {
            const body = (await response.json()) as {
              output_text?: string;
              output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
              content?: Array<{ type?: string; text?: string }>;
              choices?: Array<{ message?: { content?: string } }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                input_tokens?: number;
                output_tokens?: number;
              };
              stop_reason?: string;
            };
            attemptUsage = parseProviderUsage(body);
            if (useAnthropic) anthropicStopReason = body.stop_reason ?? null;
            raw = useAnthropic
              ? parseAnthropicOutput(body)
              : useResponses
                ? parseResponsesOutput(body)
                : (body.choices?.[0]?.message?.content ?? "");
          }
          cumulativeUsage = {
            inputTokens: cumulativeUsage.inputTokens + attemptUsage.inputTokens,
            outputTokens: cumulativeUsage.outputTokens + attemptUsage.outputTokens,
          };
          if (anthropicStopReason === "max_tokens")
            throw new Error("模型输出达到 Anthropic max_tokens 上限，结果已截断");
          if (!raw) throw new Error("模型没有返回内容");
          const parsed = options.schema.parse(JSON.parse(stripCodeFence(raw)));
          try {
            this.database.finishAiJob(jobId, JSON.stringify(parsed), undefined, telemetry());
          } catch (error) {
            this.activeRequests.delete(jobId);
            throw new Error(`AI 任务审计落库失败：${error instanceof Error ? error.message : String(error)}`);
          }
          this.log("info", "ai.request.attempt_completed", {
            jobId,
            taskType: options.taskType,
            attempt: httpAttempt,
            durationMs: Date.now() - attemptStartedAt,
            chunkCount: attemptChunkCount,
            totalChunkCount: chunkCount,
            inputTokens: attemptUsage.inputTokens,
            outputTokens: attemptUsage.outputTokens,
            attemptInputTokens: attemptUsage.inputTokens,
            attemptOutputTokens: attemptUsage.outputTokens,
            cumulativeInputTokens: cumulativeUsage.inputTokens,
            cumulativeOutputTokens: cumulativeUsage.outputTokens,
          });
          this.activeRequests.delete(jobId);
          this.cancelledJobs.delete(jobId);
          return parsed;
        } catch (error) {
          if (controller.signal.aborted) {
            if (this.cancelledJobs.has(jobId)) throw new AppError("TASK_CANCELLED", "任务已取消");
            if (timeoutError) throw new Error(timeoutError);
          }
          throw error;
        } finally {
          clearTimeout(totalTimeout);
          if (idleTimeout) clearTimeout(idleTimeout);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        const lastCode = isAppError(error) ? error.code : null;
        if (lastCode === "AUDIT_WRITE_FAILED" || lastError.startsWith("AI 任务审计落库失败")) throw error;
        this.log("error", "ai.request.attempt_failed", {
          jobId,
          taskType: options.taskType,
          attempt: attemptCount,
          durationMs: Date.now() - startedAt,
          error: lastError,
          attemptDurationMs: Date.now() - attemptStartedAt,
          attemptInputTokens: attemptUsage.inputTokens,
          attemptOutputTokens: attemptUsage.outputTokens,
          cumulativeInputTokens: cumulativeUsage.inputTokens,
          cumulativeOutputTokens: cumulativeUsage.outputTokens,
        });
        if (lastCode === "TASK_CANCELLED" || lastError === "任务已取消") {
          try {
            this.database.finishAiJob(jobId, "", lastError, telemetry("已取消"));
          } finally {
            this.cancelledJobs.delete(jobId);
            this.activeRequests.delete(jobId);
          }
          throw new Error(lastError);
        }
        if (lastCode === "PROVIDER_TIMEOUT" || lastError.startsWith("模型请求超时")) {
          try {
            this.database.finishAiJob(jobId, "", lastError, telemetry("失败"));
          } finally {
            this.activeRequests.delete(jobId);
            this.cancelledJobs.delete(jobId);
          }
          throw new Error(lastError);
        }
        if (lastCode === "PROVIDER_HTTP_ERROR" || lastError.startsWith("模型接口返回")) {
          try {
            this.database.finishAiJob(jobId, "", lastError, telemetry("失败"));
          } finally {
            this.activeRequests.delete(jobId);
            this.cancelledJobs.delete(jobId);
          }
          throw new Error(lastError);
        }
        if (lastCode === "PROVIDER_TRUNCATED" || lastError.startsWith("模型输出达到 Anthropic max_tokens")) {
          try {
            this.database.finishAiJob(jobId, "", lastError, telemetry("失败"));
          } finally {
            this.activeRequests.delete(jobId);
            this.cancelledJobs.delete(jobId);
          }
          throw new Error(lastError);
        }
        if ((lastCode === "PROVIDER_UNAVAILABLE" || lastError.startsWith("模型服务暂时不可用")) && attempt < 2) {
          try {
            const remainingMs = Math.max(0, deadline - Date.now());
            const delayMs = Math.min(1000 * 2 ** attempt, remainingMs);
            this.log("warn", "ai.request.retry_scheduled", {
              jobId,
              taskType: options.taskType,
              attempt: attemptCount,
              nextAttempt: attemptCount + 1,
              delayMs,
              reason: lastError,
            });
            await abortableDelay(delayMs, controller.signal);
          } catch {
            lastError = "任务已取消";
            try {
              this.database.finishAiJob(jobId, "", lastError, telemetry("已取消"));
            } finally {
              this.cancelledJobs.delete(jobId);
              this.activeRequests.delete(jobId);
            }
            throw new Error(lastError);
          }
        }
        if (!(lastCode === "PROVIDER_UNAVAILABLE" || lastError.startsWith("模型服务暂时不可用")) && attempt < 2)
          this.log("warn", "ai.request.retry_scheduled", {
            jobId,
            taskType: options.taskType,
            attempt: attemptCount,
            nextAttempt: attemptCount + 1,
            delayMs: 0,
            reason: lastError,
          });
        repairInstruction = `\n上一次输出校验失败：${lastError}。请修复结构并重新输出完整 JSON。`;
      }
    }
    try {
      this.database.finishAiJob(jobId, "", lastError, telemetry("失败"));
    } finally {
      this.activeRequests.delete(jobId);
      this.cancelledJobs.delete(jobId);
    }
    throw new Error(lastError);
  }

  async deconstruct(
    book: ResearchBook,
    chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>,
  ): Promise<{ insight: InsightPack; analyses: ResearchAnalysisRecord[] }> {
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
          user:
            `题材：${book.genre}\n章节范围：${fromChapter}-${toChapter}\n输出 chapters 数组，逐章给出 ordinal、finding、conflict、hook、stateChange、risk、enteringExpectation、protagonistGoal、coreInterest、emotionalPayoff、payoffImpact、nextExpectation；没有证据时写“证据不足”，不得臆测。再输出 synthesis，字段为 audienceNeed、openingPromise、conflictEngine、emotionalRhythm、retentionDevices、longFormEngine、marketGap、risks、confidence。所有结论必须抽象，不得引用原句或专名。\n` +
            batch.map((chapter, index) => `【章节${chapter.ordinal}】\n${sanitizedBatch[index]}`).join("\n"),
          schema: BatchAnalysisSchema,
          longTask: true,
          stream: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `第${fromChapter}-${toChapter}章拆解失败：${message}。已完成批次会保留，重新拆书可从缓存继续。`,
        );
      }
      partials.push({ fromChapter, toChapter, insight: result.synthesis });
      for (const finding of result.chapters)
        analyses.push({
          id: randomUUID(),
          bookId: book.id,
          layer: "章节",
          fromChapter: finding.ordinal,
          toChapter: finding.ordinal,
          findings: `进入期待：${finding.enteringExpectation}\n主角目标：${finding.protagonistGoal}\n核心利益：${finding.coreInterest}\n结构：${finding.finding}\n冲突：${finding.conflict}\n情绪回报：${finding.emotionalPayoff}\n回报影响：${finding.payoffImpact}\n下一期待：${finding.nextExpectation}\n章末钩子：${finding.hook}\n状态变化：${finding.stateChange}\n风险：${finding.risk}`,
          evidenceChapters: [finding.ordinal],
          confidence: result.synthesis.confidence,
          createdAt: now(),
        });
    }

    const stages: Array<{ fromChapter: number; toChapter: number; insight: InsightResult }> = [];
    for (let start = 0; start < partials.length; start += 2) {
      const group = partials.slice(start, start + 2);
      const fromChapter = group[0].fromChapter;
      const toChapter = group.at(-1)!.toChapter;
      const stage =
        group.length === 1
          ? group[0].insight
          : await this.runJson({
              projectId: null,
              taskType: "deconstruct-stage",
              inputSummary: `${book.title} 第${fromChapter}-${toChapter}章阶段汇总`,
              system:
                "你是网络小说开篇阶段研究员。输入只有两个脱敏小批次结论，合并重复规律并保留阶段变化，不得还原作品内容。",
              user: `题材：${book.genre}\n范围：第${fromChapter}-${toChapter}章\n请汇总为同字段 JSON：\n${JSON.stringify(group.map((item) => item.insight))}`,
              schema: InsightSchema,
              longTask: true,
              stream: true,
            });
      stages.push({ fromChapter, toChapter, insight: stage });
      analyses.push({
        id: randomUUID(),
        bookId: book.id,
        layer: "十章阶段",
        fromChapter,
        toChapter,
        findings: insightText(stage),
        evidenceChapters: chapters
          .filter((chapter) => chapter.ordinal >= fromChapter && chapter.ordinal <= toChapter)
          .map((chapter) => chapter.ordinal),
        confidence: stage.confidence,
        createdAt: now(),
      });
    }
    const volumes: InsightResult[] = [];
    for (let start = 0; start < stages.length; start += 10) {
      const group = stages.slice(start, start + 10);
      const fromChapter = group[0].fromChapter;
      const toChapter = group.at(-1)!.toChapter;
      const volume =
        group.length === 1
          ? group[0].insight
          : await this.runJson({
              projectId: null,
              taskType: "deconstruct-volume",
              inputSummary: `${book.title} 第${fromChapter}-${toChapter}章分卷汇总`,
              system: "你是长篇小说分卷结构研究员。输入只有脱敏十章阶段结论，输出同字段抽象汇总，不得还原作品内容。",
              user: `题材：${book.genre}\n范围：第${fromChapter}-${toChapter}章\n${JSON.stringify(group.map((item) => item.insight))}`,
              schema: InsightSchema,
              longTask: true,
              stream: true,
            });
      volumes.push(volume);
      analyses.push({
        id: randomUUID(),
        bookId: book.id,
        layer: "分卷",
        fromChapter,
        toChapter,
        findings: insightText(volume),
        evidenceChapters: chapters.slice(fromChapter - 1, toChapter).map((chapter) => chapter.ordinal),
        confidence: volume.confidence,
        createdAt: now(),
      });
    }
    const aggregate =
      volumes.length === 1
        ? volumes[0]
        : await this.runJson({
            projectId: null,
            taskType: "deconstruct-aggregate",
            inputSummary: `${book.title} 全书抽象汇总（${volumes.length}卷）`,
            system:
              "你是网络小说市场分析师。输入只包含抽象拆解结论。合并重复规律，保留阶段变化和风险，禁止推测或还原原作专名与具体表达。",
            user: `题材：${book.genre}\n请汇总为同字段 JSON：\n${JSON.stringify(volumes)}`,
            schema: InsightSchema,
            longTask: true,
            stream: true,
          });
    analyses.push({
      id: randomUUID(),
      bookId: book.id,
      layer: "全书",
      fromChapter: 1,
      toChapter: chapters.length,
      findings: insightText(aggregate),
      evidenceChapters: chapters.map((chapter) => chapter.ordinal),
      confidence: aggregate.confidence,
      createdAt: now(),
    });
    return {
      insight: {
        id: randomUUID(),
        name: `${book.title} · 脱敏结构洞察`,
        genre: book.genre,
        ...aggregate,
        evidenceCount: chapters.length,
        createdAt: now(),
      },
      analyses,
    };
  }

  private localInsight(
    book: ResearchBook,
    chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>,
  ): { insight: InsightPack; analyses: ResearchAnalysisRecord[] } {
    const average = Math.round(
      chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) / Math.max(chapters.length, 1),
    );
    const hookRate = Math.round(
      (chapters.filter((chapter) => /[？?!！…]$/.test(chapter.content.trim())).length / Math.max(chapters.length, 1)) *
        100,
    );
    const dialogueRate = Math.round(
      (chapters.reduce((sum, chapter) => sum + (chapter.content.match(/[“"]/g)?.length ?? 0), 0) /
        Math.max(book.wordCount, 1)) *
        1000,
    );
    const insight: InsightPack = {
      id: randomUUID(),
      name: `${book.title} · 本地结构统计`,
      genre: book.genre,
      audienceNeed: "未配置云模型，当前仅建立可复核的篇幅与节奏基线。",
      openingPromise: `样本共 ${chapters.length} 章，平均每章约 ${average} 字；需人工补充开篇承诺判断。`,
      conflictEngine: "请在配置模型后运行语义拆解，或根据章节证据人工填写冲突发动机。",
      emotionalRhythm: `章末强标点比例约 ${hookRate}%，对话标记密度约 ${dialogueRate}‰。`,
      retentionDevices: "已完成章节长度、章末形式和对话密度统计，尚未作语义归因。",
      longFormEngine: "待人工确认主线资源、关系变化和阶段升级是否可持续。",
      marketGap: "单本样本不足以形成市场空位结论，应与榜单快照和其他样本交叉验证。",
      risks: "此洞察包由本地规则生成，不包含语义级判断，不应直接作为立项依据。",
      evidenceCount: chapters.length,
      confidence: "低",
      createdAt: now(),
    };
    const analyses: ResearchAnalysisRecord[] = chapters.map((chapter) => ({
      id: randomUUID(),
      bookId: book.id,
      layer: "章节",
      fromChapter: chapter.ordinal,
      toChapter: chapter.ordinal,
      findings: `章节字数：${chapter.wordCount}\n对话标记：${chapter.content.match(/[“”]/g)?.length ?? 0}\n章末形式：${chapter.content.trim().slice(-1) || "无"}`,
      evidenceChapters: [chapter.ordinal],
      confidence: "低",
      createdAt: now(),
    }));
    for (let start = 0; start < chapters.length; start += 10) {
      const group = chapters.slice(start, start + 10);
      analyses.push({
        id: randomUUID(),
        bookId: book.id,
        layer: "十章阶段",
        fromChapter: group[0].ordinal,
        toChapter: group.at(-1)!.ordinal,
        findings: `平均章长 ${Math.round(group.reduce((sum, chapter) => sum + chapter.wordCount, 0) / group.length)} 字；仅本地统计，待人工补充语义判断。`,
        evidenceChapters: group.map((chapter) => chapter.ordinal),
        confidence: "低",
        createdAt: now(),
      });
    }
    for (let start = 0; start < chapters.length; start += 100) {
      const group = chapters.slice(start, start + 100);
      analyses.push({
        id: randomUUID(),
        bookId: book.id,
        layer: "分卷",
        fromChapter: group[0].ordinal,
        toChapter: group.at(-1)!.ordinal,
        findings: `本段共 ${group.length} 章、${group.reduce((sum, chapter) => sum + chapter.wordCount, 0)} 字；未启用云端语义拆解。`,
        evidenceChapters: group.map((chapter) => chapter.ordinal),
        confidence: "低",
        createdAt: now(),
      });
    }
    analyses.push({
      id: randomUUID(),
      bookId: book.id,
      layer: "全书",
      fromChapter: 1,
      toChapter: chapters.length,
      findings: insightText(insight),
      evidenceChapters: chapters.map((chapter) => chapter.ordinal),
      confidence: "低",
      createdAt: now(),
    });
    return { insight, analyses };
  }

  async generateConcepts(
    project: ProjectDetail,
    insights: InsightPack[],
    marketOpportunities: MarketOpportunity[] = [],
  ): Promise<ConceptCandidate[]> {
    if (!insights.length) throw new Error("请先为项目关联至少一个脱敏洞察包");
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "generate-concepts",
      inputSummary: `${project.summary.title} 三案立项`,
      system:
        "你是原创中国商业网文策划。你只能使用输入中的抽象市场洞察，不得假定、复原或模仿任何样本作品。三个方案必须在主角身份、核心矛盾和长篇发动机上明显不同，并能持续制造逐级升级的期待与回报。",
      user: `项目题材：${project.summary.genre}\n目标字数：${project.summary.targetWords}\n商业知识：${compileCommercialGuidance(project.summary.genre, 1, { currentWords: project.summary.currentWords, targetWords: project.summary.targetWords, fanqieCategoryKey: project.contract.fanqieCategoryKey, secondaryGenres: project.contract.secondaryGenres, genreElements: project.contract.genreElements, customGenreDirection: project.contract.customGenreDirection })}\n番茄市场机会（仅作证据，不得机械追热点）：${JSON.stringify(marketOpportunities)}\n脱敏洞察：${JSON.stringify(insights)}\n输出 candidates 数组，每项包含 title、oneLinePitch、audience、coreConflict、differentiation、longFormCapacity、originalityRisk。longFormCapacity 必须说明冲突、资源/关系/地图或规则如何至少三轮升级；每个方案要说明如何借鉴市场机会的读者需求但避开同质化。`,
      schema: CandidateSchema,
    });
    return result.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  }

  async generateBookConcepts(input: BookConceptInput): Promise<BookConceptCandidate[]> {
    const plugin = GENRE_PLUGINS[input.genre];
    const allowDebtAccounting = authorRequestsDebtAccounting(input);
    const defaultMotifBoundary = allowDebtAccounting
      ? "作者已明确选择债务或账目相关内容，可以据此创作，但仍需避免重复套路。"
      : "作者没有选择债务或账目题材。不得把债务、欠款、欠薪、讨债、催收、还债、清账、旧账、账本或清算作为人物困境、开局钩子、能力隐喻、冲突主线或成长载体；请从身份、生存、竞争、关系、规则、探索、技艺、责任或外部危机中选择更贴合题材的压力。";
    const system = `你是面向番茄小说的原创商业网文总编。为没有书名和完整创意的作者提供三套可立项方案。三案不得共享同一套升级换皮结构：主角身份、核心矛盾、关系结构、开局触发、成长载体、主要回报和长篇发动机至少有四项实质不同。genreSubtype 必须分别概括三条不同路线，不得使用近义词伪装差异。书名应清楚传达题材、身份反差或核心看点，禁止照搬已有作品、热榜书名或独特设定。结局必须明确主线如何收束，不能只写开放式占位语。${defaultMotifBoundary}`;
    const baseUser = `平台主题材：${input.genre}\n复合叙事类型：${input.secondaryGenres?.join(" + ") || `未指定。三个方案必须从这些叙事主轴中选择互不相同的主轴：${NARRATIVE_GENRES.join("、")}`}\n题材元素：${input.genreElements?.join("、") || "未指定；不得默认使用系统、重生、血脉、退婚或宗门等常见开局"}\n自定义创作方向：${input.customGenreDirection?.trim() || "未指定"}\n目标字数：${input.targetWords}\n更新节奏：${input.updateCadence}\n作者灵感（可为空）：${input.seed.trim() || "无，请从题材规则独立原创"}\n可参考子类型（只作素材，不是固定答案；genreSubtype 可以原创）：${plugin.subtypes.map((item) => item.name).join("、")}\n可选题材母题（不得默认全部采用，也不得直接复述为方案卖点）：${plugin.coreFantasies.join("；")}\n目标读者：${plugin.targetAudience.join("；")}\n题材禁忌：${plugin.tabooBoundaries.join("；")}\n商业规则：${compileCommercialGuidance(input.genre, 1, { currentWords: 0, targetWords: input.targetWords, secondaryGenres: input.secondaryGenres, genreElements: input.genreElements, customGenreDirection: input.customGenreDirection })}\n输出 candidates，严格三项。先在内部为三案分别确定叙事主轴、开局机制、成长载体和主要回报，确认至少三项互不相同后再输出；不要把内部检查过程写入结果。若作者指定了复合类型，每个方案的 secondaryGenres 都必须包含作者所选类型，但三案仍须采用不同的冲突切入和长篇扩张方式。每项包含 title、premise、genreSubtype、secondaryGenres、genreElements、openingMechanism、growthCarrier、primaryPayoff、protagonistDesire、readerPromise、coreEmotion、ending、immutableRules、prohibitedPatterns、audience、commercialHook、longFormEngine。secondaryGenres 必须使用给定的叙事主轴枚举。长篇发动机需说明至少三轮冲突与回报升级；所有方案是原创草案，不引用或模仿具体作品。`;
    const run = (retryIssues?: string[]) =>
      this.runJson({
        projectId: null,
        taskType: retryIssues ? "generate-book-concepts-diversity-retry" : "generate-book-concepts",
        inputSummary: `${input.genre} 从零开书三案${retryIssues ? "差异重试" : ""}`,
        system,
        user: retryIssues
          ? `${baseUser}\n上一次方案未通过差异检查：${retryIssues.join("；")}。请完全重做三案，不要只改名称。`
          : baseUser,
        schema: BookConceptSchema,
        longTask: true,
        stream: true,
      });
    let result = await run();
    const selectionIssues = (candidates: GeneratedBookConcept[]) =>
      (input.secondaryGenres ?? []).flatMap((genre) =>
        candidates.every((candidate) => candidate.secondaryGenres.includes(genre))
          ? []
          : [`部分方案未保留作者选择的叙事主轴：${genre}`],
      );
    let issues = [
      ...conceptDiversityIssues(result.candidates, !input.secondaryGenres?.length),
      ...selectionIssues(result.candidates),
      ...conceptDefaultMotifIssues(result.candidates, allowDebtAccounting),
    ];
    if (issues.length) {
      this.log("warn", "book-concepts.diversity-retry", { issues });
      result = await run(issues);
      issues = [
        ...conceptDiversityIssues(result.candidates, !input.secondaryGenres?.length),
        ...selectionIssues(result.candidates),
        ...conceptDefaultMotifIssues(result.candidates, allowDebtAccounting),
      ];
      if (issues.length)
        throw new Error(`三套方案未通过立项检查：${issues.join("；")}。请补充更具体的复合类型或自定义方向后重试。`);
    }
    return result.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  }

  async expandBookConcept(input: BookConceptInput, concept: BookConceptCandidate): Promise<BookConceptSkeleton> {
    const defaultMotifBoundary = authorRequestsDebtAccounting(input)
      ? ""
      : "作者没有选择债务或账目题材，不得在扩展时新增欠债、欠款、讨债、清账、旧账、账本或清算等冲突与隐喻。";
    return this.runJson({
      projectId: null,
      taskType: "expand-book-concept-skeleton",
      inputSummary: `${concept.title} 人物与世界骨架`,
      system: [
        "你是中文长篇小说的故事架构师。作者已经选定立项方案，现在只扩展这一本书的人物与世界骨架。",
        "不得更换主角、核心矛盾、开局机制、成长载体、主要回报、长篇发动机或终局，不得偷偷加入系统、重生、血脉等未选择元素。",
        defaultMotifBoundary,
        "主角弧光必须写清起点认知、阶段转变、关键代价和终局状态。关键关系必须说明双方、初始张力、各自目标和不可替代作用。",
        "世界规则必须是会影响人物选择的职业、社会、能力、资源或超自然规则，并写清边界或代价。主要势力必须说明目标、资源和与主线的冲突位置。",
        "时间锚点必须覆盖开局前因、开局触发、至少一个中期不可逆节点和终局兑现，使用相对阶段，不要编造具体公历日期。",
        "各项要能直接进入故事圣经，不写空泛的‘关系逐渐加深、世界更加广阔、经历重重困难’。",
      ].join("\n"),
      user: `平台主题材：${input.genre}\n复合叙事类型：${concept.secondaryGenres.join(" + ")}\n题材元素：${concept.genreElements.join("、") || "无固定元素"}\n自定义方向：${input.customGenreDirection?.trim() || "无"}\n已选开书方案：${JSON.stringify(concept)}\n输出 protagonistArc、keyRelationships、worldRules、majorForces、timelineAnchors。所有内容必须能由已选方案推出，并共同支撑 longFormEngine。`,
      schema: BookConceptSkeletonSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "medium",
    });
  }

  async generatePlanning(
    project: ProjectDetail,
    input: PlanningGenerationInput,
    onChapterBatch?: (batch: PlanningGenerationResult) => void | Promise<void>,
  ): Promise<PlanningGenerationResult> {
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    const startChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const shared = `项目：${project.summary.title}\n题材：${project.summary.genre}\n目标字数：${project.summary.targetWords}\n创作契约：${JSON.stringify(project.contract)}\n商业规则：${compileCommercialGuidance(project.summary.genre, startChapter, { currentWords: project.summary.currentWords, targetWords: project.summary.targetWords, subtype: project.contract.genreSubtype, fanqieCategoryKey: project.contract.fanqieCategoryKey, secondaryGenres: project.contract.secondaryGenres, genreElements: project.contract.genreElements, customGenreDirection: project.contract.customGenreDirection, storyStage: resolveStoryStage(project.plans, project.summary.currentWords) })}\n已批准规划：${JSON.stringify(project.plans.filter((plan) => plan.status === "已批准"))}\n已有章节：${JSON.stringify(project.chapters.slice(-20).map((chapter) => ({ number: chapter.number, title: chapter.title, outline: chapter.outline, endingExpectation: chapter.endingExpectation })))}`;
    if (input.mode === "全书结构") {
      const result = await this.runJson({
        projectId: project.summary.id,
        taskType: "generate-story-structure",
        inputSummary: `${project.summary.title} 自适应阶段与分卷`,
        system:
          "你是中国商业网文总编。根据已审批契约规划作品自己的宏观阶段和分卷，只细化结构，不写正文。阶段数量与功能必须由核心矛盾、叙事主轴和长篇发动机决定，不得机械套用开篇、追读、扩张、中期、高潮、收束六阶段。每次阶段切换必须由不可逆状态变化触发，终局必须兑现契约。",
        user: `${shared}\n输出 stages（4至8项）和 volumes（3至6项）。每项包含 title、goal、conflict、outcome、targetWords；stage 额外包含 startChapter。阶段标题必须是本书专属事件或状态，不得直接使用“开篇、追读、扩张、中期、高潮、收束”。各阶段目标字数之和应接近项目目标。`,
        schema: StructurePlanningSchema,
        longTask: true,
        stream: true,
      });
      return {
        startChapter: 1,
        chapters: [],
        plans: [
          ...result.stages.map((item, index) => ({
            id: randomUUID(),
            kind: "宏观阶段" as const,
            title: item.title,
            ordinal: item.startChapter || index + 1,
            goal: item.goal,
            conflict: item.conflict,
            outcome: item.outcome,
            targetWords: item.targetWords,
            status: "草稿" as const,
            parentId: null,
          })),
          ...result.volumes.map((item, index) => ({
            id: randomUUID(),
            kind: "分卷" as const,
            title: item.title,
            ordinal: index + 1,
            goal: item.goal,
            conflict: item.conflict,
            outcome: item.outcome,
            targetWords: item.targetWords,
            status: "草稿" as const,
            parentId: null,
          })),
        ],
      };
    }
    const count = input.chapterCount ?? 10;
    const batches: PlanningGenerationResult[] = [];
    for (let offset = 0; offset < count; offset += CHAPTER_PLANNING_BATCH_SIZE) {
      const batchStart = startChapter + offset;
      const batchCount = Math.min(CHAPTER_PLANNING_BATCH_SIZE, count - offset);
      const priorChapters = batches
        .flatMap((batch) => batch.chapters)
        .map((chapter) => ({
          number: chapter.number,
          title: chapter.title,
          outline: chapter.outline,
          endingExpectation: chapter.endingExpectation,
        }));
      const result = await this.runJson({
        projectId: project.summary.id,
        taskType: "generate-chapter-plans",
        inputSummary: `${project.summary.title} 第${batchStart}-${batchStart + batchCount - 1}章章纲`,
        system:
          "你是中国商业网文连载编辑。生成可直接执行的连续章纲，不写正文。先判断每章承担行动、调查、关系、经营、训练、生存、群像、氛围、过渡、揭秘或高潮中的哪种主要功能，再决定节奏。章节必须承接上一章，但关系、调查、氛围和过渡章可以通过认知、情绪、证据、关系或气氛积累推进，不得强塞打斗、反转或即时胜利。相邻章节的功能、场景数量和回报形态应有变化。",
        user: `${shared}\n本次任务前面刚生成且必须承接的章纲：${JSON.stringify(priorChapters)}\n从第${batchStart}章开始，严格输出${batchCount}个 chapters，并给出整个批次的 batchGoal、batchConflict、batchOutcome。每章填写 title、goal、conflict、outcome、chapterFunction、targetWords、chapterPromise、expectedPayoff、crisis、endingExpectation、payoffOffset、isKeyChapter 和 scenes。chapterFunction 必须使用规定枚举；targetWords 在 1400–3500 之间，按内容密度决定，不要全都相同；scenes 为 1–5 个真正需要的场景，每个包含 title、goal、conflict、outcome、targetWords，标题必须是本章具体事件，不得使用“入场、对抗、转向”等通用功能名。关系或氛围章可以只有 1–2 场，高潮章可以 4–5 场。各场景目标字数之和应接近本章 targetWords。payoffOffset 表示该章结尾期待预计在几章后兑现。`,
        schema: ChapterPlanningSchema,
        longTask: true,
        stream: true,
      });
      if (result.chapters.length !== batchCount)
        throw new Error(`模型返回 ${result.chapters.length} 章，预期 ${batchCount} 章，请重试`);
      const roughPlan = {
        id: randomUUID(),
        kind: "粗纲" as const,
        title: `第${batchStart}–${batchStart + batchCount - 1}章滚动粗纲`,
        ordinal: batchStart,
        goal: result.batchGoal,
        conflict: result.batchConflict,
        outcome: result.batchOutcome,
        targetWords: result.chapters.reduce((sum, item) => sum + item.targetWords, 0),
        status: "草稿" as const,
        parentId: null,
      };
      const chapters = result.chapters.map((item, index) => {
        const number = batchStart + index;
        return {
          id: randomUUID(),
          number,
          title: item.title,
          outline: `功能：${item.chapterFunction}；目标：${item.goal}；张力：${item.conflict}；结果：${item.outcome}`,
          content: "",
          wordCount: 0,
          status: "章纲" as const,
          batchMode: item.isKeyChapter ? ("逐章" as const) : ("五章批次" as const),
          isKeyChapter: item.isKeyChapter,
          chapterFunction: item.chapterFunction,
          targetWords: item.targetWords,
          chapterPromise: item.chapterPromise,
          expectedPayoff: item.expectedPayoff,
          crisis: item.crisis,
          endingExpectation: item.endingExpectation,
          expectationTargetChapter: number + item.payoffOffset,
          revision: 0,
          updatedAt: now(),
        };
      });
      const detailPlans = result.chapters.map((item, index) => ({
        id: randomUUID(),
        kind: "细纲" as const,
        title: `第${batchStart + index}章 ${item.title} · ${item.chapterFunction}`,
        ordinal: batchStart + index,
        goal: item.goal,
        conflict: item.conflict,
        outcome: item.outcome,
        targetWords: item.targetWords,
        status: "草稿" as const,
        parentId: roughPlan.id,
      }));
      const scenePlans = result.chapters.flatMap((item, index) => {
        const number = batchStart + index;
        const parentId = detailPlans[index].id;
        return item.scenes.map((scene, sceneIndex) => ({
          id: randomUUID(),
          kind: "场景卡" as const,
          title: `第${number}章·${scene.title}`,
          ordinal: number * 10 + sceneIndex + 1,
          goal: scene.goal,
          conflict: scene.conflict,
          outcome: scene.outcome,
          targetWords: scene.targetWords,
          status: "草稿" as const,
          parentId,
        }));
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

  async reviewPlanning(project: ProjectDetail, input: PlanningReviewInput): Promise<PlanningReviewResult> {
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    const toChapter = input.fromChapter + input.chapterCount - 1;
    const structuralPlans = project.plans.filter((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷");
    const scopedPlans = project.plans.filter(
      (plan) => !structuralPlans.includes(plan) && plan.ordinal >= input.fromChapter && plan.ordinal <= toChapter,
    );
    const reviewedPlans = [...structuralPlans, ...scopedPlans];
    const reviewedChapters = project.chapters.filter(
      (chapter) => chapter.number >= input.fromChapter && chapter.number <= toChapter,
    );
    if (!reviewedPlans.length && !reviewedChapters.length) throw new Error("当前范围没有可审核的规划或章纲");
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "review-planning-logic",
      inputSummary: `审核第${input.fromChapter}-${toChapter}章规划逻辑`,
      system: [
        "你是中文长篇小说的规划审稿总编。审核规划能否在不依赖作者脑补的情况下连续执行，并给出最小必要修复。",
        "逐项检查：宏观阶段与分卷是否覆盖契约；上下级目标是否一致；事件是否有原因、行动、反作用与结果；人物行动是否符合欲望和已知信息；设定与事实是否冲突；相邻章节是否重复同一功能和解法；期待是否有兑现位置；场景与篇幅是否匹配。",
        "关系、调查、氛围和过渡章不要求强冲突或即时胜利，但必须有可识别的认知、关系、证据、情绪或环境推进。不得用商业节奏名义把所有章节改成同一种结构。",
        "只依据输入指出问题。evidence 必须引用输入中的具体文字或编号，禁止编造缺失设定。没有证据的问题不要输出。",
        "修复必须保留 targetId，只改真正有问题的字段；不得改变核心契约、擅自新增关键设定或重写本来合理的节点。对全局问题可以只给 issue，不得伪造 targetId。",
      ].join("\n"),
      user: `审核范围：第${input.fromChapter}-${toChapter}章\n创作契约：${JSON.stringify(project.contract)}\n规划节点：${JSON.stringify(reviewedPlans)}\n章节章纲：${JSON.stringify(reviewedChapters.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, outline: chapter.outline, chapterFunction: chapter.chapterFunction, targetWords: chapter.targetWords, chapterPromise: chapter.chapterPromise, expectedPayoff: chapter.expectedPayoff, crisis: chapter.crisis, endingExpectation: chapter.endingExpectation, expectationTargetChapter: chapter.expectationTargetChapter, status: chapter.status })))}\n已确认事实：${JSON.stringify(project.facts.slice(-100))}\n期待账本：${JSON.stringify(project.expectations.filter((item) => item.status === "待兑现" || item.status === "部分兑现" || (item.sourceChapter >= input.fromChapter && item.sourceChapter <= toChapter)).slice(0, 100))}\n输出 summary、verdict、issues、planRepairs、chapterRepairs。修复对象必须来自输入 ID；每个 after 提供该对象修复后的完整可编辑字段。`,
      schema: PlanningReviewSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "medium",
    });
    const plansById = new Map(reviewedPlans.map((plan) => [plan.id, plan]));
    const chaptersById = new Map(reviewedChapters.map((chapter) => [chapter.id, chapter]));
    const validTargetIds = new Set([...plansById.keys(), ...chaptersById.keys()]);
    const evidenceSource = JSON.stringify({
      contract: project.contract,
      plans: reviewedPlans,
      chapters: reviewedChapters,
      facts: project.facts,
      expectations: project.expectations,
    }).replace(/\s+/g, "");
    const reviewedIssues = result.issues
      .filter((issue) => issue.targetType === "全局" || (issue.targetId !== null && validTargetIds.has(issue.targetId)))
      .map((issue) => {
        const supported =
          issue.evidence.trim().length >= 4 && evidenceSource.includes(issue.evidence.replace(/\s+/g, ""));
        return {
          issue: { ...issue, severity: issue.severity === "硬性" && !supported ? ("警告" as const) : issue.severity },
          supported,
        };
      });
    const repairableTargetIds = new Set(
      reviewedIssues.filter((item) => item.supported && item.issue.targetId).map((item) => item.issue.targetId!),
    );
    const planRepairs = [
      ...new Map(
        result.planRepairs
          .filter((repair) => plansById.has(repair.targetId) && repairableTargetIds.has(repair.targetId))
          .map((repair) => [repair.targetId, repair]),
      ).values(),
    ].map((repair) => ({
      ...repair,
      blockedReason:
        plansById.get(repair.targetId)!.status === "已批准" ? "规划已批准，需先建立并批准改纲变更单" : null,
    }));
    const protectedStatuses = new Set(["已定稿", "待发布", "已发布"]);
    const chapterRepairs = [
      ...new Map(
        result.chapterRepairs
          .filter((repair) => chaptersById.has(repair.targetId) && repairableTargetIds.has(repair.targetId))
          .map((repair) => [repair.targetId, repair]),
      ).values(),
    ].map((repair) => ({
      ...repair,
      blockedReason: protectedStatuses.has(chaptersById.get(repair.targetId)!.status)
        ? "章节已定稿或进入发布流程，需先建立并批准章节变更单"
        : null,
    }));
    const issues = reviewedIssues.map((item) => item.issue);
    return {
      summary: result.summary,
      verdict: result.verdict,
      issues,
      planRepairs,
      chapterRepairs,
      reviewedPlanCount: reviewedPlans.length,
      reviewedChapterCount: reviewedChapters.length,
    };
  }

  async analyzeNovelRevision(project: ProjectDetail, input: NovelRevisionInput): Promise<NovelRevisionProposal> {
    const chapter = project.chapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (!input.instruction.trim()) throw new Error("请先填写修改意见");
    const selected = input.scope === "仅选区";
    const start = selected ? (input.selectionStart ?? -1) : 0;
    const end = selected ? (input.selectionEnd ?? -1) : chapter.content.length;
    if (selected && (start < 0 || end <= start || end > chapter.content.length))
      throw new Error("请先在正文中选中要修改的文字");
    const sourceText = chapter.content.slice(start, end);
    if (selected && input.selectedText !== sourceText) throw new Error("正文选区已经变化，请重新选择");

    const structuralPlans = project.plans.filter((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷");
    const nearbyPlans = project.plans.filter(
      (plan) => Math.abs(plan.ordinal - chapter.number) <= (input.scope === "全书联动" ? 60 : 5),
    );
    const plans = [...new Map([...structuralPlans, ...nearbyPlans].map((plan) => [plan.id, plan])).values()].slice(
      0,
      160,
    );
    const nearbyChapters = project.chapters
      .filter((item) => Math.abs(item.number - chapter.number) <= (input.scope === "全书联动" ? 60 : 5))
      .slice(0, 121);
    const sourceTextTruncated = sourceText.length > 16_000;
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "analyze-novel-revision",
      inputSummary: `第${chapter.number}章修改意见：${input.instruction.trim().slice(0, 80)}`,
      system: [
        "你是中文长篇小说的联动修订编辑。先理解作者的自然语言意见，再提出最小、可审查的结构化修改，不得直接执行。",
        `本次权威依据是“${input.authority}”。设定为准时不得修改创作契约或已确定的故事事实，只修复正文或与正文直接相关的未锁定章纲；当前正文为准时才可提出反向同步设定与规划的提案。`,
        `本次范围是“${input.scope}”。仅选区时只返回 replacementText，不得提出其他修复；当前章节时不得修改其他章节；全书联动也只能修改输入中真实存在的目标 ID。`,
        "保留作者未要求改变的情节结果、人物动机、视角和文风。不要为了完整而扩大修改面。",
        "事实账本和期待账本只做 impact 提醒，本次不直接生成写入补丁。没有必要修改的类别必须返回空数组。",
        sourceTextTruncated
          ? "目标正文超过本次安全替换上限，只分析联动影响和结构修复，replacementText 必须返回 null。"
          : "replacementText 只输出目标范围的替换文字，不输出完整章节或修改说明。若正文无需修改则返回 null。",
      ].join("\n"),
      user: `作品：${project.summary.title}\n题材：${project.summary.genre}\n作者意见：${input.instruction.trim()}\n创作契约：${JSON.stringify(project.contract)}\n可修改规划：${JSON.stringify(plans)}\n相关章节章纲：${JSON.stringify(nearbyChapters.map((item) => ({ ...chapterRevisionSnapshot(item), id: item.id, number: item.number, status: item.status })))}\n已确认事实：${JSON.stringify(project.facts.filter((fact) => fact.confidence === "已确认").slice(-150))}\n期待账本：${JSON.stringify(project.expectations.slice(-100))}\n目标章节：第${chapter.number}章 ${chapter.title}\n目标正文：\n${sourceText.slice(0, 16000)}\n输出 summary、warnings、impacts、contractRepairs、planRepairs、chapterRepairs、replacementText、replacementReason、replacementRisk。`,
      schema: NovelRevisionSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "medium",
    });
    const plansById = new Map(plans.map((item) => [item.id, item]));
    const chaptersById = new Map(nearbyChapters.map((item) => [item.id, item]));
    const contractRepairs = [
      ...new Map(
        result.contractRepairs
          .filter((_repair) => input.authority === "当前正文为准")
          .map((repair) => [repair.field, repair]),
      ).values(),
    ]
      .map((repair) => ({
        ...repair,
        id: `contract:${repair.field}`,
        before: contractFieldText(project.contract, repair.field),
      }))
      .filter((repair) => repair.before !== repair.after);
    const planRepairs = [
      ...new Map(
        result.planRepairs
          .filter((repair) => plansById.has(repair.targetId))
          .map((repair) => [repair.targetId, repair]),
      ).values(),
    ]
      .map((repair) => ({
        ...repair,
        id: `plan:${repair.targetId}`,
        location: plansById.get(repair.targetId)!.title,
        before: planRevisionSnapshot(plansById.get(repair.targetId)!),
      }))
      .filter((repair) => !sameJson(repair.before, repair.after));
    const chapterRepairs = [
      ...new Map(
        result.chapterRepairs
          .filter(
            (repair) =>
              chaptersById.has(repair.targetId) && (input.scope === "全书联动" || repair.targetId === chapter.id),
          )
          .map((repair) => [repair.targetId, repair]),
      ).values(),
    ]
      .map((repair) => ({
        ...repair,
        id: `chapter:${repair.targetId}`,
        baseRevision: chaptersById.get(repair.targetId)!.revision,
        location: `第${chaptersById.get(repair.targetId)!.number}章`,
        before: chapterRevisionSnapshot(chaptersById.get(repair.targetId)!),
      }))
      .filter((repair) => !sameJson(repair.before, repair.after));
    const textRepair =
      !sourceTextTruncated &&
      sourceText.length > 0 &&
      result.replacementText !== null &&
      result.replacementText !== sourceText
        ? {
            id: `text:${chapter.id}`,
            targetId: chapter.id,
            baseRevision: chapter.revision,
            start,
            end,
            before: sourceText,
            after: result.replacementText,
            reason: result.replacementReason || "按作者意见修改正文",
            risk: result.replacementRisk ?? ("低" as const),
          }
        : null;
    const omitted = input.scope === "全书联动" && project.chapters.length > nearbyChapters.length;
    const safetyWarnings = [
      ...(omitted ? ["长篇作品本次检查了目标章前后各 60 章；更远章节需分段继续检查。"] : []),
      ...(sourceTextTruncated
        ? ["目标正文超过 16000 字符，本次不会生成整段替换；请选中具体段落后再次提交正文修改。"]
        : []),
    ];
    return {
      sourceChapterId: chapter.id,
      baseContractVersion: project.contract.version,
      instruction: input.instruction.trim(),
      authority: input.authority,
      scope: input.scope,
      summary: result.summary,
      warnings: [...result.warnings, ...safetyWarnings],
      impacts: result.impacts,
      contractRepairs,
      planRepairs,
      chapterRepairs,
      textRepair,
    };
  }

  async suggestAestheticProfile(project: ProjectDetail): Promise<AestheticProfileSuggestion> {
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
    onStream?: (event: ChapterDraftStreamEvent) => void,
  ): Promise<Chapter> {
    return this.startDraftChapter(projectId, chapter, context, { retryContext, onStream }).completion;
  }

  startDraftChapter(
    projectId: string,
    chapter: Chapter,
    context: ContextPackage,
    options: StartDraftChapterOptions = {},
  ): StartedAiTask<Chapter> {
    let jobId: string | null = null;
    let source: StartedAiTask<Chapter>["source"] = "network";
    const completion = this.runDraftChapter(projectId, chapter, context, options, {
      onJobStarted: (startedJobId) => {
        jobId = startedJobId;
      },
      onCacheHit: () => {
        source = "cache";
      },
    });
    return { jobId, source, completion };
  }

  private async runDraftChapter(
    projectId: string,
    chapter: Chapter,
    context: ContextPackage,
    options: StartDraftChapterOptions,
    lifecycle: { onJobStarted: (jobId: string) => void; onCacheHit: () => void },
  ): Promise<Chapter> {
    let currentAttempt = 0;
    const targetCharacters = Math.min(3500, Math.max(1400, chapter.targetWords ?? 2300));
    const minimumCharacters = Math.max(900, Math.round(targetCharacters * 0.68));
    const maximumCharacters = Math.min(4800, Math.round(targetCharacters * 1.35));
    const chapterFunction = chapter.chapterFunction ?? "行动";
    let result: z.infer<ReturnType<typeof chapterDraftSchema>>;
    try {
      result = await this.runJson({
        projectId,
        taskType: "draft-chapter",
        inputSummary: `第${chapter.number}章 ${chapter.title || "未命名"}`,
        system:
          "你是中文长篇商业网文协作写作者。严格遵守已审批创作契约、项目审美、章纲和事实账本，不自行改纲，不引入上下文之外的关键设定，不泄露角色尚未知晓的信息。商业知识用于明确目标、压力、行动、回报影响和续读问题，不能凌驾于人物逻辑、契约或本书审美。项目审美是本书唯一的文风基准：冷峻、克制、均衡、热烈都可能是正确答案，不得默认采用清冷克制风，也不得把任一温度写成所有作品共用的模板。",
        user: `本章主要功能：${chapterFunction}\n本章章纲：${chapter.outline}\n上下文包：${JSON.stringify(contextForModel(context))}\n请输出 title 和 content。正文目标约 ${targetCharacters} 个非空白字符，完整结果必须落在 ${minimumCharacters}-${maximumCharacters} 个非空白字符内。按本章功能完成有效推进：行动、生存、经营或高潮章应产生可观察的局势变化；调查、关系、群像、氛围或过渡章可以通过证据重排、认知变化、关系位移、情绪积累或环境信息完成推进，不得为了显得刺激而强塞冲突、打脸或反转。若本章承担回报，展示其实际影响；若只承担蓄势，不要提前透支回报。把上下文中的叙事距离、情绪温度、文字质地、对话风格、情绪表达和标志手法落实到具体句段。遵守审美避用项，并以符合本章功能的自然余波结束。`,
        schema: chapterDraftSchema(minimumCharacters, maximumCharacters),
        retryContext: options.retryContext,
        timeoutMs: 300_000,
        stream: true,
        cachePolicy: options.cachePolicy,
        onJobStarted: lifecycle.onJobStarted,
        onCacheHit: lifecycle.onCacheHit,
        onAttempt: (attempt) => {
          currentAttempt = attempt;
          options.onStream?.({ type: "attempt-start", attempt });
        },
        onDelta: (delta, attempt) => options.onStream?.({ type: "delta", attempt, delta }),
      });
    } catch (error) {
      options.onStream?.({
        type: "failed",
        attempt: currentAttempt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    options.onStream?.({ type: "complete", attempt: currentAttempt });
    return { ...chapter, title: result.title, content: result.content, status: "待质检", updatedAt: now() };
  }

  async extractChapterFacts(project: ProjectDetail, chapter: Chapter): Promise<LedgerFact[]> {
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "extract-chapter-facts",
      inputSummary: `第${chapter.number}章状态候选`,
      system:
        "你是长篇小说状态记录员。只提取本章正文明确发生且会影响后续连续性的持久状态变化。不得推测心理、补全设定或把临时动作当成长期事实；无可靠变化时返回空数组。",
      user: `题材：${project.summary.genre}\n章节：第${chapter.number}章 ${chapter.title}\n章纲：${chapter.outline}\n本地检索到的相关有效事实：${JSON.stringify(project.facts.filter((fact) => fact.confidence === "已确认" || fact.confidence === "有冲突"))}\n正文：\n${chapter.content.slice(0, 16000)}\n输出 facts；每项包含 kind、subject、predicate、value、knowledgeScope、evidence。evidence 必须是正文中的连续短句。秘密必须说明当前知情角色，公开事实的 knowledgeScope 写“公开”。`,
      schema: FactCandidateSchema,
      longTask: true,
      stream: true,
      reasoningEffort: "low",
    });
    const compactContent = chapter.content.replace(/\s+/g, "");
    const activeFacts = project.facts
      .filter(
        (fact) =>
          fact.confidence === "已确认" &&
          fact.validFromChapter < chapter.number &&
          (fact.validToChapter === null || fact.validToChapter >= chapter.number),
      )
      .sort((left, right) => right.validFromChapter - left.validFromChapter);
    return result.facts
      .filter((fact) => compactContent.includes(fact.evidence.replace(/\s+/g, "")))
      .map((fact) => {
        const subject = fact.subject.trim();
        const predicate = fact.predicate.trim();
        const value = fact.value.trim();
        const replaced = activeFacts.find(
          (current) =>
            current.kind === fact.kind &&
            current.subject === subject &&
            current.predicate === predicate &&
            (current.value !== value || current.knowledgeScope !== (fact.knowledgeScope.trim() || "公开")),
        );
        const knowledgeScope = fact.knowledgeScope.trim() || "公开";
        const previousNumber = replaced && fact.kind === "资源" ? parseStoryNumber(replaced.value) : null;
        const nextNumber = fact.kind === "资源" ? parseStoryNumber(value) : null;
        const numericDelta = previousNumber !== null && nextNumber !== null ? nextNumber - previousNumber : null;
        const changeType =
          numericDelta !== null
            ? ("数值变化" as const)
            : replaced?.value === value && replaced.knowledgeScope !== knowledgeScope
              ? ("知情范围变更" as const)
              : replaced
                ? ("状态替换" as const)
                : ("新增" as const);
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
    const evidenceSource = [
      chapter.content,
      context.contract,
      context.volumeGoal,
      context.rollingOutline,
      context.relevantFacts,
      context.forbiddenKnowledge,
    ]
      .join("\n")
      .replace(/\s+/g, "");
    return result.issues.map((issue) => {
      const evidence = issue.evidence.trim();
      const supported = evidence.length >= 4 && evidenceSource.includes(evidence.replace(/\s+/g, ""));
      return {
        ...issue,
        severity: issue.severity === "硬性" && !supported ? ("警告" as const) : issue.severity,
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
    if (result.content.trim() === chapter.content.trim()) throw new Error("模型未产生有效修订，请检查质检问题后重试");
    return {
      ...chapter,
      title: result.title,
      content: result.content,
      status: "待质检",
      updatedAt: now(),
    };
  }
}
