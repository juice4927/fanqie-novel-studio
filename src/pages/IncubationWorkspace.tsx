import { ArrowRight, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, IconButton, Progress } from "../components/UI";
import { describeError } from "../lib/error-message";
import { formatDate } from "../lib/format";
import { getFanqieCategoryProfile } from "../shared/fanqie-taxonomy";
import { describeIncubationPositioning, INCUBATION_STEPS, type IncubationDraft } from "../shared/incubation";
import { blockingFindings, reviewIncubationCandidate, summarizeFindings } from "../shared/incubation-review";
import type { AppApi, IncubationCandidate } from "../shared/types";

const COMPARISON_ROWS: Array<[string, (candidate: IncubationCandidate) => string]> = [
  ["子类型", (item) => item.genreSubtype],
  ["叙事主轴", (item) => item.secondaryGenres.join(" + ")],
  ["开局机制", (item) => item.openingMechanism],
  ["成长载体", (item) => item.growthCarrier],
  ["主要回报", (item) => item.primaryPayoff],
  ["首章钩子", (item) => item.openingDesign.chapter1Hook],
  ["首个回报", (item) => `第 ${item.openingDesign.firstPayoffChapter} 章`],
  ["升级阶梯", (item) => item.escalationLadder.map((step) => `${step.stage}（${step.expansionAxis}）`).join(" → ")],
  ["差异化", (item) => item.differentiation.against.join("；")],
  ["建议标签", (item) => item.suggestedTags.join("、")],
  ["长篇发动机", (item) => item.longFormEngine],
];

export function IncubationWorkspace({
  api,
  drafts,
  reload,
  notify,
  onEdit,
  onOpenProject,
  onNew,
}: {
  api: AppApi;
  drafts: IncubationDraft[];
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
  onEdit: (draft: IncubationDraft) => void;
  onOpenProject: (id: string) => void;
  onNew: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("正在处理…");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [signatures, setSignatures] = useState<Array<{ title: string; premise: string; openingMechanism: string }>>([]);

  useEffect(() => {
    let active = true;
    void api
      .listProjectSignatures()
      .then((next) => {
        if (active) setSignatures(next);
      })
      .catch(() => {
        if (active) setSignatures([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const draft = drafts.find((item) => item.id === selectedId) ?? drafts[0] ?? null;
  useEffect(() => {
    setAcknowledged(draft?.review.acknowledged ?? []);
  }, [draft]);
  useEffect(() => {
    if (!draft && drafts.length) setSelectedId(drafts[0].id);
  }, [draft, drafts]);

  const category = draft ? getFanqieCategoryProfile(draft.positioning.fanqieCategoryKey) : undefined;
  const selectedCandidate =
    draft?.candidates.find((item) => item.id === draft.selectedCandidateId) ?? draft?.candidates[0] ?? null;
  const findings = useMemo(
    () =>
      draft && selectedCandidate
        ? reviewIncubationCandidate({
            candidate: selectedCandidate,
            targetWords: draft.positioning.targetWords,
            wordsPerChapter: draft.positioning.wordsPerChapter,
            genreElements: selectedCandidate.genreElements,
            category,
            subGenres: [],
            skeleton: draft.skeleton,
            tagStats: category?.tags,
            existingContracts: signatures,
          })
        : [],
    [draft, selectedCandidate, category, signatures],
  );
  const summary = summarizeFindings(findings);
  const blocking = blockingFindings(findings, acknowledged);

  const persist = async (overrides: Partial<IncubationDraft>) => {
    if (!draft) return null;
    return api.saveIncubation({
      ...draft,
      selectedCandidateId: selectedCandidate?.id ?? draft.selectedCandidateId,
      review: { acknowledged },
      updatedAt: new Date().toISOString(),
      ...overrides,
    });
  };

  const promote = async () => {
    if (!draft || !selectedCandidate) return;
    setBusyMessage("正在生成人物与世界骨架…");
    setBusy(true);
    try {
      await persist({});
      const project = await api.promoteIncubation(draft.id);
      await reload();
      notify(`已创建《${project.title}》，请到故事圣经复核并审批契约`);
      onOpenProject(project.id);
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: IncubationDraft) => {
    setBusy(true);
    try {
      await api.deleteIncubation(target.id);
      await reload();
      notify("立项草稿已删除");
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!drafts.length) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">立项孵化台</p>
            <h1>还没有立项草稿</h1>
            <p>从 0 开书的三套方案、体检结论与证据都会保存在这里，可以隔几天再继续。</p>
          </div>
          <Button icon={<Sparkles size={17} />} onClick={onNew}>
            新建立项
          </Button>
        </header>
        <EmptyState
          icon={<Sparkles />}
          title="从一套方案开始"
          description="点击「新建立项」，填写定位后生成三套方案；关闭窗口也不会丢失。"
        />
      </div>
    );
  }

  return (
    <div className="page incubation-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">立项孵化台</p>
          <h1>{draft?.candidates.find((item) => item.id === draft.selectedCandidateId)?.title ?? "未命名立项"}</h1>
          <p>定位、证据、三案对比与体检结论都保存在草稿里，立项前不会写入任何作品数据。</p>
        </div>
        <Button icon={<Sparkles size={17} />} onClick={onNew}>
          新建立项
        </Button>
      </header>
      <div className="incubation-layout">
        <aside className="incubation-drafts">
          {drafts.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === draft?.id ? "selected" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <strong>
                {item.candidates.find((candidate) => candidate.id === item.selectedCandidateId)?.title ?? "未命名立项"}
              </strong>
              <small>
                {item.positioning.fanqieCategoryKey || "未选分类"} · {item.candidates.length} 案
              </small>
              <small>更新 {formatDate(item.updatedAt, true)}</small>
            </button>
          ))}
        </aside>
        {draft && (
          <div className="incubation-detail">
            <ol className="step-bar">
              {INCUBATION_STEPS.map((step) => (
                <li key={step} className={step === draft.step ? "current" : ""}>
                  {step}
                </li>
              ))}
            </ol>
            <section className="section-band compact-band">
              <div className="section-heading">
                <div>
                  <h2>定位</h2>
                  <p>{category ? `${category.channel}·${category.name}` : "未选择番茄分类"}</p>
                </div>
                <div className="heading-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => onEdit(draft)}>
                    继续编辑
                  </Button>
                  <IconButton label="删除立项草稿" onClick={() => void remove(draft)}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
              <p className="muted-line">{describeIncubationPositioning(draft.positioning)}</p>
              <div className="incubation-evidence">
                <Badge tone={draft.evidence.categoryTags.length ? "accent" : "warning"}>
                  标签证据 {draft.evidence.categoryTags.length}
                </Badge>
                <Badge tone={draft.evidence.insightIds.length ? "accent" : "warning"}>
                  洞察证据 {draft.evidence.insightIds.length}
                </Badge>
                {draft.evidence.skipped && <Badge tone="warning">未使用市场证据</Badge>}
              </div>
            </section>
            <section className="section-band compact-band">
              <div className="section-heading">
                <div>
                  <h2>三案对比</h2>
                  <p>只高亮存在差异的维度；点选一行即可切换采用方案。</p>
                </div>
                <Badge>{draft.candidates.length} 套</Badge>
              </div>
              {draft.candidates.length ? (
                <div className="compare-table">
                  <div className="compare-row head">
                    <span>维度</span>
                    {draft.candidates.map((candidate) => (
                      <button
                        type="button"
                        key={candidate.id}
                        className={candidate.id === selectedCandidate?.id ? "selected" : ""}
                        onClick={() => {
                          setAcknowledged([]);
                          void persist({ selectedCandidateId: candidate.id });
                        }}
                      >
                        {candidate.title}
                      </button>
                    ))}
                  </div>
                  {COMPARISON_ROWS.map(([label, select]) => {
                    const values = draft.candidates.map(select);
                    const differs = new Set(values).size > 1;
                    return (
                      <div key={label} className={`compare-row${differs ? " differs" : ""}`}>
                        <span>{label}</span>
                        {values.map((value, index) => (
                          <p key={draft.candidates[index].id}>{value}</p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-line">还没有候选方案。点「继续编辑」生成三套方案。</p>
              )}
            </section>
            {selectedCandidate && (
              <section className="section-band compact-band">
                <div className="section-heading">
                  <div>
                    <h2>立项体检</h2>
                    <p>
                      阻断 {summary.blocked} · 警告 {summary.warnings} · 提示 {summary.hints} · 通过 {summary.passed}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await persist({});
                          notify("立项草稿已保存");
                        } catch (error) {
                          notify(describeError(error), "error");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      保存草稿
                    </Button>
                    <Button
                      icon={busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                      disabled={busy || blocking.length > 0}
                      onClick={promote}
                    >
                      {busy ? busyMessage : "采用并创建作品"}
                    </Button>
                  </div>
                </div>
                <Progress
                  value={
                    summary.passed + summary.warnings + summary.hints
                      ? (summary.passed / (summary.passed + summary.warnings + summary.hints)) * 100
                      : 0
                  }
                />
                <div className="finding-panel">
                  {findings
                    .filter((item) => item.level !== "通过")
                    .map((item) => {
                      const cleared = acknowledged.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`finding-row ${item.level.toLowerCase()}${cleared ? " cleared" : ""}`}
                        >
                          <span className="finding-level">{item.level}</span>
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                            {item.suggestion && <small>{item.suggestion}</small>}
                          </div>
                          {item.level === "阻断" && (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setAcknowledged((current) => [...current, item.id])}
                            >
                              {cleared ? "已确认" : "人工确认"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  {!findings.some((item) => item.level !== "通过") && <p className="muted-line">体检全部通过。</p>}
                </div>
                {blocking.length > 0 && (
                  <p className="inline-warning">还有 {blocking.length} 条阻断项未处理，处理后才能创建作品。</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
