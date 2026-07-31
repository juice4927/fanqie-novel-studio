import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookMarked,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
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
  SlidersHorizontal,
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
  QualityIssue,
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

export function QualityPage({ project, api, reload, notify }: CommonProjectProps) {
  const [changeModal, setChangeModal] = useState(false);
  const [reviewChapterId, setReviewChapterId] = useState("");
  const [qualityView, setQualityView] = useState<"审稿队列" | "问题记录" | "改纲变更">("审稿队列");
  const [issueScope, setIssueScope] = useState<"待处理" | "全部">("待处理");
  const [issueSeverity, setIssueSeverity] = useState<"全部" | "硬性" | "警告" | "建议">("全部");
  const [chapterAction, setChapterAction] = useState<{ id: string; kind: "质检" | "修订" } | null>(null);
  const [change, setChange] = useState<ChangeRequest>({
    id: "",
    targetKind: "创作契约",
    targetId: "contract",
    baseVersion: 0,
    title: "",
    reason: "",
    beforeValue: "",
    afterValue: "",
    impact: "",
    rollback: "",
    status: "待审批",
    createdAt: new Date().toISOString(),
  });
  const currentChapter = Math.max(
    0,
    ...project.chapters.map((chapter) => chapter.number),
  );
  const recentConflictKeys = project.chapters
    .slice(-30)
    .map((chapter) =>
      chapter.outline.replace(/[目标冲突结果：:；;，,。\s]/g, "").slice(0, 18),
    )
    .filter(Boolean);
  const repeatedConflicts =
    recentConflictKeys.length - new Set(recentConflictKeys).size;
  const debts = [
    {
      label: "长期未回收伏笔",
      count: project.facts.filter(
        (fact) =>
          fact.kind === "伏笔" &&
          fact.validToChapter === null &&
          project.summary.chapterCount - fact.validFromChapter > 30,
      ).length,
    },
    {
      label: "待兑现承诺",
      count: project.facts.filter(
        (fact) => fact.kind === "承诺" && fact.validToChapter === null,
      ).length,
    },
    {
      label: "沉睡角色",
      count: project.facts.filter(
        (fact) =>
          fact.kind === "人物" &&
          fact.validToChapter === null &&
          currentChapter - fact.evidenceChapter > 50,
      ).length,
    },
    {
      label: "能力膨胀信号",
      count: project.facts.filter(
        (fact) =>
          fact.kind === "能力" && currentChapter - fact.evidenceChapter <= 20,
      ).length,
    },
    { label: "重复冲突信号", count: repeatedConflicts },
    {
      label: "失联支线",
      count: project.facts.filter(
        (fact) =>
          fact.kind === "支线" &&
          fact.validToChapter === null &&
          currentChapter - fact.evidenceChapter > 30,
      ).length,
    },
    {
      label: "冲突事实",
      count: project.facts.filter((fact) => fact.confidence === "有冲突")
        .length,
    },
    {
      label: "未处理硬性项",
      count: project.issues.filter(
        (issue) => issue.severity === "硬性" && issue.status === "待处理",
      ).length,
    },
  ];
  const reviewQueue = project.chapters
    .filter((chapter) => chapter.status === "待质检" || project.issues.some((issue) => issue.chapterId === chapter.id && issue.status === "待处理"))
    .map((chapter) => ({
      chapter,
      issues: project.issues.filter((issue) => issue.chapterId === chapter.id && issue.status === "待处理"),
    }));
  const reviewQueueKey = reviewQueue.map(({ chapter }) => chapter.id).join("|");
  useEffect(() => {
    if (!reviewQueue.length) {
      setReviewChapterId("");
      return;
    }
    if (!reviewQueue.some(({ chapter }) => chapter.id === reviewChapterId)) {
      setReviewChapterId(reviewQueue[0].chapter.id);
    }
  }, [reviewChapterId, reviewQueueKey]);
  const selectedReview = reviewQueue.find(({ chapter }) => chapter.id === reviewChapterId) ?? reviewQueue[0];
  const pendingIssues = project.issues.filter((issue) => issue.status === "待处理");
  const hardIssueCount = pendingIssues.filter((issue) => issue.severity === "硬性").length;
  const displayedIssues = project.issues.filter((issue) => {
    const chapterMatches = qualityView === "问题记录" || issue.chapterId === selectedReview?.chapter.id;
    const scopeMatches = issueScope === "全部" || issue.status === "待处理";
    const severityMatches = issueSeverity === "全部" || issue.severity === issueSeverity;
    return chapterMatches && scopeMatches && severityMatches;
  });
  const runChapterAction = async (chapter: Chapter, kind: "质检" | "修订") => {
    setChapterAction({ id: chapter.id, kind });
    try {
      if (kind === "质检") {
        await api.runQualityCheck(project.summary.id, chapter.id);
        notify(`第${chapter.number}章质检已更新`);
      } else {
        const revised = await api.reviseChapterFromQuality(project.summary.id, chapter.id);
        notify(`第${chapter.number}章 AI 修订已保存为 v${revised.revision}，请重新质检`);
      }
      await reload();
      setReviewChapterId(chapter.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setChapterAction(null);
    }
  };
  const updateIssue = async (issueId: string, status: "已忽略" | "已解决") => {
    try {
      await api.resolveIssue(project.summary.id, issueId, status);
      await reload();
      notify(status === "已解决" ? "问题已标记解决" : "问题已忽略");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };
  return (
    <div className="page project-page quality-page">
      <header className="page-header quality-header">
        <div>
          <p className="eyebrow">质量门禁</p>
          <h1>质检中心</h1>
          <p>{hardIssueCount ? `${hardIssueCount} 项硬性问题正在阻止定稿` : "当前没有阻止定稿的硬性问题"}</p>
        </div>
        <Button icon={<GitPullRequestArrow size={16} />} variant="secondary" onClick={() => setChangeModal(true)}>提交改纲单</Button>
      </header>

      <section className="quality-summary" aria-label="质检概览">
        <div className={hardIssueCount ? "danger" : "clear"}><AlertTriangle size={18} /><span><strong>{hardIssueCount}</strong>硬性问题</span></div>
        <div><ClipboardCheck size={18} /><span><strong>{reviewQueue.length}</strong>待审章节</span></div>
        <div><CircleDot size={18} /><span><strong>{pendingIssues.length}</strong>待处理问题</span></div>
        <div><GitPullRequestArrow size={18} /><span><strong>{project.changes.filter((item) => item.status === "待审批").length}</strong>待审批变更</span></div>
      </section>

      <nav className="quality-tabs" aria-label="质检中心视图">
        <button className={qualityView === "审稿队列" ? "active" : ""} onClick={() => setQualityView("审稿队列")}><ClipboardCheck size={16} />审稿队列<span>{reviewQueue.length}</span></button>
        <button className={qualityView === "问题记录" ? "active" : ""} onClick={() => setQualityView("问题记录")}><Archive size={16} />问题记录<span>{project.issues.length}</span></button>
        <button className={qualityView === "改纲变更" ? "active" : ""} onClick={() => setQualityView("改纲变更")}><GitPullRequestArrow size={16} />改纲变更<span>{project.changes.length}</span></button>
      </nav>

      {qualityView === "审稿队列" && (reviewQueue.length ? (
        <section className="quality-workbench">
          <aside className="quality-queue-panel">
            <header><div><h2>待审章节</h2><p>按章节逐一处理</p></div><Badge tone={hardIssueCount ? "danger" : "neutral"}>{reviewQueue.length}</Badge></header>
            <Select className="select quality-chapter-select" value={selectedReview?.chapter.id ?? ""} onChange={(event) => setReviewChapterId(event.target.value)} aria-label="筛选审稿章节">
              {reviewQueue.map(({ chapter }) => <option key={chapter.id} value={chapter.id}>第{chapter.number}章 · {chapter.title || "未命名章"}</option>)}
            </Select>
            <div className="quality-queue-list">
              {reviewQueue.map(({ chapter, issues }) => {
                const hard = issues.filter((issue) => issue.severity === "硬性").length;
                return <button type="button" key={chapter.id} className={selectedReview?.chapter.id === chapter.id ? "active" : ""} onClick={() => setReviewChapterId(chapter.id)}>
                  <span className="chapter-number">{chapter.number}</span>
                  <span className="chapter-label"><strong>{chapter.title || "未命名章"}</strong><small>{chapter.status} · {issues.length ? `${issues.length} 项待处理` : "等待质检"}</small></span>
                  {hard > 0 ? <Badge tone="danger">{hard} 硬性</Badge> : <ChevronRight size={16} />}
                </button>;
              })}
            </div>
          </aside>

          <div className="quality-review-panel">
            <header className="quality-review-header">
              <div><p>第 {selectedReview.chapter.number} 章 · {selectedReview.chapter.status}</p><h2>{selectedReview.chapter.title || "未命名章"}</h2><span>{selectedReview.chapter.wordCount.toLocaleString()} 字 · 修订 v{selectedReview.chapter.revision}</span></div>
              <div className="quality-review-actions">
                <Button variant="secondary" disabled={Boolean(chapterAction)} onClick={() => runChapterAction(selectedReview.chapter, "质检")}>{chapterAction?.kind === "质检" ? <><LoaderCircle className="spin" size={15} />质检中</> : <><SearchCheck size={15} />重新质检</>}</Button>
                {selectedReview.issues.length > 0 && !["已定稿", "待发布", "已发布"].includes(selectedReview.chapter.status) && <Button disabled={Boolean(chapterAction)} onClick={() => runChapterAction(selectedReview.chapter, "修订")}>{chapterAction?.kind === "修订" ? <><LoaderCircle className="spin" size={15} />修订中</> : <><Sparkles size={15} />AI 修订</>}</Button>}
              </div>
            </header>
            <div className="issue-toolbar">
              <div><Segmented options={["待处理", "全部"] as const} value={issueScope} onChange={setIssueScope} /></div>
              <Select value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)} aria-label="筛选问题级别"><option>全部</option><option>硬性</option><option>警告</option><option>建议</option></Select>
            </div>
            <IssueList issues={displayedIssues} onUpdate={updateIssue} emptyMessage={issueScope === "待处理" ? "这一章没有待处理问题" : "这一章还没有质检记录"} />
          </div>
        </section>
      ) : <EmptyState icon={<CheckCircle2 size={24} />} title="审稿队列已清空" description="当前没有等待质检或问题处理的章节。" />)}

      {qualityView === "问题记录" && <section className="section-band quality-records">
        <div className="section-heading"><div><h2>问题记录</h2><p>查看跨章节问题与处理结果</p></div><div className="issue-record-filters"><Segmented options={["待处理", "全部"] as const} value={issueScope} onChange={setIssueScope} /><Select value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)} aria-label="筛选问题级别"><option>全部</option><option>硬性</option><option>警告</option><option>建议</option></Select></div></div>
        <IssueList issues={displayedIssues} onUpdate={updateIssue} emptyMessage="没有符合筛选条件的问题" showChapter chapters={project.chapters} />
      </section>}

      {qualityView === "改纲变更" && <section className="section-band quality-changes">
        <div className="section-heading"><div><h2>改纲变更单</h2><p>批准只改变状态，不会静默改写内容。</p></div><Button icon={<Plus size={15} />} onClick={() => setChangeModal(true)}>提交改纲单</Button></div>
          {project.changes.length ? (
            <div className="change-list">
              {project.changes.map((item) => (
                <article key={item.id}>
                  <div>
                    <Badge
                      tone={
                        item.status === "已批准"
                          ? "success"
                          : item.status === "已拒绝"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {item.status}
                    </Badge>
                    <h3>{item.title}</h3>
                    <p>{item.reason}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>影响范围</dt>
                      <dd>{item.impact}</dd>
                    </div>
                    <div>
                      <dt>回滚方案</dt>
                      <dd>{item.rollback}</dd>
                    </div>
                  </dl>
                  {item.status === "待审批" && (
                    <footer>
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          await api.decideChangeRequest(
                            project.summary.id,
                            item.id,
                            "拒绝",
                          );
                          await reload();
                        }}
                      >
                        拒绝
                      </Button>
                      <Button
                        onClick={async () => {
                          await api.decideChangeRequest(
                            project.summary.id,
                            item.id,
                            "批准",
                          );
                          await reload();
                        }}
                      >
                        批准
                      </Button>
                    </footer>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-line">没有待审改纲单</p>
          )}
        </section>}

      <details className="quality-debts"><summary><span><SlidersHorizontal size={16} />长期质量信号</span><small>{debts.reduce((sum, debt) => sum + debt.count, 0)} 个信号</small></summary><div className="debt-strip">{debts.map((debt) => <div key={debt.label}><strong>{debt.count}</strong><span>{debt.label}</span></div>)}</div></details>
      {changeModal && (
        <Modal title="提交改纲变更单" onClose={() => setChangeModal(false)}>
          <div className="form-stack">
            <div className="form-grid two">
              <Field label="目标类型">
                <Select
                  value={change.targetKind}
                  onChange={(event) => {
                    const targetKind = event.target
                      .value as ChangeRequest["targetKind"];
                    setChange({
                      ...change,
                      targetKind,
                      targetId: targetKind === "创作契约" ? "contract" : "",
                    });
                  }}
                >
                  <option>创作契约</option>
                  <option>规划</option>
                  <option>章节</option>
                </Select>
              </Field>
              <Field label="具体目标">
                <Select
                  value={change.targetId}
                  disabled={change.targetKind === "创作契约"}
                  onChange={(event) =>
                    setChange({ ...change, targetId: event.target.value })
                  }
                >
                  {change.targetKind === "创作契约" ? (
                    <option value="contract">当前创作契约</option>
                  ) : (
                    <>
                      <option value="">请选择</option>
                      {change.targetKind === "规划"
                        ? project.plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.kind}：{plan.title}
                            </option>
                          ))
                        : project.chapters.map((chapter) => (
                            <option key={chapter.id} value={chapter.id}>
                              第{chapter.number}章 {chapter.title}
                            </option>
                          ))}
                    </>
                  )}
                </Select>
              </Field>
            </div>
            <Field label="变更标题">
              <Input
                value={change.title}
                onChange={(event) =>
                  setChange({ ...change, title: event.target.value })
                }
              />
            </Field>
            <Field label="变更原因">
              <Textarea
                rows={3}
                value={change.reason}
                onChange={(event) =>
                  setChange({ ...change, reason: event.target.value })
                }
              />
            </Field>
            <div className="form-grid two">
              <Field label="旧方案">
                <Textarea
                  rows={4}
                  value={change.beforeValue}
                  onChange={(event) =>
                    setChange({ ...change, beforeValue: event.target.value })
                  }
                />
              </Field>
              <Field label="新方案">
                <Textarea
                  rows={4}
                  value={change.afterValue}
                  onChange={(event) =>
                    setChange({ ...change, afterValue: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="影响范围">
              <Textarea
                rows={3}
                value={change.impact}
                onChange={(event) =>
                  setChange({ ...change, impact: event.target.value })
                }
              />
            </Field>
            <Field label="回滚方式">
              <Textarea
                rows={3}
                value={change.rollback}
                onChange={(event) =>
                  setChange({ ...change, rollback: event.target.value })
                }
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setChangeModal(false)}>
                取消
              </Button>
              <Button
                disabled={
                  !change.targetId ||
                  !change.title ||
                  !change.reason ||
                  !change.impact ||
                  !change.rollback
                }
                onClick={async () => {
                  await api.saveChangeRequest(project.summary.id, change);
                  await reload();
                  setChangeModal(false);
                  notify("变更单已提交待审批");
                }}
              >
                提交变更单
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function IssueList({ issues, onUpdate, emptyMessage, showChapter = false, chapters = [] }: {
  issues: QualityIssue[];
  onUpdate: (issueId: string, status: "已忽略" | "已解决") => Promise<void>;
  emptyMessage: string;
  showChapter?: boolean;
  chapters?: Chapter[];
}) {
  if (!issues.length) {
    return <div className="quality-empty"><CheckCircle2 size={24} /><strong>{emptyMessage}</strong><span>调整筛选条件，或从左侧选择其他章节。</span></div>;
  }
  return <div className="issue-list quality-issue-list">
    {issues.map((issue) => {
      const chapter = showChapter ? chapters.find((item) => item.id === issue.chapterId) : undefined;
      return <article key={issue.id} className={issue.status !== "待处理" ? "resolved" : ""}>
        <div className="issue-marker">{issue.status === "待处理" ? <AlertTriangle size={17} /> : <Check size={17} />}</div>
        <div className="issue-content">
          <div className="issue-meta"><Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge><strong>{issue.category}</strong>{chapter && <span>第 {chapter.number} 章 · {chapter.title || "未命名章"}</span>}</div>
          <p>{issue.message}</p>
          {issue.evidence && <blockquote>{issue.evidence}</blockquote>}
          <small>{formatDate(issue.createdAt, true)}</small>
        </div>
        {issue.status === "待处理" ? <div className="issue-actions">
          {issue.severity !== "硬性" && <Button variant="ghost" onClick={() => onUpdate(issue.id, "已忽略")}>忽略</Button>}
          <Button variant="secondary" icon={<Check size={14} />} onClick={() => onUpdate(issue.id, "已解决")}>解决</Button>
        </div> : <Badge tone="neutral">{issue.status}</Badge>}
      </article>;
    })}
  </div>;
}
