import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerSystemHandlers,
  type SystemHandlerDependencies,
} from "../electron/handlers/system-handlers";
import type { RegisterHandler } from "../electron/handlers/types";
import type { ProjectDetail, SystemHealthReport } from "../src/shared/types";

const report: SystemHealthReport = {
  checkedAt: "2026-07-31T00:00:00.000Z",
  status: "正常",
  projectCount: 1,
  chapterCount: 5,
  failedAiJobs: 0,
  workspaceBytes: 1024,
  backupBytes: 2048,
  checks: [],
};

const project = {
  summary: {
    id: "project-1",
    title: "旧城回声",
  },
  contract: {
    approved: true,
    version: 3,
  },
  plans: [
    { kind: "分卷", status: "已批准" },
    { kind: "分卷", status: "草稿" },
  ],
  chapters: [
    {
      id: "chapter-1",
      number: 1,
      title: "雨夜来信",
      status: "已定稿",
      content: "第一段正文\n\n第二段正文",
    },
    {
      id: "chapter-2",
      number: 2,
      title: "旧城坐标",
      status: "待发布",
      content: "第二章正文",
    },
    {
      id: "chapter-3",
      number: 3,
      title: "未完成章节",
      status: "草稿",
      content: "不应导出",
    },
  ],
  issues: [
    {
      status: "待处理",
      severity: "硬性",
      category: "连续性",
      message: "时间线冲突",
    },
    {
      status: "待处理",
      severity: "建议",
      category: "节奏",
      message: "转场过快",
    },
  ],
  facts: [
    {
      confidence: "有冲突",
      subject: "林舟",
      predicate: "所在城市",
      value: "旧城",
      evidenceChapter: 2,
    },
  ],
} as unknown as ProjectDetail;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDependencies(workerRun = vi.fn(async () => report)) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const register: RegisterHandler = (channel, callback) => {
    handlers.set(channel, callback);
  };
  const database = {
    root: "C:/workspace",
    backupRoot: "C:/workspace/backups",
    checkpointAll: vi.fn(),
    finishAutoBackup: vi.fn(),
    getAutoBackupSettings: vi.fn(() => ({
      enabled: false,
      frequency: "daily",
      retentionCount: 7,
      hasPassword: false,
      lastRunAt: null,
      lastStatus: "未运行",
      lastError: null,
      nextRunAt: null,
    })),
    getChapter: vi.fn((_projectId: string, chapterId: string) =>
      project.chapters.find((chapter) => chapter.id === chapterId)!,
    ),
    getProjectOverview: vi.fn(() => ({
      ...project,
      chapters: project.chapters.map((chapter) => ({
        ...chapter,
        content: "",
      })),
    })),
    rebuildSearchIndexes: vi.fn(),
    runSystemHealthCheck: vi.fn(() => report),
    saveAutoBackupSettings: vi.fn(),
  };
  const workerCancel = vi.fn(() => true);
  const dependencies = {
    register,
    database,
    worker: { run: workerRun, cancel: workerCancel },
    logFilePath: "C:/workspace/application.jsonl",
    getSystemMetadata: () => ({
      appVersion: "1.0.0",
      electron: "43",
      chrome: "140",
      node: "22",
      platform: "win32",
      arch: "x64",
    }),
    chooseBackupDestination: vi.fn(async () => null),
    chooseBackupSource: vi.fn(async () => null),
    chooseDiagnosticDestination: vi.fn(async () => null),
    chooseProjectExportDestination: vi.fn(async () => null),
  } as unknown as SystemHandlerDependencies;
  return {
    dependencies,
    handlers,
    database,
    workerCancel,
  };
}

describe("system handlers", () => {
  it("registers the complete system surface and honors canceled file selection", async () => {
    const { dependencies, handlers, database } = createDependencies();
    registerSystemHandlers(dependencies);

    expect([...handlers.keys()].sort()).toEqual([
      "cancelSystemHealthCheck",
      "createBackup",
      "exportDiagnosticBundle",
      "exportProject",
      "getAutoBackupSettings",
      "getSystemHealthCheck",
      "getWorkspacePath",
      "rebuildSearchIndexes",
      "restoreBackup",
      "runAutoBackup",
      "runSystemHealthCheck",
      "saveAutoBackupSettings",
      "startSystemHealthCheck",
    ]);
    expect(handlers.get("getWorkspacePath")!()).toBe("C:/workspace");
    await expect(handlers.get("createBackup")!("password")).resolves.toBeNull();
    expect(database.checkpointAll).not.toHaveBeenCalled();
    await expect(
      handlers.get("exportProject")!("project-1", "txt"),
    ).resolves.toBeNull();
    expect(database.getChapter).not.toHaveBeenCalled();
  });

  it.each(["txt", "md", "docx"] as const)(
    "exports finalized chapters and a publishing report as %s",
    async (format) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "novel-export-"));
      temporaryDirectories.push(directory);
      const destination = path.join(directory, `旧城回声-发布包.${format}`);
      const { dependencies, handlers } = createDependencies();
      dependencies.chooseProjectExportDestination = vi.fn(async () =>
        destination,
      );
      registerSystemHandlers(dependencies);

      await expect(
        handlers.get("exportProject")!("project-1", format),
      ).resolves.toBe(destination);

      expect(dependencies.chooseProjectExportDestination).toHaveBeenCalledWith(
        `旧城回声-发布包.${format}`,
        format,
      );
      expect(dependencies.database.getChapter).toHaveBeenCalledTimes(2);
      expect(dependencies.database.getChapter).toHaveBeenNthCalledWith(
        1,
        "project-1",
        "chapter-1",
      );
      expect(dependencies.database.getChapter).toHaveBeenNthCalledWith(
        2,
        "project-1",
        "chapter-2",
      );
      if (format === "docx") {
        const archive = await JSZip.loadAsync(readFileSync(destination));
        const documentXml = await archive
          .file("word/document.xml")!
          .async("string");
        expect(documentXml).toContain("旧城回声");
        expect(documentXml).toContain("第1章 雨夜来信");
        expect(documentXml).toContain("第一段正文");
        expect(documentXml).not.toContain("未完成章节");
      } else {
        const content = readFileSync(destination, "utf8");
        expect(content).toContain(
          `${format === "md" ? "# " : ""}第1章 雨夜来信`,
        );
        expect(content).toContain("第2章 旧城坐标");
        expect(content).not.toContain("未完成章节");
        expect(content).not.toContain("不应导出");
      }

      const publishingReport = readFileSync(
        path.join(directory, "旧城回声-发布包-检查报告.md"),
        "utf8",
      );
      expect(publishingReport).toContain("- 导出章节：2 章");
      expect(publishingReport).toContain("- 创作契约：已审批 v3");
      expect(publishingReport).toContain("- 已批准卷纲：1");
      expect(publishingReport).toContain("- 未处理硬性问题：1");
      expect(publishingReport).toContain("- 其他待处理问题：1");
      expect(publishingReport).toContain("- 冲突事实：1");
    },
  );

  it("rejects exports when no chapter has reached a publishable state", async () => {
    const { dependencies, handlers, database } = createDependencies();
    database.getProjectOverview.mockReturnValue({
      ...project,
      chapters: project.chapters.map((chapter) => ({
        ...chapter,
        content: "",
        status: "草稿" as const,
      })),
    });
    registerSystemHandlers(dependencies);

    await expect(
      handlers.get("exportProject")!("project-1", "txt"),
    ).rejects.toThrow("没有可导出的已定稿章节");
    expect(dependencies.chooseProjectExportDestination).not.toHaveBeenCalled();
  });

  it("deduplicates a running health task and retains progress through completion", async () => {
    let resolveHealth!: (value: SystemHealthReport) => void;
    let onProgress!: (value: unknown) => void;
    const healthPromise = new Promise<SystemHealthReport>((resolve) => {
      resolveHealth = resolve;
    });
    const workerRun = vi.fn(
      (_task: string, _payload: unknown, options: { onProgress: (value: unknown) => void }) => {
        onProgress = options.onProgress;
        return healthPromise;
      },
    );
    const { dependencies, handlers } = createDependencies(workerRun);
    registerSystemHandlers(dependencies);

    const first = handlers.get("startSystemHealthCheck")!() as { id: string };
    const second = handlers.get("startSystemHealthCheck")!() as { id: string };
    expect(second.id).toBe(first.id);
    expect(workerRun).toHaveBeenCalledTimes(1);

    onProgress({ completed: 2, total: 4, label: "检查项目数据库" });
    expect(handlers.get("getSystemHealthCheck")!(first.id)).toMatchObject({
      status: "运行中",
      completed: 2,
      total: 4,
      label: "检查项目数据库",
    });

    resolveHealth(report);
    await healthPromise;
    await Promise.resolve();
    expect(handlers.get("getSystemHealthCheck")!(first.id)).toMatchObject({
      status: "完成",
      completed: 4,
      report,
    });
  });

  it("marks a running health task canceled before delegating cancellation", () => {
    const workerRun = vi.fn(() => new Promise<SystemHealthReport>(() => {}));
    const { dependencies, handlers, workerCancel } = createDependencies(workerRun);
    registerSystemHandlers(dependencies);
    const task = handlers.get("startSystemHealthCheck")!() as { id: string };

    expect(handlers.get("cancelSystemHealthCheck")!(task.id)).toBe(true);
    expect(workerCancel).toHaveBeenCalledWith(task.id);
    expect(handlers.get("getSystemHealthCheck")!(task.id)).toMatchObject({
      status: "已取消",
      label: "正在取消",
    });
  });
});
