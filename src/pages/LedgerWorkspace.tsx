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

export function LedgerPage({ project, api, reload, notify }: CommonProjectProps) {
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
    (fact) => fact.confidence !== "已忽略" && (filter === "全部" || fact.kind === filter),
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
            {pendingFacts.slice(0, 12).map((fact) => {
              const replaced = fact.replacesFactId
                ? project.facts.find((item) => item.id === fact.replacesFactId)
                : undefined;
              return (
                <article key={fact.id}>
                  <span><Badge>{fact.changeType ?? (replaced ? "状态替换" : fact.kind)}</Badge><strong>{fact.subject} · {fact.predicate}</strong><small>{fact.changeType === "知情范围变更" && replaced ? `${replaced.knowledgeScope || "公开"} → ${fact.knowledgeScope || "公开"}` : replaced ? `${replaced.value} → ${fact.value}` : fact.value}{fact.numericDelta !== null && fact.numericDelta !== undefined ? `（${fact.numericDelta > 0 ? "+" : ""}${fact.numericDelta}）` : ""}｜证据第{fact.evidenceChapter}章{replaced ? "｜确认后结束旧状态" : ""}</small></span>
                  <div className="inline-actions">
                    <Button variant="secondary" onClick={async () => {
                      try { await api.saveFact(project.summary.id, { ...fact, confidence: "已确认" }); await reload(); notify(replaced ? "新状态已生效，旧状态已结束" : "候选事实已确认"); }
                      catch (error) { notify(String(error), "error"); }
                    }}>确认入账</Button>
                    <Button variant="ghost" icon={<Trash2 size={14} />} onClick={async () => {
                      try { await api.saveFact(project.summary.id, { ...fact, confidence: "已忽略" }); await reload(); notify("候选已忽略"); }
                      catch (error) { notify(String(error), "error"); }
                    }}>忽略</Button>
                  </div>
                </article>
              );
            })}
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
