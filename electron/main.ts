import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import type {
  BatchGenerationPreview,
  Chapter,
  ChapterDraftStreamEvent,
  ChapterFactsExtractionEvent,
  ConceptCandidate,
  ContextPackage,
  MetricSnapshot,
  PlanningGenerationResult,
  PlanningRepairInput,
  ProjectDetail,
  QualityIssue,
} from "../src/shared/types";
import { WorkspaceDatabase, now } from "./database";
import { BackgroundWorker } from "./worker-client";
import { AiService, type AiCachePolicy } from "./ai-service";
import { createEncryptedBackup } from "./backup";
import { analyzeRankings } from "./ranking-service";
import { analyzeMetrics, parseMetricsCsv } from "../src/shared/metrics";
import { readApiCredential, readAutoBackupCredential, writeApiCredential } from "./credential-store";
import { assertNoHardStoryConstraint, evaluateStoryConstraints } from "../src/shared/story-constraints";
import { compileChapterContext } from "../src/shared/context-compiler";
import { buildChapterBatchPreview } from "../src/shared/chapter-batch-service";
import {
  assertChapterRetrySnapshot,
  createChapterGenerationGuard,
  serializeChapterAiRetryContext,
  validateChapterAiRetrySource,
} from "./ai-retry";
import { validateIpcArgs } from "./ipc-validation";
import { StructuredLogger } from "./structured-log";
import { configureAutoUpdates } from "./update-service";
import {
  registerProjectHandlers,
} from "./handlers/project-handlers";
import {
  registerResearchHandlers,
  type ResearchHandlerRuntime,
} from "./handlers/research-handlers";
import {
  registerSystemHandlers,
  type SystemHandlerRuntime,
} from "./handlers/system-handlers";
import type { RegisterHandler } from "./handlers/types";

let mainWindow: BrowserWindow | null = null;
let database: WorkspaceDatabase;
let worker: BackgroundWorker;
let ai: AiService;
let apiCredential = "";
const activeGenerationProjects = new Set<string>();
let rankingScheduleTimer: ReturnType<typeof setInterval> | null = null;
let researchHandlers: ResearchHandlerRuntime;
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let systemHandlers: SystemHandlerRuntime;
let logger: StructuredLogger;
const singleInstanceLockDisabled =
  process.env.NOVEL_STUDIO_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const hasSingleInstanceLock =
  singleInstanceLockDisabled || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else if (!singleInstanceLockDisabled) app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function previewChapterBatch(
  project: ProjectDetail,
  settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
  chapterId: string,
): BatchGenerationPreview {
  return buildChapterBatchPreview(
    project,
    settings,
    chapterId,
    (chapter) => compileContext(project, chapter).estimatedTokens,
  );
}

function startOneChapter(
  id: string,
  chapterId: string,
  onStream?: (event: ChapterDraftStreamEvent) => void,
  cachePolicy: AiCachePolicy = "use",
) {
  if (activeGenerationProjects.has(id)) throw new Error("该作品已有正文生成任务正在运行");
  const project = database.getProject(id);
  if (!project.contract.approved) throw new Error("创作契约审批后才能生成正文");
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在");
  if (!chapter.outline.trim()) throw new Error("请先填写本章章纲");
  if (["已定稿", "待发布", "已发布"].includes(chapter.status)) throw new Error("已定稿或进入发布流程的章节不能由 AI 覆写");
  assertNoHardStoryConstraint(evaluateStoryConstraints(project.facts, chapter));
  if (!getApiKey()) throw new Error("尚未配置 AI API 密钥");
  activeGenerationProjects.add(id);
  try {
    const facts = database.searchRelevantFacts(id, `${chapter.title} ${chapter.outline}`, chapter.number);
    const generationGuard = createChapterGenerationGuard(chapter);
    const task = ai.startDraftChapter(id, chapter, compileContext(project, chapter, facts), {
      retryContext: serializeChapterAiRetryContext("chapter", id, chapter),
      onStream,
      cachePolicy,
    });
    return {
      ...task,
      completion: task.completion
        .then((generated) => database.saveGeneratedChapter(id, generated, generationGuard))
        .finally(() => activeGenerationProjects.delete(id)),
    };
  } catch (error) {
    activeGenerationProjects.delete(id);
    throw error;
  }
}

async function generateOneChapter(id: string, chapterId: string, onStream?: (event: ChapterDraftStreamEvent) => void) {
  return startOneChapter(id, chapterId, onStream).completion;
}

async function generateChapterBatchFrom(id: string, chapterId: string) {
  if (activeGenerationProjects.has(id)) throw new Error("该作品已有正文生成任务正在运行");
  const preview = previewChapterBatch(database.getProject(id), database.getAiSettings(), chapterId);
  if (!preview.canRun) throw new Error(preview.blockingReason ?? "当前不能执行五章批次");
  activeGenerationProjects.add(id);
  try {
    const generated: Chapter[] = [];
    for (const candidate of preview.chapters) {
      const currentProject = database.getProject(id);
      const chapter = currentProject.chapters.find((item) => item.id === candidate.id);
      if (!chapter) throw new Error(`第${candidate.number}章不存在`);
      if (chapter.content.trim()) { generated.push(chapter); continue; }
      assertNoHardStoryConstraint(evaluateStoryConstraints(currentProject.facts, chapter));
      const facts = database.searchRelevantFacts(id, `${chapter.title} ${chapter.outline}`, chapter.number);
      const generationGuard = createChapterGenerationGuard(chapter);
      const draft = await ai.draftChapter(
        id,
        chapter,
        compileContext(currentProject, chapter, facts),
        serializeChapterAiRetryContext("batch", id, chapter),
      );
      generated.push(database.saveGeneratedChapter(id, draft, generationGuard));
    }
    return generated;
  } finally {
    activeGenerationProjects.delete(id);
  }
}

function getApiKey() {
  return apiCredential;
}

async function extractFinalizedChapterFacts(
  projectId: string,
  chapter: Chapter,
): Promise<ChapterFactsExtractionEvent> {
  try {
    const project = database.getProjectOverview(projectId);
    const candidates = await ai.extractChapterFacts(project, chapter);
    const existing = new Set(project.facts.map((fact) =>
      `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`,
    ));
    let candidateCount = 0;
    for (const fact of candidates) {
      const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
      if (existing.has(key)) continue;
      database.saveFact(projectId, fact);
      existing.add(key);
      candidateCount += 1;
    }
    return { projectId, chapterId: chapter.id, status: "已完成", candidateCount };
  } catch (error) {
    return {
      projectId,
      chapterId: chapter.id,
      status: "失败",
      candidateCount: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function compileContext(
  project: ProjectDetail,
  chapter: Chapter,
  relevantFacts: ReadonlyArray<ProjectDetail["facts"][number]> = project.facts,
): ContextPackage {
  return compileChapterContext({
    summary: project.summary,
    contract: project.contract,
    chapter,
    plans: project.plans,
    relevantFacts,
    constraintFacts: project.facts,
    summaries: project.summaries,
    expectations: project.expectations,
    recentChapters: project.chapters,
    styleSamples: project.chapters
      .filter((item) =>
        item.number < chapter.number &&
        ["已定稿", "待发布", "已发布"].includes(item.status) &&
        item.content,
      )
      .sort((left, right) => left.number - right.number)
      .slice(-20)
      .map((item) => item.content),
  });
}

async function exportProject(projectId: string, format: "txt" | "md" | "docx") {
  if (!mainWindow) return null;
  const project = database.getProject(projectId);
  const chapters = project.chapters.filter((chapter) =>
    ["已定稿", "待发布", "已发布"].includes(chapter.status),
  );
  if (!chapters.length) throw new Error("没有可导出的已定稿章节");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出发布包",
    defaultPath: `${project.summary.title}-发布包.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (format === "docx") {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: project.summary.title,
              heading: HeadingLevel.TITLE,
            }),
            ...chapters.flatMap((chapter) => [
              new Paragraph({
                text: `第${chapter.number}章 ${chapter.title}`,
                heading: HeadingLevel.HEADING_1,
              }),
              ...chapter.content
                .split(/\n+/)
                .filter(Boolean)
                .map((line) => new Paragraph({ text: line })),
            ]),
          ],
        },
      ],
    });
    await writeFile(result.filePath, await Packer.toBuffer(document));
  } else {
    const text = chapters
      .map((chapter) =>
        format === "md"
          ? `# 第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`
          : `第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`,
      )
      .join("\n\n");
    await writeFile(result.filePath, text, "utf8");
  }
  const pending = project.issues.filter((issue) => issue.status === "待处理");
  const conflicts = project.facts.filter(
    (fact) => fact.confidence === "有冲突",
  );
  const report = [
    `# ${project.summary.title} 发布前检查报告`,
    "",
    `- 生成时间：${new Date().toLocaleString("zh-CN")}`,
    `- 导出章节：${chapters.length} 章`,
    `- 创作契约：${project.contract.approved ? `已审批 v${project.contract.version}` : "未审批"}`,
    `- 已批准卷纲：${project.plans.filter((plan) => plan.kind === "分卷" && plan.status === "已批准").length}`,
    `- 未处理硬性问题：${pending.filter((issue) => issue.severity === "硬性").length}`,
    `- 其他待处理问题：${pending.filter((issue) => issue.severity !== "硬性").length}`,
    `- 冲突事实：${conflicts.length}`,
    "",
    "## 待处理问题",
    "",
    ...(pending.length
      ? pending.map(
          (issue) =>
            `- [${issue.severity}] ${issue.category}：${issue.message}`,
        )
      : ["- 无"]),
    "",
    "## 冲突事实",
    "",
    ...(conflicts.length
      ? conflicts.map(
          (fact) =>
            `- ${fact.subject} / ${fact.predicate}：${fact.value}（证据第${fact.evidenceChapter}章）`,
        )
      : ["- 无"]),
    "",
    "> 本报告只辅助人工发布检查，不代表平台审核结论。",
  ].join("\n");
  const reportPath = `${result.filePath.slice(0, -path.extname(result.filePath).length)}-检查报告.md`;
  await writeFile(reportPath, report, "utf8");
  return result.filePath;
}

function registerHandlers() {
  const handle: RegisterHandler = (channel, callback) =>
    ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
      if (!mainWindow || event.sender.id !== mainWindow.webContents.id)
        throw new Error("拒绝来自非主窗口的调用");
      const startedAt = Date.now();
      try {
        const result = await callback(...validateIpcArgs(channel, args));
        logger.write("info", "ipc.completed", { channel, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        logger.write("error", "ipc.failed", { channel, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  researchHandlers = registerResearchHandlers({
    register: handle,
    database,
    ai,
    worker,
    chooseResearchFile: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{ name: "小说文档", extensions: ["txt", "epub", "docx"] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  });
  systemHandlers = registerSystemHandlers({
    register: handle,
    database,
    worker,
    logFilePath: logger.filePath,
    getSystemMetadata: () => ({
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
    chooseBackupDestination: async (defaultFileName) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "创建加密备份",
        defaultPath: defaultFileName,
        filters: [{ name: "加密备份", extensions: ["novelbak"] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    chooseBackupSource: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "校验并恢复备份副本",
        properties: ["openFile"],
        filters: [{ name: "加密备份", extensions: ["novelbak"] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    chooseDiagnosticDestination: async (defaultFileName) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出崩溃诊断包",
        defaultPath: defaultFileName,
        filters: [{ name: "诊断包", extensions: ["zip"] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    },
  });
  registerProjectHandlers({
    register: handle,
    database,
    ai,
    isGenerationActive: (projectId) =>
      activeGenerationProjects.has(projectId),
    currentDate: () => new Date(),
  });
  handle("generatePlanningDraft", async (id, input) => {
    const project = database.getProject(id);
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    if (input.mode === "全书结构" && project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷"))
      throw new Error("当前已有宏观阶段或分卷；为避免重复，AI 不会覆盖现有结构");
    const fromChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const count = input.mode === "后续章纲" ? input.chapterCount ?? 10 : 0;
    if (input.mode === "后续章纲" && project.chapters.some((chapter) => chapter.number >= fromChapter && chapter.number < fromChapter + count))
      throw new Error(`第${fromChapter}–${fromChapter + count - 1}章范围内已有章节，AI 不会覆盖`);
    const savedPlans: PlanningGenerationResult["plans"] = [];
    const savedChapters: PlanningGenerationResult["chapters"] = [];
    try {
      const generated = await ai.generatePlanning(project, { ...input, fromChapter }, (batch) => {
        const latest = database.getProject(id);
        if (batch.chapters.some((chapter) => latest.chapters.some((existing) => existing.number === chapter.number)))
          throw new Error("生成期间章节范围发生变化，本批结果未保存，请重新生成");
        savedPlans.push(...batch.plans.map((plan) => database.savePlan(id, plan)));
        savedChapters.push(...batch.chapters.map((chapter) => database.saveChapter(id, chapter)));
      });
      if (!generated.chapters.length) {
        savedPlans.push(...generated.plans.map((plan) => database.savePlan(id, plan)));
      }
      return { ...generated, plans: savedPlans, chapters: savedChapters };
    } catch (error) {
      if (!savedChapters.length) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`已保存第${savedChapters[0].number}–${savedChapters.at(-1)!.number}章；后续批次生成失败：${message}`);
    }
  });
  handle("reviewPlanning", (id, input) => ai.reviewPlanning(database.getProject(id), input));
  handle("applyPlanningRepairs", (id, input: PlanningRepairInput) => {
    const project = database.getProject(id);
    const plansById = new Map(project.plans.map((plan) => [plan.id, plan]));
    const chaptersById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
    if (!input.plans.length && !input.chapters.length) throw new Error("没有可应用的规划修复");
    if (new Set(input.plans.map((item) => item.targetId)).size !== input.plans.length || new Set(input.chapters.map((item) => item.targetId)).size !== input.chapters.length)
      throw new Error("修复提案包含重复目标");
    for (const repair of input.plans) {
      const current = plansById.get(repair.targetId);
      if (!current) throw new Error(`规划修复目标不存在：${repair.targetId}`);
      if (current.status === "已批准") throw new Error(`规划“${current.title}”已经批准，需先建立并批准改纲变更单`);
    }
    for (const repair of input.chapters) {
      const current = chaptersById.get(repair.targetId);
      if (!current) throw new Error(`章节修复目标不存在：${repair.targetId}`);
      if (["已定稿", "待发布", "已发布"].includes(current.status)) throw new Error(`第${current.number}章已受保护，需先建立并批准章节变更单`);
    }
    const appliedPlanIds = input.plans.map((repair) => database.savePlan(id, { ...plansById.get(repair.targetId)!, ...repair.after }).id);
    const appliedChapterIds = input.chapters.map((repair) => {
      const definedAfter = Object.fromEntries(Object.entries(repair.after).filter(([, value]) => value !== undefined));
      return database.saveChapter(id, { ...chaptersById.get(repair.targetId)!, ...definedAfter }).id;
    });
    return { appliedPlanIds, appliedChapterIds };
  });
  handle("saveChapter", (id, chapter, mode) => database.saveChapter(id, chapter, mode));
  handle("saveExpectation", (id, expectation) =>
    database.saveExpectation(id, expectation),
  );
  handle("transitionChapter", async (id, chapterId, status) => {
    const saved = database.transitionChapter(id, chapterId, status);
    if (status !== "已定稿") {
      return { chapter: saved, ledgerExtraction: { status: "不适用", candidateCount: 0 } };
    }
    if (!getApiKey()) {
      return { chapter: saved, ledgerExtraction: { status: "未配置", candidateCount: 0 } };
    }
    setImmediate(() => {
      void extractFinalizedChapterFacts(id, saved).then((result) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("studio:chapter-facts-extracted", result);
      });
    });
    return { chapter: saved, ledgerExtraction: { status: "排队中", candidateCount: 0 } };
  });
  handle("compileContext", (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    return compileContext(
      project,
      chapter,
      database.searchRelevantFacts(
        id,
        `${chapter.title} ${chapter.outline}`,
        chapter.number,
      ),
    );
  });
  handle("searchProject", (id, query, offset, limit) => database.searchProject(id, query, offset, limit));
  handle("listRevisions", (id, collection, entityId) =>
    database.listRevisions(id, collection, entityId),
  );
  handle("restoreRevision", (id, revisionId) =>
    database.restoreRevision(id, revisionId),
  );
  handle("runQualityCheck", async (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    const localIssues = await worker.run<QualityIssue[]>("quality-check", {
      projectId: id,
      chapter,
      previousChapter: project.chapters.find(
        (item) => item.number === chapter.number - 1,
      ),
      recentChapters: project.chapters
        .filter((item) => item.number < chapter.number)
        .slice(-12),
      facts: project.facts,
      contract: project.contract,
      genre: project.summary.genre,
      originalityMatches: database.findOriginalityMatches(chapter.content),
    });
    const intentIssues: QualityIssue[] = [
      ["本章承诺", chapter.chapterPromise],
      ["预期回报", chapter.expectedPayoff],
      ["当前危机", chapter.crisis],
      ["结尾期待", chapter.endingExpectation],
    ]
      .filter(([, value]) => !String(value ?? "").trim())
      .map(([label]) => ({
        id: randomUUID(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "章节商业意图",
        message: `${label}尚未规划，建议在写作台补充后再判断本章闭环。`,
        evidence: "",
        status: "待处理" as const,
        createdAt: now(),
      }));
    const dueExpectationIssues: QualityIssue[] = project.expectations
      .filter(
        (item) =>
          (item.status === "待兑现" || item.status === "部分兑现") &&
          item.expectedPayoffChapter !== null &&
          item.expectedPayoffChapter <= chapter.number &&
          !chapter.linkedExpectationIds?.includes(item.id),
      )
      .map((item) => ({
        id: randomUUID(),
        projectId: id,
        chapterId,
        severity: "建议" as const,
        category: "期待兑现",
        message: `“${item.title}”已到预计兑现章，但本章未标记承接；请确认延期、部分兑现或调整目标章。`,
        evidence: `第${item.sourceChapter}章提出`,
        status: "待处理" as const,
        createdAt: now(),
      }));
    let semanticIssues: QualityIssue[] = [];
    if (getApiKey()) {
      try {
        semanticIssues = await ai.reviewChapter(
          { ...project, facts },
          chapter,
          compileContext(project, chapter, facts),
        );
      } catch (error) {
        semanticIssues = [
          {
            id: randomUUID(),
            projectId: id,
            chapterId,
            severity: "警告",
            category: "语义质检",
            message: "云端语义质检未完成，本次结果仅包含本地规则检查。",
            evidence:
              error instanceof Error
                ? error.message.slice(0, 300)
                : String(error).slice(0, 300),
            status: "待处理",
            createdAt: now(),
          },
        ];
      }
    }
    const seen = new Set<string>();
    const issues = [
      ...localIssues,
      ...intentIssues,
      ...dueExpectationIssues,
      ...semanticIssues,
    ].filter((issue) => {
      const key = `${issue.category}\n${issue.message}\n${issue.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    database.saveIssues(id, chapterId, issues);
    if (chapter.status === "草稿")
      database.transitionChapter(id, chapterId, "待质检");
    return issues;
  });
  handle("reviseChapterFromQuality", async (id, chapterId) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品已有正文生成或修订任务正在运行");
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      throw new Error("已定稿或进入发布流程的章节不能直接由 AI 修改");
    const issues = project.issues.filter(
      (issue) => issue.chapterId === chapterId && issue.status === "待处理",
    );
    if (!issues.length) throw new Error("本章没有可供 AI 修订的待处理问题");
    const facts = database.searchRelevantFacts(
      id,
      `${chapter.title} ${chapter.outline} ${chapter.content.slice(0, 500)}`,
      chapter.number,
    );
    activeGenerationProjects.add(id);
    try {
      const revised = await ai.reviseChapter(
        { ...project, facts },
        chapter,
        compileContext(project, chapter, facts),
        issues,
      );
      return database.saveGeneratedChapter(id, revised);
    } finally {
      activeGenerationProjects.delete(id);
    }
  });
  handle("extractChapterFacts", async (id, chapterId) => {
    const project = database.getProjectOverview(id);
    const chapter = database.getChapter(id, chapterId);
    if (!chapter.content.trim()) throw new Error("章节还没有正文");
    const relevantFacts = database.searchRelevantFacts(
      id,
      `${chapter.title}\n${chapter.outline}\n${chapter.content.slice(0, 4_000)}`,
      chapter.number,
      40,
    );
    const candidates = await ai.extractChapterFacts(
      { ...project, facts: relevantFacts },
      chapter,
    );
    const existing = new Set(project.facts.map((fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`));
    const saved = [];
    for (const fact of candidates) {
      const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
      if (existing.has(key)) continue;
      saved.push(database.saveFact(id, fact));
      existing.add(key);
    }
    return saved;
  });
  handle("saveFact", (id, fact) => database.saveFact(id, fact));
  handle("resolveIssue", (id, issueId, status) =>
    database.resolveIssue(id, issueId, status),
  );
  handle("saveChangeRequest", (id, change) =>
    database.saveChangeRequest(id, change),
  );
  handle("decideChangeRequest", (id, changeId, decision) =>
    database.decideChangeRequest(id, changeId, decision),
  );
  handle("saveSchedule", (id, item) => database.saveSchedule(id, item));
  handle("attachInsights", (id, insightIds) =>
    database.attachInsights(id, insightIds),
  );
  handle("generateConcepts", async (id): Promise<ConceptCandidate[]> => {
    const project = database.getProject(id);
    const opportunities = analyzeRankings(database.listRankings()).marketOpportunities
      .filter((item) => project.contract.fanqieCategoryKey ? item.categoryKey === project.contract.fanqieCategoryKey : item.genre === project.summary.genre)
      .filter((item) => item.evidenceLevel !== "基线")
      .slice(0, 5);
    return ai.generateConcepts(
      project,
      database.getInsights(project.insightIds),
      opportunities,
    );
  });
  handle("generateChapterDraft", (id, chapterId, streamId) => generateOneChapter(id, chapterId, streamId
    ? (event) => mainWindow?.webContents.send("studio:chapter-draft-stream", { streamId, event })
    : undefined));
  handle("previewChapterBatch", (id, chapterId) =>
    previewChapterBatch(
      database.getProject(id),
      database.getAiSettings(),
      chapterId,
    ),
  );
  handle("generateChapterBatch", generateChapterBatchFrom);
  handle("getAiSettings", () => ({
    ...database.getAiSettings(),
    hasApiKey: Boolean(getApiKey()),
  }));
  handle("saveAiSettings", async (settings, apiKey) => {
    if (apiKey) {
      await writeApiCredential(apiKey);
      apiCredential = apiKey;
    }
    return {
      ...database.saveAiSettings(settings),
      hasApiKey: Boolean(getApiKey()),
    };
  });
  handle("listAiJobs", (projectId) => database.listAiJobs(projectId));
  handle("cancelAiJob", (id) => ai.cancelJob(id));
  handle("retryAiJob", async (id) => {
    const sourceJob = database.getAiJob(id);
    if (!sourceJob) throw new Error("AI 任务不存在");
    const context = validateChapterAiRetrySource(sourceJob, database.getAiJobRetryContext(id));
    assertChapterRetrySnapshot(context, database.getChapter(context.projectId, context.chapterId));
    const task = startOneChapter(context.projectId, context.chapterId, undefined, "bypass");
    if (!task.jobId || task.source !== "network") {
      await task.completion;
      throw new Error("重试没有创建新的 AI 任务，请返回章节工作区重新生成");
    }
    void task.completion
      .catch((error) => logger.write("error", "ai.retry.failed", {
        sourceJobId: id,
        retryJobId: task.jobId,
        projectId: context.projectId,
        chapterId: context.chapterId,
        error: error instanceof Error ? error.message : String(error),
      }))
      .catch(() => {});
    const retryJob = database.getAiJob(task.jobId);
    if (!retryJob) throw new Error("AI 重试任务已启动，但审计记录不可用");
    return retryJob;
  });
  handle("exportProject", (id, format) => exportProject(id, format));
  handle("importMetricsCsv", (id, csvText) => {
    const metrics = parseMetricsCsv(csvText);
    database.saveMetrics(id, metrics);
    return metrics.length;
  });
  handle("getReviewSuggestions", (id) =>
    analyzeMetrics(database.getProject(id).metrics),
  );
  handle("saveReviewExperiment", (id, experiment) => database.saveReviewExperiment(id, experiment));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4f4f1",
    title: "长篇创作工作台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  const openExternalHttpUrl = (value: string) => {
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        void shell.openExternal(url.toString());
      }
    } catch {
      // Ignore malformed and unsupported external URLs.
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternalHttpUrl(url);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const workspaceRoot =
    process.env.NOVEL_STUDIO_WORKSPACE ||
    path.join(app.getPath("documents"), "长篇创作工作台数据");
  try {
    apiCredential = await readApiCredential();
  } catch {
    apiCredential = "";
  }
  database = new WorkspaceDatabase(workspaceRoot);
  database.pruneAiJobHistory();
  logger = new StructuredLogger(path.join(app.getPath("userData"), "logs"));
  logger.write("info", "application.started", { version: app.getVersion(), workspace: workspaceRoot });
  worker = new BackgroundWorker();
  ai = new AiService(database, getApiKey, 120_000, 0, (level, event, data) => logger.write(level, event, data));
  registerHandlers();
  void researchHandlers.runDueRankingSchedules();
  void systemHandlers.runAutomaticBackup();
  rankingScheduleTimer = setInterval(
    () => void researchHandlers.runDueRankingSchedules(),
    15 * 60 * 1000,
  );
  autoBackupTimer = setInterval(
    () => void systemHandlers.runAutomaticBackup(),
    15 * 60 * 1000,
  );
  createWindow();
  configureAutoUpdates(logger, async () => {
    database.checkpointAll();
    const password = await readAutoBackupCredential();
    if (!password) throw new Error("自动更新前需要先在设置中保存自动备份密码");
    await createEncryptedBackup(database.root, path.join(database.backupRoot, `pre-update-${app.getVersion()}.novelbak`), password);
  });
  process.on("uncaughtException", (error) => logger.write("error", "process.uncaughtException", { error: error.message, stack: error.stack }));
  process.on("unhandledRejection", (reason) => logger.write("error", "process.unhandledRejection", { error: String(reason) }));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (rankingScheduleTimer) clearInterval(rankingScheduleTimer);
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  void worker?.close();
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
