import { AlertTriangle, ArrowRight, BookOpen, CalendarClock, FileCheck2, LibraryBig, Plus, ShieldAlert } from "lucide-react";
import type { DashboardData, ProjectSummary } from "../shared/types";
import { Badge, Button, EmptyState, Progress } from "../components/UI";
import { formatCount, formatDate } from "../lib/format";

function riskTone(risk: ProjectSummary["riskLevel"]) {
  return risk === "告警" ? "danger" : risk === "注意" ? "warning" : "success";
}

export function DashboardPage({ data, onCreate, onOpenProject }: { data: DashboardData; onCreate: () => void; onOpenProject: (id: string) => void }) {
  return <div className="page">
    <header className="page-header">
      <div><p className="eyebrow">今日工作台</p><h1>多书总览</h1><p>按风险、存稿和下一次发布安排当前写作顺序。</p></div>
      <Button icon={<Plus size={17} />} onClick={onCreate}>新建作品</Button>
    </header>

    <section className="stat-grid" aria-label="项目统计">
      <div className="stat"><LibraryBig size={19} /><div><span>活跃作品</span><strong>{data.totals.activeBooks}</strong></div></div>
      <div className="stat"><BookOpen size={19} /><div><span>累计正文</span><strong>{formatCount(data.totals.totalWords)}</strong></div></div>
      <div className="stat"><FileCheck2 size={19} /><div><span>安全存稿</span><strong>{data.totals.stockChapters} 章</strong></div></div>
      <div className={`stat ${data.totals.pendingIssues ? "stat-alert" : ""}`}><ShieldAlert size={19} /><div><span>待处理问题</span><strong>{data.totals.pendingIssues}</strong></div></div>
    </section>

    <section className="section-band">
      <div className="section-heading"><div><h2>作品组合</h2><p>单书数据和上下文完全隔离。</p></div></div>
      {data.projects.length ? <div className="project-table">
        <div className="table-header"><span>作品</span><span>阶段</span><span>进度</span><span>存稿</span><span>下次发布</span><span>状态</span><span /></div>
        {data.projects.map((project) => <button className="project-row" key={project.id} onClick={() => onOpenProject(project.id)}>
          <span className="book-cell"><span className="book-mark">{project.title.slice(0, 1)}</span><span><strong>{project.title}</strong><small>{project.genre} · {project.chapterCount} 章</small></span></span>
          <span>{project.status}</span>
          <span className="progress-cell"><span>{formatCount(project.currentWords)} / {formatCount(project.targetWords)}</span><Progress value={project.currentWords / project.targetWords * 100} /></span>
          <span>{project.stockChapters} 章</span>
          <span>{formatDate(project.nextPublishAt, true)}</span>
          <span><Badge tone={riskTone(project.riskLevel)}>{project.riskLevel}</Badge></span>
          <span><ArrowRight size={17} /></span>
        </button>)}
      </div> : <EmptyState icon={<BookOpen />} title="还没有作品" description="先建立第一本书，工作台会为它创建独立数据库和内容目录。" action={<Button onClick={onCreate} icon={<Plus size={17} />}>新建作品</Button>} />}
    </section>

    <section className="two-column lower-dashboard">
      <div className="section-band compact-band">
        <div className="section-heading"><div><h2>今日发布</h2><p>到期但尚未确认发布的章节。</p></div><CalendarClock size={19} /></div>
        {data.dueToday.length ? <div className="simple-list">{data.dueToday.map((item) => <div key={item.id}><span><strong>{item.projectTitle}</strong><small>第{item.chapterNumber}章 {item.chapterTitle}</small></span><Badge tone="warning">{formatDate(item.publishAt, true)}</Badge></div>)}</div> : <p className="muted-line">今天没有待发布任务</p>}
      </div>
      <div className="section-band compact-band">
        <div className="section-heading"><div><h2>风险队列</h2><p>硬性问题必须解决后才能定稿。</p></div><AlertTriangle size={19} /></div>
        {data.activeAlerts.length ? <div className="simple-list">{data.activeAlerts.slice(0, 5).map((issue) => <div key={issue.id}><span><strong>{issue.category}</strong><small>{issue.message}</small></span><Badge tone={issue.severity === "硬性" ? "danger" : "warning"}>{issue.severity}</Badge></div>)}</div> : <p className="muted-line">当前没有未处理问题</p>}
      </div>
    </section>
  </div>;
}
