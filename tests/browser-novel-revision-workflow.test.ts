import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

const initialTime = "2026-08-01T00:00:00.000Z";
let storage: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
    get length() {
      return storage.size;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser novel revision workflow", () => {
  it("applies a selected-text revision through a protected chapter change request", async () => {
    const api = createBrowserApi();
    const [project] = await api.listProjects();
    const chapter = await api.getChapter(project.id, "demo-chapter-1");
    const selectedText = "她没有看老人，只看着沈砚。";
    const selectionStart = chapter.content.indexOf(selectedText);
    const proposal = await api.analyzeNovelRevision(project.id, {
      chapterId: chapter.id,
      instruction: "改为：“她越过老人，径直看向沈砚。”",
      authority: "设定为准",
      scope: "仅选区",
      selectionStart,
      selectionEnd: selectionStart + selectedText.length,
      selectedText,
    });

    expect(proposal.textRepair).toMatchObject({
      before: selectedText,
      after: "她越过老人，径直看向沈砚。",
      baseRevision: 3,
    });
    const result = await api.applyNovelRevision(project.id, proposal, [proposal.textRepair!.id]);

    expect(result.appliedTargets).toEqual(["第1章"]);
    expect(result.changeRequestIds).toHaveLength(1);
    const saved = await api.getChapter(project.id, chapter.id);
    expect(saved.content).toContain("她越过老人，径直看向沈砚。");
    expect(saved.status).toBe("待质检");
    expect(saved.revision).toBe(4);
    expect((await api.getProject(project.id)).changes).toContainEqual(
      expect.objectContaining({
        id: result.changeRequestIds[0],
        targetKind: "章节",
        targetId: chapter.id,
        status: "已应用",
      }),
    );

    const reloaded = createBrowserApi();
    expect((await reloaded.getChapter(project.id, chapter.id)).content).toContain("她越过老人，径直看向沈砚。");
  });

  it("rejects a revision after the analyzed chapter version changes", async () => {
    const api = createBrowserApi();
    const [project] = await api.listProjects();
    const outline = await api.getChapter(project.id, "demo-chapter-2");
    const draft = await api.saveChapter(project.id, {
      ...outline,
      content: "灯忽然亮了。",
    });
    const proposal = await api.analyzeNovelRevision(project.id, {
      chapterId: draft.id,
      instruction: "把“灯忽然亮了”改为“应急灯一盏盏亮起”",
      authority: "设定为准",
      scope: "当前章节",
    });
    await api.saveChapter(project.id, {
      ...draft,
      content: "门外的灯忽然亮了。",
    });

    await expect(api.applyNovelRevision(project.id, proposal, [proposal.textRepair!.id])).rejects.toThrow("版本已变化");
  });

  it("does not invent edits for ambiguous instructions or accept unknown repair ids", async () => {
    const api = createBrowserApi();
    const [project] = await api.listProjects();
    const proposal = await api.analyzeNovelRevision(project.id, {
      chapterId: "demo-chapter-1",
      instruction: "整体写得更有氛围一些",
      authority: "设定为准",
      scope: "当前章节",
    });

    expect(proposal.textRepair).toBeNull();
    expect(proposal.warnings.join(" ")).toContain("复杂联动分析请使用桌面版模型");
    await expect(api.applyNovelRevision(project.id, proposal, ["text:forged"])).rejects.toThrow("未知项目");
  });
});
