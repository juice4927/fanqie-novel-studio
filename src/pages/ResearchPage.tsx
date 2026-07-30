import { useEffect, useState } from "react";
import {
  BarChart3,
  BookCopy,
  BookOpenText,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  FileInput,
  Lightbulb,
  Link2,
  LoaderCircle,
  Clock3,
  Play,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import type {
  AiSettings,
  AppApi,
  Genre,
  ImportPreview,
  InsightPack,
  RankingAnalytics,
  RankingSnapshot,
  RankingCaptureSchedule,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../shared/types";
import { GENRES } from "../shared/types";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
} from "../components/UI";
import { formatCount, formatDate } from "../lib/format";
import {
  COMMERCIAL_KNOWLEDGE_SOURCES,
  COMMERCIAL_KNOWLEDGE_VERSION,
} from "../shared/commercial-knowledge";
import { GENRE_PLUGINS } from "../shared/genre-plugins";

type ResearchTab = "榜单快照" | "样本拆书" | "脱敏洞察" | "商业知识";

const FANQIE_CATEGORIES = {
  男频: [
    ["1141", "西方奇幻"], ["1140", "东方仙侠"], ["8", "科幻末世"],
    ["261", "都市日常"], ["124", "都市修真"], ["1014", "都市高武"],
    ["273", "历史古代"], ["27", "战神赘婿"], ["263", "都市种田"],
    ["258", "传统玄幻"], ["272", "历史脑洞"], ["539", "悬疑脑洞"],
    ["262", "都市脑洞"], ["257", "玄幻脑洞"], ["751", "悬疑灵异"],
    ["504", "抗战谍战"], ["746", "游戏体育"], ["718", "动漫衍生"],
    ["1016", "男频衍生"],
  ],
  女频: [
    ["1139", "古风世情"], ["8", "科幻末世"], ["746", "游戏体育"],
    ["1015", "女频衍生"], ["248", "玄幻言情"], ["23", "种田"],
    ["79", "年代"], ["267", "现言脑洞"], ["246", "宫斗宅斗"],
    ["539", "悬疑脑洞"], ["253", "古言脑洞"], ["24", "快穿"],
    ["749", "青春甜宠"], ["745", "星光璀璨"], ["747", "女频悬疑"],
    ["750", "职场婚恋"], ["748", "豪门总裁"], ["1017", "民国言情"],
  ],
} as const;

type FanqieGender = keyof typeof FANQIE_CATEGORIES;
type FanqieRankKind = "阅读榜" | "新书榜";

function splitPastedText(text: string): ImportPreview["chapters"] {
  const pattern =
    /^\s*(第[0-9零〇一二三四五六七八九十百千万两]+[章节回]\s*[^\n]{0,40})\s*$/gm;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length)
    return [
      {
        title: "正文",
        content: text.trim(),
        wordCount: text.replace(/\s/g, "").length,
      },
    ];
  return matches
    .map((match, index) => {
      const content = text
        .slice(
          (match.index ?? 0) + match[0].length,
          matches[index + 1]?.index ?? text.length,
        )
        .trim();
      return {
        title: match[1],
        content,
        wordCount: content.replace(/\s/g, "").length,
      };
    })
    .filter((chapter) => chapter.content);
}

export function ResearchPage({
  api,
  notify,
}: {
  api: AppApi;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [tab, setTab] = useState<ResearchTab>("榜单快照");
  const [rankings, setRankings] = useState<RankingSnapshot[]>([]);
  const [analytics, setAnalytics] = useState<RankingAnalytics | null>(null);
  const [books, setBooks] = useState<ResearchBook[]>([]);
  const [insights, setInsights] = useState<InsightPack[]>([]);
  const [rankingModal, setRankingModal] = useState(false);
  const [rankingCsv, setRankingCsv] = useState("");
  const [fanqieGender, setFanqieGender] = useState<FanqieGender>("男频");
  const [fanqieRankKind, setFanqieRankKind] = useState<FanqieRankKind>("阅读榜");
  const [fanqieCategoryId, setFanqieCategoryId] = useState("262");
  const [rankingName, setRankingName] = useState("番茄男频阅读榜·都市脑洞");
  const [publicModal, setPublicModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [rankingSchedules, setRankingSchedules] = useState<RankingCaptureSchedule[]>([]);
  const [scheduleFrequency, setScheduleFrequency] = useState<RankingCaptureSchedule["frequency"]>("每日");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pasteModal, setPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [genre, setGenre] = useState<Genre>(GENRES[0]);
  const [rights, setRights] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [busyBook, setBusyBook] = useState<string | null>(null);
  const [analysisBook, setAnalysisBook] = useState<ResearchBook | null>(null);
  const [analyses, setAnalyses] = useState<ResearchAnalysisRecord[]>([]);
  const [pendingDeconstruct, setPendingDeconstruct] =
    useState<ResearchBook | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const fanqieCategories = FANQIE_CATEGORIES[fanqieGender];
  const fanqieCategory = fanqieCategories.find(([id]) => id === fanqieCategoryId) ?? fanqieCategories[0];
  const publicUrl = `https://fanqienovel.com/rank/${fanqieGender === "男频" ? 1 : 0}_${fanqieRankKind === "阅读榜" ? 2 : 1}_${fanqieCategory[0]}`;

  const selectFanqieRanking = (
    gender: FanqieGender,
    kind: FanqieRankKind,
    categoryId: string,
  ) => {
    const categories = FANQIE_CATEGORIES[gender];
    const category = categories.find(([id]) => id === categoryId) ?? categories[0];
    setFanqieGender(gender);
    setFanqieRankKind(kind);
    setFanqieCategoryId(category[0]);
    setRankingName(`番茄${gender}${kind}·${category[1]}`);
  };

  const reload = async () => {
    const [rankingData, rankingAnalytics, bookData, insightData, schedules] =
      await Promise.all([
        api.listRankings(),
        api.getRankingAnalytics(),
        api.listResearchBooks(),
        api.listInsights(),
        api.listRankingSchedules(),
      ]);
    setRankings(rankingData);
    setAnalytics(rankingAnalytics);
    setBooks(bookData);
    setInsights(insightData);
    setRankingSchedules(schedules);
  };
  useEffect(() => {
    void reload();
  }, []);

  const chooseFile = async () => {
    try {
      const result = await api.previewResearchFile();
      if (result) setPreview(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const commitImport = async () => {
    if (!preview) return;
    try {
      await api.importResearchBook(preview, genre, rights, cloud);
      setPreview(null);
      setRights(false);
      setCloud(false);
      await reload();
      notify("样本已导入研究隔离区");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const deconstruct = async (book: ResearchBook) => {
    setBusyBook(book.id);
    try {
      await api.deconstructResearchBook(book.id);
      await reload();
      setTab("脱敏洞察");
      notify("拆书完成，已生成脱敏洞察包");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyBook(null);
    }
  };
  const requestDeconstruct = async (book: ResearchBook) => {
    if (!book.cloudConsent) {
      await deconstruct(book);
      return;
    }
    setAiSettings(await api.getAiSettings());
    setPendingDeconstruct(book);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">市场研究区</p>
          <h1>榜单、样本与洞察</h1>
          <p>原始文本停留在研究库，创作区只接收脱敏后的结构洞察。</p>
        </div>
      </header>
      <div className="toolbar-row">
        <Segmented
          options={["榜单快照", "样本拆书", "脱敏洞察", "商业知识"] as const}
          value={tab}
          onChange={setTab}
        />
        <div className="toolbar-actions">
          {tab === "榜单快照" && (
            <>
              <Button
                variant="secondary"
                icon={<Clock3 size={17} />}
                onClick={() => setScheduleModal(true)}
              >
                定时采榜
              </Button>
              <Button
                variant="secondary"
                icon={<Link2 size={17} />}
                onClick={() => setPublicModal(true)}
              >
                采集公开页
              </Button>
              <Button
                icon={<Upload size={17} />}
                onClick={() => setRankingModal(true)}
              >
                导入榜单 CSV
              </Button>
            </>
          )}
          {tab === "样本拆书" && (
            <>
              <Button
                variant="secondary"
                icon={<ClipboardPaste size={17} />}
                onClick={() => setPasteModal(true)}
              >
                粘贴文本
              </Button>
              <Button icon={<FileInput size={17} />} onClick={chooseFile}>
                导入样本
              </Button>
            </>
          )}
        </div>
      </div>

      {tab === "榜单快照" && (
        <section className="section-band">
          {analytics && (
            <div className="ranking-analytics">
              <div>
                <TrendingUp size={17} />
                <span>
                  <small>统计可信度</small>
                  <strong>{analytics.confidence}</strong>
                </span>
              </div>
              <div>
                <span>
                  <small>有效快照</small>
                  <strong>{analytics.snapshotCount}</strong>
                </span>
              </div>
              <div>
                <span>
                  <small>累计样本</small>
                  <strong>{analytics.sampleSize}</strong>
                </span>
              </div>
              <div>
                <span>
                  <small>新晋书目</small>
                  <strong>{analytics.newEntrants.length}</strong>
                </span>
              </div>
              <div className="analytics-wide">
                <small>数据范围</small>
                <strong>{analytics.timeRange}</strong>
              </div>
            </div>
          )}
          {analytics?.marketOpportunities.length ? (
            <div className="market-opportunity-panel">
              <div className="section-heading">
                <div>
                  <h2>榜单趋势与立项机会</h2>
                  <p>按同一番茄榜单的连续快照估算动能与竞争，仅作选题证据，不替代人工判断。</p>
                </div>
              </div>
              <div className="market-opportunity-grid">
                {analytics.marketOpportunities.slice(0, 6).map((opportunity) => (
                  <article key={opportunity.listName}>
                    <div className="opportunity-head">
                      <div><Badge tone="accent">{opportunity.genre}</Badge><strong>{opportunity.categoryName}</strong></div>
                      <span className={`opportunity-score ${opportunity.opportunityScore === null ? "is-baseline" : ""}`}>{opportunity.opportunityScore ?? "--"}</span>
                    </div>
                    <p>{opportunity.recommendation}</p>
                    <small>{opportunity.evidenceLevel} · 证据 {opportunity.dataSufficiency}% · 动能 {opportunity.momentumScore ?? "待观察"} · 竞争{opportunity.competition}</small>
                    <small>{opportunity.snapshots}次快照 · 新晋率 {opportunity.newEntrantRate}% · 平均升位 {opportunity.averageRankChange}{opportunity.scoreRange ? ` · 机会区间 ${opportunity.scoreRange[0]}–${opportunity.scoreRange[1]}` : ""}</small>
                    {opportunity.sampleWarning && <small className="warning-text">{opportunity.sampleWarning}</small>}
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          {rankings.length ? (
            rankings.map((snapshot) => (
              <div className="snapshot" key={snapshot.id}>
                <div className="snapshot-head">
                  <span>
                    <strong>{snapshot.listName}</strong>
                    <small>
                      {snapshot.source} ·{" "}
                      {formatDate(snapshot.capturedAt, true)}
                    </small>
                  </span>
                  <Badge
                    tone={snapshot.status === "成功" ? "success" : "warning"}
                  >
                    {snapshot.status}
                  </Badge>
                </div>
                <div className="data-table">
                  <div className="data-head ranking-grid">
                    <span>排名</span>
                    <span>书名</span>
                    <span>题材</span>
                    <span>字数</span>
                    <span>状态</span>
                    <span>官方页</span>
                  </div>
                  {snapshot.entries.slice(0, 20).map((entry) => (
                    <div className="data-row ranking-grid" key={entry.id}>
                      <span className="rank-number">{entry.rank}</span>
                      <span>
                        <strong>{entry.title}</strong>
                        <small>{entry.author}</small>
                      </span>
                      <span>{entry.genre}</span>
                      <span>{formatCount(entry.words)}</span>
                      <span>{entry.status}</span>
                      <span className="ranking-links">
                        {entry.sourceUrl && (
                          <a href={entry.sourceUrl} target="_blank" rel="noreferrer" title={entry.synopsis || "打开番茄官方详情页"}>
                            详情 <ExternalLink size={12} />
                          </a>
                        )}
                        {entry.officialReaderUrl && (
                          <a href={entry.officialReaderUrl} target="_blank" rel="noreferrer">
                            阅读
                          </a>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon={<BarChart3 />}
              title="还没有榜单快照"
              description="采集番茄官方公开榜单或导入 CSV，系统会按日期保留不可变快照。"
              action={
                <Button
                  onClick={() => setPublicModal(true)}
                  icon={<Link2 size={17} />}
                >
                  采集番茄榜单
                </Button>
              }
            />
          )}
        </section>
      )}

      {tab === "样本拆书" && (
        <section className="section-band">
          {books.length ? (
            <div className="research-book-grid">
              {books.map((book) => (
                <article className="research-book" key={book.id}>
                  <div className="research-book-icon">
                    <BookCopy size={20} />
                  </div>
                  <div className="research-book-main">
                    <div>
                      <Badge>{book.genre}</Badge>
                      <h3>{book.title}</h3>
                      <p>
                        {book.sourceType} · {book.chapterCount} 章 ·{" "}
                        {formatCount(book.wordCount)}字
                      </p>
                    </div>
                    <div className="book-consents">
                      <span>
                        <CheckCircle2 size={14} />
                        权利已确认
                      </span>
                      <span className={book.cloudConsent ? "" : "muted"}>
                        <CheckCircle2 size={14} />
                        {book.cloudConsent ? "允许脱敏上云" : "仅本地分析"}
                      </span>
                    </div>
                  </div>
                  <div className="research-book-action">
                    <Badge
                      tone={
                        book.status === "已拆解"
                          ? "success"
                          : book.status === "失败"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {book.status}
                    </Badge>
                    {book.status === "已拆解" && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          setAnalyses(await api.listResearchAnalyses(book.id));
                          setAnalysisBook(book);
                        }}
                      >
                        查看分层
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      disabled={busyBook !== null}
                      onClick={() => requestDeconstruct(book)}
                      icon={
                        busyBook === book.id ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Lightbulb size={16} />
                        )
                      }
                    >
                      {book.status === "已拆解" ? "重新拆解" : "生成洞察"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<BookCopy />}
              title="研究库为空"
              description="导入你有权使用的样本材料，系统会先预览切章结果。"
              action={
                <Button onClick={chooseFile} icon={<FileInput size={17} />}>
                  导入样本
                </Button>
              }
            />
          )}
        </section>
      )}

      {tab === "脱敏洞察" && (
        <section className="section-band">
          {insights.length ? (
            <div className="insight-grid">
              {insights.map((insight) => (
                <article className="insight-item" key={insight.id}>
                  <div className="insight-top">
                    <Badge tone="accent">{insight.genre}</Badge>
                    <Badge
                      tone={
                        insight.confidence === "高"
                          ? "success"
                          : insight.confidence === "中"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {insight.confidence}可信度
                    </Badge>
                  </div>
                  <h3>{insight.name}</h3>
                  <dl>
                    <div>
                      <dt>读者需求</dt>
                      <dd>{insight.audienceNeed}</dd>
                    </div>
                    <div>
                      <dt>冲突发动机</dt>
                      <dd>{insight.conflictEngine}</dd>
                    </div>
                    <div>
                      <dt>长篇能力</dt>
                      <dd>{insight.longFormEngine}</dd>
                    </div>
                    <div>
                      <dt>市场空位</dt>
                      <dd>{insight.marketGap}</dd>
                    </div>
                  </dl>
                  <footer>
                    {insight.evidenceCount} 个章节证据 ·{" "}
                    {formatDate(insight.createdAt)}
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Lightbulb />}
              title="还没有脱敏洞察"
              description="完成样本拆书后，抽象结构结论会出现在这里。"
            />
          )}
        </section>
      )}

      {tab === "商业知识" && (
        <section className="section-band knowledge-base">
          <div className="section-heading">
            <div>
              <h2>中国网文商业拆解</h2>
              <p>版本 {COMMERCIAL_KNOWLEDGE_VERSION}</p>
            </div>
            <Badge tone="success">已用于拆书与写作</Badge>
          </div>
          <div className="knowledge-loop">
            <BookOpenText size={19} />
            <span>读者承诺</span>
            <i>→</i>
            <span>具体压力</span>
            <i>→</i>
            <span>主动行动</span>
            <i>→</i>
            <span>情绪回报</span>
            <i>→</i>
            <span>影响发酵</span>
            <i>→</i>
            <span>续读问题</span>
          </div>
          <div className="genre-knowledge-grid">
            {GENRES.map((genre) => {
              const plugin = GENRE_PLUGINS[genre];
              return (
                <article key={genre}>
                  <div>
                    <Badge tone="accent">{genre}</Badge>
                    <small>{plugin.id}</small>
                  </div>
                  <h3>{plugin.readerPromise}</h3>
                  <dl>
                    <div>
                      <dt>子类型</dt>
                      <dd>
                        {plugin.subtypes.map((item) => item.name).join("、")}
                      </dd>
                    </div>
                    <div>
                      <dt>回报阶梯</dt>
                      <dd>{plugin.rewardLadder.join(" → ")}</dd>
                    </div>
                    <div>
                      <dt>扩张轴</dt>
                      <dd>{plugin.expansionAxes.join("；")}</dd>
                    </div>
                    <div>
                      <dt>疲劳识别</dt>
                      <dd>
                        {plugin.fatigueRules
                          .map((item) => item.name)
                          .join("、")}
                      </dd>
                    </div>
                    <div>
                      <dt>专属账本</dt>
                      <dd>
                        {plugin.ledgerTemplates
                          .map((item) => item.label)
                          .join("、")}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          <div className="knowledge-source-list">
            {COMMERCIAL_KNOWLEDGE_SOURCES.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <Badge
                    tone={
                      source.authority === "平台官方" ? "accent" : "neutral"
                    }
                  >
                    {source.authority}
                  </Badge>
                  <strong>{source.title}</strong>
                  <small>{source.appliesTo}</small>
                </span>
                <ExternalLink size={15} />
              </a>
            ))}
          </div>
          <p className="knowledge-boundary">
            平台官方方法用于确定分析维度；作者经验只作观察提示。字数和看点密度不作为机械门禁，创作契约、人物动机、事实与知识边界始终优先。
          </p>
        </section>
      )}

      {rankingModal && (
        <Modal title="导入榜单 CSV" onClose={() => setRankingModal(false)}>
          <div className="form-stack">
            <Field label="榜单名称">
              <Input
                value={rankingName}
                onChange={(event) => setRankingName(event.target.value)}
              />
            </Field>
            <Field
              label="CSV 内容"
              hint="支持字段：排名、书名、作者、题材、字数、状态、标签、链接"
            >
              <Textarea
                rows={12}
                value={rankingCsv}
                onChange={(event) => setRankingCsv(event.target.value)}
                placeholder="排名,书名,作者,题材,字数,状态\n1,示例书名,作者,都市脑洞,100万,连载"
              />
            </Field>
            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => setRankingModal(false)}
              >
                取消
              </Button>
              <Button
                disabled={!rankingCsv.trim()}
                onClick={async () => {
                  try {
                    await api.importRankingCsv(rankingCsv, rankingName);
                    setRankingModal(false);
                    setRankingCsv("");
                    await reload();
                    notify("榜单快照已保存");
                  } catch (error) {
                    notify(String(error), "error");
                  }
                }}
              >
                保存快照
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {publicModal && (
        <Modal title="采集番茄公开榜单" onClose={() => setPublicModal(false)}>
          <div className="form-stack">
            <div className="form-grid fanqie-ranking-filters">
            <Field label="频道">
              <Select
                value={fanqieGender}
                onChange={(event) => selectFanqieRanking(event.target.value as FanqieGender, fanqieRankKind, "")}
              >
                <option>男频</option>
                <option>女频</option>
              </Select>
            </Field>
            <Field label="榜型">
              <Select
                value={fanqieRankKind}
                onChange={(event) => selectFanqieRanking(fanqieGender, event.target.value as FanqieRankKind, fanqieCategoryId)}
              >
                <option>阅读榜</option>
                <option>新书榜</option>
              </Select>
            </Field>
            <Field label="题材">
              <Select
                value={fanqieCategoryId}
                onChange={(event) => selectFanqieRanking(fanqieGender, fanqieRankKind, event.target.value)}
              >
                {fanqieCategories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </Field>
            </div>
            <Field label="榜单名称">
              <Input
                value={rankingName}
                onChange={(event) => setRankingName(event.target.value)}
              />
            </Field>
            <p className="inline-warning">
              每次最多读取前 20 本的公开元数据与官方链接。系统不下载正文，不携带 Cookie，也不绕过登录、验证或访问限制。
            </p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setPublicModal(false)}>
                取消
              </Button>
              <Button
                disabled={!/^https?:\/\//.test(publicUrl)}
                onClick={async () => {
                  try {
                    const snapshot = await api.capturePublicRanking(
                      publicUrl,
                      rankingName,
                    );
                    setPublicModal(false);
                    await reload();
                    notify(
                      snapshot.status !== "失败"
                        ? `已采集 ${snapshot.entries.length} 条公开书目`
                        : `采集失败已记录：${snapshot.error}`,
                      snapshot.status !== "失败" ? "success" : "error",
                    );
                  } catch (error) {
                    notify(String(error), "error");
                  }
                }}
              >
                开始采集
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {scheduleModal && (
        <Modal title="定时采集番茄榜单" onClose={() => setScheduleModal(false)} width={720}>
          <div className="form-stack">
            <div className="schedule-create-row">
              <span><strong>{rankingName}</strong><small>{publicUrl}</small></span>
              <Select value={scheduleFrequency} onChange={(event) => setScheduleFrequency(event.target.value as RankingCaptureSchedule["frequency"])}>
                <option>每日</option><option>每周</option>
              </Select>
              <Button onClick={async () => {
                try {
                  await api.saveRankingSchedule({ url: publicUrl, listName: rankingName, frequency: scheduleFrequency, enabled: true });
                  await reload();
                  notify("定时采榜任务已保存");
                } catch (error) { notify(String(error), "error"); }
              }}>添加任务</Button>
            </div>
            <p className="inline-warning">仅在桌面应用运行时检查任务；失败会记录并顺延到下一周期，不会绕过验证或访问限制。</p>
            <div className="ranking-schedule-list">
              {rankingSchedules.length ? rankingSchedules.map((schedule) => (
                <article key={schedule.id}>
                  <div><strong>{schedule.listName}</strong><small>{schedule.frequency} · 下次 {formatDate(schedule.nextRunAt, true)}</small>{schedule.lastError && <small className="error-text">{schedule.lastError}</small>}</div>
                  <Badge tone={schedule.lastStatus === "成功" ? "success" : schedule.lastStatus === "失败" ? "danger" : "neutral"}>{schedule.lastStatus}</Badge>
                  <label className="schedule-toggle" title={schedule.enabled ? "暂停任务" : "启用任务"}>
                    <input type="checkbox" checked={schedule.enabled} onChange={async (event) => {
                      try {
                        await api.saveRankingSchedule({ id: schedule.id, url: schedule.url, listName: schedule.listName, frequency: schedule.frequency, enabled: event.target.checked });
                        await reload();
                      } catch (error) { notify(String(error), "error"); }
                    }} />
                    <span>{schedule.enabled ? "运行中" : "已暂停"}</span>
                  </label>
                  <button className="icon-button" title="立即运行" aria-label="立即运行" onClick={async () => {
                    try { await api.runRankingSchedule(schedule.id); await reload(); notify("榜单任务已运行"); }
                    catch (error) { notify(String(error), "error"); }
                  }}><Play size={15} /></button>
                  <button className="icon-button" title="删除任务" aria-label="删除任务" onClick={async () => {
                    try { await api.deleteRankingSchedule(schedule.id); await reload(); }
                    catch (error) { notify(String(error), "error"); }
                  }}><Trash2 size={15} /></button>
                </article>
              )) : <p className="muted-line">还没有定时任务。上方会按当前频道、榜型和题材创建任务。</p>}
            </div>
          </div>
        </Modal>
      )}

      {pasteModal && (
        <Modal title="粘贴样本文本" onClose={() => setPasteModal(false)}>
          <div className="form-stack">
            <Field label="样本文本">
              <Textarea
                rows={16}
                value={pastedText}
                onChange={(event) => setPastedText(event.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setPasteModal(false)}>
                取消
              </Button>
              <Button
                disabled={pastedText.trim().length < 20}
                onClick={() => {
                  const chapters = splitPastedText(pastedText);
                  setPreview({
                    fileName: "粘贴样本",
                    sourceType: "粘贴",
                    detectedEncoding: "浏览器文本",
                    chapters,
                    totalWords: chapters.reduce(
                      (sum, item) => sum + item.wordCount,
                      0,
                    ),
                    warnings:
                      chapters.length === 1 ? ["未识别到标准章节标题"] : [],
                  });
                  setPasteModal(false);
                }}
              >
                预览切章
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal
          title="确认样本导入"
          onClose={() => setPreview(null)}
          width={760}
        >
          <div className="import-preview">
            <div className="preview-summary">
              <span>
                <strong>{preview.fileName}</strong>
                <small>
                  {preview.sourceType} · {preview.detectedEncoding}
                </small>
              </span>
              <span>
                <strong>{preview.chapters.length} 章</strong>
                <small>{formatCount(preview.totalWords)} 字</small>
              </span>
            </div>
            {preview.warnings.map((warning) => (
              <p className="inline-warning" key={warning}>
                {warning}
              </p>
            ))}
            <div className="chapter-preview">
              {preview.chapters.slice(0, 8).map((chapter, index) => (
                <div key={`${chapter.title}-${index}`}>
                  <span>{index + 1}</span>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.wordCount} 字</small>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <Field label="题材">
                <Select
                  value={genre}
                  onChange={(event) => setGenre(event.target.value as Genre)}
                >
                  {GENRES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={rights}
                onChange={(event) => setRights(event.target.checked)}
              />
              <span>我确认拥有该材料的合法使用权</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={cloud}
                onChange={(event) => setCloud(event.target.checked)}
              />
              <span>允许本地脱敏后按章发送给已配置的云模型</span>
            </label>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setPreview(null)}>
                取消
              </Button>
              <Button disabled={!rights} onClick={commitImport}>
                导入研究隔离区
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {analysisBook && (
        <Modal
          title={`${analysisBook.title} · 四层拆解证据`}
          onClose={() => setAnalysisBook(null)}
          width={820}
        >
          <div className="analysis-counts">
            {(["章节", "十章阶段", "分卷", "全书"] as const).map((layer) => (
              <div key={layer}>
                <strong>
                  {analyses.filter((item) => item.layer === layer).length}
                </strong>
                <span>{layer}</span>
              </div>
            ))}
          </div>
          <div className="analysis-list">
            {analyses.length ? (
              analyses
                .filter(
                  (item) => item.layer !== "章节" || item.fromChapter <= 20,
                )
                .map((item) => (
                  <details key={item.id} open={item.layer === "全书"}>
                    <summary>
                      <Badge
                        tone={
                          item.layer === "全书"
                            ? "accent"
                            : item.layer === "分卷"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {item.layer}
                      </Badge>
                      <strong>
                        第{item.fromChapter}–{item.toChapter}章
                      </strong>
                      <span>
                        {item.confidence}可信度 · {item.evidenceChapters.length}
                        条证据
                      </span>
                    </summary>
                    <p>{item.findings}</p>
                  </details>
                ))
            ) : (
              <p className="muted-line">
                浏览器预览不包含原始研究记录；桌面版拆解后会显示完整证据层。
              </p>
            )}
          </div>
        </Modal>
      )}
      {pendingDeconstruct &&
        aiSettings &&
        (() => {
          const inputTokens = Math.ceil(pendingDeconstruct.wordCount / 1.7);
          const outputTokens =
            pendingDeconstruct.chapterCount * 500 +
            Math.ceil(pendingDeconstruct.chapterCount / 10) * 900 +
            Math.ceil(pendingDeconstruct.chapterCount / 100) * 1200;
          const cost =
            (inputTokens / 1_000_000) * aiSettings.inputPricePerMillion +
            (outputTokens / 1_000_000) * aiSettings.outputPricePerMillion;
          return (
            <Modal
              title="确认云端拆书任务"
              onClose={() => setPendingDeconstruct(null)}
            >
              <div className="cost-preview">
                <div>
                  <span>样本规模</span>
                  <strong>
                    {pendingDeconstruct.chapterCount}章 ·{" "}
                    {formatCount(pendingDeconstruct.wordCount)}字
                  </strong>
                </div>
                <div>
                  <span>预计输入</span>
                  <strong>{formatCount(inputTokens)} tokens</strong>
                </div>
                <div>
                  <span>预计输出</span>
                  <strong>{formatCount(outputTokens)} tokens</strong>
                </div>
                <div>
                  <span>估算费用</span>
                  <strong>
                    {aiSettings.inputPricePerMillion ||
                    aiSettings.outputPricePerMillion
                      ? `¥${cost.toFixed(2)}`
                      : "未填写模型单价"}
                  </strong>
                </div>
              </div>
              <p className="inline-warning">
                任务按章脱敏，分十章阶段、分卷和全书逐层汇总。实际用量由模型分词与输出长度决定，不设强制费用上限。
              </p>
              <div className="modal-actions">
                <Button
                  variant="secondary"
                  onClick={() => setPendingDeconstruct(null)}
                >
                  取消
                </Button>
                <Button
                  onClick={() => {
                    const book = pendingDeconstruct;
                    setPendingDeconstruct(null);
                    void deconstruct(book);
                  }}
                >
                  确认执行
                </Button>
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}
