import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  FileOutput,
  GitPullRequestArrow,
  Layers3,
  LoaderCircle,
  History,
  LockKeyhole,
  NotebookTabs,
  Plus,
  Save,
  Search,
  SearchCheck,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AppApi,
  BatchGenerationPreview,
  ChangeRequest,
  Chapter,
  ChapterStatus,
  ConceptCandidate,
  ContextPackage,
  InsightPack,
  ExpectationEntry,
  LedgerFact,
  LedgerKind,
  PlanNode,
  PlanningGenerationInput,
  ProjectDetail,
  ProjectStatus,
  ScheduleItem,
  StoryContract,
  ReviewSuggestion,
  SearchHit,
  RevisionRecord,
} from "../shared/types";
import { CHAPTER_FUNCTIONS } from "../shared/types";
import { AutosaveCoordinator, chapterDraftSignature, clearRecoveredChapter, readRecoveredChapter, writeRecoveredChapter } from "../lib/chapter-draft";
import { GENRE_PLUGINS, GENRE_STAGES } from "../shared/genre-plugins";
import type { GenrePluginDefinition } from "../shared/genre-plugins";
import { FANQIE_CATEGORY_PROFILES, getFanqieCategoryProfile } from "../shared/fanqie-taxonomy";
import { TOKEN_ESTIMATE_WARNING } from "../shared/token-estimator";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
} from "../components/UI";
import { formatCount, formatDate } from "../lib/format";
import { summarizeMetrics } from "../shared/metrics";
import { CONTEXT_SECTION_LABELS } from "../shared/context-diagnostics";
import { diffParagraphs } from "../shared/paragraph-diff";

export interface CommonProjectProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

const EMPTY_CHAPTER = (number: number): Chapter => ({
  id: "", number, title: "", outline: "", content: "", wordCount: 0,
  status: "章纲", batchMode: "逐章", isKeyChapter: false, chapterPromise: "",
  expectedPayoff: "", crisis: "", endingExpectation: "", expectationTargetChapter: null,
  endingExpectationId: null, linkedExpectationIds: [], revision: 0, updatedAt: new Date().toISOString(),
});
const splitLines = (value: string) => value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
const issueTone = (value: string) => value === "硬性" ? "danger" : value === "警告" ? "warning" : "neutral";
function LightbulbIcon() { return <span className="mini-icon"><Sparkles size={16} /></span>; }
function UploadIcon() { return <FileOutput size={16} />; }

export function WritingPage({ project, api, reload, notify }: CommonProjectProps) {
  const [selectedId, setSelectedId] = useState(project.chapters[0]?.id ?? "");
  const selected = project.chapters.find(
    (chapter) => chapter.id === selectedId,
  );
  const [draft, setDraft] = useState<Chapter>(
    readRecoveredChapter(
      project.summary.id,
      selected ?? EMPTY_CHAPTER(project.chapters.length + 1),
    ),
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
  const lastSavedSignature = useRef(chapterDraftSignature(selected ?? draft));
  const draftRef = useRef(draft);
  const chapterRequestRef = useRef(0);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const reloadRef = useRef(reload);
  const notifyRef = useRef(notify);
  const [batchPreview, setBatchPreview] =
    useState<BatchGenerationPreview | null>(null);
  useEffect(() => { draftRef.current = draft; reloadRef.current = reload; notifyRef.current = notify; }, [draft, reload, notify]);
  useEffect(() => api.onChapterFactsExtracted((event) => {
    if (event.projectId !== project.summary.id) return;
    void reloadRef.current();
    if (event.status === "失败") {
      notifyRef.current(`章节已定稿，但状态扫描失败：${event.message ?? "未知错误"}`, "error");
      return;
    }
    notifyRef.current(event.candidateCount
      ? `状态扫描完成，生成 ${event.candidateCount} 条待确认状态`
      : "状态扫描完成，本章没有新的持久状态");
  }), [api, project.summary.id]);
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
      (error) => {
        setSaveStatus("error");
        notifyRef.current(`${error instanceof Error ? error.message : String(error)}；将自动重试`, "error");
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
  useEffect(() => {
    const chapter = project.chapters.find((item) => item.id === selectedId);
    if (!chapter) {
      setChapterLoading(false);
      return;
    }
    const requestId = ++chapterRequestRef.current;
    setChapterLoading(true);
    void api.getChapter(project.summary.id, chapter.id).then((loaded) => {
      if (chapterRequestRef.current !== requestId) return;
      const recovered = readRecoveredChapter(project.summary.id, loaded);
      draftRef.current = recovered;
      setDraft(recovered);
      lastSavedSignature.current = chapterDraftSignature(loaded);
      setSaveStatus(chapterDraftSignature(recovered) === lastSavedSignature.current ? "saved" : "dirty");
    }).catch((error) => {
      if (chapterRequestRef.current === requestId)
        notifyRef.current(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      if (chapterRequestRef.current === requestId) setChapterLoading(false);
    });
    return () => { chapterRequestRef.current += 1; };
  }, [api, project.summary.id, selectedId]);
  const dirty = chapterDraftSignature(draft) !== lastSavedSignature.current;
  useEffect(() => {
    if (busy || chapterLoading) return;
    if (!dirty) {
      setSaveStatus("saved");
      return;
    }
    setRecoveryAvailable(writeRecoveredChapter(project.summary.id, draft));
    setSaveStatus("dirty");
    if (!draft.id || ["已定稿", "待发布", "已发布"].includes(draft.status)) return;
    const timer = window.setTimeout(async () => {
      const snapshot = draftRef.current;
      setSaveStatus("saving");
      autosaveRef.current?.enqueue(snapshot);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [api, busy, chapterLoading, dirty, draft, notify, project.summary.id]);
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
    const timer = window.setTimeout(() => {
      if (query.trim().length >= 2)
        void api.searchProject(project.summary.id, query, 0, 50).then((hits) => {
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
      ? project.chapters.filter((chapter) =>
          searchHits.some((hit) => hit.id === chapter.id),
        )
      : project.chapters.slice(0, loadedCount);
  const ROW_HEIGHT = 54;
  const OVERSCAN = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const renderCount = Math.ceil(window.innerHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const virtualChapters = compactList ? filteredChapters : filteredChapters.slice(startIndex, startIndex + renderCount);
  const loadMoreSearch = async () => {
    const hits = await api.searchProject(project.summary.id, query, searchHits.length, 50);
    setSearchHits((current) => [...current, ...hits]);
    setSearchHasMore(hits.length === 50);
  };
  const save = async () => {
    const snapshot = draftRef.current;
    const snapshotSignature = chapterDraftSignature(snapshot);
    setSaveStatus("saving");
    try {
      const saved = await api.saveChapter(project.summary.id, snapshot);
      clearRecoveredChapter(project.summary.id, snapshot);
      lastSavedSignature.current = snapshotSignature;
      setSelectedId(saved.id);
      setDraft(saved);
      setSaveStatus("saved");
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
        <div
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
          <div className="chapter-virtual-spacer" style={{ height: compactList ? ROW_HEIGHT : filteredChapters.length * ROW_HEIGHT }}>
          <div className="chapter-virtual-window" style={{ transform: compactList ? undefined : `translateY(${startIndex * ROW_HEIGHT}px)` }}>
          {virtualChapters.map((chapter) => (
            <button
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
        </div>
      </aside>
      <div className="editor-workspace">
        <header className="editor-toolbar">
          <div>
            <p>第 {draft.number} 章</p>
            <Input
              className="title-input"
              disabled={editorBusy}
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              placeholder="章节标题"
            />
          </div>
          <div className="heading-actions">
            <span className={`autosave-status autosave-${saveStatus}`} role="status">
              {chapterLoading ? "正在读取正文" : !recoveryAvailable ? "恢复副本不可用" : saveStatus === "saving" ? "正在自动保存" : saveStatus === "dirty" ? "未保存" : saveStatus === "error" ? "保存失败" : "已保存"}
            </span>
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
            icon={<BrainCircuit size={16} />}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await saveLatestForAction();
                setContext(
                  await api.compileContext(project.summary.id, saved.id),
                );
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
                const result = await api.generateChapterDraft(
                  project.summary.id,
                  beforeGeneration.id,
                  (event) => {
                    if (event.type === "attempt-start") {
                      streamedAttempt = event.attempt;
                      streamedContent = "";
                    } else if (event.type === "delta" && event.attempt === streamedAttempt) {
                      streamedContent += event.delta;
                    } else return;
                    const streamedDraft = { ...beforeGeneration, content: streamedContent };
                    draftRef.current = streamedDraft;
                    setDraft(streamedDraft);
                  },
                );
                draftRef.current = result;
                lastSavedSignature.current = chapterDraftSignature(result);
                clearRecoveredChapter(project.summary.id, result);
                setDraft(result);
                setSaveStatus("saved");
                await reload();
                notify("AI 草稿已生成，尚未定稿");
              } catch (error) {
                draftRef.current = beforeGeneration;
                setDraft(beforeGeneration);
                notify(
                  error instanceof Error ? error.message : String(error),
                  "error",
                );
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
                  setBatchPreview(
                    await api.previewChapterBatch(project.summary.id, saved.id),
                  );
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                  );
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
                const issues = await api.runQualityCheck(
                  project.summary.id,
                  saved.id,
                );
                await api.transitionChapter(
                  project.summary.id,
                  saved.id,
                  "待定稿",
                );
                await reload();
                notify(
                  issues.length
                    ? `质检完成，发现 ${issues.length} 项问题`
                    : "质检完成，未发现问题",
                );
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : String(error),
                  "error",
                );
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
                  const result = await api.transitionChapter(
                    project.summary.id,
                    draft.id,
                    "已定稿",
                  );
                  await reload();
                  if (result.ledgerExtraction.status === "排队中") {
                    notify("章节已定稿，状态扫描正在后台进行");
                  } else if (result.ledgerExtraction.status === "已完成") {
                    notify(result.ledgerExtraction.candidateCount
                      ? `章节已定稿，生成 ${result.ledgerExtraction.candidateCount} 条待确认状态`
                      : "章节已定稿，本章没有新的持久状态");
                  } else if (result.ledgerExtraction.status === "失败") {
                    notify(`章节已定稿，但状态扫描失败：${result.ledgerExtraction.message ?? "未知错误"}`, "error");
                  } else {
                    notify("章节已定稿；未配置 AI，未扫描状态候选");
                  }
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                  );
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
                  onChange={(event) =>
                    setDraft({ ...draft, chapterPromise: event.target.value })
                  }
                  placeholder="承接哪项期待，本章具体答应什么"
                />
              </Field>
              <Field label="预期回报" hint="本章准备释放的情绪或利益回报">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.expectedPayoff ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, expectedPayoff: event.target.value })
                  }
                  placeholder="胜负、关系、信息、资源或身份变化"
                />
              </Field>
              <Field label="当前危机" hint="不行动会失去什么">
                <Textarea
                  rows={2}
                  disabled={editorBusy}
                  value={draft.crisis ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, crisis: event.target.value })
                  }
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
                  onChange={(event) => setDraft({ ...draft, chapterFunction: event.target.value as Chapter["chapterFunction"] })}
                >
                  {CHAPTER_FUNCTIONS.map((item) => <option key={item}>{item}</option>)}
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
                      expectationTargetChapter: event.target.value
                        ? Number(event.target.value)
                        : null,
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
                      linkedExpectationIds: Array.from(
                        event.currentTarget.selectedOptions,
                        (option) => option.value,
                      ),
                    })
                  }
                >
                  {project.expectations
                    .filter(
                      (item) =>
                        item.status === "待兑现" || item.status === "部分兑现",
                    )
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
                onChange={(event) =>
                  setDraft({ ...draft, outline: event.target.value })
                }
                placeholder="目标、冲突、信息揭示、状态变化、章末推动力"
              />
            </Field>
          </div>
          <Textarea
            className="manuscript"
            value={draft.content}
            disabled={editorBusy}
            onChange={(event) =>
              setDraft({ ...draft, content: event.target.value })
            }
            placeholder="在这里写正文，或先保存章纲后使用 AI 生成草稿。"
          />
          <footer className="editor-footer">
            <span>
              {draft.content.replace(/\s/g, "").length.toLocaleString()} 字 · v
              {draft.revision || 1}
            </span>
            <span className="editor-version-actions">
              {draft.id && (
                <button
                  onClick={async () => {
                    setHistory(
                      await api.listRevisions(
                        project.summary.id,
                        "chapters",
                        draft.id,
                      ),
                    );
                    setHistoryOpen(true);
                  }}
                >
                  <History size={13} />
                  历史版本
                </button>
              )}
              <Badge
                tone={
                  draft.status === "已定稿" || draft.status === "已发布"
                    ? "success"
                    : "neutral"
                }
              >
                {draft.status}
              </Badge>
            </span>
          </footer>
        </div>
      </div>
      {context && (
        <aside className="context-panel">
          <div className="context-head">
            <span>
              <strong>上下文包</strong>
              <small>约 {context.estimatedTokens} tokens</small>
              <small>{TOKEN_ESTIMATE_WARNING}</small>
            </span>
            <IconButton label="关闭上下文" onClick={() => setContext(null)}>
              <Trash2 size={16} />
            </IconButton>
          </div>
          {context.diagnostics && (
            <div className="context-diagnostics">
              {context.diagnostics.warnings.length > 0 && (
                <div className="context-warnings" role="alert">
                  <AlertTriangle size={16} />
                  <span>{context.diagnostics.warnings.join("；")}</span>
                </div>
              )}
              <div className="context-diagnostic-list">
                {context.diagnostics.sections.map((section) => (
                  <div key={section.key} className={`context-diagnostic context-${section.status}`}>
                    <span><strong>{section.label}</strong><small>{section.source}</small></span>
                    <span><Badge tone={section.status === "缺失" ? "warning" : "neutral"}>{section.status}</Badge><small>{section.includedItems}/{section.totalItems} 项 · {section.characters} 字</small></span>
                    <p>{section.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.entries(context)
            .filter(([key]) => key !== "estimatedTokens" && key !== "diagnostics")
            .map(([key, value]) => (
              <details
                key={key}
                open={
                  key === "contract" ||
                  key === "chapterIntent" ||
                  key === "expectationLedger" ||
                  key === "forbiddenKnowledge"
                }
              >
                <summary>
                  {
                    CONTEXT_SECTION_LABELS[key as keyof typeof CONTEXT_SECTION_LABELS]
                  }
                </summary>
                <pre>{value || "无"}</pre>
              </details>
            ))}
        </aside>
      )}
      {historyOpen && (
        <Modal
          title={`第${draft.number}章历史版本`}
          onClose={() => setHistoryOpen(false)}
        >
          <div className="revision-list">
            {history.length ? (
              history.map((revision) => {
                const snapshot = revision.payload as Chapter;
                const compared = compareRevisionId === revision.id ? diffParagraphs(snapshot.content ?? "", draft.content ?? "") : [];
                return (
                  <article key={revision.id}>
                    <div>
                      <strong>
                        v{revision.revision} · {snapshot.title}
                      </strong>
                      <small>
                        {formatDate(revision.createdAt, true)} ·{" "}
                        {snapshot.content?.replace(/\s/g, "").length ?? 0}字
                      </small>
                    </div>
                    <div className="revision-actions">
                      <Button variant="ghost" onClick={() => setCompareRevisionId(compareRevisionId === revision.id ? "" : revision.id)}>
                        {compareRevisionId === revision.id ? "收起差异" : "与当前版本比较"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          await api.restoreRevision(
                            project.summary.id,
                            revision.id,
                          );
                          await reload();
                          setHistoryOpen(false);
                          notify(`已从 v${revision.revision} 建立新的当前版本`);
                        }}
                      >
                        恢复为新版本
                      </Button>
                    </div>
                    {compared.length > 0 && (
                      <div className="paragraph-diff" aria-label={`v${revision.revision} 与当前版本的段落差异`}>
                        <header>
                          <span>新增 {compared.filter((item) => item.kind === "新增").length}</span>
                          <span>删除 {compared.filter((item) => item.kind === "删除").length}</span>
                          <span>未变 {compared.filter((item) => item.kind === "未变").length}</span>
                        </header>
                        {compared.map((item, index) => (
                          <p key={`${item.kind}-${index}`} className={`diff-${item.kind}`}>{item.kind === "新增" ? "+" : item.kind === "删除" ? "-" : " "} {item.text}</p>
                        ))}
                      </div>
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
                  {batchPreview.estimatedCost
                    ? `¥${batchPreview.estimatedCost.toFixed(2)}`
                    : "未填写模型单价"}
                </strong>
              </div>
            </div>
            <p className="inline-warning">{TOKEN_ESTIMATE_WARNING}</p>
            {batchPreview.blockingReason && (
              <p className="inline-warning">{batchPreview.blockingReason}</p>
            )}
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
                    const result = await api.generateChapterBatch(
                      project.summary.id,
                      draft.id,
                    );
                    setBatchPreview(null);
                    await reload();
                    notify(`已生成 ${result.length} 章待质检草稿`);
                  } catch (error) {
                    notify(
                      error instanceof Error ? error.message : String(error),
                      "error",
                    );
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
