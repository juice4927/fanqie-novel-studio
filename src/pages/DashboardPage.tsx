import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  FileCheck2,
  LibraryBig,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Badge, Button, EmptyState, IconButton, Progress } from "../components/UI";
import { formatCount, formatDate } from "../lib/format";
import type { DashboardData, IncubationDraft, ProjectSummary } from "../shared/types";

function riskTone(risk: ProjectSummary["riskLevel"]) {
  return risk === "告警" ? "danger" : risk === "注意" ? "warning" : "success";
}

const SETUP_STEPS = [
  { title: "配置 AI 密钥", detail: "生成正文和语义拆书需要，密钥只写入 Windows 凭据管理器" },
  { title: "新建作品", detail: "填写题材与目标字数，系统会同时创建创作契约草案" },
  { title: "审批创作契约", detail: "在“故事圣经”补全并审批，AI 才会开始生成正文" },
  { title: "生成或手写正文", detail: "在“写作台”质检通过后定稿，再进入发布排期" },
] as const;

export function DashboardPage({
  data,
  hasApiKey,
  incubations = [],
  onCreate,
  onResumeIncubation,
  onOpenProject,
  onOpenSettings,
  onDeleteProject,
}: {
  data: DashboardData;
  hasApiKey?: boolean | null;
  incubations?: IncubationDraft[];
  onCreate: () => void;
  onResumeIncubation?: (draft: IncubationDraft) => void;
  onOpenProject: (id: string) => void;
  onOpenSettings?: () => void;
  onDeleteProject: (project: ProjectSummary) => void;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">今日工作台</p>
          <h1>多书总览</h1>
          <p>按风险、存稿和下一次发布安排当前写作顺序。</p>
        </div>
        <Button icon={<Plus size={17} />} onClick={onCreate}>
          新建作品
        </Button>
      </header>

      <section className="stat-grid" aria-label="项目统计">
        <div className="stat">
          <LibraryBig size={19} />
          <div>
            <span>活跃作品</span>
            <strong>{data.totals.activeBooks}</strong>
          </div>
        </div>
        <div className="stat">
          <BookOpen size={19} />
          <div>
            <span>累计正文</span>
            <strong>{formatCount(data.totals.totalWords)}</strong>
          </div>
        </div>
        <div className="stat">
          <FileCheck2 size={19} />
          <div>
            <span>安全存稿</span>
            <strong>{data.totals.stockChapters} 章</strong>
          </div>
        </div>
        <div className={`stat ${data.totals.pendingIssues ? "stat-alert" : ""}`}>
          <ShieldAlert size={19} />
          <div>
            <span>待处理问题</span>
            <strong>{data.totals.pendingIssues}</strong>
          </div>
        </div>
      </section>

      {incubations.length > 0 && (
        <section className="section-band compact-band">
          <div className="section-heading">
            <div>
              <h2>立项草稿</h2>
              <p>未完成的从 0 开书草稿会保留在这里，可随时继续。</p>
            </div>
          </div>
          <div className="choice-list">
            {incubations.map((draft) => (
              <div key={draft.id} className="draft-row">
                <span>
                  <strong>
                    {draft.candidates.find((item) => item.id === draft.selectedCandidateId)?.title ?? "未命名立项"}
                  </strong>
                  <small>
                    {draft.positioning.fanqieCategoryKey || "未选分类"} · {draft.candidates.length} 套方案 · 步骤{" "}
                    {draft.step} · 更新 {formatDate(draft.updatedAt, true)}
                  </small>
                </span>
                <Button variant="secondary" onClick={() => onResumeIncubation?.(draft)}>
                  继续
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section-band">
        <div className="section-heading">
          <div>
            <h2>作品组合</h2>
            <p>单书数据和上下文完全隔离。</p>
          </div>
        </div>
        {data.projects.length ? (
          <div className="project-table">
            <div className="table-header">
              <span>作品</span>
              <span>阶段</span>
              <span>进度</span>
              <span>存稿</span>
              <span>下次发布</span>
              <span>状态</span>
              <span />
            </div>
            {data.projects.map((project) => (
              <div className="project-row" key={project.id}>
                <button
                  type="button"
                  className="project-row-open"
                  aria-label={`打开作品 ${project.title}`}
                  onClick={() => onOpenProject(project.id)}
                />
                <span className="book-cell">
                  <span className="book-mark">{project.title.slice(0, 1)}</span>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      {project.genre} · {project.chapterCount} 章
                    </small>
                  </span>
                </span>
                <span>{project.status}</span>
                <span className="progress-cell">
                  <span>
                    {formatCount(project.currentWords)} / {formatCount(project.targetWords)}
                  </span>
                  <Progress value={(project.currentWords / project.targetWords) * 100} />
                </span>
                <span>{project.stockChapters} 章</span>
                <span>{formatDate(project.nextPublishAt, true)}</span>
                <span>
                  <Badge tone={riskTone(project.riskLevel)}>{project.riskLevel}</Badge>
                </span>
                <span className="project-row-actions">
                  <IconButton label={`删除作品 ${project.title}`} onClick={() => onDeleteProject(project)}>
                    <Trash2 size={16} />
                  </IconButton>
                  <ArrowRight size={17} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title="还没有作品"
            description={
              <ol className="setup-checklist">
                {SETUP_STEPS.map((step, index) => {
                  const done = index === 0 && hasApiKey === true;
                  return (
                    <li key={step.title} className={done ? "done" : ""}>
                      <span className="setup-mark" aria-hidden="true">
                        {done ? "✓" : index + 1}
                      </span>
                      <span>
                        <strong>{step.title}</strong>
                        <small>{step.detail}</small>
                      </span>
                      {index === 0 && !done && onOpenSettings && (
                        <button type="button" className="setup-action" onClick={onOpenSettings}>
                          去配置
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            }
            action={
              <Button onClick={onCreate} icon={<Plus size={17} />}>
                新建作品
              </Button>
            }
          />
        )}
      </section>

      <section className="two-column lower-dashboard">
        <div className="section-band compact-band">
          <div className="section-heading">
            <div>
              <h2>今日发布</h2>
              <p>到期但尚未确认发布的章节。</p>
            </div>
            <CalendarClock size={19} />
          </div>
          {data.dueToday.length ? (
            <div className="simple-list">
              {data.dueToday.map((item) => (
                <div key={item.id}>
                  <span>
                    <strong>{item.projectTitle}</strong>
                    <small>
                      第{item.chapterNumber}章 {item.chapterTitle}
                    </small>
                  </span>
                  <Badge tone="warning">{formatDate(item.publishAt, true)}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-line">今天没有待发布任务</p>
          )}
        </div>
        <div className="section-band compact-band">
          <div className="section-heading">
            <div>
              <h2>风险队列</h2>
              <p>硬性问题必须解决后才能定稿。</p>
            </div>
            <AlertTriangle size={19} />
          </div>
          {data.activeAlerts.length ? (
            <div className="simple-list">
              {data.activeAlerts.slice(0, 5).map((issue) => (
                <div key={issue.id}>
                  <span>
                    <strong>{issue.category}</strong>
                    <small>{issue.message}</small>
                  </span>
                  <Badge tone={issue.severity === "硬性" ? "danger" : "warning"}>{issue.severity}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-line">当前没有未处理问题</p>
          )}
        </div>
      </section>
    </div>
  );
}
