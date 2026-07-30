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
import { PlanningPage } from "./PlanningWorkspace";
import { WritingPage } from "./WritingWorkspace";
import { LedgerPage } from "./LedgerWorkspace";
import { QualityPage } from "./QualityWorkspace";
import { PublishingPage } from "./PublishingWorkspace";

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
