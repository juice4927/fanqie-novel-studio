import {
  ArrowLeft,
  BookMarked,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  ClipboardCheck,
  Layers3,
  LoaderCircle,
  NotebookTabs,
  SearchCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Select } from "../components/UI";
import { GENRE_PLUGINS } from "../shared/genre-plugins";
import { PROJECT_STATUSES } from "../shared/status-constants";
import type { AppApi, InsightPack, ProjectDetail, ProjectStatus } from "../shared/types";
import { LedgerPage } from "./LedgerWorkspace";
import { PlanningPage } from "./PlanningWorkspace";
import { ProjectDashboard } from "./ProjectDashboard";
import styles from "./ProjectPage.module.css";
import { PublishingPage } from "./PublishingWorkspace";
import { QualityPage } from "./QualityWorkspace";
import { ReviewPage } from "./ReviewWorkspace";
import { StoryBiblePage } from "./StoryBibleWorkspace";
import { WritingPage } from "./WritingWorkspace";

type ProjectTab = "驾驶舱" | "故事圣经" | "规划台" | "写作台" | "状态账本" | "质检中心" | "发布日历" | "数据复盘";
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
  const [writingDirty, setWritingDirty] = useState(false);
  const confirmLeaveWriting = () => !writingDirty || window.confirm("当前章节还有未保存内容，确定离开写作台吗？");

  const reload = useCallback(async () => {
    const [detail, allInsights] = await Promise.all([api.getProject(projectId), api.listInsights()]);
    setProject(detail);
    setInsights(allInsights);
    setLoading(false);
  }, [api, projectId]);
  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  if (loading || !project)
    return (
      <div className="page loading-page">
        <LoaderCircle className="spin" />
        <span>正在打开独立项目库...</span>
      </div>
    );
  const plugin = GENRE_PLUGINS[project.summary.genre];
  return (
    <div className={styles.shell}>
      <aside className={styles.subnav}>
        <button
          type="button"
          className={styles.backLink}
          onClick={() => {
            if (confirmLeaveWriting()) onBack();
          }}
        >
          <ArrowLeft size={16} />
          返回多书总览
        </button>
        <div className={styles.identity}>
          <div className={styles.avatar}>{project.summary.title.slice(0, 1)}</div>
          <strong>{project.summary.title}</strong>
          <span>{project.summary.genre}</span>
        </div>
        <nav className={styles.nav}>
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`${styles.navButton}${tab === item.id ? ` ${styles.active}` : ""}`}
              onClick={() => {
                if (item.id === tab || confirmLeaveWriting()) setTab(item.id);
              }}
            >
              <item.icon size={17} />
              {item.id}
              {item.id === "质检中心" && project.issues.filter((issue) => issue.status === "待处理").length > 0 && (
                <i className={styles.issueCount}>
                  {project.issues.filter((issue) => issue.status === "待处理").length}
                </i>
              )}
            </button>
          ))}
        </nav>
        <div className={styles.stage}>
          <span>当前阶段</span>
          <Select
            aria-label="当前阶段"
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
            {PROJECT_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        </div>
      </aside>
      <main className={styles.content}>
        {tab === "驾驶舱" && (
          <ProjectDashboard
            project={project}
            plugin={plugin}
            insights={insights}
            api={api}
            reload={reload}
            notify={notify}
            onNavigate={(next) => {
              if (confirmLeaveWriting()) setTab(next);
            }}
          />
        )}
        {tab === "故事圣经" && <StoryBiblePage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "规划台" && <PlanningPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "写作台" && (
          <WritingPage project={project} api={api} reload={reload} notify={notify} onDirtyChange={setWritingDirty} />
        )}
        {tab === "状态账本" && <LedgerPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "质检中心" && <QualityPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "发布日历" && <PublishingPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "数据复盘" && <ReviewPage project={project} api={api} reload={reload} notify={notify} />}
      </main>
    </div>
  );
}
