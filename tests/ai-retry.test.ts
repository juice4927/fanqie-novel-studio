import { describe, expect, it } from "vitest";
import {
  assertChapterRetrySnapshot,
  serializeChapterAiRetryContext,
  validateChapterAiRetrySource,
} from "../electron/ai-retry";
import type { AiJobRecord, Chapter } from "../src/shared/types";

const sourceJob = (overrides: Partial<Pick<AiJobRecord, "projectId" | "taskType" | "retryable">> = {}) => ({
  projectId: "project-1",
  taskType: "draft-chapter",
  retryable: true,
  ...overrides,
});

const chapter = {
  id: "chapter-2",
  number: 2,
  title: "旧标题",
  outline: "旧章纲",
  content: "",
  wordCount: 0,
  status: "章纲",
  batchMode: "逐章",
  isKeyChapter: false,
  revision: 7,
  updatedAt: "2026-07-31T00:00:00.000Z",
} satisfies Chapter;

describe("chapter AI retry validation", () => {
  it("serializes and validates chapter and former batch retry contexts", () => {
    const chapterContext = validateChapterAiRetrySource(
      sourceJob(),
      serializeChapterAiRetryContext("chapter", "project-1", chapter),
    );
    expect(chapterContext).toMatchObject({
      kind: "chapter",
      projectId: "project-1",
      chapterId: "chapter-2",
      revision: 7,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => assertChapterRetrySnapshot(chapterContext, chapter)).not.toThrow();

    const batchContext = validateChapterAiRetrySource(
      sourceJob(),
      serializeChapterAiRetryContext("batch", "project-1", chapter),
    );
    expect(batchContext).toMatchObject({ kind: "batch", chapterId: "chapter-2" });
  });

  it("rejects non-retryable and unrelated AI jobs", () => {
    const raw = serializeChapterAiRetryContext("chapter", "project-1", chapter);
    expect(() => validateChapterAiRetrySource(sourceJob({ retryable: false }), raw)).toThrow("当前不可重试");
    expect(() => validateChapterAiRetrySource(sourceJob({ taskType: "quality-review" }), raw)).toThrow(
      "只支持重试章节正文",
    );
    expect(() => validateChapterAiRetrySource(sourceJob({ projectId: "project-2" }), raw)).toThrow("项目不匹配");
  });

  it("rejects damaged, legacy, and structurally invalid contexts", () => {
    expect(() => validateChapterAiRetrySource(sourceJob(), "not-json")).toThrow("已损坏");
    expect(() =>
      validateChapterAiRetrySource(
        sourceJob(),
        JSON.stringify({
          kind: "chapter",
          projectId: "project-1",
          chapterId: "chapter-2",
        }),
      ),
    ).toThrow("旧版或无效");
    expect(() =>
      validateChapterAiRetrySource(
        sourceJob(),
        JSON.stringify({
          kind: "unknown",
          projectId: "project-1",
          chapterId: "chapter-2",
          revision: 7,
        }),
      ),
    ).toThrow("旧版或无效");
    expect(() =>
      validateChapterAiRetrySource(
        sourceJob(),
        JSON.stringify({
          kind: "chapter",
          projectId: "project-1",
          chapterId: "chapter-2",
          revision: 7.5,
        }),
      ),
    ).toThrow("旧版或无效");
  });

  it("blocks a retry after the chapter revision or target changes", () => {
    const context = validateChapterAiRetrySource(
      sourceJob(),
      serializeChapterAiRetryContext("chapter", "project-1", chapter),
    );
    expect(() => assertChapterRetrySnapshot(context, { ...chapter, revision: 8 })).toThrow("已被修改");
    expect(() => assertChapterRetrySnapshot(context, { ...chapter, outline: "自动保存后的新章纲" })).toThrow(
      "已被修改",
    );
    expect(() => assertChapterRetrySnapshot(context, { ...chapter, id: "chapter-3" })).toThrow("目标章节不匹配");
  });
});
