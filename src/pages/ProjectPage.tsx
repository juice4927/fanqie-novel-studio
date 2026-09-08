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
  RefreshCw,
  SearchCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Select } from "../components/UI";
import { useNavigationGuard } from "../lib/navigation-guard";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const { confirmNavigation } = useNavigationGuard();

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const [detail, allInsights] = await Promise.all([api.getProject(projectId), api.listInsights()]);
      if (requestRef.current !== requestId) return;
      setProject(detail);
      setInsights(allInsights);
      setLoadError(null);
    } catch (error) {
      if (requestRef.current === requestId) setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [api, projectId]);
  useEffect(() => {
    setLoading(true);
    setProject(null);
    setLoadError(null);
    void reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  if (loadError && !project)
    return (
      <div className="page loading-page" role="alert">
        <span>打开作品失败：{loadError}</span>
        <Button icon={<RefreshCw size={16} />} onClick={() => void reload()}>
          重试
        </Button>
        <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={onBack}>
          返回多书总览
        </Button>
      </div>
    );

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
        <button type="button" className={styles.backLink} onClick={onBack}>
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
                if (item.id === tab || confirmNavigation()) setTab(item.id);
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
        {loadError && (
          <div role="alert">
            刷新失败：{loadError}
            <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => void reload()}>
              重试
            </Button>
          </div>
        )}
        {tab === "驾驶舱" && (
          <ProjectDashboard
            project={project}
            plugin={plugin}
            insights={insights}
            api={api}
            reload={reload}
            notify={notify}
            onNavigate={(next) => {
              if (confirmNavigation()) setTab(next);
            }}
          />
        )}
        {tab === "故事圣经" && <StoryBiblePage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "规划台" && <PlanningPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "写作台" && <WritingPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "状态账本" && <LedgerPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "质检中心" && <QualityPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "发布日历" && <PublishingPage project={project} api={api} reload={reload} notify={notify} />}
        {tab === "数据复盘" && <ReviewPage project={project} api={api} reload={reload} notify={notify} />}
      </main>
    </div>
  );
}
