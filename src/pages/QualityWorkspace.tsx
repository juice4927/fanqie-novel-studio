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

export function QualityPage({ project, api, reload, notify }: CommonProjectProps) {
  const [changeModal, setChangeModal] = useState(false);
  const [reviewChapterId, setReviewChapterId] = useState("all");
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
  const displayedIssues = project.issues.filter((issue) => reviewChapterId === "all" || issue.chapterId === reviewChapterId);
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">质量与变更门禁</p>
          <h1>质检中心</h1>
          <p>硬性问题会阻止定稿；改纲只能通过可回滚的变更单生效。</p>
        </div>
        <Button
          icon={<GitPullRequestArrow size={16} />}
          onClick={() => setChangeModal(true)}
        >
          提交改纲单
        </Button>
      </header>
      <section className="debt-strip">
        {debts.map((debt) => (
          <div key={debt.label}>
            <strong>{debt.count}</strong>
            <span>{debt.label}</span>
          </div>
        ))}
      </section>
      <section className="section-band review-queue-band">
        <div className="section-heading">
          <div><h2>章节审稿队列</h2><p>{reviewQueue.length} 章等待质检或问题处理</p></div>
          <Select value={reviewChapterId} onChange={(event) => setReviewChapterId(event.target.value)} aria-label="筛选审稿章节">
            <option value="all">全部问题</option>
            {reviewQueue.map(({ chapter }) => <option key={chapter.id} value={chapter.id}>第{chapter.number}章 · {chapter.title}</option>)}
          </Select>
        </div>
        {reviewQueue.length ? (
          <div className="review-queue">
            {reviewQueue.map(({ chapter, issues }) => (
              <article key={chapter.id} className={reviewChapterId === chapter.id ? "active" : ""}>
                <button type="button" onClick={() => setReviewChapterId(chapter.id)}>
                  <span>第 {chapter.number} 章</span><strong>{chapter.title || "未命名章"}</strong>
                  <small>{chapter.status} · 硬性 {issues.filter((issue) => issue.severity === "硬性").length} · 其他 {issues.filter((issue) => issue.severity !== "硬性").length}</small>
                </button>
                <div className="review-queue-actions">
                  <Button variant="secondary" disabled={Boolean(chapterAction)} onClick={async () => {
                    setChapterAction({ id: chapter.id, kind: "质检" });
                    try { await api.runQualityCheck(project.summary.id, chapter.id); await reload(); setReviewChapterId(chapter.id); notify(`第${chapter.number}章质检已更新`); }
                    catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); }
                    finally { setChapterAction(null); }
                  }}>{chapterAction?.id === chapter.id && chapterAction.kind === "质检" ? "质检中" : "运行质检"}</Button>
                  {issues.length > 0 && !["已定稿", "待发布", "已发布"].includes(chapter.status) && (
                    <Button icon={<Sparkles size={14} />} disabled={Boolean(chapterAction)} onClick={async () => {
                      setChapterAction({ id: chapter.id, kind: "修订" });
                      try {
                        const revised = await api.reviseChapterFromQuality(project.summary.id, chapter.id);
                        await reload();
                        setReviewChapterId(chapter.id);
                        notify(`第${chapter.number}章 AI 修订已保存为 v${revised.revision}，请重新质检`);
                      } catch (error) {
                        notify(error instanceof Error ? error.message : String(error), "error");
                      } finally {
                        setChapterAction(null);
                      }
                    }}>{chapterAction?.id === chapter.id && chapterAction.kind === "修订" ? "修订中" : "AI 修订"}</Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="muted-line">当前没有等待审稿的章节。</p>}
      </section>
      <section className="two-column quality-columns">
        <div className="section-band">
          <div className="section-heading">
            <div>
              <h2>质检问题</h2>
              <p>
                {
                  project.issues.filter((issue) => issue.status === "待处理")
                    .length
                }{" "}
                项待处理
              </p>
            </div>
          </div>
          {displayedIssues.length ? (
            <div className="issue-list">
              {displayedIssues.map((issue) => (
                <article
                  key={issue.id}
                  className={issue.status !== "待处理" ? "resolved" : ""}
                >
                  <div className="issue-marker">
                    <AlertTriangle size={17} />
                  </div>
                  <div>
                    <div>
                      <Badge tone={issueTone(issue.severity)}>
                        {issue.severity}
                      </Badge>
                      <strong>{issue.category}</strong>
                    </div>
                    <p>{issue.message}</p>
                    {issue.evidence && (
                      <blockquote>{issue.evidence}</blockquote>
                    )}
                    <small>{formatDate(issue.createdAt, true)}</small>
                  </div>
                  {issue.status === "待处理" ? (
                    <div className="issue-actions">
                      {issue.severity !== "硬性" && (
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            await api.resolveIssue(
                              project.summary.id,
                              issue.id,
                              "已忽略",
                            );
                            await reload();
                          }}
                        >
                          忽略
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          await api.resolveIssue(
                            project.summary.id,
                            issue.id,
                            "已解决",
                          );
                          await reload();
                        }}
                      >
                        标记解决
                      </Button>
                    </div>
                  ) : (
                    <Badge>{issue.status}</Badge>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-line">
              还没有质检记录，请在写作台选择章节运行质检。
            </p>
          )}
        </div>
        <div className="section-band">
          <div className="section-heading">
            <div>
              <h2>改纲变更单</h2>
              <p>批准只改变状态，不会静默改写内容。</p>
            </div>
          </div>
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
        </div>
      </section>
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
