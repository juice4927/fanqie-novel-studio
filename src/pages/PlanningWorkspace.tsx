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

export function PlanningPage({ project, api, reload, notify }: CommonProjectProps) {
  const [modal, setModal] = useState(false);
  const [aiModal, setAiModal] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInput, setAiInput] = useState<PlanningGenerationInput>({ mode: project.plans.some((plan) => plan.kind === "宏观阶段" || plan.kind === "分卷") ? "后续章纲" : "全书结构", fromChapter: Math.max(1, ...project.chapters.map((chapter) => chapter.number + 1)), chapterCount: 10 });
  const [kind, setKind] = useState<PlanNode["kind"]>("宏观阶段");
  const [draft, setDraft] = useState<PlanNode>({
    id: "",
    kind: "宏观阶段",
    title: "",
    ordinal: project.plans.length + 1,
    goal: "",
    conflict: "",
    outcome: "",
    targetWords: 150000,
    status: "草稿",
    parentId: null,
  });
  const grouped = ["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"].map(
    (group) => ({
      group,
      items: project.plans.filter((plan) => plan.kind === group),
    }),
  );
  const open = (nextKind: PlanNode["kind"]) => {
    setKind(nextKind);
    setDraft({
      id: "",
      kind: nextKind,
      title: "",
      ordinal: project.plans.filter((p) => p.kind === nextKind).length + 1,
      goal: "",
      conflict: "",
      outcome: "",
      targetWords: nextKind === "分卷" ? 150000 : 2500,
      status: "草稿",
      parentId: null,
    });
    setModal(true);
  };
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">连载生产区</p>
          <h1>分层规划台</h1>
          <p>远期只定目标，未来 30 章粗纲、5 章细纲和当前场景卡逐级收敛。</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" icon={<Sparkles size={16} />} disabled={!project.contract.approved} onClick={() => setAiModal(true)}>AI 生成规划</Button>
          <Button icon={<Plus size={16} />} onClick={() => open("宏观阶段")}>新建规划节点</Button>
        </div>
      </header>
      <div className="plan-hierarchy">
        {grouped.map(({ group, items }) => (
          <section className="plan-level" key={group}>
            <div className="plan-level-title">
              <span>
                <strong>{group}</strong>
                <small>
                  {group === "宏观阶段"
                    ? "全书 3–5 个阶段"
                    : group === "分卷"
                      ? "建议每卷 12–18 万字"
                      : group === "粗纲"
                        ? "未来 30 章"
                        : group === "细纲"
                          ? "未来 5 章"
                          : "当前章场景目标"}
                </small>
              </span>
              <IconButton
                label={`新建${group}`}
                onClick={() => open(group as PlanNode["kind"])}
              >
                <Plus size={16} />
              </IconButton>
            </div>
            <div className="plan-items">
              {items.map((plan) => (
                <article key={plan.id}>
                  <span className="plan-order">{plan.ordinal}</span>
                  <div>
                    <h3>{plan.title}</h3>
                    <p>{plan.goal}</p>
                    <small>
                      {formatCount(plan.targetWords)}字 ·{" "}
                      {plan.conflict || "未填写冲突"}
                    </small>
                  </div>
                  <div className="plan-actions">
                    <Badge
                      tone={
                        plan.status === "已批准"
                          ? "success"
                          : plan.status === "待审批"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {plan.status}
                    </Badge>
                    {plan.status !== "已批准" && (
                      <IconButton
                        label="审批规划"
                        onClick={async () => {
                          try {
                            await api.approvePlan(project.summary.id, plan.id);
                            await reload();
                            notify("规划节点已批准");
                          } catch (error) {
                            notify(
                              error instanceof Error
                                ? error.message
                                : String(error),
                              "error",
                            );
                          }
                        }}
                      >
                        <Check size={16} />
                      </IconButton>
                    )}
                  </div>
                </article>
              ))}
              {!items.length && (
                <button
                  className="plan-empty"
                  onClick={() => open(group as PlanNode["kind"])}
                >
                  <Plus size={16} />
                  建立{group}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {modal && (
        <Modal title={`新建${kind}`} onClose={() => setModal(false)}>
          <div className="form-stack">
            <div className="form-grid two">
              <Field label="层级">
                <Select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as PlanNode["kind"],
                    })
                  }
                >
                  {["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Select>
              </Field>
              <Field label="序号">
                <Input
                  type="number"
                  min={1}
                  value={draft.ordinal}
                  onChange={(event) =>
                    setDraft({ ...draft, ordinal: Number(event.target.value) })
                  }
                />
              </Field>
            </div>
            <Field label="标题">
              <Input
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field label="目标">
              <Textarea
                rows={3}
                value={draft.goal}
                onChange={(event) =>
                  setDraft({ ...draft, goal: event.target.value })
                }
              />
            </Field>
            <Field label="核心矛盾">
              <Textarea
                rows={3}
                value={draft.conflict}
                onChange={(event) =>
                  setDraft({ ...draft, conflict: event.target.value })
                }
              />
            </Field>
            <Field label="预期结果 / 状态变化">
              <Textarea
                rows={3}
                value={draft.outcome}
                onChange={(event) =>
                  setDraft({ ...draft, outcome: event.target.value })
                }
              />
            </Field>
            <div className="form-grid two">
              <Field label="目标字数">
                <Input
                  type="number"
                  min={500}
                  step={500}
                  value={draft.targetWords}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      targetWords: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="初始状态">
                <Select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.value as PlanNode["status"],
                    })
                  }
                >
                  <option>草稿</option>
                  <option>待审批</option>
                </Select>
              </Field>
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                disabled={!draft.title || !draft.goal}
                onClick={async () => {
                  await api.savePlan(project.summary.id, draft);
                  await reload();
                  setModal(false);
                  notify("规划节点已保存");
                }}
              >
                保存节点
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {aiModal && (
        <Modal title="AI 生成规划草稿" onClose={() => !aiBusy && setAiModal(false)} width={680}>
          <div className="form-stack">
            <Field label="生成范围" hint="AI 只新增草稿，不覆盖已有规划或章节">
              <Segmented options={["全书结构", "后续章纲"] as const} value={aiInput.mode} onChange={(mode) => setAiInput({ ...aiInput, mode })} />
            </Field>
            {aiInput.mode === "全书结构" ? (
              <p className="inline-warning">生成六个商业阶段与 3–6 个分卷。当前已有宏观阶段或分卷时会拒绝执行，防止重复结构。</p>
            ) : (
              <div className="form-grid two">
                <Field label="起始章节">
                  <Input type="number" min={1} value={aiInput.fromChapter ?? 1} onChange={(event) => setAiInput({ ...aiInput, fromChapter: Math.max(1, Number(event.target.value)) })} />
                </Field>
                <Field label="生成章数">
                  <Select value={aiInput.chapterCount ?? 10} onChange={(event) => setAiInput({ ...aiInput, chapterCount: Number(event.target.value) as 10 | 30 })}><option value={10}>10 章</option><option value={30}>30 章</option></Select>
                </Field>
              </div>
            )}
            <div className="planning-ai-summary">
              <strong>{aiInput.mode === "全书结构" ? "输出：六阶段 + 分卷" : `输出：第${aiInput.fromChapter}–${(aiInput.fromChapter ?? 1) + (aiInput.chapterCount ?? 10) - 1}章`}</strong>
              <p>{aiInput.mode === "全书结构" ? "每个节点包含目标、核心矛盾、预期结果和目标字数。" : "同步建立滚动粗纲、逐章细纲、每章三张场景卡，以及章节承诺、回报、危机、章末期待和兑现目标章。"}</p>
            </div>
            <div className="modal-actions">
              <Button variant="secondary" disabled={aiBusy} onClick={() => setAiModal(false)}>取消</Button>
              <Button disabled={aiBusy} icon={aiBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} onClick={async () => {
                setAiBusy(true);
                try {
                  const result = await api.generatePlanningDraft(project.summary.id, aiInput);
                  await reload(); setAiModal(false);
                  notify(result.chapters.length ? `已生成 ${result.chapters.length} 章章纲、细纲和场景卡，共 ${result.plans.length} 个规划草稿` : `已生成 ${result.plans.length} 个全书结构草稿`);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  await reload();
                  if (message.startsWith("已保存第")) setAiModal(false);
                  notify(message, "error");
                }
                finally { setAiBusy(false); }
              }}>{aiBusy ? "生成中" : "生成草稿"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
