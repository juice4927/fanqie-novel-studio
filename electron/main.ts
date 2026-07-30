import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import type {
  AppApi,
  BatchGenerationPreview,
  Chapter,
  ConceptCandidate,
  ContextPackage,
  ImportPreview,
  InsightPack,
  MetricSnapshot,
  ProjectDetail,
  QualityIssue,
  RankingSnapshot,
  RankingCaptureSchedule,
  ResearchBook,
} from "../src/shared/types";
import { WorkspaceDatabase, now } from "./database";
import { BackgroundWorker } from "./worker-client";
import { AiService } from "./ai-service";
import { createEncryptedBackup, restoreEncryptedBackup } from "./backup";
import { analyzeRankings, capturePublicRankingPage } from "./ranking-service";
import { analyzeMetrics, parseMetricsCsv } from "../src/shared/metrics";
import {
  findCurrentVolume,
  volumeBoundaryChapters,
} from "../src/shared/planning";
import { readApiCredential, writeApiCredential } from "./credential-store";
import { compileCommercialGuidance } from "../src/shared/commercial-knowledge";
import { buildLongTermMemory } from "../src/shared/summaries";
import { completeRankingSchedule, failRankingSchedule, nextRankingRun } from "../src/shared/ranking-schedule";

let mainWindow: BrowserWindow | null = null;
let database: WorkspaceDatabase;
let worker: BackgroundWorker;
let ai: AiService;
let apiCredential = "";
const activeGenerationProjects = new Set<string>();
let rankingScheduleTimer: ReturnType<typeof setInterval> | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function runRankingSchedule(id: string) {
  const schedule = database.listRankingSchedules().find((item) => item.id === id);
  if (!schedule) throw new Error("定时采榜任务不存在");
  const snapshot = await capturePublicRankingPage(schedule.url, schedule.listName);
  database.saveRanking(snapshot);
  database.saveRankingSchedule(completeRankingSchedule(schedule, snapshot));
  return snapshot;
}

async function runDueRankingSchedules() {
  const current = Date.now();
  for (const schedule of database.listRankingSchedules()) {
    if (!schedule.enabled || Date.parse(schedule.nextRunAt) > current) continue;
    try { await runRankingSchedule(schedule.id); } catch (error) {
      database.saveRankingSchedule(failRankingSchedule(schedule, error));
    }
  }
}

const majorStateChange =
  /死亡|牺牲|突破|晋级|身份揭露|身份暴露|决裂|成婚|离婚|重生|穿越|失忆|叛变|真相揭晓|终局/;

function previewChapterBatch(
  project: ProjectDetail,
  settings: ReturnType<WorkspaceDatabase["getAiSettings"]>,
  chapterId: string,
): BatchGenerationPreview {
  const start = project.chapters.find((chapter) => chapter.id === chapterId);
  const blocked = (
    reason: string,
    chapters: BatchGenerationPreview["chapters"] = [],
  ): BatchGenerationPreview => ({
    chapters,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    canRun: false,
    blockingReason: reason,
  });
  if (!start) return blocked("章节不存在");
  if (start.batchMode !== "五章批次") return blocked("请先保存“五章批次”模式");
  if (!project.contract.approved) return blocked("创作契约审批后才能生成正文");
  if (project.facts.some((fact) => fact.confidence === "有冲突"))
    return blocked("状态账本存在冲突事实，已自动恢复逐章模式");

  const ordered = project.chapters
    .filter(
      (chapter) =>
        chapter.number >= start.number && chapter.number < start.number + 5,
    )
    .sort((a, b) => a.number - b.number);
  if (
    ordered.length !== 5 ||
    ordered.some((chapter, index) => chapter.number !== start.number + index)
  ) {
    return blocked("需要从当前章开始预先建立连续五章及其章纲");
  }
  const boundaries = volumeBoundaryChapters(project.plans);
  const activeHardIssues = new Set(
    project.issues
      .filter((issue) => issue.severity === "硬性" && issue.status === "待处理")
      .map((issue) => issue.chapterId),
  );
  for (const chapter of ordered) {
    const summary = ordered.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
    }));
    if (chapter.batchMode !== "五章批次")
      return blocked(`第${chapter.number}章处于逐章模式`, summary);
    if (chapter.isKeyChapter)
      return blocked(`第${chapter.number}章是关键章，必须逐章审批`, summary);
    if (boundaries.has(chapter.number))
      return blocked(
        `第${chapter.number}章位于卷首或卷末，必须逐章审批`,
        summary,
      );
    if (majorStateChange.test(chapter.outline))
      return blocked(
        `第${chapter.number}章包含重大状态变化，必须逐章审批`,
        summary,
      );
    if (activeHardIssues.has(chapter.id))
      return blocked(`第${chapter.number}章有未解决的硬性告警`, summary);
    if (!chapter.outline.trim())
      return blocked(`第${chapter.number}章尚未填写章纲`, summary);
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      return blocked(`第${chapter.number}章已经定稿或进入发布流程`, summary);
  }

  const inputTokens = ordered.reduce(
    (sum, chapter) => sum + compileContext(project, chapter).estimatedTokens,
    0,
  );
  const outputTokens = ordered.length * Math.ceil(2600 / 1.7);
  const estimatedCost =
    (inputTokens / 1_000_000) * settings.inputPricePerMillion +
    (outputTokens / 1_000_000) * settings.outputPricePerMillion;
  return {
    chapters: ordered.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
    })),
    inputTokens,
    outputTokens,
    estimatedCost,
    canRun: true,
    blockingReason: null,
  };
}

function getApiKey() {
  return apiCredential;
}

function compileContext(
  project: ProjectDetail,
  chapter: Chapter,
): ContextPackage {
  const approvedPlans = project.plans.filter(
    (plan) => plan.status === "已批准",
  );
  const volume = findCurrentVolume(approvedPlans, chapter.number);
  const rolling = approvedPlans
    .filter(
      (plan) =>
        (plan.kind === "粗纲" ||
          plan.kind === "细纲" ||
          plan.kind === "场景卡") &&
        plan.ordinal >= chapter.number &&
        plan.ordinal <= chapter.number + 30,
    )
    .slice(0, 30);
  const recent = project.chapters
    .filter((item) => item.number < chapter.number)
    .slice(-5);
  const approvedOwnText = project.chapters
    .filter(
      (item) =>
        ["已定稿", "待发布", "已发布"].includes(item.status) && item.content,
    )
    .slice(-20);
  const ownText = approvedOwnText.map((item) => item.content).join("\n");
  const sentences = ownText.split(/[。！？!?]/).filter(Boolean);
  const paragraphs = ownText.split(/\n+/).filter(Boolean);
  const averageSentence = sentences.length
    ? Math.round(
        sentences.reduce((sum, item) => sum + item.length, 0) /
          sentences.length,
      )
    : 0;
  const averageParagraph = paragraphs.length
    ? Math.round(
        paragraphs.reduce((sum, item) => sum + item.length, 0) /
          paragraphs.length,
      )
    : 0;
  const dialogueDensity = ownText.length
    ? Math.round(
        ((ownText.match(/[“”]/g)?.length ?? 0) / ownText.length) * 1000,
      )
    : 0;
  const activeFacts = project.facts.filter(
    (fact) =>
      fact.confidence === "已确认" &&
      fact.validFromChapter <= chapter.number &&
      (fact.validToChapter === null || fact.validToChapter >= chapter.number),
  );
  const secrets = activeFacts.filter(
    (fact) => fact.kind === "秘密" && fact.knowledgeScope.trim(),
  );
  const linkedExpectations = project.expectations.filter((item) =>
    chapter.linkedExpectationIds?.includes(item.id),
  );
  const openExpectations = project.expectations.filter(
    (item) => item.status === "待兑现" || item.status === "部分兑现",
  );
  const context = {
    contract: [
      `故事前提：${project.contract.premise}`,
      `题材子类型：${project.contract.genreSubtype || "未选择"}`,
      `番茄分类：${project.contract.fanqieCategoryKey || "未选择"}`,
      `主角欲望：${project.contract.protagonistDesire}`,
      `读者承诺：${project.contract.readerPromise}`,
      `核心情绪：${project.contract.coreEmotion}`,
      `终局：${project.contract.ending}`,
      `不可破坏规则：${project.contract.immutableRules.join("；") || "无"}`,
      `禁写项：${project.contract.prohibitedPatterns.join("；") || "无"}`,
    ].join("\n"),
    commercialGuidance: compileCommercialGuidance(
      project.summary.genre,
      chapter.number,
      {
        currentWords: project.summary.currentWords,
        targetWords: project.summary.targetWords,
        subtype: project.contract.genreSubtype,
        fanqieCategoryKey: project.contract.fanqieCategoryKey,
      },
    ),
    chapterIntent: [
      `本章承诺：${chapter.chapterPromise || "未填写"}`,
      `预期回报：${chapter.expectedPayoff || "未填写"}`,
      `当前危机：${chapter.crisis || "未填写"}`,
      `结尾期待：${chapter.endingExpectation || "未填写"}`,
    ].join("\n"),
    expectationLedger:
      [
        ...linkedExpectations.map(
          (item) =>
            `[本章承接] ${item.title}｜第${item.sourceChapter}章提出｜预计第${item.expectedPayoffChapter ?? "未定"}章兑现｜${item.status}`,
        ),
        ...openExpectations
          .filter(
            (item) =>
              !linkedExpectations.some((linked) => linked.id === item.id),
          )
          .slice(-20)
          .map(
            (item) =>
              `[待处理] ${item.title}｜第${item.sourceChapter}章提出｜预计第${item.expectedPayoffChapter ?? "未定"}章兑现｜${item.status}`,
          ),
      ].join("\n") || "暂无跨章节期待",
    longTermMemory: buildLongTermMemory(project.summaries, chapter.number),
    volumeGoal: volume
      ? `${volume.title}\n目标：${volume.goal}\n矛盾：${volume.conflict}\n结果：${volume.outcome}`
      : "尚未批准当前卷纲",
    rollingOutline:
      rolling
        .map(
          (plan) =>
            `${plan.ordinal}. ${plan.title}｜${plan.goal}｜${plan.outcome}`,
        )
        .join("\n") || chapter.outline,
    recentSummary: recent
      .map(
        (item) =>
          project.summaries.find(
            (summary) =>
              summary.layer === "章节" && summary.fromChapter === item.number,
          )?.content ??
          `第${item.number}章 ${item.title}：${item.outline || item.content.slice(0, 180)}`,
      )
      .join("\n"),
    relevantFacts: activeFacts
      .slice(0, 80)
      .map(
        (fact) =>
          `[${fact.genreDimension || fact.kind}] ${fact.subject}｜${fact.predicate}｜${fact.value}（自第${fact.validFromChapter}章）`,
      )
      .join("\n"),
    forbiddenKnowledge:
      secrets
        .map(
          (fact) =>
            `${fact.subject}：${fact.value}；当前知情范围：${fact.knowledgeScope}`,
        )
        .join("\n") || "无额外限制",
    authorStyle: approvedOwnText.length
      ? `仅根据本项目已定稿正文统计：平均句长 ${averageSentence} 字，平均段长 ${averageParagraph} 字，对话标记密度 ${dialogueDensity}‰。保持当前项目的叙事密度，不模仿研究样本。`
      : "尚无本项目已定稿正文，不加载任何样本文风。",
    estimatedTokens: 0,
  } satisfies ContextPackage;
  context.estimatedTokens = Math.ceil(
    Object.values(context)
      .filter((value) => typeof value === "string")
      .join("\n").length / 1.8,
  );
  return context;
}

function getDashboard() {
  const projects = database.listProjects();
  const details = projects.map((project) => database.getProject(project.id));
  const dueToday = details
    .flatMap((detail) => detail.schedule)
    .filter(
      (item) =>
        item.publishAt.slice(0, 10) <= now().slice(0, 10) &&
        item.status !== "已发布",
    );
  const activeAlerts = details
    .flatMap((detail) => detail.issues)
    .filter((issue) => issue.status === "待处理")
    .slice(0, 12);
  return {
    projects,
    dueToday,
    activeAlerts,
    totals: {
      activeBooks: projects.filter(
        (project) => !["暂停", "完结", "归档"].includes(project.status),
      ).length,
      totalWords: projects.reduce(
        (sum, project) => sum + project.currentWords,
        0,
      ),
      stockChapters: projects.reduce(
        (sum, project) => sum + project.stockChapters,
        0,
      ),
      pendingIssues: activeAlerts.length,
    },
  };
}

function value(row: Record<string, string>, keys: string[], fallback = "") {
  for (const key of keys)
    if (row[key] !== undefined && row[key] !== "") return row[key];
  return fallback;
}

function parseNumber(raw: string) {
  const numeric = Number(String(raw).replace(/[,，万]/g, ""));
  if (String(raw).includes("万")) return Math.round(numeric * 10000);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseRankingCsv(csvText: string, listName: string): RankingSnapshot {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length && !parsed.data.length)
    throw new Error(parsed.errors[0].message);
  const id = randomUUID();
  return {
    id,
    source: "CSV 手动导入",
    listName,
    capturedAt: now(),
    status: parsed.errors.length ? "部分成功" : "成功",
    error: parsed.errors.length
      ? parsed.errors.map((error) => error.message).join("；")
      : null,
    entries: parsed.data.map((row, index) => ({
      id: randomUUID(),
      snapshotId: id,
      rank: parseNumber(value(row, ["排名", "rank"], String(index + 1))),
      title: value(row, ["书名", "title"], "未命名"),
      author: value(row, ["作者", "author"], "未知"),
      genre: value(row, ["题材", "分类", "genre"], "未分类"),
      words: parseNumber(value(row, ["字数", "words"])),
      status: value(row, ["状态", "status"], "未知"),
      tags: value(row, ["标签", "tags"])
        .split(/[、,，]/)
        .filter(Boolean),
      sourceUrl: value(row, ["链接", "url", "sourceUrl"]),
    })),
  };
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
  const handle = (
    channel: keyof AppApi,
    callback: (...args: any[]) => unknown,
  ) =>
    ipcMain.handle(`studio:${channel}`, (_event, ...args) => callback(...args));
  handle("getDashboard", () => getDashboard());
  handle("listProjects", () => database.listProjects());
  handle("createProject", (input) => database.createProject(input));
  handle("deleteProject", (id, confirmationTitle) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品仍有正文生成任务运行，暂时不能删除");
    return database.deleteProject(id, confirmationTitle);
  });
  handle("getProject", (id) => database.getProject(id));
  handle("updateProject", (id, patch) => database.updateProject(id, patch));
  handle("saveContract", (id, contract) => database.saveContract(id, contract));
  handle("approveContract", (id) => database.approveContract(id));
  handle("savePlan", (id, plan) => database.savePlan(id, plan));
  handle("approvePlan", (id, planId) => database.approvePlan(id, planId));
  handle("generatePlanningDraft", async (id, input) => {
    const project = database.getProject(id);
    if (!project.contract.approved) throw new Error("必须先审批创作契约");
    if (input.mode === "全书结构" && project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷"))
      throw new Error("当前已有宏观阶段或分卷；为避免重复，AI 不会覆盖现有结构");
    const fromChapter = input.fromChapter ?? Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1));
    const count = input.mode === "后续章纲" ? input.chapterCount ?? 10 : 0;
    if (input.mode === "后续章纲" && project.chapters.some((chapter) => chapter.number >= fromChapter && chapter.number < fromChapter + count))
      throw new Error(`第${fromChapter}–${fromChapter + count - 1}章范围内已有章节，AI 不会覆盖`);
    const generated = await ai.generatePlanning(project, { ...input, fromChapter });
    const latest = database.getProject(id);
    if (generated.chapters.some((chapter) => latest.chapters.some((existing) => existing.number === chapter.number)))
      throw new Error("生成期间章节范围发生变化，本次结果未保存，请重新生成");
    const plans = generated.plans.map((plan) => database.savePlan(id, plan));
    const chapters = generated.chapters.map((chapter) => database.saveChapter(id, chapter));
    return { ...generated, plans, chapters };
  });
  handle("saveChapter", (id, chapter) => database.saveChapter(id, chapter));
  handle("saveExpectation", (id, expectation) =>
    database.saveExpectation(id, expectation),
  );
  handle("transitionChapter", async (id, chapterId, status) => {
    const saved = database.transitionChapter(id, chapterId, status);
    if (status === "已定稿" && getApiKey()) {
      try {
        const project = database.getProject(id);
        const candidates = await ai.extractChapterFacts(project, saved);
        const existing = new Set(project.facts.map((fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`));
        for (const fact of candidates) {
          const key = `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`;
          if (!existing.has(key)) database.saveFact(id, fact);
        }
      } catch {
        // Finalization must remain available if optional AI extraction fails.
      }
    }
    return saved;
  });
  handle("compileContext", (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    return compileContext(
      {
        ...project,
        facts: database.searchRelevantFacts(
          id,
          `${chapter.title} ${chapter.outline}`,
          chapter.number,
        ),
      },
      chapter,
    );
  });
  handle("searchProject", (id, query) => database.searchProject(id, query));
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
          compileContext({ ...project, facts }, chapter),
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
  handle("extractChapterFacts", async (id, chapterId) => {
    const project = database.getProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (!chapter.content.trim()) throw new Error("章节还没有正文");
    const candidates = await ai.extractChapterFacts(project, chapter);
    const existing = new Set(project.facts.map((fact) => `${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`));
    return candidates
      .filter((fact) => !existing.has(`${fact.evidenceChapter}|${fact.kind}|${fact.subject}|${fact.predicate}|${fact.value}`))
      .map((fact) => database.saveFact(id, fact));
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
  handle("listRankings", () => database.listRankings());
  handle("importRankingCsv", (csvText, listName) => {
    const snapshot = parseRankingCsv(csvText, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  handle("capturePublicRanking", async (url, listName) => {
    const snapshot = await capturePublicRankingPage(url, listName);
    database.saveRanking(snapshot);
    return snapshot;
  });
  handle("listRankingSchedules", () => database.listRankingSchedules());
  handle("saveRankingSchedule", (input: Parameters<AppApi["saveRankingSchedule"]>[0]) => {
    const existing = input.id ? database.listRankingSchedules().find((item) => item.id === input.id) : undefined;
    const restartCycle = !existing || existing.frequency !== input.frequency || (!existing.enabled && input.enabled);
    return database.saveRankingSchedule({
      id: input.id || randomUUID(),
      url: input.url,
      listName: input.listName,
      frequency: input.frequency,
      enabled: input.enabled,
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: restartCycle ? nextRankingRun(input.frequency) : existing.nextRunAt,
      lastStatus: existing?.lastStatus ?? "未运行",
      lastError: existing?.lastError ?? null,
    });
  });
  handle("runRankingSchedule", (id) => runRankingSchedule(id));
  handle("deleteRankingSchedule", (id) => database.deleteRankingSchedule(id));
  handle("getRankingAnalytics", () => analyzeRankings(database.listRankings()));
  handle("listResearchBooks", () => database.listResearchBooks());
  handle("previewResearchFile", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "小说文档", extensions: ["txt", "epub", "docx"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return worker.run<ImportPreview>("parse-document", {
      filePath: result.filePaths[0],
    });
  });
  handle(
    "importResearchBook",
    (preview, genre, rightsConfirmed, cloudConsent) => {
      if (!rightsConfirmed) throw new Error("必须确认拥有材料的合法使用权");
      const book: ResearchBook = {
        id: randomUUID(),
        title: path.basename(preview.fileName, path.extname(preview.fileName)),
        author: "未标注",
        genre,
        sourceType: preview.sourceType,
        chapterCount: preview.chapters.length,
        wordCount: preview.totalWords,
        rightsConfirmed,
        cloudConsent,
        importedAt: now(),
        status: "待拆解",
      };
      database.saveResearchBook(book, preview.chapters);
      return book;
    },
  );
  handle("listInsights", () => database.listInsights());
  handle("createInsight", (input) => {
    const insight: InsightPack = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
    };
    database.saveInsight(insight);
    return insight;
  });
  handle("deconstructResearchBook", async (bookId) => {
    const source = database.getResearchBook(bookId);
    database.updateResearchBook({ ...source.book, status: "拆解中" });
    try {
      const result = await ai.deconstruct(source.book, source.chapters);
      database.saveInsight(result.insight);
      database.saveResearchAnalyses(result.analyses);
      database.updateResearchBook({ ...source.book, status: "已拆解" });
      return result.insight;
    } catch (error) {
      database.updateResearchBook({ ...source.book, status: "失败" });
      throw error;
    }
  });
  handle("listResearchAnalyses", (bookId) =>
    database.listResearchAnalyses(bookId),
  );
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
  handle("generateChapterDraft", async (id, chapterId) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品已有正文生成任务正在运行");
    const project = database.getProject(id);
    if (!project.contract.approved)
      throw new Error("创作契约审批后才能生成正文");
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在");
    if (!chapter.outline.trim()) throw new Error("请先填写本章章纲");
    if (["已定稿", "待发布", "已发布"].includes(chapter.status))
      throw new Error("已定稿或进入发布流程的章节不能由 AI 覆写");
    activeGenerationProjects.add(id);
    try {
      const generated = await ai.draftChapter(
        id,
        chapter,
        compileContext(
          {
            ...project,
            facts: database.searchRelevantFacts(
              id,
              `${chapter.title} ${chapter.outline}`,
              chapter.number,
            ),
          },
          chapter,
        ),
      );
      return database.saveGeneratedChapter(id, generated);
    } finally {
      activeGenerationProjects.delete(id);
    }
  });
  handle("previewChapterBatch", (id, chapterId) =>
    previewChapterBatch(
      database.getProject(id),
      database.getAiSettings(),
      chapterId,
    ),
  );
  handle("generateChapterBatch", async (id, chapterId) => {
    if (activeGenerationProjects.has(id))
      throw new Error("该作品已有正文生成任务正在运行");
    const preview = previewChapterBatch(
      database.getProject(id),
      database.getAiSettings(),
      chapterId,
    );
    if (!preview.canRun)
      throw new Error(preview.blockingReason ?? "当前不能执行五章批次");
    activeGenerationProjects.add(id);
    try {
      const generated: Chapter[] = [];
      for (const candidate of preview.chapters) {
        const currentProject = database.getProject(id);
        const chapter = currentProject.chapters.find(
          (item) => item.id === candidate.id,
        );
        if (!chapter) throw new Error(`第${candidate.number}章不存在`);
        const facts = database.searchRelevantFacts(
          id,
          `${chapter.title} ${chapter.outline}`,
          chapter.number,
        );
        const draft = await ai.draftChapter(
          id,
          chapter,
          compileContext({ ...currentProject, facts }, chapter),
        );
        generated.push(database.saveGeneratedChapter(id, draft));
      }
      return generated;
    } finally {
      activeGenerationProjects.delete(id);
    }
  });
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
  handle("exportProject", (id, format) => exportProject(id, format));
  handle("importMetricsCsv", (id, csvText) => {
    const metrics = parseMetricsCsv(csvText);
    database.saveMetrics(id, metrics);
    return metrics.length;
  });
  handle("getReviewSuggestions", (id) =>
    analyzeMetrics(database.getProject(id).metrics),
  );
  handle("createBackup", async (password) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "创建加密备份",
      defaultPath: `长篇创作工作台-${now().slice(0, 10)}.novelbak`,
      filters: [{ name: "加密备份", extensions: ["novelbak"] }],
    });
    if (result.canceled || !result.filePath) return null;
    database.checkpointAll();
    await createEncryptedBackup(database.root, result.filePath, password);
    return result.filePath;
  });
  handle("restoreBackup", async (password) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "校验并恢复备份副本",
      properties: ["openFile"],
      filters: [{ name: "加密备份", extensions: ["novelbak"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return restoreEncryptedBackup(result.filePaths[0], database.root, password);
  });
  handle("getWorkspacePath", () => database.root);
  ipcMain.handle("studio:showInFolder", (_event, target: string) =>
    shell.showItemInFolder(target),
  );
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
      sandbox: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
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
  worker = new BackgroundWorker();
  ai = new AiService(database, getApiKey);
  registerHandlers();
  void runDueRankingSchedules();
  rankingScheduleTimer = setInterval(() => void runDueRankingSchedules(), 15 * 60 * 1000);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (rankingScheduleTimer) clearInterval(rankingScheduleTimer);
  void worker?.close();
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
