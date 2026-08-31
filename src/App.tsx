import { BookCopy, BookOpen, Database, LayoutDashboard, Plus, Search, Settings, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NewProjectModal } from "./components/NewProjectModal";
import { Button, Field, Input, Modal } from "./components/UI";
import { createBrowserApi } from "./lib/browser-api";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ResearchPage } from "./pages/ResearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { DashboardData, ProjectSummary } from "./shared/types";

type AppPage = "dashboard" | "research" | "project" | "settings";

export default function App() {
  const api = useMemo(() => window.novelStudio ?? createBrowserApi(), []);
  const [page, setPage] = useState<AppPage>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [deleteProject, setDeleteProject] = useState<ProjectSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const reload = useCallback(async () => {
    const [nextDashboard, nextProjects] = await Promise.all([api.getDashboard(), api.listProjects()]);
    setDashboard(nextDashboard);
    setProjects(nextProjects);
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const notify = (message: string, tone: "success" | "error" = "success") => setToast({ message, tone });
  const openProject = (id: string) => {
    setSelectedProjectId(id);
    setPage("project");
  };
  const navigate = (next: AppPage) => {
    setPage(next);
    if (next !== "project") setSelectedProjectId(null);
    void reload();
  };
  const visibleProjects = projects.filter((project) => project.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="app-shell">
      <aside className="main-sidebar">
        <div className="brand">
          <span>
            <BookOpen size={20} />
          </span>
          <div>
            <strong>长篇创作</strong>
            <small>Novel Studio</small>
          </div>
        </div>
        <nav className="main-nav">
          <button type="button" className={page === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}>
            <LayoutDashboard size={18} />
            多书总览
          </button>
          <button type="button" className={page === "research" ? "active" : ""} onClick={() => navigate("research")}>
            <BookCopy size={18} />
            市场研究
          </button>
        </nav>
        <div className="sidebar-projects">
          <div className="sidebar-label">
            <span>作品库</span>
            <button type="button" aria-label="新建作品" title="新建作品" onClick={() => setCreateModal(true)}>
              <Plus size={15} />
            </button>
          </div>
          <div className="sidebar-search">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品" />
          </div>
          <div className="sidebar-book-list">
            {visibleProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={selectedProjectId === project.id ? "active" : ""}
                onClick={() => openProject(project.id)}
              >
                <span>{project.title.slice(0, 1)}</span>
                <div>
                  <strong>{project.title}</strong>
                  <small>
                    {project.status} · {project.chapterCount}章
                  </small>
                </div>
                {project.riskLevel !== "正常" && <i className={project.riskLevel === "告警" ? "danger" : "warning"} />}
              </button>
            ))}
          </div>
        </div>
        <nav className="sidebar-bottom">
          <button type="button" className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}>
            <Settings size={18} />
            系统设置
          </button>
          <div className="local-status">
            <Database size={14} />
            <span>{window.novelStudio ? "本地数据库已连接" : "浏览器预览数据"}</span>
          </div>
        </nav>
      </aside>
      <div className="app-main">
        {page === "dashboard" && dashboard && (
          <DashboardPage
            data={dashboard}
            onCreate={() => setCreateModal(true)}
            onOpenProject={openProject}
            onDeleteProject={(project) => {
              setDeleteProject(project);
              setDeleteConfirmation("");
            }}
          />
        )}
        {page === "research" && <ResearchPage api={api} notify={notify} />}
        {page === "settings" && <SettingsPage api={api} notify={notify} />}
        {page === "project" && selectedProjectId && (
          <ProjectPage
            api={api}
            projectId={selectedProjectId}
            onBack={() => navigate("dashboard")}
            notify={(message, tone) => {
              notify(message, tone);
              void reload();
            }}
          />
        )}
      </div>
      {createModal && (
        <NewProjectModal
          api={api}
          onClose={() => setCreateModal(false)}
          notify={notify}
          onCreated={async (created) => {
            setCreateModal(false);
            await reload();
            openProject(created.id);
            notify("作品与创作契约草案已创建，请先在故事圣经中审核");
          }}
        />
      )}
      {deleteProject && (
        <Modal title="移除作品" onClose={() => !deleteBusy && setDeleteProject(null)}>
          <div className="form-stack">
            <div className="delete-project-warning">
              <Trash2 size={20} />
              <div>
                <strong>作品将从工作台移除</strong>
                <p>独立数据库、正文、附件和历史版本会移动到工作区的 trash 回收目录，不会立即永久擦除。</p>
              </div>
            </div>
            <Field label={`输入完整书名“${deleteProject.title}”确认`}>
              <Input
                autoFocus
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" disabled={deleteBusy} onClick={() => setDeleteProject(null)}>
                取消
              </Button>
              <Button
                disabled={deleteBusy || deleteConfirmation.trim() !== deleteProject.title}
                icon={<Trash2 size={16} />}
                onClick={async () => {
                  setDeleteBusy(true);
                  try {
                    const result = await api.deleteProject(deleteProject.id, deleteConfirmation);
                    if (selectedProjectId === deleteProject.id) {
                      setSelectedProjectId(null);
                      setPage("dashboard");
                    }
                    setDeleteProject(null);
                    setDeleteConfirmation("");
                    await reload();
                    notify(result);
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), "error");
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                移入回收目录
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast toast-${toast.tone}`}>
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭通知" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
