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

export function PublishingPage({ project, api, reload, notify }: CommonProjectProps) {
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
