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

type ProjectTab =
  | "驾驶舱"
  | "故事圣经"
  | "规划台"
  | "写作台"
  | "状态账本"
  | "质检中心"
  | "发布日历"
  | "数据复盘";
const TABS: Array<{ id: ProjectTab; icon: typeof BookMarked }> = [
  { id: "驾驶舱", icon: BookMarked },
  { id: "故事圣经", icon: NotebookTabs },
  { id: "规划台", icon: Layers3 },
  { id: "写作台", icon: BookOpenCheck },
  { id: "状态账本", icon: BrainCircuit },
  { id: "质检中心", icon: ClipboardCheck },
  { id: "发布日历", icon: CalendarDays },
  { id: "数据复盘", icon: SearchCheck },
];

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

function chapterDraftSignature(chapter: Chapter) {
  const { id: _id, revision: _revision, updatedAt: _updatedAt, wordCount: _wordCount, ...editable } = chapter;
  return JSON.stringify(editable);
}

function chapterRecoveryKey(projectId: string, chapter: Chapter) {
  return `novel-studio.chapter-draft.${projectId}.${chapter.id || `new-${chapter.number}`}`;
}

function readRecoveredChapter(projectId: string, chapter: Chapter) {
  try {
    const recovered = localStorage.getItem(chapterRecoveryKey(projectId, chapter));
    return recovered ? JSON.parse(recovered) as Chapter : chapter;
  } catch {
    return chapter;
  }
}

function writeRecoveredChapter(projectId: string, chapter: Chapter) {
  try { localStorage.setItem(chapterRecoveryKey(projectId, chapter), JSON.stringify(chapter)); } catch { /* storage unavailable */ }
}

function clearRecoveredChapter(projectId: string, chapter: Chapter) {
  try { localStorage.removeItem(chapterRecoveryKey(projectId, chapter)); } catch { /* storage unavailable */ }
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function issueTone(value: string) {
  return value === "硬性" ? "danger" : value === "警告" ? "warning" : "neutral";
}

export function ProjectPage({
  api,
  projectId,
  initialTab,
  onBack,
  notify,
}: {
  api: AppApi;
  projectId: string;
  initialTab?: ProjectTab;
  onBack: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [tab, setTab] = useState<ProjectTab>(initialTab ?? "驾驶舱");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [insights, setInsights] = useState<InsightPack[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [detail, allInsights] = await Promise.all([
      api.getProject(projectId),
      api.listInsights(),
    ]);
    setProject(detail);
    setInsights(allInsights);
    setLoading(false);
  };
  useEffect(() => {
    setLoading(true);
    void reload();
  }, [projectId]);

  if (loading || !project)
    return (
      <div className="page loading-page">
        <LoaderCircle className="spin" />
        <span>正在打开独立项目库...</span>
      </div>
    );
  const plugin = GENRE_PLUGINS[project.summary.genre];
  return (
    <div className="project-shell">
      <aside className="project-subnav">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          返回多书总览
        </button>
        <div className="project-identity">
          <div className="project-avatar">
            {project.summary.title.slice(0, 1)}
          </div>
          <strong>{project.summary.title}</strong>
          <span>{project.summary.genre}</span>
        </div>
        <nav>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={17} />
              {item.id}
              {item.id === "质检中心" &&
                project.issues.filter((issue) => issue.status === "待处理")
                  .length > 0 && (
                  <i>
                    {
                      project.issues.filter(
                        (issue) => issue.status === "待处理",
                      ).length
                    }
                  </i>
                )}
            </button>
          ))}
        </nav>
        <div className="project-stage">
          <span>当前阶段</span>
          <Select
            value={project.summary.status}
            onChange={async (event) => {
              try {
                await api.updateProject(projectId, {
                  status: event.target.value as ProjectStatus,
                });
                await reload();
              } catch (error) {
                notify(String(error), "error");
              }
            }}
          >
            {[
              "研究中",
              "候选立项",
              "设定中",
              "大纲审批",
              "连载准备",
              "连载中",
              "暂停",
              "完结",
              "归档",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        </div>
      </aside>
      <main className="project-content">
        {tab === "驾驶舱" && (
          <ProjectDashboard
            project={project}
            plugin={plugin}
            insights={insights}
            api={api}
            reload={reload}
            notify={notify}
            onNavigate={setTab}
          />
        )}
        {tab === "故事圣经" && (
          <StoryBiblePage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "规划台" && (
          <PlanningPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "写作台" && (
          <WritingPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "状态账本" && (
          <LedgerPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "质检中心" && (
          <QualityPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "发布日历" && (
          <PublishingPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
        {tab === "数据复盘" && (
          <ReviewPage
            project={project}
            api={api}
            reload={reload}
            notify={notify}
          />
        )}
      </main>
    </div>
  );
}

function ProjectDashboard({
  project,
  plugin,
  insights,
  api,
  reload,
  notify,
  onNavigate,
}: {
  project: ProjectDetail;
  plugin: GenrePluginDefinition;
  insights: InsightPack[];
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
  onNavigate: (tab: ProjectTab) => void;
}) {
  const [showInsights, setShowInsights] = useState(false);
  const [selectedInsights, setSelectedInsights] = useState(project.insightIds);
  const [concepts, setConcepts] = useState<ConceptCandidate[]>([]);
  const [generating, setGenerating] = useState(false);
  const unresolved = project.issues.filter(
    (issue) => issue.status === "待处理",
  );
  const approvedPlans = project.plans.filter(
    (plan) => plan.status === "已批准",
  );
  const milestones = [
    {
      label: "关联市场洞察",
      done: project.insightIds.length > 0,
      action: () => setShowInsights(true),
    },
    {
      label: "审批创作契约",
      done: project.contract.approved,
      action: () => onNavigate("故事圣经"),
    },
    {
      label: "批准宏观阶段与卷纲",
      done: approvedPlans.some((plan) => plan.kind === "分卷"),
      action: () => onNavigate("规划台"),
    },
    {
      label: "建立第一章并质检",
      done: project.chapters.some((chapter) =>
        ["待定稿", "已定稿", "待发布", "已发布"].includes(chapter.status),
      ),
      action: () => onNavigate("写作台"),
    },
    {
      label: "安排首个发布日",
      done: project.schedule.length > 0,
      action: () => onNavigate("发布日历"),
    },
  ];
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">项目驾驶舱</p>
          <h1>{project.summary.title}</h1>
          <p>{plugin.readerPromise}</p>
        </div>
        <Badge
          tone={
            project.summary.riskLevel === "告警"
              ? "danger"
              : project.summary.riskLevel === "注意"
                ? "warning"
                : "success"
          }
        >
          {project.summary.riskLevel}
        </Badge>
      </header>
      <section className="stat-grid project-stats">
        <div className="stat">
          <BookOpenCheck size={19} />
          <div>
            <span>当前正文</span>
            <strong>{formatCount(project.summary.currentWords)}</strong>
          </div>
        </div>
        <div className="stat">
          <Layers3 size={19} />
          <div>
            <span>规划节点</span>
            <strong>{project.plans.length}</strong>
          </div>
        </div>
        <div className="stat">
          <ShieldCheck size={19} />
          <div>
            <span>已确认事实</span>
            <strong>
              {
                project.facts.filter((fact) => fact.confidence === "已确认")
                  .length
              }
            </strong>
          </div>
        </div>
        <div className="stat">
          <AlertTriangle size={19} />
          <div>
            <span>未处理问题</span>
            <strong>{unresolved.length}</strong>
          </div>
        </div>
      </section>
      <section className="two-column">
        <div className="section-band compact-band">
          <div className="section-heading">
            <div>
              <h2>闭环进度</h2>
              <p>门禁按顺序推进，不允许 AI 越权。</p>
            </div>
          </div>
          <div className="milestone-list">
            {milestones.map((milestone, index) => (
              <button key={milestone.label} onClick={milestone.action}>
                <span className={milestone.done ? "done" : ""}>
                  {milestone.done ? <Check size={15} /> : index + 1}
                </span>
                <strong>{milestone.label}</strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
        <div className="section-band compact-band">
          <div className="section-heading">
            <div>
              <h2>题材规则包</h2>
              <p>{plugin.id}</p>
            </div>
            <Badge tone="accent">{project.summary.genre}</Badge>
          </div>
          <div className="genre-profile">
            <div>
              <span>子类型</span>
              <p>{plugin.subtypes.map((item) => item.name).join(" · ")}</p>
            </div>
            <div>
              <span>核心幻想</span>
              <p>{plugin.coreFantasies.join("；")}</p>
            </div>
            <div>
              <span>禁忌边界</span>
              <p>{plugin.tabooBoundaries.join("；")}</p>
            </div>
          </div>
          <ul className="rule-list">
            {plugin.planningChecks?.map((rule) => (
              <li key={rule}>
                <CircleDot size={14} />
                {rule}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section-band genre-stage-model">
        <div className="section-heading">
          <div>
            <h2>六阶段商业模型</h2>
            <p>按故事进度切换目标、冲突与回报，不用固定字数机械卡点。</p>
          </div>
          <Badge>{project.summary.genre}</Badge>
        </div>
        <div className="genre-stage-grid">
          {GENRE_STAGES.map((stage, index) => {
            const rule = plugin.stages[stage];
            return (
              <article key={stage}>
                <span>{index + 1}</span>
                <div>
                  <h3>{stage}</h3>
                  <p>{rule.objective}</p>
                  <small>回报：{rule.payoff}</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="section-band">
        <div className="section-heading">
          <div>
            <h2>立项洞察</h2>
            <p>这里只能关联研究区产生的脱敏洞察包。</p>
          </div>
          <div className="heading-actions">
            <Button variant="secondary" onClick={() => setShowInsights(true)}>
              管理关联
            </Button>
            <Button
              icon={
                generating ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )
              }
              disabled={!project.insightIds.length || generating}
              onClick={async () => {
                setGenerating(true);
                try {
                  setConcepts(await api.generateConcepts(project.summary.id));
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                  );
                } finally {
                  setGenerating(false);
                }
              }}
            >
              生成三个原创方向
            </Button>
          </div>
        </div>
        {concepts.length > 0 ? (
          <div className="concept-grid">
            {concepts.map((concept) => (
              <article key={concept.id}>
                <div>
                  <Badge
                    tone={
                      concept.originalityRisk === "低" ? "success" : "warning"
                    }
                  >
                    原创风险 {concept.originalityRisk}
                  </Badge>
                  <h3>{concept.title}</h3>
                  <p>{concept.oneLinePitch}</p>
                </div>
                <dl>
                  <div>
                    <dt>核心冲突</dt>
                    <dd>{concept.coreConflict}</dd>
                  </div>
                  <div>
                    <dt>差异化</dt>
                    <dd>{concept.differentiation}</dd>
                  </div>
                  <div>
                    <dt>长篇承载</dt>
                    <dd>{concept.longFormCapacity}</dd>
                  </div>
                </dl>
                <footer>
                  <Button
                    variant="secondary"
                    disabled={concept.originalityRisk === "高"}
                    onClick={async () => {
                      await api.saveContract(project.summary.id, {
                        ...project.contract,
                        premise: concept.oneLinePitch,
                        readerPromise: concept.audience,
                        coreEmotion: concept.coreConflict,
                      });
                      await api.updateProject(project.summary.id, {
                        title: concept.title,
                        status: "设定中",
                      });
                      await reload();
                      onNavigate("故事圣经");
                      notify("候选方向已写入故事圣经，仍需补全并审批");
                    }}
                  >
                    {concept.originalityRisk === "高"
                      ? "需先人工复核"
                      : "采用此方向"}
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="linked-insights">
            {insights
              .filter((item) => project.insightIds.includes(item.id))
              .map((item) => (
                <div key={item.id}>
                  <LightbulbIcon />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.marketGap}</small>
                  </span>
                  <Badge>{item.confidence}</Badge>
                </div>
              ))}
            {!project.insightIds.length && (
              <p className="muted-line">尚未关联洞察，无法生成立项方案。</p>
            )}
          </div>
        )}
      </section>
      {showInsights && (
        <Modal
          title="关联脱敏洞察"
          onClose={() => setShowInsights(false)}
          width={760}
        >
          <div className="choice-list">
            {insights.map((insight) => (
              <label key={insight.id}>
                <input
                  type="checkbox"
                  checked={selectedInsights.includes(insight.id)}
                  onChange={(event) =>
                    setSelectedInsights(
                      event.target.checked
                        ? [...selectedInsights, insight.id]
                        : selectedInsights.filter((id) => id !== insight.id),
                    )
                  }
                />
                <span>
                  <strong>{insight.name}</strong>
                  <small>
                    {insight.genre} · {insight.marketGap}
                  </small>
                </span>
                <Badge>{insight.confidence}</Badge>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setShowInsights(false)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                await api.attachInsights(project.summary.id, selectedInsights);
                await reload();
                setShowInsights(false);
                notify("关联洞察已更新");
              }}
            >
              保存关联
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LightbulbIcon() {
  return (
    <span className="mini-icon">
      <Sparkles size={16} />
    </span>
  );
}

function StoryBiblePage({ project, api, reload, notify }: CommonProjectProps) {
  const [contract, setContract] = useState<StoryContract>(project.contract);
  useEffect(() => setContract(project.contract), [project.contract]);
  const set = (key: keyof StoryContract, value: string | string[]) =>
    setContract((current) => ({ ...current, [key]: value }));
  const save = async () => {
    try {
      setContract(await api.saveContract(project.summary.id, contract));
      await reload();
      notify("创作契约已保存为新版本");
    } catch (error) {
      notify(String(error), "error");
    }
  };
  const genrePlugin = GENRE_PLUGINS[project.summary.genre];
  const compatibleFanqieCategories = FANQIE_CATEGORY_PROFILES.filter(
    (profile) => profile.genre === project.summary.genre,
  );
  const selectedFanqieCategory = getFanqieCategoryProfile(contract.fanqieCategoryKey);
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">新书设计区</p>
          <h1>故事圣经</h1>
          <p>创作契约是全书最高约束，改动会自动产生版本记录。</p>
        </div>
        <div className="heading-actions">
          <Badge tone={contract.approved ? "success" : "warning"}>
            {contract.approved
              ? `已审批 · v${contract.version}`
              : `待审批 · v${contract.version}`}
          </Badge>
          <Button variant="secondary" icon={<Save size={16} />} onClick={save}>
            保存新版本
          </Button>
          <Button
            icon={<LockKeyhole size={16} />}
            disabled={contract.approved}
            onClick={async () => {
              try {
                await api.approveContract(project.summary.id);
                await reload();
                notify("创作契约已锁定审批");
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : String(error),
                  "error",
                );
              }
            }}
          >
            审批契约
          </Button>
        </div>
      </header>
      <section className="section-band bible-form">
        <Field
          label="番茄目标分类"
          hint="把番茄官方细分类映射到本项目的生成、规划与质检规则"
        >
          <Select
            value={contract.fanqieCategoryKey ?? ""}
            onChange={(event) => {
              const profile = getFanqieCategoryProfile(event.target.value);
              setContract((current) => ({
                ...current,
                fanqieCategoryKey: event.target.value,
                genreSubtype: profile?.recommendedSubtype ?? current.genreSubtype,
              }));
            }}
          >
            <option value="">尚未选择</option>
            {(["男频", "女频"] as const).map((channel) => (
              <optgroup key={channel} label={channel}>
                {compatibleFanqieCategories.filter((item) => item.channel === channel).map((profile) => (
                  <option key={profile.key} value={profile.key}>{profile.name}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {selectedFanqieCategory && (
          <div className="fanqie-category-summary">
            <div><span>核心幻想</span><strong>{selectedFanqieCategory.coreFantasy}</strong></div>
            <div><span>目标读者</span><strong>{selectedFanqieCategory.audience}</strong></div>
            <div><span>开篇抓手</span><strong>{selectedFanqieCategory.openingFocus}</strong></div>
            <div><span>禁忌边界</span><strong>{selectedFanqieCategory.taboo}</strong></div>
          </div>
        )}
        <Field
          label="题材子类型"
          hint="决定本项目优先使用的核心幻想、目标受众和禁忌边界"
        >
          <Select
            value={contract.genreSubtype ?? ""}
            onChange={(event) => set("genreSubtype", event.target.value)}
          >
            <option value="">尚未选择</option>
            {genrePlugin.subtypes.map((subtype) => (
              <option key={subtype.name}>{subtype.name}</option>
            ))}
          </Select>
        </Field>
        {contract.genreSubtype &&
          genrePlugin.subtypes.find(
            (item) => item.name === contract.genreSubtype,
          ) && (
            <div className="subtype-summary">
              {(() => {
                const subtype = genrePlugin.subtypes.find(
                  (item) => item.name === contract.genreSubtype,
                )!;
                return (
                  <>
                    <div>
                      <span>核心幻想</span>
                      <strong>{subtype.coreFantasy}</strong>
                    </div>
                    <div>
                      <span>目标读者</span>
                      <strong>{subtype.targetAudience}</strong>
                    </div>
                    <div>
                      <span>禁忌边界</span>
                      <strong>{subtype.tabooBoundary}</strong>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        <div className="form-grid two">
          <Field label="故事前提">
            <Textarea
              rows={4}
              value={contract.premise}
              onChange={(event) => set("premise", event.target.value)}
              placeholder="用一句清晰因果描述主角、变化与核心问题"
            />
          </Field>
          <Field label="主角核心欲望">
            <Textarea
              rows={4}
              value={contract.protagonistDesire}
              onChange={(event) => set("protagonistDesire", event.target.value)}
              placeholder="主角真正想获得、守住或摆脱什么"
            />
          </Field>
          <Field label="读者承诺">
            <Textarea
              rows={4}
              value={contract.readerPromise}
              onChange={(event) => set("readerPromise", event.target.value)}
              placeholder="读者持续追读能稳定得到什么体验"
            />
          </Field>
          <Field label="核心爽感 / 情绪价值">
            <Textarea
              rows={4}
              value={contract.coreEmotion}
              onChange={(event) => set("coreEmotion", event.target.value)}
            />
          </Field>
        </div>
        <Field label="故事终局">
          <Textarea
            rows={5}
            value={contract.ending}
            onChange={(event) => set("ending", event.target.value)}
            placeholder="终局状态、主角代价与主题落点"
          />
        </Field>
        <div className="form-grid two">
          <Field label="不可破坏规则" hint="每行一条">
            <Textarea
              rows={7}
              value={contract.immutableRules.join("\n")}
              onChange={(event) =>
                set("immutableRules", splitLines(event.target.value))
              }
            />
          </Field>
          <Field label="禁写清单" hint="每行一条；命中正文将触发硬性门禁">
            <Textarea
              rows={7}
              value={contract.prohibitedPatterns.join("\n")}
              onChange={(event) =>
                set("prohibitedPatterns", splitLines(event.target.value))
              }
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

interface CommonProjectProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

function PlanningPage({ project, api, reload, notify }: CommonProjectProps) {
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
                } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); }
                finally { setAiBusy(false); }
              }}>{aiBusy ? "生成中" : "生成草稿"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WritingPage({ project, api, reload, notify }: CommonProjectProps) {
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
  const [history, setHistory] = useState<RevisionRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const lastSavedSignature = useRef(chapterDraftSignature(selected ?? draft));
  const draftRef = useRef(draft);
  const saveInFlight = useRef(false);
  const [batchPreview, setBatchPreview] =
    useState<BatchGenerationPreview | null>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
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
    writeRecoveredChapter(project.summary.id, draft);
    setSaveStatus("dirty");
    if (!draft.id || ["已定稿", "待发布", "已发布"].includes(draft.status)) return;
    const timer = window.setTimeout(async () => {
      if (saveInFlight.current) return;
      const snapshot = draftRef.current;
      const snapshotSignature = chapterDraftSignature(snapshot);
      saveInFlight.current = true;
      setSaveStatus("saving");
      try {
        const saved = await api.saveChapter(project.summary.id, snapshot);
        const stillEditingChapter = draftRef.current.id === snapshot.id;
        clearRecoveredChapter(project.summary.id, snapshot);
        if (stillEditingChapter) lastSavedSignature.current = snapshotSignature;
        if (stillEditingChapter && chapterDraftSignature(draftRef.current) === snapshotSignature) {
          setDraft(saved);
          setSaveStatus("saved");
        } else if (stillEditingChapter) setSaveStatus("dirty");
        await reload();
      } catch (error) {
        setSaveStatus("error");
        notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        saveInFlight.current = false;
      }
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
        void api.searchProject(project.summary.id, query).then(setSearchHits);
      else setSearchHits([]);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, project.summary.id, query]);
  const visibleChapters =
    query.trim().length >= 2
      ? project.chapters.filter((chapter) =>
          searchHits.some((hit) => hit.id === chapter.id),
        )
      : project.chapters;
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
        <div className="chapter-scroll">
          {visibleChapters.map((chapter) => (
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
              {saveStatus === "saving" ? "正在自动保存" : saveStatus === "dirty" ? "未保存" : saveStatus === "error" ? "保存失败" : "已保存"}
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
              disabled={!dirty || saveStatus === "saving"}
              onClick={save}
            >
              保存
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

function LedgerPage({ project, api, reload, notify }: CommonProjectProps) {
  const [modal, setModal] = useState(false);
  const [expectationModal, setExpectationModal] = useState(false);
  const [filter, setFilter] = useState<LedgerKind | "全部">("全部");
  const [draft, setDraft] = useState<LedgerFact>({
    id: "",
    kind: "人物",
    subject: "",
    predicate: "",
    value: "",
    validFromChapter: 1,
    validToChapter: null,
    evidenceChapter: 1,
    confidence: "待确认",
    knowledgeScope: "",
    updatedAt: new Date().toISOString(),
  });
  const blankExpectation = (): ExpectationEntry => ({
    id: "",
    title: "",
    description: "",
    sourceChapter: Math.max(1, project.summary.chapterCount),
    expectedPayoffChapter: null,
    actualPayoffChapter: null,
    status: "待兑现",
    payoffResult: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const [expectationDraft, setExpectationDraft] =
    useState<ExpectationEntry>(blankExpectation);
  const kinds: LedgerKind[] = [
    "人物",
    "关系",
    "能力",
    "资源",
    "地点",
    "时间线",
    "秘密",
    "承诺",
    "伏笔",
    "支线",
    "事件",
  ];
  const visible = project.facts.filter(
    (fact) => filter === "全部" || fact.kind === filter,
  );
  const pendingFacts = project.facts.filter((fact) => fact.confidence === "待确认");
  const currentChapter = Math.max(
    0,
    ...project.chapters.map((chapter) => chapter.number),
  );
  const openExpectations = project.expectations.filter(
    (item) => item.status === "待兑现" || item.status === "部分兑现",
  );
  const overdueCount = openExpectations.filter(
    (item) =>
      item.expectedPayoffChapter !== null &&
      item.expectedPayoffChapter < currentChapter,
  ).length;
  const openExpectation = (item?: ExpectationEntry) => {
    setExpectationDraft(item ?? blankExpectation());
    setExpectationModal(true);
  };
  const genrePlugin = GENRE_PLUGINS[project.summary.genre];
  const activeLedgerTemplate = genrePlugin.ledgerTemplates.find(
    (item) => item.label === draft.genreDimension,
  );
  const openLedgerTemplate = (
    template: (typeof genrePlugin.ledgerTemplates)[number],
  ) => {
    setDraft({
      id: "",
      kind: template.kind,
      genreDimension: template.label,
      subject: "",
      predicate: template.predicate,
      value: "",
      validFromChapter: Math.max(1, currentChapter),
      validToChapter: null,
      evidenceChapter: Math.max(1, currentChapter),
      confidence: "待确认",
      knowledgeScope: "",
      updatedAt: new Date().toISOString(),
    });
    setModal(true);
  };
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">故事状态图</p>
          <h1>状态账本</h1>
          <p>事实具有生效区间、证据章节、可信状态和角色知情范围。</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setModal(true)}>
          新增事实
        </Button>
        {project.chapters.some((chapter) => chapter.status === "已定稿") && (
          <Button variant="secondary" icon={<Sparkles size={16} />} onClick={async () => {
            const chapter = project.chapters.filter((item) => item.status === "已定稿").at(-1)!;
            try { const facts = await api.extractChapterFacts(project.summary.id, chapter.id); await reload(); notify(facts.length ? `已提取 ${facts.length} 条待确认状态` : "本章没有新的持久状态"); }
            catch (error) { notify(String(error), "error"); }
          }}>扫描最新定稿</Button>
        )}
      </header>
      <div className="toolbar-row ledger-filter">
        <Segmented
          options={["全部", ...kinds] as const}
          value={filter}
          onChange={setFilter}
        />
        <span>
          {pendingFacts.length} 项待确认 · {" "}
          {project.facts.filter((fact) => fact.confidence === "有冲突").length}{" "}
          项冲突
        </span>
      </div>
      {pendingFacts.length ? (
        <section className="section-band pending-facts-panel">
          <div className="section-heading">
            <div>
              <h2>定稿状态候选</h2>
              <p>AI 只提出正文有证据的候选；确认后才会作为后续写作事实。</p>
            </div>
            <Badge tone="warning">{pendingFacts.length} 项待确认</Badge>
          </div>
          <div className="pending-facts-list">
            {pendingFacts.slice(0, 12).map((fact) => (
              <article key={fact.id}>
                <span><Badge>{fact.kind}</Badge><strong>{fact.subject} · {fact.predicate}</strong><small>{fact.value}｜证据第{fact.evidenceChapter}章</small></span>
                <Button variant="secondary" onClick={async () => {
                  try { await api.saveFact(project.summary.id, { ...fact, confidence: "已确认" }); await reload(); notify("候选事实已确认"); }
                  catch (error) { notify(String(error), "error"); }
                }}>确认入账</Button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="section-band genre-ledger-panel">
        <div className="section-heading">
          <div>
            <h2>{project.summary.genre}专属账本</h2>
            <p>按题材核心变量建立结构化事实，写作与质检会读取这些记录。</p>
          </div>
          <Badge tone="accent">{genrePlugin.id}</Badge>
        </div>
        <div className="genre-ledger-templates">
          {genrePlugin.ledgerTemplates.map((template) => (
            <button
              key={template.label}
              onClick={() => openLedgerTemplate(template)}
            >
              <span>
                <strong>{template.label}</strong>
                <Badge>{template.kind}</Badge>
              </span>
              <p>
                {template.subjectPlaceholder} · {template.predicate}
              </p>
              <small>{template.valueHint}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="section-band expectation-ledger">
        <div className="section-heading">
          <div>
            <h2>期待 / 兑现账本</h2>
            <p>
              跟踪提出、承接、预计兑现和实际结果；逾期用于提醒，不是机械门禁。
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<Plus size={16} />}
            onClick={() => openExpectation()}
          >
            新增期待
          </Button>
        </div>
        <div className="expectation-stats">
          <div>
            <strong>{openExpectations.length}</strong>
            <span>待兑现</span>
          </div>
          <div className={overdueCount ? "danger" : ""}>
            <strong>{overdueCount}</strong>
            <span>已逾期</span>
          </div>
          <div>
            <strong>
              {
                project.expectations.filter((item) => item.status === "已兑现")
                  .length
              }
            </strong>
            <span>已兑现</span>
          </div>
        </div>
        {project.expectations.length ? (
          <div className="expectation-list">
            {project.expectations.map((item) => {
              const overdue =
                (item.status === "待兑现" || item.status === "部分兑现") &&
                item.expectedPayoffChapter !== null &&
                item.expectedPayoffChapter < currentChapter;
              return (
                <button
                  key={item.id}
                  className={overdue ? "overdue" : ""}
                  onClick={() => openExpectation(item)}
                >
                  <span>
                    <Badge
                      tone={
                        item.status === "已兑现"
                          ? "success"
                          : overdue
                            ? "danger"
                            : "warning"
                      }
                    >
                      {overdue ? "已逾期" : item.status}
                    </Badge>
                    <small>第{item.sourceChapter}章提出</small>
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description || "未填写说明"}</small>
                  </span>
                  <span>
                    <strong>
                      {item.expectedPayoffChapter
                        ? `第${item.expectedPayoffChapter}章`
                        : "未定章"}
                    </strong>
                    <small>
                      {item.actualPayoffChapter
                        ? `实际第${item.actualPayoffChapter}章`
                        : "预计兑现"}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="muted-line">保存章节的“结尾期待”后会自动建立记录。</p>
        )}
      </section>
      <section className="section-band">
        {visible.length ? (
          <div className="ledger-table">
            <div className="data-head ledger-grid">
              <span>类型</span>
              <span>主体与属性</span>
              <span>当前值</span>
              <span>生效范围</span>
              <span>知情范围</span>
              <span>状态</span>
            </div>
            {visible.map((fact) => (
              <div className="data-row ledger-grid" key={fact.id}>
                <span>
                  <Badge>{fact.kind}</Badge>
                </span>
                <span>
                  <strong>{fact.subject}</strong>
                  <small>{fact.predicate}</small>
                </span>
                <span>{fact.value}</span>
                <span>
                  第{fact.validFromChapter}章起
                  {fact.validToChapter ? `至 ${fact.validToChapter} 章` : ""}
                  <small>证据：第{fact.evidenceChapter}章</small>
                </span>
                <span>{fact.knowledgeScope || "公开事实"}</span>
                <span>
                  <Badge
                    tone={
                      fact.confidence === "有冲突"
                        ? "danger"
                        : fact.confidence === "已确认"
                          ? "success"
                          : "warning"
                    }
                  >
                    {fact.confidence}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BrainCircuit />}
            title="状态账本为空"
            description="定稿后记录人物、关系、能力、资源、伏笔与秘密，支撑超长篇上下文。"
            action={
              <Button onClick={() => setModal(true)} icon={<Plus size={16} />}>
                新增事实
              </Button>
            }
          />
        )}
      </section>
      <section className="section-band">
        <div className="section-heading">
          <div>
            <h2>分层记忆摘要</h2>
            <p>章节定稿后自动更新场景、章节、十章阶段、分卷和全书摘要。</p>
          </div>
          <Badge>{project.summaries.length} 条</Badge>
        </div>
        {project.summaries.filter((summary) => summary.layer !== "场景")
          .length ? (
          <div className="summary-list">
            {project.summaries
              .filter((summary) => summary.layer !== "场景")
              .slice(-20)
              .reverse()
              .map((summary) => (
                <details key={summary.id}>
                  <summary>
                    <Badge
                      tone={
                        summary.layer === "全书"
                          ? "accent"
                          : summary.layer === "分卷"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {summary.layer}
                    </Badge>
                    <strong>{summary.title}</strong>
                    <span>
                      第{summary.fromChapter}–{summary.toChapter}章 · v
                      {summary.version}
                    </span>
                  </summary>
                  <p>{summary.content}</p>
                </details>
              ))}
          </div>
        ) : (
          <p className="muted-line">第一章定稿后开始建立分层摘要。</p>
        )}
      </section>
      {expectationModal && (
        <Modal
          title={expectationDraft.id ? "更新期待兑现" : "新增期待"}
          onClose={() => setExpectationModal(false)}
        >
          <div className="form-stack">
            <Field label="期待标题">
              <Input
                value={expectationDraft.title}
                onChange={(event) =>
                  setExpectationDraft({
                    ...expectationDraft,
                    title: event.target.value,
                  })
                }
                placeholder="读者正在等待什么答案或回报"
              />
            </Field>
            <Field label="具体说明">
              <Textarea
                rows={3}
                value={expectationDraft.description}
                onChange={(event) =>
                  setExpectationDraft({
                    ...expectationDraft,
                    description: event.target.value,
                  })
                }
              />
            </Field>
            <div className="form-grid three">
              <Field label="提出章节">
                <Input
                  type="number"
                  min={1}
                  value={expectationDraft.sourceChapter}
                  onChange={(event) =>
                    setExpectationDraft({
                      ...expectationDraft,
                      sourceChapter: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="预计兑现章">
                <Input
                  type="number"
                  min={expectationDraft.sourceChapter}
                  value={expectationDraft.expectedPayoffChapter ?? ""}
                  onChange={(event) =>
                    setExpectationDraft({
                      ...expectationDraft,
                      expectedPayoffChapter: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </Field>
              <Field label="实际兑现章">
                <Input
                  type="number"
                  min={expectationDraft.sourceChapter}
                  value={expectationDraft.actualPayoffChapter ?? ""}
                  onChange={(event) =>
                    setExpectationDraft({
                      ...expectationDraft,
                      actualPayoffChapter: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="兑现状态">
              <Select
                value={expectationDraft.status}
                onChange={(event) =>
                  setExpectationDraft({
                    ...expectationDraft,
                    status: event.target.value as ExpectationEntry["status"],
                  })
                }
              >
                <option>待兑现</option>
                <option>部分兑现</option>
                <option>已兑现</option>
                <option>已放弃</option>
              </Select>
            </Field>
            <Field
              label="兑现结果 / 变化"
              hint="记录资源、关系、地位、信息或后续机会的实际变化"
            >
              <Textarea
                rows={3}
                value={expectationDraft.payoffResult}
                onChange={(event) =>
                  setExpectationDraft({
                    ...expectationDraft,
                    payoffResult: event.target.value,
                  })
                }
              />
            </Field>
            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => setExpectationModal(false)}
              >
                取消
              </Button>
              <Button
                disabled={
                  !expectationDraft.title.trim() ||
                  (expectationDraft.status === "已兑现" &&
                    !expectationDraft.actualPayoffChapter)
                }
                onClick={async () => {
                  try {
                    await api.saveExpectation(
                      project.summary.id,
                      expectationDraft,
                    );
                    await reload();
                    setExpectationModal(false);
                    notify("期待账本已更新");
                  } catch (error) {
                    notify(String(error), "error");
                  }
                }}
              >
                保存期待
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal && (
        <Modal
          title={
            activeLedgerTemplate
              ? `新增${activeLedgerTemplate.label}`
              : "新增状态事实"
          }
          onClose={() => setModal(false)}
        >
          <div className="form-stack">
            <div className="form-grid two">
              <Field label="类型">
                <Select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as LedgerKind,
                    })
                  }
                >
                  {kinds.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </Select>
              </Field>
              <Field label="可信状态">
                <Select
                  value={draft.confidence}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      confidence: event.target
                        .value as LedgerFact["confidence"],
                    })
                  }
                >
                  <option>待确认</option>
                  <option>已确认</option>
                </Select>
              </Field>
            </div>
            <div className="form-grid two">
              <Field label="主体">
                <Input
                  value={draft.subject}
                  onChange={(event) =>
                    setDraft({ ...draft, subject: event.target.value })
                  }
                  placeholder={
                    activeLedgerTemplate?.subjectPlaceholder ??
                    "角色、地点或事件"
                  }
                />
              </Field>
              <Field label="属性 / 关系">
                <Input
                  value={draft.predicate}
                  onChange={(event) =>
                    setDraft({ ...draft, predicate: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="事实值">
              <Textarea
                rows={3}
                value={draft.value}
                placeholder={activeLedgerTemplate?.valueHint}
                onChange={(event) =>
                  setDraft({ ...draft, value: event.target.value })
                }
              />
            </Field>
            <div className="form-grid three">
              <Field label="生效章节">
                <Input
                  type="number"
                  min={1}
                  value={draft.validFromChapter}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      validFromChapter: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="失效章节">
                <Input
                  type="number"
                  min={1}
                  value={draft.validToChapter ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      validToChapter: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </Field>
              <Field label="证据章节">
                <Input
                  type="number"
                  min={1}
                  value={draft.evidenceChapter}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      evidenceChapter: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <Field label="知情范围" hint="秘密类事实必须写明哪些角色知道">
              <Input
                value={draft.knowledgeScope}
                onChange={(event) =>
                  setDraft({ ...draft, knowledgeScope: event.target.value })
                }
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                disabled={!draft.subject || !draft.predicate || !draft.value}
                onClick={async () => {
                  const saved = await api.saveFact(project.summary.id, draft);
                  await reload();
                  setModal(false);
                  notify(
                    saved.confidence === "有冲突"
                      ? "事实已保存，但检测到冲突"
                      : "事实已保存",
                    saved.confidence === "有冲突" ? "error" : "success",
                  );
                }}
              >
                保存事实
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function QualityPage({ project, api, reload, notify }: CommonProjectProps) {
  const [changeModal, setChangeModal] = useState(false);
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
          {project.issues.length ? (
            <div className="issue-list">
              {project.issues.map((issue) => (
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

function PublishingPage({ project, api, reload, notify }: CommonProjectProps) {
  const [modal, setModal] = useState(false);
  const draftable = project.chapters.filter(
    (chapter) => chapter.status === "已定稿" || chapter.status === "待发布",
  );
  const [chapterId, setChapterId] = useState(draftable[0]?.id ?? "");
  const [publishAt, setPublishAt] = useState("");
  const doExport = async (format: "txt" | "md" | "docx") => {
    try {
      const result = await api.exportProject(project.summary.id, format);
      if (result) notify(`发布包已导出：${result}`);
    } catch (error) {
      notify(String(error), "error");
    }
  };
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">发布运营区</p>
          <h1>发布日历</h1>
          <p>系统只辅助排期和导出，最终发布仍由作者在番茄后台人工完成。</p>
        </div>
        <div className="heading-actions">
          <div className="export-menu">
            <Button
              variant="secondary"
              icon={<FileOutput size={16} />}
              onClick={() => doExport("txt")}
            >
              导出 TXT
            </Button>
            <IconButton label="导出 Markdown" onClick={() => doExport("md")}>
              <FileOutput size={16} />
            </IconButton>
            <IconButton label="导出 DOCX" onClick={() => doExport("docx")}>
              <BookMarked size={16} />
            </IconButton>
          </div>
          <Button icon={<Plus size={16} />} onClick={() => setModal(true)}>
            安排发布
          </Button>
        </div>
      </header>
      <section className="section-band">
        <div className="publication-summary">
          <div>
            <span>安全存稿线</span>
            <span className="stock-line">
              <strong>{project.summary.stockChapters} /</strong>
              <Input
                aria-label="安全存稿线"
                type="number"
                min={1}
                defaultValue={project.summary.safeStockLine}
                onBlur={async (event) => {
                  await api.updateProject(project.summary.id, {
                    safeStockLine: Number(event.target.value) || 1,
                  });
                  await reload();
                }}
              />
              <em>章</em>
            </span>
          </div>
          <div>
            <span>更新节奏</span>
            <strong>{project.summary.updateCadence}</strong>
          </div>
          <div>
            <span>下次发布</span>
            <strong>{formatDate(project.summary.nextPublishAt, true)}</strong>
          </div>
        </div>
        {project.schedule.length ? (
          <div className="schedule-list">
            {project.schedule.map((item) => (
              <article key={item.id}>
                <div className="schedule-date">
                  <strong>{new Date(item.publishAt).getDate()}</strong>
                  <span>
                    {new Date(item.publishAt).toLocaleDateString("zh-CN", {
                      month: "short",
                    })}
                  </span>
                </div>
                <div>
                  <strong>
                    第{item.chapterNumber}章 {item.chapterTitle}
                  </strong>
                  <span>
                    {item.projectTitle} · {formatDate(item.publishAt, true)}
                  </span>
                </div>
                <Badge tone={item.status === "已发布" ? "success" : "warning"}>
                  {item.status}
                </Badge>
                {item.status === "待发布" && (
                  <Button
                    variant="secondary"
                    icon={<Send size={15} />}
                    onClick={async () => {
                      try {
                        await api.transitionChapter(
                          project.summary.id,
                          item.chapterId,
                          "已发布",
                        );
                        await api.saveSchedule(project.summary.id, {
                          ...item,
                          status: "已发布",
                        });
                        await reload();
                        notify("已记录人工发布");
                      } catch (error) {
                        notify(String(error), "error");
                      }
                    }}
                  >
                    确认已发布
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="尚未安排发布"
            description="只有已定稿章节可以进入发布排期。"
            action={
              <Button
                disabled={!draftable.length}
                onClick={() => setModal(true)}
              >
                安排第一章
              </Button>
            }
          />
        )}
      </section>
      {modal && (
        <Modal title="安排章节发布" onClose={() => setModal(false)}>
          <div className="form-stack">
            <Field label="已定稿章节">
              <Select
                value={chapterId}
                onChange={(event) => setChapterId(event.target.value)}
              >
                <option value="">选择章节</option>
                {draftable.map((chapter) => (
                  <option value={chapter.id} key={chapter.id}>
                    第{chapter.number}章 {chapter.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="计划发布时间">
              <Input
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                disabled={!chapterId || !publishAt}
                onClick={async () => {
                  const chapter = project.chapters.find(
                    (item) => item.id === chapterId,
                  )!;
                  if (chapter.status === "已定稿")
                    await api.transitionChapter(
                      project.summary.id,
                      chapterId,
                      "待发布",
                    );
                  const item: ScheduleItem = {
                    id: "",
                    projectId: project.summary.id,
                    projectTitle: project.summary.title,
                    chapterId,
                    chapterNumber: chapter.number,
                    chapterTitle: chapter.title,
                    publishAt: new Date(publishAt).toISOString(),
                    status: "待发布",
                  };
                  await api.saveSchedule(project.summary.id, item);
                  await reload();
                  setModal(false);
                  notify("发布任务已安排");
                }}
              >
                保存排期
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReviewPage({ project, api, reload, notify }: CommonProjectProps) {
  const [csv, setCsv] = useState("");
  const [modal, setModal] = useState(false);
  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([]);
  useEffect(() => {
    void api.getReviewSuggestions(project.summary.id).then(setSuggestions);
  }, [project.summary.id, project.metrics.length]);
  const funnel = useMemo(() => summarizeMetrics(project.metrics), [project.metrics]);
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">运营反馈回路</p>
          <h1>数据复盘</h1>
          <p>指标只用于发现相关性和提出建议，不会自动修改已审批规划。</p>
        </div>
        <Button icon={<UploadIcon />} onClick={() => setModal(true)}>
          导入指标 CSV
        </Button>
      </header>
      <section className="stat-grid">
        <div className="stat">
          <div>
            <span>累计曝光</span>
            <strong>{formatCount(funnel.exposure)}</strong>
          </div>
        </div>
        <div className="stat">
          <div>
            <span>入口点击率</span>
            <strong>{funnel.clickRate === null ? "待导入" : `${funnel.clickRate.toFixed(1)}%`}</strong>
          </div>
        </div>
        <div className="stat">
          <div>
            <span>首章 / 三章</span>
            <strong>{funnel.firstChapterCompletion === null ? "待导入" : `${funnel.firstChapterCompletion.toFixed(1)}%`} / {funnel.threeChapterRetention === null ? "待导入" : `${funnel.threeChapterRetention.toFixed(1)}%`}</strong>
          </div>
        </div>
        <div className="stat">
          <div>
            <span>追读 / 书架</span>
            <strong>{funnel.followRate === null ? "待导入" : `${funnel.followRate.toFixed(1)}%`} / {funnel.bookshelfRate === null ? "待导入" : `${funnel.bookshelfRate.toFixed(1)}%`}</strong>
          </div>
        </div>
      </section>
      <section className="section-band">
        <div className="section-heading">
          <div>
            <h2>周度复盘建议</h2>
            <p>只生成观察与建议，不自动修改故事圣经和章纲。</p>
          </div>
        </div>
        <div className="review-suggestions">
          {suggestions.map((suggestion) => (
            <article key={suggestion.id}>
              <Badge
                tone={
                  suggestion.confidence === "高"
                    ? "success"
                    : suggestion.confidence === "中"
                      ? "warning"
                      : "neutral"
                }
              >
                {suggestion.category} · {suggestion.confidence}
              </Badge>
              <h3>{suggestion.observation}</h3>
              <p>{suggestion.recommendation}</p>
              <small>{suggestion.evidence}</small>
            </article>
          ))}
        </div>
      </section>
      <section className="section-band">
        {project.metrics.length ? (
          <div className="data-table">
            <div className="data-head metrics-grid">
              <span>日期</span>
              <span>关联章节</span>
              <span>曝光</span>
              <span>点击</span>
              <span>阅读</span>
              <span>首章 / 三章</span>
              <span>追读 / 书架</span>
              <span>收益</span>
            </div>
            {project.metrics.map((metric) => (
              <div className="data-row metrics-grid" key={metric.id}>
                <span>{formatDate(metric.recordedAt)}</span>
                <span>
                  {metric.chapterNumber
                    ? `第${metric.chapterNumber}章`
                    : "全书"}
                </span>
                <span>{formatCount(metric.exposure)}</span>
                <span>{formatCount(metric.clicks ?? 0)}</span>
                <span>{formatCount(metric.reads)}</span>
                <span>{metric.firstChapterCompletion === undefined ? "-" : `${metric.firstChapterCompletion}%`} / {metric.threeChapterRetention === undefined ? "-" : `${metric.threeChapterRetention}%`}</span>
                <span>{formatCount(metric.follows)} / {formatCount(metric.bookshelfAdds ?? 0)}</span>
                <span>¥{metric.revenue}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<SearchCheck />}
            title="还没有运营指标"
            description="导入曝光、点击、阅读、首章读完、三章留存、追读、书架和收益，系统只提供可审查建议。"
            action={<Button onClick={() => setModal(true)}>导入 CSV</Button>}
          />
        )}
      </section>
      {modal && (
        <Modal title="导入运营指标 CSV" onClose={() => setModal(false)}>
          <div className="form-stack">
            <Field
              label="CSV 内容"
              hint="支持：日期、章节、曝光、点击、阅读、首章读完、三章留存、留存、追读、加书架、收益、评论摘要；旧字段仍兼容"
            >
              <Textarea
                rows={14}
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                placeholder="日期,章节,曝光,点击,阅读,首章读完,三章留存,留存,追读,加书架,收益\n2026-07-30,1,10000,3500,3000,48,32,42.5,900,280,128.5"
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                disabled={!csv.trim()}
                onClick={async () => {
                  try {
                    const count = await api.importMetricsCsv(
                      project.summary.id,
                      csv,
                    );
                    await reload();
                    setModal(false);
                    setCsv("");
                    notify(`已导入 ${count} 条指标`);
                  } catch (error) {
                    notify(String(error), "error");
                  }
                }}
              >
                确认导入
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UploadIcon() {
  return <FileOutput size={16} />;
}
