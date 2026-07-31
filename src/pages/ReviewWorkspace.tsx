import { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileOutput, SearchCheck } from "lucide-react";
import type {
  AppApi,
  ProjectDetail,
  ReviewExperiment,
  ReviewSuggestion,
} from "../shared/types";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "../components/UI";
import { formatCount, formatDate } from "../lib/format";
import { summarizeMetrics } from "../shared/metrics";

interface ReviewPageProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

export function ReviewPage({ project, api, reload, notify }: ReviewPageProps) {
  const [csv, setCsv] = useState("");
  const [modal, setModal] = useState(false);
  const [experimentModal, setExperimentModal] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const emptyExperiment = (): ReviewExperiment => ({
    id: "", title: "", hypothesis: "", changeSummary: "", fromChapter: 1, toChapter: 1,
    baselineStart: today, baselineEnd: today, observationStart: today, observationEnd: today,
    primaryMetric: "追读率", successCriteria: "", confounders: "", status: "计划中",
    conclusion: "", decision: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const [experiment, setExperiment] = useState<ReviewExperiment>(emptyExperiment);
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
      <section className="section-band experiment-band">
        <div className="section-heading">
          <div><h2>运营实验</h2><p>记录假设、观察窗口和结论；剧情修改仍需单独提交变更单。</p></div>
          <Button icon={<CalendarDays size={16} />} onClick={() => { setExperiment(emptyExperiment()); setExperimentModal(true); }}>新建实验</Button>
        </div>
        {project.experiments.length ? (
          <div className="experiment-list">
            {project.experiments.map((item) => (
              <article key={item.id}>
                <header><Badge tone={item.status === "已结论" ? "success" : item.status === "已取消" ? "neutral" : "warning"}>{item.status}</Badge><strong>{item.title}</strong></header>
                <p>{item.hypothesis}</p>
                <dl>
                  <div><dt>主指标</dt><dd>{item.primaryMetric}</dd></div>
                  <div><dt>影响章节</dt><dd>第{item.fromChapter}–{item.toChapter}章</dd></div>
                  <div><dt>观察期</dt><dd>{item.observationStart} 至 {item.observationEnd}</dd></div>
                  <div><dt>决定</dt><dd>{item.decision ?? "尚未决定"}</dd></div>
                </dl>
                {item.conclusion && <blockquote>{item.conclusion}</blockquote>}
                <Button variant="secondary" onClick={() => { setExperiment(item); setExperimentModal(true); }}>查看与更新</Button>
              </article>
            ))}
          </div>
        ) : <p className="muted-line">还没有运营实验。先从一条可验证的复盘建议建立假设。</p>}
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
      {experimentModal && (
        <Modal title={experiment.id ? "更新运营实验" : "新建运营实验"} onClose={() => setExperimentModal(false)}>
          <div className="form-stack">
            <Field label="实验标题"><Input value={experiment.title} onChange={(event) => setExperiment({ ...experiment, title: event.target.value })} placeholder="例如：减少重复打脸是否改善追读" /></Field>
            <Field label="可验证假设"><Textarea rows={3} value={experiment.hypothesis} onChange={(event) => setExperiment({ ...experiment, hypothesis: event.target.value })} placeholder="如果调整哪些内容，哪个指标将在什么时间内发生怎样的变化" /></Field>
            <Field label="计划改动"><Textarea rows={3} value={experiment.changeSummary} onChange={(event) => setExperiment({ ...experiment, changeSummary: event.target.value })} placeholder="只记录计划；需要改纲时另行提交变更单" /></Field>
            <div className="form-grid two">
              <Field label="影响起始章"><Input type="number" min={1} value={experiment.fromChapter} onChange={(event) => setExperiment({ ...experiment, fromChapter: Number(event.target.value) })} /></Field>
              <Field label="影响结束章"><Input type="number" min={1} value={experiment.toChapter} onChange={(event) => setExperiment({ ...experiment, toChapter: Number(event.target.value) })} /></Field>
              <Field label="基线开始"><Input type="date" value={experiment.baselineStart} onChange={(event) => setExperiment({ ...experiment, baselineStart: event.target.value })} /></Field>
              <Field label="基线结束"><Input type="date" value={experiment.baselineEnd} onChange={(event) => setExperiment({ ...experiment, baselineEnd: event.target.value })} /></Field>
              <Field label="观察开始"><Input type="date" value={experiment.observationStart} onChange={(event) => setExperiment({ ...experiment, observationStart: event.target.value })} /></Field>
              <Field label="观察结束"><Input type="date" value={experiment.observationEnd} onChange={(event) => setExperiment({ ...experiment, observationEnd: event.target.value })} /></Field>
              <Field label="主指标"><Select value={experiment.primaryMetric} onChange={(event) => setExperiment({ ...experiment, primaryMetric: event.target.value as ReviewExperiment["primaryMetric"] })}>{["点击率", "首章读完率", "三章留存", "追读率", "书架率", "收益"].map((item) => <option key={item}>{item}</option>)}</Select></Field>
              <Field label="状态"><Select value={experiment.status} onChange={(event) => setExperiment({ ...experiment, status: event.target.value as ReviewExperiment["status"] })}>{["计划中", "观察中", "已结论", "已取消"].map((item) => <option key={item}>{item}</option>)}</Select></Field>
            </div>
            <Field label="成功标准"><Input value={experiment.successCriteria} onChange={(event) => setExperiment({ ...experiment, successCriteria: event.target.value })} placeholder="例如：7 日追读率较基线提高 2 个百分点" /></Field>
            <Field label="干扰因素"><Textarea rows={3} value={experiment.confounders} onChange={(event) => setExperiment({ ...experiment, confounders: event.target.value })} placeholder="推荐量、断更、发布时间、封面简介变化、流量人群变化等" /></Field>
            {experiment.status === "已结论" && <>
              <Field label="实验结论"><Textarea rows={3} value={experiment.conclusion} onChange={(event) => setExperiment({ ...experiment, conclusion: event.target.value })} /></Field>
              <Field label="处理决定"><Select value={experiment.decision ?? ""} onChange={(event) => setExperiment({ ...experiment, decision: event.target.value ? event.target.value as ReviewExperiment["decision"] : null })}><option value="">请选择</option>{["保留改动", "撤销改动", "继续观察"].map((item) => <option key={item}>{item}</option>)}</Select></Field>
            </>}
            <div className="modal-actions"><Button variant="secondary" onClick={() => setExperimentModal(false)}>取消</Button><Button disabled={!experiment.title.trim() || !experiment.hypothesis.trim()} onClick={async () => {
              try { await api.saveReviewExperiment(project.summary.id, experiment); await reload(); setExperimentModal(false); notify("运营实验已保存"); }
              catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); }
            }}>保存实验</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UploadIcon() {
  return <FileOutput size={16} />;
}
