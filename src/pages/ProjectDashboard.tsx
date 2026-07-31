import { useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleDot,
  Layers3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  AppApi,
  ConceptCandidate,
  InsightPack,
  ProjectDetail,
} from "../shared/types";
import { GENRE_STAGES } from "../shared/genre-plugins";
import type { GenrePluginDefinition } from "../shared/genre-plugins";
import { Badge, Button, Modal } from "../components/UI";
import { formatCount } from "../lib/format";

type ProjectTab =
  | "驾驶舱"
  | "故事圣经"
  | "规划台"
  | "写作台"
  | "状态账本"
  | "质检中心"
  | "发布日历"
  | "数据复盘";

export function ProjectDashboard({
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
              <span>可选题材母题</span>
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
            <h2>题材节奏参考</h2>
            <p>六个常见功能仅作工具；本书实际阶段由已审批宏观规划决定。</p>
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
