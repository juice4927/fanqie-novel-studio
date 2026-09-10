import { Check, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { describeError } from "../lib/error-message";
import { formatCount } from "../lib/format";
import type { AppApi, ProjectDetail } from "../shared/types";
import { Badge, Button, IconButton, Segmented, Select } from "./UI";

const REVIEW_VIEWS = ["故事与世界", "分层大纲", "全书章纲"] as const;
const PLAN_KINDS = ["宏观阶段", "分卷", "粗纲", "细纲", "场景卡"] as const;
const PAGE_SIZE = 20;

export function LaunchPackReview({
  project,
  api,
  reload,
  notify,
  onEditContract,
  onEditPlans,
}: {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
  onEditContract: () => void;
  onEditPlans: () => void;
}) {
  const [view, setView] = useState<(typeof REVIEW_VIEWS)[number]>("故事与世界");
  const [planKind, setPlanKind] = useState<(typeof PLAN_KINDS)[number]>("宏观阶段");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const contract = project.contract;
  const progress = project.launchPack;
  const confirmed = progress?.status === "已确认";
  const generating = progress?.status === "生成中";
  const paused = progress?.status === "已暂停";
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number);
  const plans = project.plans
    .filter((plan) => plan.kind === planKind)
    .sort((left, right) => left.ordinal - right.ordinal);
  const itemCount = view === "分层大纲" ? plans.length : chapters.length;
  const lastPage = Math.max(0, Math.ceil(itemCount / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageNumbers = Array.from({ length: lastPage + 1 }, (_, index) => index);
  const fields: Array<[string, string | string[] | undefined]> = [
    ["故事前提", contract.premise],
    ["故事终局", contract.ending],
    ["主角核心欲望", contract.protagonistDesire],
    ["主角弧光", contract.protagonistArc],
    ["关键关系", contract.keyRelationships],
    ["世界规则", contract.worldRules],
    ["主要势力", contract.majorForces],
    ["时间锚点", contract.timelineAnchors],
    ["读者承诺", contract.readerPromise],
    ["核心情绪", contract.coreEmotion],
    ["目标读者", contract.audience],
    ["商业钩子", contract.commercialHook],
    ["开局机制", contract.openingMechanism],
    ["成长载体", contract.growthCarrier],
    ["核心回报", contract.primaryPayoff],
    ["长篇发动机", contract.longFormEngine],
    ["不可变规则", contract.immutableRules],
    ["禁用模式", contract.prohibitedPatterns],
    ["题材子类型", contract.genreSubtype],
    ["复合叙事类型", contract.secondaryGenres],
    ["题材元素", contract.genreElements],
    ["自定义创作方向", contract.customGenreDirection],
    ["篇幅形态", contract.lengthShape],
    ["创作自由度", contract.guidanceMode],
    ["补充引导", contract.creativeBrief],
    ["重大状态变化", contract.majorStateChanges?.include],
    ["状态变化例外", contract.majorStateChanges?.exclude],
    ...(contract.genreSpecificSections ?? []).map((section): [string, string[]] => [section.label, section.items]),
    ...(contract.aestheticProfile
      ? ([
          ["叙事距离", contract.aestheticProfile.narrativeDistance],
          ["情绪温度", contract.aestheticProfile.emotionalTemperature],
          ["文字质地", contract.aestheticProfile.proseTexture],
          ["对话风格", contract.aestheticProfile.dialogueStyle],
          ["情绪表达", contract.aestheticProfile.emotionalExpression],
          ["标志手法", contract.aestheticProfile.signatureTechniques],
          ["审美避用", contract.aestheticProfile.avoidPatterns],
        ] satisfies Array<[string, string | string[]]>)
      : []),
  ];
  return (
    <section className="section-band launch-review" aria-label="创作包集中复核">
      <div className="section-heading">
        <div>
          <h2>完整创作包</h2>
          <p>
            {formatCount(project.summary.targetWords)} 字 · {project.plans.length} 个规划节点 · {chapters.length} 章章纲
          </p>
        </div>
        <Badge tone={confirmed ? "success" : "warning"}>{progress?.status || "草稿"}</Badge>
      </div>
      {progress && !confirmed && (
        <div className="launch-review-progress" role="status">
          <strong>
            {generating ? `正在生成${progress.phase}…` : paused ? "生成已暂停" : "创作包已生成，等待确认"}
          </strong>
          <span>
            章纲 {progress.completedChapters} / {progress.horizonChapters ?? progress.targetChapters}
            {progress.coarseTotal ? ` · 全书粗纲 ${progress.coarseCompleted ?? 0} / ${progress.coarseTotal} 批` : ""}
            {` · 全书 ${progress.targetChapters} 章`}
          </span>
          {progress.error && <small>{progress.error}</small>}
          {paused && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.generateLaunchPack(project.summary.id);
                  await reload();
                  notify("已继续生成完整创作包");
                } catch (error) {
                  notify(describeError(error), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              继续生成
            </Button>
          )}
        </div>
      )}
      <div className="launch-review-toolbar">
        <Segmented
          options={REVIEW_VIEWS}
          value={view}
          label="创作包内容"
          onChange={(next) => {
            setView(next);
            setPage(0);
          }}
        />
        <Button variant="secondary" onClick={view === "故事与世界" ? onEditContract : onEditPlans}>
          {view === "故事与世界" ? "编辑故事圣经" : "编辑规划"}
        </Button>
      </div>
      {view === "故事与世界" ? (
        <dl className="launch-review-fields">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {Array.isArray(value) ? (
                  value.length ? (
                    <ul>
                      {value.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    "未设置"
                  )
                ) : (
                  value?.trim() || "未设置"
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          {view === "分层大纲" && (
            <Segmented
              options={PLAN_KINDS}
              value={planKind}
              label="大纲层级"
              onChange={(next) => {
                setPlanKind(next);
                setPage(0);
              }}
            />
          )}
          <div className="launch-review-items">
            {view === "分层大纲"
              ? plans.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((plan) => (
                  <article key={plan.id}>
                    <header>
                      <h3>{plan.title}</h3>
                      <Badge>{plan.status}</Badge>
                    </header>
                    <dl>
                      <div>
                        <dt>目标</dt>
                        <dd>{plan.goal}</dd>
                      </div>
                      <div>
                        <dt>冲突</dt>
                        <dd>{plan.conflict || "未设置"}</dd>
                      </div>
                      <div>
                        <dt>结果</dt>
                        <dd>{plan.outcome || "未设置"}</dd>
                      </div>
                    </dl>
                    <small>{formatCount(plan.targetWords)} 字</small>
                  </article>
                ))
              : chapters.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((chapter) => (
                  <article key={chapter.id}>
                    <header>
                      <h3>
                        第 {chapter.number} 章 · {chapter.title}
                      </h3>
                      <Badge>{chapter.status}</Badge>
                    </header>
                    <p>{chapter.outline}</p>
                    <dl>
                      <div>
                        <dt>本章承诺</dt>
                        <dd>{chapter.chapterPromise || "未设置"}</dd>
                      </div>
                      <div>
                        <dt>预期回报</dt>
                        <dd>{chapter.expectedPayoff || "未设置"}</dd>
                      </div>
                      <div>
                        <dt>危机</dt>
                        <dd>{chapter.crisis || "未设置"}</dd>
                      </div>
                      <div>
                        <dt>章末期待</dt>
                        <dd>{chapter.endingExpectation || "未设置"}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
            {!itemCount && <p className="muted-line">暂无{view === "分层大纲" ? planKind : "章纲"}。</p>}
          </div>
          {itemCount > PAGE_SIZE && (
            <div className="launch-review-pagination">
              <IconButton label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft size={16} />
              </IconButton>
              <Select
                aria-label="内容页码"
                value={currentPage}
                onChange={(event) => setPage(Number(event.target.value))}
              >
                {pageNumbers.map((pageNumber) => (
                  <option key={pageNumber} value={pageNumber}>
                    {pageNumber * PAGE_SIZE + 1}–{Math.min((pageNumber + 1) * PAGE_SIZE, itemCount)} / {itemCount}
                  </option>
                ))}
              </Select>
              <IconButton label="下一页" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight size={16} />
              </IconButton>
            </div>
          )}
        </>
      )}
      {!confirmed && (
        <footer className="launch-review-footer">
          <span>
            确认范围：创作契约、全书结构与粗纲、前 {progress?.horizonChapters ?? progress?.targetChapters ?? 0} 章章纲；
            后续章纲会随写作自动续跑
          </span>
          <Button
            icon={busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            disabled={busy || progress?.status !== "待确认"}
            onClick={async () => {
              setBusy(true);
              try {
                await api.approveLaunchPack(project.summary.id);
                await reload();
                notify("创作包已确认，可以开始写作");
              } catch (error) {
                notify(describeError(error), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在确认…" : "确认创作包"}
          </Button>
        </footer>
      )}
    </section>
  );
}
