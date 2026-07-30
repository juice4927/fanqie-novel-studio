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
import { AutosaveCoordinator, chapterDraftSignature, clearRecoveredChapter, readRecoveredChapter, writeRecoveredChapter } from "../lib/chapter-draft";
import { GENRE_PLUGINS, GENRE_STAGES } from "../shared/genre-plugins";
import type { GenrePluginDefinition } from "../shared/genre-plugins";
import { FANQIE_CATEGORY_PROFILES, getFanqieCategoryProfile } from "../shared/fanqie-taxonomy";
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
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(200);
  const [scrollTop, setScrollTop] = useState(0);
  const [compactList, setCompactList] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  const [history, setHistory] = useState<RevisionRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const lastSavedSignature = useRef(chapterDraftSignature(selected ?? draft));
  const draftRef = useRef(draft);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const reloadRef = useRef(reload);
  const notifyRef = useRef(notify);
  const [batchPreview, setBatchPreview] =
    useState<BatchGenerationPreview | null>(null);
  useEffect(() => { draftRef.current = draft; reloadRef.current = reload; notifyRef.current = notify; }, [draft, reload, notify]);
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
    if (!next || chapterDraftSignature(draftRef.current) !== lastSavedSignature.current) return;
    setDraft(next);
    lastSavedSignature.current = chapterDraftSignature(next);
  }, [project, selectedId]);
  const dirty = chapterDraftSignature(draft) !== lastSavedSignature.current;
  useEffect(() => {
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
  }, [api, dirty, draft, notify, project.summary.id]);
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
  const canDiscardDraft = () => {
    if (!dirty) return true;
    if (!window.confirm("当前章节还有未保存内容，确定放弃这些修改吗？")) return false;
    clearRecoveredChapter(project.summary.id, draftRef.current);
    return true;
  };
  const selectChapter = (chapter: Chapter) => {
    if (!canDiscardDraft()) return;
    const recovered = readRecoveredChapter(project.summary.id, chapter);
    setSelectedId(chapter.id);
    setDraft(recovered);
    draftRef.current = recovered;
    lastSavedSignature.current = chapterDraftSignature(chapter);
    setSaveStatus(chapterDraftSignature(recovered) === lastSavedSignature.current ? "saved" : "dirty");
    setContext(null);
  };
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
            onClick={() => {
              if (!canDiscardDraft()) return;
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
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              placeholder="章节标题"
            />
          </div>
          <div className="heading-actions">
            <span className={`autosave-status autosave-${saveStatus}`} role="status">
              {!recoveryAvailable ? "恢复副本不可用" : saveStatus === "saving" ? "正在自动保存" : saveStatus === "dirty" ? "未保存" : saveStatus === "error" ? "保存失败" : "已保存"}
            </span>
            <Segmented
              options={["逐章", "五章批次"] as const}
              value={draft.batchMode}
              onChange={(batchMode) => setDraft({ ...draft, batchMode })}
            />
            <label className="key-toggle">
              <input
                type="checkbox"
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
              disabled={saveStatus === "saving"}
              onClick={save}
            >
              建立版本
            </Button>
          </div>
        </header>
        <div className="writing-actions">
          <Button
            variant="secondary"
            disabled={!draft.id}
            icon={<BrainCircuit size={16} />}
            onClick={async () => {
              try {
                setContext(
                  await api.compileContext(project.summary.id, draft.id),
                );
              } catch (error) {
                notify(String(error), "error");
              }
            }}
          >
            预览上下文
          </Button>
          <Button
            variant="secondary"
            disabled={!draft.id || busy}
            icon={<Sparkles size={16} />}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api.generateChapterDraft(
                  project.summary.id,
                  draft.id,
                );
                setDraft(result);
                await reload();
                notify("AI 草稿已生成，尚未定稿");
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
            {busy ? "生成中" : "AI 生成草稿"}
          </Button>
          {draft.batchMode === "五章批次" && (
            <Button
              variant="secondary"
              disabled={!draft.id || busy}
              icon={<Layers3 size={16} />}
              onClick={async () => {
                try {
                  setBatchPreview(
                    await api.previewChapterBatch(project.summary.id, draft.id),
                  );
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                  );
                }
              }}
            >
              五章批次
            </Button>
          )}
          <Button
            disabled={!draft.id}
            icon={<SearchCheck size={16} />}
            onClick={async () => {
              try {
                const issues = await api.runQualityCheck(
                  project.summary.id,
                  draft.id,
                );
                await api.transitionChapter(
                  project.summary.id,
                  draft.id,
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
              }
            }}
          >
            运行质检
          </Button>
          {draft.status === "待定稿" && (
            <Button
              icon={<Check size={16} />}
              onClick={async () => {
                try {
                  await api.transitionChapter(
                    project.summary.id,
                    draft.id,
                    "已定稿",
                  );
                  await reload();
                  notify("章节已定稿");
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
              <Field label="预计兑现章">
                <Input
                  type="number"
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
            </span>
            <IconButton label="关闭上下文" onClick={() => setContext(null)}>
              <Trash2 size={16} />
            </IconButton>
          </div>
          {Object.entries(context)
            .filter(([key]) => key !== "estimatedTokens")
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
                    {
                      contract: "创作契约",
                      commercialGuidance: "商业写作知识",
                      chapterIntent: "本章商业意图",
                      expectationLedger: "期待兑现账本",
                      volumeGoal: "当前卷目标",
                      rollingOutline: "滚动章纲",
                      recentSummary: "近期摘要",
                      relevantFacts: "相关事实",
                      forbiddenKnowledge: "禁止泄露信息",
                      authorStyle: "作者自身文风统计",
                    }[key]
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
                disabled={!batchPreview.canRun || busy}
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
