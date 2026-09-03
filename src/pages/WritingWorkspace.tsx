import {
  AlertTriangle,
  BrainCircuit,
  Check,
  History,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Save,
  Search,
  SearchCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Field, IconButton, Input, Modal, Segmented, Select, Textarea } from "../components/UI";
import {
  AutosaveCoordinator,
  chapterDraftSignature,
  clearRecoveredChapter,
  readRecoveredChapter,
  writeRecoveredChapter,
} from "../lib/chapter-draft";
import { formatCount, formatDate } from "../lib/format";
import { canAcceptGeneratedDraft, summarizeQualityOverview } from "../shared/generated-review";
import type { GenerationQuality } from "../shared/generation-quality";
import { diffParagraphs } from "../shared/paragraph-diff";
import { buildChapterSummary } from "../shared/summaries";
import { TOKEN_ESTIMATE_WARNING } from "../shared/token-estimator";
import type {
  AppApi,
  BatchGenerationPreview,
  Chapter,
  ContextPackage,
  NovelRevisionAuthority,
  NovelRevisionProposal,
  NovelRevisionScope,
  ProjectDetail,
  QualityIssue,
  RevisionRecord,
  SearchHit,
} from "../shared/types";
import { CHAPTER_FUNCTIONS } from "../shared/types";
import { ContextPanel } from "./ContextPanel";
import { DirectorNotesEditor } from "./DirectorNotesEditor";

export interface CommonProjectProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

const EMPTY_CHAPTER = (number: number): Chapter => ({
  id: "",
  number,
  title: "",
  outline: "",
  content: "",
  wordCount: 0,
  status: "章纲",
  batchMode: "逐章",
  isKeyChapter: false,
  chapterPromise: "",
  expectedPayoff: "",
  crisis: "",
  endingExpectation: "",
  expectationTargetChapter: null,
  endingExpectationId: null,
  linkedExpectationIds: [],
  revision: 0,
  updatedAt: new Date().toISOString(),
});

export function WritingPage({
  project,
  api,
  reload,
  notify,
  onDirtyChange,
}: CommonProjectProps & { onDirtyChange?: (dirty: boolean) => void }) {
  const [selectedId, setSelectedId] = useState(project.chapters[0]?.id ?? "");
  const selected = project.chapters.find((chapter) => chapter.id === selectedId);
  const [draft, setDraft] = useState<Chapter>(
    readRecoveredChapter(project.summary.id, selected ?? EMPTY_CHAPTER(project.chapters.length + 1)),
  );
  const [context, setContext] = useState<ContextPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [chapterLoading, setChapterLoading] = useState(Boolean(selected));
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(200);
  const [scrollTop, setScrollTop] = useState(0);
  const [compactList, setCompactList] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  const [history, setHistory] = useState<RevisionRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareRevisionId, setCompareRevisionId] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const [review, setReview] = useState<{
    chapter: Chapter;
    previousChapter: Chapter;
    issues: QualityIssue[];
    checking: boolean;
  } | null>(null);
  const [revertNote, setRevertNote] = useState("");
  const [reviewSelectionText, setReviewSelectionText] = useState("");
  const [generationQuality, setGenerationQuality] = useState<GenerationQuality | null>(null);
  const lastSavedSignature = useRef(chapterDraftSignature(selected ?? draft));
  const draftRef = useRef(draft);
  const manuscriptRef = useRef<HTMLTextAreaElement>(null);
  const chapterRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const searchLoadingRef = useRef(false);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const reloadRef = useRef(reload);
  const notifyRef = useRef(notify);
  const [batchPreview, setBatchPreview] = useState<BatchGenerationPreview | null>(null);
  const [batchReview, setBatchReview] = useState<Array<{
    chapter: Chapter;
    previousContent: string;
    issues: QualityIssue[];
    checking: boolean;
    adopted: boolean;
  }> | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionProposal, setRevisionProposal] = useState<NovelRevisionProposal | null>(null);
  const [selectedRepairIds, setSelectedRepairIds] = useState<string[]>([]);
  const [revisionSelection, setRevisionSelection] = useState({ start: 0, end: 0, text: "" });
  const [revisionInput, setRevisionInput] = useState<{
    instruction: string;
    authority: NovelRevisionAuthority;
    scope: NovelRevisionScope;
  }>({
    instruction: "",
    authority: "设定为准",
    scope: "当前章节",
  });
  useEffect(() => {
    draftRef.current = draft;
    reloadRef.current = reload;
    notifyRef.current = notify;
  }, [draft, reload, notify]);
  useEffect(() => {
    let active = true;
    void api
      .getGenerationQuality(project.summary.id)
      .then((next) => {
        if (active && next.total > 0) setGenerationQuality(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, project.summary.id]);
  useEffect(
    () =>
      api.onChapterFactsExtracted((event) => {
        if (event.projectId !== project.summary.id) return;
        void reloadRef.current();
        if (event.status === "失败") {
          notifyRef.current(`章节已定稿，但状态扫描失败：${event.message ?? "未知错误"}`, "error");
          return;
        }
        notifyRef.current(
          event.candidateCount
            ? `状态扫描完成，生成 ${event.candidateCount} 条待确认状态`
            : "状态扫描完成，本章没有新的持久状态",
        );
      }),
    [api, project.summary.id],
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => setCompactList(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const coordinator = new AutosaveCoordinator(
      (snapshot) => api.saveChapter(project.summary.id, snapshot, "autosave"),
      (snapshot, saved) => {
        const snapshotSignature = chapterDraftSignature(snapshot);
        const stillEditingChapter = draftRef.current.id === snapshot.id;
        if (stillEditingChapter) lastSavedSignature.current = snapshotSignature;
        if (stillEditingChapter && chapterDraftSignature(draftRef.current) === snapshotSignature) {
          clearRecoveredChapter(project.summary.id, snapshot);
          setDraft(saved);
          setSaveStatus("saved");
        } else if (stillEditingChapter) setSaveStatus("dirty");
        void reloadRef.current();
      },
      (error, willRetry) => {
        setSaveStatus("error");
        notifyRef.current(
          `${error instanceof Error ? error.message : String(error)}${willRetry ? "；将自动重试" : ""}`,
          "error",
        );
      },
    );
    autosaveRef.current = coordinator;
    return () => {
      coordinator.stop();
      if (autosaveRef.current === coordinator) autosaveRef.current = null;
    };
  }, [api, project.summary.id]);
  useEffect(() => {
    const next = project.chapters.find((chapter) => chapter.id === selectedId);
    const current = draftRef.current;
    if (!next || current.id !== selectedId || chapterDraftSignature(current) !== lastSavedSignature.current) return;
    const merged = { ...next, content: current.content };
    draftRef.current = merged;
    setDraft(merged);
    lastSavedSignature.current = chapterDraftSignature(merged);
  }, [project, selectedId]);
  const chapter = project.chapters.find((item) => item.id === selectedId);
  useEffect(() => {
    if (!chapter) {
      setChapterLoading(false);
      return;
    }
    const requestId = ++chapterRequestRef.current;
    setChapterLoading(true);
    void api
      .getChapter(project.summary.id, chapter.id)
      .then((loaded) => {
        if (chapterRequestRef.current !== requestId) return;
        const recovered = readRecoveredChapter(project.summary.id, loaded);
        draftRef.current = recovered;
        setDraft(recovered);
        lastSavedSignature.current = chapterDraftSignature(loaded);
        setSaveStatus(chapterDraftSignature(recovered) === lastSavedSignature.current ? "saved" : "dirty");
      })
      .catch((error) => {
        if (chapterRequestRef.current === requestId)
          notifyRef.current(error instanceof Error ? error.message : String(error), "error");
      })
      .finally(() => {
        if (chapterRequestRef.current === requestId) setChapterLoading(false);
      });
    return () => {
      chapterRequestRef.current += 1;
    };
  }, [api, chapter, project.summary.id]);
  const dirty = chapterDraftSignature(draft) !== lastSavedSignature.current;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (busy || chapterLoading) return;
    if (!dirty) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("dirty");
    const recoveryTimer = window.setTimeout(() => {
      setRecoveryAvailable(writeRecoveredChapter(project.summary.id, draftRef.current));
    }, 500);
    const timer =
      !draft.id || ["已定稿", "待发布", "已发布"].includes(draft.status)
        ? null
        : window.setTimeout(() => {
            const snapshot = draftRef.current;
            setSaveStatus("saving");
            autosaveRef.current?.enqueue(snapshot);
          }, 2000);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.clearTimeout(recoveryTimer);
    };
  }, [busy, chapterLoading, dirty, draft, project.summary.id]);
  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      if (chapterDraftSignature(draftRef.current) === lastSavedSignature.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedExit);
    return () => window.removeEventListener("beforeunload", preventUnsavedExit);
  }, []);
  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    const timer = window.setTimeout(() => {
      if (query.trim().length >= 2)
        void api.searchProject(project.summary.id, query, 0, 50).then((hits) => {
          if (searchRequestRef.current !== requestId) return;
          setSearchHits(hits);
          setSearchHasMore(hits.length === 50);
          setScrollTop(0);
        });
      else {
        setSearchHits([]);
        setSearchHasMore(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, project.summary.id, query]);
  const filteredChapters =
    query.trim().length >= 2
      ? project.chapters.filter((chapter) => searchHits.some((hit) => hit.id === chapter.id))
      : project.chapters.slice(0, loadedCount);
  const ROW_HEIGHT = 54;
  const OVERSCAN = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const renderCount = Math.ceil(window.innerHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const virtualChapters = compactList ? filteredChapters : filteredChapters.slice(startIndex, startIndex + renderCount);
  const loadMoreSearch = async () => {
    if (searchLoadingRef.current) return;
    searchLoadingRef.current = true;
    const requestId = searchRequestRef.current;
    const requestedQuery = query;
    const offset = searchHits.length;
    try {
      const hits = await api.searchProject(project.summary.id, requestedQuery, offset, 50);
      if (searchRequestRef.current !== requestId || query !== requestedQuery) return;
      setSearchHits((current) => (current.length === offset ? [...current, ...hits] : current));
      setSearchHasMore(hits.length === 50);
    } finally {
      searchLoadingRef.current = false;
    }
  };
  const save = async () => {
    const snapshot = draftRef.current;
    const snapshotSignature = chapterDraftSignature(snapshot);
    setSaveStatus("saving");
    try {
      const coordinator = autosaveRef.current;
      const saved = coordinator
        ? await coordinator.saveLatest(snapshot, (value) => api.saveChapter(project.summary.id, value))
        : await api.saveChapter(project.summary.id, snapshot);
      clearRecoveredChapter(project.summary.id, snapshot);
      lastSavedSignature.current = snapshotSignature;
      setSelectedId(saved.id);
      if (chapterDraftSignature(draftRef.current) === snapshotSignature) {
        draftRef.current = saved;
        setDraft(saved);
        setSaveStatus("saved");
      } else setSaveStatus("dirty");
      await reload();
      notify("章节已保存并建立新版本");
    } catch (error) {
      setSaveStatus("error");
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };
  const saveLatestForAction = async () => {
    const snapshot = draftRef.current;
    if (chapterDraftSignature(snapshot) === lastSavedSignature.current) return snapshot;
    setSaveStatus("saving");
    const coordinator = autosaveRef.current;
    const saved = coordinator
      ? await coordinator.saveLatest(snapshot)
      : await api.saveChapter(project.summary.id, snapshot, "autosave");
    draftRef.current = saved;
    lastSavedSignature.current = chapterDraftSignature(saved);
    clearRecoveredChapter(project.summary.id, saved);
    setDraft(saved);
    setSelectedId(saved.id);
    setSaveStatus("saved");
    return saved;
  };
  const openRevisionFromReviewSelection = () => {
    if (!review || !reviewSelectionText) return;
    const content = review.chapter.content;
    const index = content.indexOf(reviewSelectionText);
    if (index < 0) {
      notify("未能在正文中定位所选文字，请改选或使用整章修改意见", "error");
      return;
    }
    setRevisionSelection({ start: index, end: index + reviewSelectionText.length, text: reviewSelectionText });
    setRevisionInput((current) => ({ ...current, scope: "仅选区" }));
    setRevisionProposal(null);
    setSelectedRepairIds([]);
    setReviewSelectionText("");
    setReview(null);
    setRevisionOpen(true);
  };
  const acceptGeneratedDraft = async () => {
    if (!review) return;
    try {
      setBusy(true);
      await api.transitionChapter(project.summary.id, review.chapter.id, "待定稿");
      void api.recordGenerationDecision(project.summary.id, review.chapter.id, "adopted");
      const accepted = review.chapter;
      setReview(null);
      setReviewSelectionText("");
      await reload();
      notify("已采纳 AI 产出并进入待定稿");
      if (accepted.id === draftRef.current.id) {
        draftRef.current = { ...draftRef.current, status: "待定稿" };
        setDraft({ ...draftRef.current, status: "待定稿" });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const persistDirectorNote = async (note: string) => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const current = project.directorNotes ?? [];
    if (!current.includes(trimmed)) {
      await api.saveDirectorNotes(project.summary.id, [...current, trimmed]);
      await reload();
    }
  };
  const removeDirectorNote = async (note: string) => {
    const current = project.directorNotes ?? [];
    await api.saveDirectorNotes(
      project.summary.id,
      current.filter((item) => item !== note),
    );
    await reload();
  };
  const rejectGeneratedDraft = async () => {
    if (!review) return;
    try {
      setBusy(true);
      await persistDirectorNote(revertNote);
      void api.recordGenerationDecision(project.summary.id, review.chapter.id, "reverted");
      const restored = await api.saveChapter(
        project.summary.id,
        { ...review.previousChapter, content: review.previousChapter.content },
        "version",
      );
      draftRef.current = restored;
      lastSavedSignature.current = chapterDraftSignature(restored);
      clearRecoveredChapter(project.summary.id, restored);
      setDraft(restored);
      setSaveStatus("saved");
      setRevertNote("");
      setReviewSelectionText("");
      setReview(null);
      await reload();
      notify("已打回，正文恢复为生成前内容");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const adoptBatchChapter = async (chapterId: string) => {
    try {
      await api.transitionChapter(project.summary.id, chapterId, "待定稿");
      void api.recordGenerationDecision(project.summary.id, chapterId, "adopted");
      setBatchReview((current) =>
        current ? current.map((item) => (item.chapter.id === chapterId ? { ...item, adopted: true } : item)) : current,
      );
      notify("已采纳该章并进入待定稿");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };
  const revertBatchChapter = async (chapterId: string, previousContent: string) => {
    try {
      const target = batchReview?.find((item) => item.chapter.id === chapterId)?.chapter;
      if (!target) return;
      await persistDirectorNote(revertNote);
      void api.recordGenerationDecision(project.summary.id, chapterId, "reverted");
      await api.saveChapter(project.summary.id, { ...target, content: previousContent }, "version");
      setBatchReview((current) => (current ? current.filter((item) => item.chapter.id !== chapterId) : current));
      setRevertNote("");
      await reload();
      notify("已打回该章，正文恢复为生成前内容");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const canDiscardDraft = () => {
    if (!dirty) return true;
    if (!window.confirm("当前章节还有未保存内容，确定放弃这些修改吗？")) return false;
    clearRecoveredChapter(project.summary.id, draftRef.current);
    return true;
  };
  const selectChapter = (chapter: Chapter) => {
    if (!canDiscardDraft()) return;
    chapterRequestRef.current += 1;
    setSelectedId(chapter.id);
    setDraft(chapter);
    draftRef.current = chapter;
    lastSavedSignature.current = chapterDraftSignature(chapter);
    setSaveStatus("saved");
    setContext(null);
  };
  const editorBusy = busy || chapterLoading;
  const revisionRepairItems = revisionProposal
    ? [
        ...revisionProposal.contractRepairs.map((item) => ({
          id: item.id,
          kind: "创作设定",
          label: item.label,
          reason: item.reason,
          risk: item.risk,
          before: item.before,
          after: item.after,
        })),
        ...revisionProposal.planRepairs.map((item) => ({
          id: item.id,
          kind: "规划",
          label: item.location,
          reason: item.reason,
          risk: item.risk,
          before: JSON.stringify(item.before, null, 2),
          after: JSON.stringify(item.after, null, 2),
        })),
        ...revisionProposal.chapterRepairs.map((item) => ({
          id: item.id,
          kind: "章纲",
          label: item.location,
          reason: item.reason,
          risk: item.risk,
          before: JSON.stringify(item.before, null, 2),
          after: JSON.stringify(item.after, null, 2),
        })),
        ...(revisionProposal.textRepair
          ? [
              {
                id: revisionProposal.textRepair.id,
                kind: "正文",
                label: `第${draft.number}章正文`,
                reason: revisionProposal.textRepair.reason,
                risk: revisionProposal.textRepair.risk,
                before: revisionProposal.textRepair.before,
                after: revisionProposal.textRepair.after,
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="writing-layout">
      <aside className="chapter-list">
        <div className="chapter-list-head">
          <span>
            <strong>章节</strong>
            <small>{project.chapters.length} 章</small>
          </span>
          <IconButton
            label="新建章节"
            disabled={editorBusy}
            onClick={() => {
              if (!canDiscardDraft()) return;
              chapterRequestRef.current += 1;
              setChapterLoading(false);
              const empty = EMPTY_CHAPTER(project.chapters.length + 1);
              setSelectedId("");
              setDraft(empty);
              draftRef.current = empty;
              lastSavedSignature.current = chapterDraftSignature(empty);
              setSaveStatus("saved");
              setContext(null);
            }}
          >
            <Plus size={17} />
          </IconButton>
        </div>
        <label className="chapter-search">
          <Search size={13} />
          <input
            disabled={editorBusy}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="检索正文"
          />
        </label>
        <section
          className="chapter-scroll"
          onScroll={(event) => {
            const element = event.currentTarget;
            setScrollTop(element.scrollTop);
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - ROW_HEIGHT * 3) {
              if (query.trim().length >= 2) {
                if (searchHasMore) void loadMoreSearch();
              } else if (loadedCount < project.chapters.length) {
                setLoadedCount((current) => Math.min(project.chapters.length, current + 200));
              }
            }
          }}
          aria-label="章节列表"
        >
          <div
            className="chapter-virtual-spacer"
            style={{ height: compactList ? ROW_HEIGHT : filteredChapters.length * ROW_HEIGHT }}
          >
            <div
              className="chapter-virtual-window"
              style={{ transform: compactList ? undefined : `translateY(${startIndex * ROW_HEIGHT}px)` }}
            >
              {virtualChapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.id}
                  disabled={editorBusy}
                  className={selectedId === chapter.id ? "active" : ""}
                  onClick={() => selectChapter(chapter)}
                >
                  <span>{chapter.number}</span>
                  <div>
                    <strong>{chapter.title || "未命名章"}</strong>
                    <small>
                      {chapter.status} · {formatCount(chapter.wordCount)}字
                    </small>
                  </div>
                  {chapter.isKeyChapter && <i />}
                </button>
              ))}
            </div>
          </div>
        </section>
      </aside>
      <div className="editor-workspace">
        <header className="editor-toolbar">
          <div>
            <p>第 {draft.number} 章</p>
            <Input
              className="title-input"
              disabled={editorBusy}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="章节标题"
            />
          </div>
          <div className="heading-actions">
            <span className={`autosave-status autosave-${saveStatus}`} role="status">
              {chapterLoading
                ? "正在读取正文"
                : !recoveryAvailable
                  ? "恢复副本不可用"
                  : saveStatus === "saving"
                    ? "正在自动保存"
                    : saveStatus === "dirty"
                      ? "未保存"
                      : saveStatus === "error"
                        ? "保存失败"
                        : "已保存"}
            </span>
            {generationQuality && (
              <Badge
                tone={
                  generationQuality.tier === "scrutiny"
                    ? "warning"
                    : generationQuality.tier === "balanced"
                      ? "accent"
                      : "success"
                }
              >
                {generationQuality.tier === "scrutiny"
                  ? "建议细审"
                  : generationQuality.tier === "balanced"
                    ? "建议扫读"
                    : "可抽查"}
              </Badge>
            )}
            <Segmented
              options={["逐章", "五章批次"] as const}
              value={draft.batchMode}
              disabled={editorBusy}
              onChange={(batchMode) => setDraft({ ...draft, batchMode })}
            />
            <label className="key-toggle">
              <input
                type="checkbox"
                disabled={editorBusy}
                checked={draft.isKeyChapter}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    isKeyChapter: event.target.checked,
                    batchMode: event.target.checked ? "逐章" : draft.batchMode,
                  })
                }
              />
              关键章
            </label>
            <Button
              variant="secondary"
              icon={<Save size={16} />}
              disabled={editorBusy || saveStatus === "saving"}
              onClick={save}
            >
              建立版本
            </Button>
          </div>
        </header>
        <div className="writing-actions">
          <Button
            variant="secondary"
            disabled={!draft.id || editorBusy}
            icon={<MessageSquareText size={16} />}
            onClick={() => {
              const editor = manuscriptRef.current;
              const start = editor?.selectionStart ?? 0;
              const end = editor?.selectionEnd ?? 0;
              const text = end > start ? draft.content.slice(start, end) : "";
              setRevisionSelection({ start, end, text });
              setRevisionInput((current) => ({ ...current, scope: text ? "仅选区" : "当前章节" }));
              setRevisionProposal(null);
              setSelectedRepairIds([]);
              setRevisionOpen(true);
            }}
          >
            修改意见
          </Button>
          <Button
            variant="secondary"
            disabled={!draft.id || editorBusy}
            icon={<BrainCircuit size={16} />}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await saveLatestForAction();
                setContext(await api.compileContext(project.summary.id, saved.id));
              } catch (error) {
                notify(String(error), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            预览上下文
          </Button>
          <Button
            variant="secondary"
            disabled={!draft.id || editorBusy}
            icon={<Sparkles size={16} />}
            onClick={async () => {
              let beforeGeneration = draftRef.current;
              let streamedContent = "";
              let streamedAttempt = 0;
              setBusy(true);
              try {
                beforeGeneration = await saveLatestForAction();
                const result = await api.generateChapterDraft(project.summary.id, beforeGeneration.id, (event) => {
                  if (event.type === "attempt-start") {
                    streamedAttempt = event.attempt;
                    streamedContent = "";
                  } else if (event.type === "delta" && event.attempt === streamedAttempt) {
                    streamedContent += event.delta;
                  } else return;
                  const streamedDraft = { ...beforeGeneration, content: streamedContent };
                  draftRef.current = streamedDraft;
                  setDraft(streamedDraft);
                });
                draftRef.current = result;
                lastSavedSignature.current = chapterDraftSignature(result);
                clearRecoveredChapter(project.summary.id, result);
                setDraft(result);
                setSaveStatus("saved");
                await reload();
                setReview({ chapter: result, previousChapter: beforeGeneration, issues: [], checking: true });
                void api
                  .runQualityCheck(project.summary.id, result.id)
                  .then((issues) =>
                    setReview((current) =>
                      current && current.chapter.id === result.id ? { ...current, issues, checking: false } : current,
                    ),
                  )
                  .catch(() =>
                    setReview((current) =>
                      current && current.chapter.id === result.id
                        ? { ...current, issues: [], checking: false }
                        : current,
                    ),
                  );
              } catch (error) {
                draftRef.current = beforeGeneration;
                setDraft(beforeGeneration);
                notify(error instanceof Error ? error.message : String(error), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "生成中" : "AI 生成草稿"}
          </Button>
          {draft.batchMode === "五章批次" && (
            <Button
              variant="secondary"
              disabled={!draft.id || editorBusy}
              icon={<Layers3 size={16} />}
              onClick={async () => {
                setBusy(true);
                try {
                  const saved = await saveLatestForAction();
                  setBatchPreview(await api.previewChapterBatch(project.summary.id, saved.id));
                } catch (error) {
                  notify(error instanceof Error ? error.message : String(error), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              五章批次
            </Button>
          )}
          <Button
            disabled={!draft.id || editorBusy}
            icon={<SearchCheck size={16} />}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await saveLatestForAction();
                const issues = await api.runQualityCheck(project.summary.id, saved.id);
                await api.transitionChapter(project.summary.id, saved.id, "待定稿");
                await reload();
                notify(issues.length ? `质检完成，发现 ${issues.length} 项问题` : "质检完成，未发现问题");
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            运行质检
          </Button>
          {draft.status === "待定稿" && (
            <Button
              icon={<Check size={16} />}
              disabled={editorBusy}
              onClick={async () => {
                try {
                  const result = await api.transitionChapter(project.summary.id, draft.id, "已定稿");
                  await reload();
                  if (result.ledgerExtraction.status === "排队中") {
                    notify("章节已定稿，状态扫描正在后台进行");
                  } else if (result.ledgerExtraction.status === "已完成") {
                    notify(
                      result.ledgerExtraction.candidateCount
                        ? `章节已定稿，生成 ${result.ledgerExtraction.candidateCount} 条待确认状态`
                        : "章节已定稿，本章没有新的持久状态",
                    );
                  } else if (result.ledgerExtraction.status === "失败") {
                    notify(`章节已定稿，但状态扫描失败：${result.ledgerExtraction.message ?? "未知错误"}`, "error");
                  } else {
                    notify("章节已定稿；未配置 AI，未扫描状态候选");
                  }
                } catch (error) {
                  notify(error instanceof Error ? error.message : String(error), "error");
                }
              }}
            >
              确认定稿
            </Button>
          )}
        </div>
        <div className="editor-body">
          <div className="chapter-intent-panel">
            <div className="intent-grid">
              <Field label="本章承诺" hint="读者进入本章后应获得什么推进">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.chapterPromise ?? ""}
                  onChange={(event) => setDraft({ ...draft, chapterPromise: event.target.value })}
                  placeholder="承接哪项期待，本章具体答应什么"
                />
              </Field>
              <Field label="预期回报" hint="本章准备释放的情绪或利益回报">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.expectedPayoff ?? ""}
                  onChange={(event) => setDraft({ ...draft, expectedPayoff: event.target.value })}
                  placeholder="胜负、关系、信息、资源或身份变化"
                />
              </Field>
              <Field label="当前危机" hint="不行动会失去什么">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.crisis ?? ""}
                  onChange={(event) => setDraft({ ...draft, crisis: event.target.value })}
                  placeholder="具体压力、代价和时间限制"
                />
              </Field>
              <Field label="结尾期待" hint="保存后自动进入跨章节账本">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.endingExpectation ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      endingExpectation: event.target.value,
                    })
                  }
                  placeholder="回报之后自然产生的下一问题"
                />
              </Field>
            </div>
            <div className="intent-meta">
              <Field label="章节功能">
                <Select
                  disabled={editorBusy}
                  value={draft.chapterFunction ?? "行动"}
                  onChange={(event) =>
                    setDraft({ ...draft, chapterFunction: event.target.value as Chapter["chapterFunction"] })
                  }
                >
                  {CHAPTER_FUNCTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Select>
              </Field>
              <Field label="目标字数">
                <Input
                  type="number"
                  disabled={editorBusy}
                  min={800}
                  max={5000}
                  step={100}
                  value={draft.targetWords ?? 2300}
                  onChange={(event) => setDraft({ ...draft, targetWords: Number(event.target.value) })}
                />
              </Field>
              <Field label="预计兑现章">
                <Input
                  type="number"
                  disabled={editorBusy}
                  min={draft.number}
                  value={draft.expectationTargetChapter ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      expectationTargetChapter: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="本章承接的历史期待">
                <select
                  className="expectation-link-select"
                  disabled={editorBusy}
                  multiple
                  value={draft.linkedExpectationIds ?? []}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      linkedExpectationIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                    })
                  }
                >
                  {project.expectations
                    .filter((item) => item.status === "待兑现" || item.status === "部分兑现")
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        第{item.sourceChapter}章 · {item.title}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="outline-panel">
            <Field label="本章章纲">
              <Textarea
                rows={5}
                disabled={editorBusy}
                value={draft.outline}
                onChange={(event) => setDraft({ ...draft, outline: event.target.value })}
                placeholder="目标、冲突、信息揭示、状态变化、章末推动力"
              />
            </Field>
          </div>
          <textarea
            ref={manuscriptRef}
            className="manuscript"
            value={draft.content}
            disabled={editorBusy}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            placeholder="在这里写正文，或先保存章纲后使用 AI 生成草稿。"
          />
          <footer className="editor-footer">
            <span>
              {draft.content.replace(/\s/g, "").length.toLocaleString()} 字 · v{draft.revision || 1}
            </span>
            {draft.content.length >= 190_000 && (
              <Badge tone={draft.content.length > 200_000 ? "danger" : "warning"}>
                {draft.content.length > 200_000
                  ? "正文超过 200,000 字符保存上限"
                  : `距离保存上限还剩 ${(200_000 - draft.content.length).toLocaleString()} 字符`}
              </Badge>
            )}
            <span className="editor-version-actions">
              {draft.id && (
                <button
                  type="button"
                  onClick={async () => {
                    setHistory(await api.listRevisions(project.summary.id, "chapters", draft.id));
                    setHistoryOpen(true);
                  }}
                >
                  <History size={13} />
                  历史版本
                </button>
              )}
              <Badge tone={draft.status === "已定稿" || draft.status === "已发布" ? "success" : "neutral"}>
                {draft.status}
              </Badge>
            </span>
          </footer>
        </div>
      </div>
      {context && <ContextPanel context={context} onClose={() => setContext(null)} />}

      {batchReview && batchReview.length > 0 && (
        <Modal title="审阅五章批次产出" onClose={() => setBatchReview(null)} width={940}>
          <div className="form-stack generated-review">
            <p className="muted-line">逐章确认：无硬性问题的章节可采纳进入待定稿；有硬性问题的建议先打回或稍后处理。</p>
            {batchReview.map((item) => {
              const overview = summarizeQualityOverview(item.issues);
              const adoptable = !item.checking && canAcceptGeneratedDraft(item.issues) && !item.adopted;
              return (
                <article
                  key={item.chapter.id}
                  style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <strong>
                      第{item.chapter.number}章 {item.chapter.title || "未命名章"}
                    </strong>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <small>{formatCount(item.chapter.content.replace(/\s/g, "").length)} 字</small>
                      {item.checking ? (
                        <Badge tone="neutral">质检中</Badge>
                      ) : item.adopted ? (
                        <Badge tone="success">已采纳</Badge>
                      ) : overview.needsHumanJudgment ? (
                        <Badge tone="danger">有硬性问题</Badge>
                      ) : (
                        <Badge tone="success">可采纳</Badge>
                      )}
                    </span>
                  </div>
                  <details>
                    <summary>本章摘要</summary>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.7 }}>
                      {buildChapterSummary(item.chapter)}
                    </pre>
                  </details>
                  <details>
                    <summary>阅读全文</summary>
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.9,
                        maxHeight: 260,
                        overflowY: "auto",
                        fontSize: 14,
                      }}
                    >
                      {item.chapter.content || "（空正文）"}
                    </div>
                  </details>
                  {!item.checking && item.issues.length > 0 && (
                    <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                      {item.issues.slice(0, 4).map((issue) => (
                        <li key={issue.id} style={{ marginBottom: 2, fontSize: 12 }}>
                          <Badge
                            tone={
                              issue.severity === "硬性" ? "danger" : issue.severity === "警告" ? "warning" : "neutral"
                            }
                          >
                            {issue.severity}
                          </Badge>{" "}
                          {issue.message}
                        </li>
                      ))}
                      {item.issues.length > 4 && <li style={{ fontSize: 12 }}>… 共 {item.issues.length} 项</li>}
                    </ul>
                  )}
                  {!item.checking && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                      <Button
                        variant="secondary"
                        disabled={item.adopted}
                        onClick={() => void revertBatchChapter(item.chapter.id, item.previousContent)}
                      >
                        打回
                      </Button>
                      {adoptable && (
                        <Button disabled={busy} onClick={() => void adoptBatchChapter(item.chapter.id)}>
                          采纳
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
              <section>
                <DirectorNotesEditor
                  notes={project.directorNotes ?? []}
                  note={revertNote}
                  onNoteChange={setRevertNote}
                  onRemove={(entry) => void removeDirectorNote(entry)}
                />
              </section>

              <Button variant="secondary" onClick={() => setBatchReview(null)}>
                关闭
              </Button>
              <Button
                icon={<Check size={16} />}
                disabled={
                  busy ||
                  batchReview.every(
                    (item) => !(!item.checking && canAcceptGeneratedDraft(item.issues) && !item.adopted),
                  )
                }
                onClick={async () => {
                  for (const item of batchReview) {
                    if (!item.checking && canAcceptGeneratedDraft(item.issues) && !item.adopted)
                      await adoptBatchChapter(item.chapter.id);
                  }
                }}
              >
                全部采纳（无硬性问题章节）
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title={`审阅 AI 产出 · 第${review.chapter.number}章`}
          onClose={() => {
            if (busy) return;
            setReview(null);
            setReviewSelectionText("");
          }}
          width={940}
        >
          <div className="form-stack generated-review">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <strong>{review.chapter.title || "未命名章"}</strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <small>{formatCount(review.chapter.content.replace(/\s/g, "").length)} 字</small>
                {!review.checking && (
                  <Badge tone={canAcceptGeneratedDraft(review.issues) ? "success" : "danger"}>
                    {canAcceptGeneratedDraft(review.issues) ? "可采纳" : "存在硬性问题"}
                  </Badge>
                )}
              </span>
            </div>
            <details open>
              <summary>本章摘要</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.7 }}>
                {buildChapterSummary(review.chapter)}
              </pre>
            </details>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: 阅读区划词交给 AI 修改，需要原生文本选区 */}
            <div
              style={{
                whiteSpace: "pre-wrap",
                lineHeight: 1.9,
                maxHeight: 340,
                overflowY: "auto",
                padding: 12,
                background: "var(--surface-soft)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: 15,
              }}
              onMouseUp={() => {
                const selection = window.getSelection();
                const text = selection ? selection.toString() : "";
                setReviewSelectionText(text && text.length <= 2000 ? text : "");
              }}
            >
              {review.chapter.content || "（空正文）"}
            </div>
            {reviewSelectionText && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <Button
                  variant="secondary"
                  icon={<MessageSquareText size={15} />}
                  onClick={() => void openRevisionFromReviewSelection()}
                >
                  把选中文字交给 AI 修改（已选 {reviewSelectionText.length} 字）
                </Button>
              </div>
            )}
            <section>
              {review.checking ? (
                <p className="muted-line">正在运行质检…</p>
              ) : review.issues.length === 0 ? (
                <p className="muted-line">未发现硬性问题（本地规则未命中，可采纳进入待定稿）</p>
              ) : (
                <div>
                  <p>
                    {summarizeQualityOverview(review.issues).hard} 硬性 ·{" "}
                    {summarizeQualityOverview(review.issues).warning} 警告 ·{" "}
                    {summarizeQualityOverview(review.issues).suggestion} 建议
                  </p>
                  <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                    {review.issues.map((issue) => (
                      <li key={issue.id} style={{ marginBottom: 4 }}>
                        <Badge
                          tone={
                            issue.severity === "硬性" ? "danger" : issue.severity === "警告" ? "warning" : "neutral"
                          }
                        >
                          {issue.severity}
                        </Badge>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <section>
                <DirectorNotesEditor
                  notes={project.directorNotes ?? []}
                  note={revertNote}
                  onNoteChange={setRevertNote}
                  onRemove={(entry) => void removeDirectorNote(entry)}
                />
              </section>
            </section>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              {canAcceptGeneratedDraft(review.issues) ? (
                <Button
                  icon={<Check size={16} />}
                  disabled={review.checking || busy}
                  onClick={() => void acceptGeneratedDraft()}
                >
                  采纳并进入待定稿
                </Button>
              ) : (
                <Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>
                  先保留草稿，去处理问题
                </Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={() => void rejectGeneratedDraft()}>
                打回重写
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {revisionOpen && (
        <Modal title="AI 修改意见" onClose={() => !revisionBusy && setRevisionOpen(false)} width={920}>
          <div className="form-stack novel-revision-modal">
            {!revisionProposal ? (
              <>
                <Field label="修改意见" hint="直接说明哪里不满意、希望怎么改，以及必须保留什么">
                  <Textarea
                    autoFocus
                    rows={5}
                    disabled={revisionBusy}
                    value={revisionInput.instruction}
                    onChange={(event) => setRevisionInput({ ...revisionInput, instruction: event.target.value })}
                    placeholder="例如：第五章和解太快，把冲突延长到第七章；保留结尾的拥抱，但改成利益合作。"
                  />
                </Field>
                <div className="form-grid two">
                  {/* biome-ignore lint/a11y/useSemanticElements: role=group+aria-label 已提供分组语义，fieldset 需调整样式 */}
                  <div className="field" role="group" aria-label="修改依据">
                    <span className="field-label">修改依据</span>
                    <Segmented
                      options={["设定为准", "当前正文为准"] as const}
                      value={revisionInput.authority}
                      disabled={revisionBusy}
                      onChange={(authority) => setRevisionInput({ ...revisionInput, authority })}
                    />
                    <span className="field-hint">选择发生冲突时以哪一侧为准</span>
                  </div>
                  {/* biome-ignore lint/a11y/useSemanticElements: role=group+aria-label 已提供分组语义，fieldset 需调整样式 */}
                  <div className="field" role="group" aria-label="检查范围">
                    <span className="field-label">检查范围</span>
                    <Segmented
                      options={["仅选区", "当前章节", "全书联动"] as const}
                      value={revisionInput.scope}
                      disabled={revisionBusy}
                      onChange={(scope) => setRevisionInput({ ...revisionInput, scope })}
                    />
                  </div>
                </div>
                {revisionInput.scope === "仅选区" && (
                  <div className="revision-selection-preview">
                    <strong>
                      {revisionSelection.text ? `已选 ${revisionSelection.text.length} 字` : "尚未选择正文"}
                    </strong>
                    <p>{revisionSelection.text || "关闭对话框，在正文中选中文字后重新点击“修改意见”。"}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="revision-proposal-summary">
                  <div>
                    <Badge tone="accent">{revisionProposal.authority}</Badge>
                    <Badge tone="neutral">{revisionProposal.scope}</Badge>
                    <strong>{revisionRepairItems.length} 项可应用修改</strong>
                  </div>
                  <p>{revisionProposal.summary}</p>
                </div>
                {revisionProposal.warnings.length > 0 && (
                  <div className="revision-warnings" role="alert">
                    <AlertTriangle size={16} />
                    <span>{revisionProposal.warnings.join("；")}</span>
                  </div>
                )}
                {revisionProposal.impacts.length > 0 && (
                  <div className="revision-impact-list">
                    <strong>影响检查</strong>
                    {revisionProposal.impacts.map((impact) => (
                      <div key={`${impact.targetType}-${impact.location}`}>
                        <Badge tone={impact.risk === "高" ? "danger" : impact.risk === "中" ? "warning" : "neutral"}>
                          {impact.targetType}
                        </Badge>
                        <span>
                          <b>{impact.location}</b>
                          {impact.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="revision-repair-list">
                  {revisionRepairItems.map((item) => (
                    <article key={item.id} className={selectedRepairIds.includes(item.id) ? "selected" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedRepairIds.includes(item.id)}
                          onChange={(event) =>
                            setSelectedRepairIds((current) =>
                              event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>
                          <strong>
                            {item.kind} · {item.label}
                          </strong>
                          <small>{item.reason}</small>
                        </span>
                        <Badge tone={item.risk === "高" ? "danger" : item.risk === "中" ? "warning" : "neutral"}>
                          {item.risk}风险
                        </Badge>
                      </label>
                      <details>
                        <summary>查看修改前后</summary>
                        <div className="revision-before-after">
                          <section>
                            <span>修改前</span>
                            <pre>{item.before || "无"}</pre>
                          </section>
                          <section>
                            <span>修改后</span>
                            <pre>{item.after || "无"}</pre>
                          </section>
                        </div>
                      </details>
                    </article>
                  ))}
                  {!revisionRepairItems.length && (
                    <p className="muted-line">没有生成可应用修改。可以调整意见后重新分析。</p>
                  )}
                </div>
              </>
            )}
            <div className="modal-actions">
              <Button
                variant="secondary"
                disabled={revisionBusy}
                onClick={() => (revisionProposal ? setRevisionProposal(null) : setRevisionOpen(false))}
              >
                {revisionProposal ? "返回修改意见" : "取消"}
              </Button>
              {!revisionProposal ? (
                <Button
                  disabled={
                    revisionBusy ||
                    !revisionInput.instruction.trim() ||
                    (revisionInput.scope === "仅选区" && !revisionSelection.text)
                  }
                  icon={revisionBusy ? <LoaderCircle className="spin" size={16} /> : <SearchCheck size={16} />}
                  onClick={async () => {
                    setRevisionBusy(true);
                    try {
                      const saved = await saveLatestForAction();
                      const proposal = await api.analyzeNovelRevision(project.summary.id, {
                        chapterId: saved.id,
                        ...revisionInput,
                        selectionStart: revisionInput.scope === "仅选区" ? revisionSelection.start : undefined,
                        selectionEnd: revisionInput.scope === "仅选区" ? revisionSelection.end : undefined,
                        selectedText: revisionInput.scope === "仅选区" ? revisionSelection.text : undefined,
                      });
                      setRevisionProposal(proposal);
                      setSelectedRepairIds([
                        ...proposal.contractRepairs.map((item) => item.id),
                        ...proposal.planRepairs.map((item) => item.id),
                        ...proposal.chapterRepairs.map((item) => item.id),
                        ...(proposal.textRepair ? [proposal.textRepair.id] : []),
                      ]);
                    } catch (error) {
                      notify(error instanceof Error ? error.message : String(error), "error");
                    } finally {
                      setRevisionBusy(false);
                    }
                  }}
                >
                  {revisionBusy ? "分析中" : "分析修改意见"}
                </Button>
              ) : (
                <Button
                  disabled={revisionBusy || !selectedRepairIds.length}
                  icon={revisionBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                  onClick={async () => {
                    setRevisionBusy(true);
                    try {
                      const result = await api.applyNovelRevision(
                        project.summary.id,
                        revisionProposal,
                        selectedRepairIds,
                      );
                      await reload();
                      const loaded = await api.getChapter(project.summary.id, revisionProposal.sourceChapterId);
                      draftRef.current = loaded;
                      setDraft(loaded);
                      lastSavedSignature.current = chapterDraftSignature(loaded);
                      setSaveStatus("saved");
                      setRevisionOpen(false);
                      const contractNote = result.appliedTargets.includes("创作设定") ? "；创作设定需要重新审批" : "";
                      notify(
                        `已应用 ${result.appliedTargets.length} 个目标${result.changeRequestIds.length ? `，建立 ${result.changeRequestIds.length} 条受保护变更记录` : ""}${contractNote}`,
                      );
                    } catch (error) {
                      notify(error instanceof Error ? error.message : String(error), "error");
                    } finally {
                      setRevisionBusy(false);
                    }
                  }}
                >
                  {revisionBusy ? "应用中" : `应用所选 ${selectedRepairIds.length} 项`}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {historyOpen && (
        <Modal title={`第${draft.number}章历史版本`} onClose={() => setHistoryOpen(false)}>
          <div className="revision-list">
            {history.length ? (
              history.map((revision) => {
                const snapshot = revision.payload as Chapter;
                const compared =
                  compareRevisionId === revision.id ? diffParagraphs(snapshot.content ?? "", draft.content ?? "") : [];
                return (
                  <article key={revision.id}>
                    <div>
                      <strong>
                        v{revision.revision} · {snapshot.title}
                      </strong>
                      <small>
                        {formatDate(revision.createdAt, true)} · {snapshot.content?.replace(/\s/g, "").length ?? 0}字
                      </small>
                    </div>
                    <div className="revision-actions">
                      <Button
                        variant="ghost"
                        onClick={() => setCompareRevisionId(compareRevisionId === revision.id ? "" : revision.id)}
                      >
                        {compareRevisionId === revision.id ? "收起差异" : "与当前版本比较"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          await api.restoreRevision(project.summary.id, revision.id);
                          await reload();
                          const restored = await api.getChapter(project.summary.id, draftRef.current.id);
                          draftRef.current = restored;
                          lastSavedSignature.current = chapterDraftSignature(restored);
                          clearRecoveredChapter(project.summary.id, restored);
                          setDraft(restored);
                          setSaveStatus("saved");
                          setHistoryOpen(false);
                          notify(`已从 v${revision.revision} 建立新的当前版本`);
                        }}
                      >
                        恢复为新版本
                      </Button>
                    </div>
                    {compared.length > 0 && (
                      <section className="paragraph-diff" aria-label={`v${revision.revision} 与当前版本的段落差异`}>
                        <header>
                          <span>新增 {compared.filter((item) => item.kind === "新增").length}</span>
                          <span>删除 {compared.filter((item) => item.kind === "删除").length}</span>
                          <span>未变 {compared.filter((item) => item.kind === "未变").length}</span>
                        </header>
                        {compared.map((item) => (
                          <p key={`${item.kind}-${item.text}`} className={`diff-${item.kind}`}>
                            {item.kind === "新增" ? "+" : item.kind === "删除" ? "-" : " "} {item.text}
                          </p>
                        ))}
                      </section>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="muted-line">当前章节尚无旧版本。</p>
            )}
          </div>
        </Modal>
      )}
      {batchPreview && (
        <Modal title="五章批次确认" onClose={() => setBatchPreview(null)}>
          <div className="form-stack">
            <div className="cost-preview">
              <div>
                <span>章节范围</span>
                <strong>
                  {batchPreview.chapters.length
                    ? `第${batchPreview.chapters[0].number}–${batchPreview.chapters.at(-1)?.number}章`
                    : "不可执行"}
                </strong>
              </div>
              <div>
                <span>预计输入</span>
                <strong>{formatCount(batchPreview.inputTokens)} tokens</strong>
              </div>
              <div>
                <span>预计输出</span>
                <strong>{formatCount(batchPreview.outputTokens)} tokens</strong>
              </div>
              <div>
                <span>估算费用</span>
                <strong>
                  {batchPreview.estimatedCost ? `¥${batchPreview.estimatedCost.toFixed(2)}` : "未填写模型单价"}
                </strong>
              </div>
            </div>
            <p className="inline-warning">{TOKEN_ESTIMATE_WARNING}</p>
            {batchPreview.blockingReason && <p className="inline-warning">{batchPreview.blockingReason}</p>}
            <div className="chapter-preview">
              {batchPreview.chapters.map((chapter) => (
                <div key={chapter.id}>
                  <span>{chapter.number}</span>
                  <strong>{chapter.title || "未命名章"}</strong>
                  <small>待质检草稿</small>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setBatchPreview(null)}>
                取消
              </Button>
              <Button
                disabled={!batchPreview.canRun || editorBusy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await api.generateChapterBatch(project.summary.id, draft.id);
                    const prior = new Map<string, string>();
                    for (const chapter of project.chapters)
                      if (chapter.number >= draft.number && chapter.number < draft.number + result.length)
                        prior.set(chapter.id, chapter.content);
                    setBatchPreview(null);
                    await reload();
                    setBatchReview(
                      result.map((chapter) => ({
                        chapter,
                        previousContent: prior.get(chapter.id) ?? "",
                        issues: [],
                        checking: true,
                        adopted: false,
                      })),
                    );
                    void Promise.all(
                      result.map(async (chapter) => {
                        try {
                          return { id: chapter.id, issues: await api.runQualityCheck(project.summary.id, chapter.id) };
                        } catch {
                          return { id: chapter.id, issues: [] as QualityIssue[] };
                        }
                      }),
                    ).then((checks) =>
                      setBatchReview((current) =>
                        current
                          ? current.map((item) => {
                              const check = checks.find((entry) => entry.id === item.chapter.id);
                              return check ? { ...item, issues: check.issues, checking: false } : item;
                            })
                          : current,
                      ),
                    );
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), "error");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "生成中" : "确认生成"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
