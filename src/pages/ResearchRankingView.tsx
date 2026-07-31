import { BarChart3, ExternalLink, Link2, TrendingUp } from "lucide-react";
import type {
  RankingAnalytics,
  RankingEntry,
  RankingSnapshot,
} from "../shared/types";
import { Badge, Button, EmptyState } from "../components/UI";
import { formatCount, formatDate } from "../lib/format";
import styles from "./ResearchPage.module.css";

interface ResearchRankingViewProps {
  analytics: RankingAnalytics | null;
  rankings: RankingSnapshot[];
  onOpenPublicSample: (snapshot: RankingSnapshot, entry: RankingEntry) => void;
  onOpenPublicRanking: () => void;
}

export function ResearchRankingView({
  analytics,
  rankings,
  onOpenPublicSample,
  onOpenPublicRanking,
}: ResearchRankingViewProps) {
  return (
    <section className="section-band">
      {analytics && (
        <div className={styles.rankingAnalytics}>
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
          <div className={styles.analyticsWide}>
            <small>数据范围</small>
            <strong>{analytics.timeRange}</strong>
          </div>
        </div>
      )}
      {analytics?.marketOpportunities.length ? (
        <div className={styles.marketOpportunityPanel}>
          <div className="section-heading">
            <div>
              <h2>榜单趋势与立项机会</h2>
              <p>按同一番茄榜单的连续快照估算动能与竞争，仅作选题证据，不替代人工判断。</p>
            </div>
          </div>
          <div className={styles.marketOpportunityGrid}>
            {analytics.marketOpportunities.slice(0, 6).map((opportunity) => (
              <article key={opportunity.listName}>
                <div className={styles.opportunityHead}>
                  <div><Badge tone="accent">{opportunity.genre}</Badge><strong>{opportunity.categoryName}</strong></div>
                  <span
                    className={`${styles.opportunityScore} ${opportunity.opportunityScore === null ? styles.isBaseline : ""}`}
                  >
                    {opportunity.opportunityScore ?? "--"}
                  </span>
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
          <div className={styles.snapshot} key={snapshot.id}>
            <div className={styles.snapshotHead}>
              <span>
                <strong>{snapshot.listName}</strong>
                <small>
                  {snapshot.source} · {formatDate(snapshot.capturedAt, true)}
                </small>
              </span>
              <Badge tone={snapshot.status === "成功" ? "success" : "warning"}>
                {snapshot.status}
              </Badge>
            </div>
            <div className="data-table">
              <div className={`data-head ${styles.rankingGrid}`}>
                <span>排名</span>
                <span>书名</span>
                <span>题材</span>
                <span>字数</span>
                <span>状态</span>
                <span>官方页</span>
              </div>
              {snapshot.entries.slice(0, 20).map((entry) => (
                <div className={`data-row ${styles.rankingGrid}`} key={entry.id}>
                  <span className={styles.rankNumber}>{entry.rank}</span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.author}</small>
                  </span>
                  <span>{entry.genre}</span>
                  <span>{formatCount(entry.words)}</span>
                  <span>{entry.status}</span>
                  <span className={styles.rankingLinks}>
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
                    {entry.sourceUrl && entry.platform === "番茄小说" && (
                      <button
                        className={styles.linkButton}
                        type="button"
                        onClick={() => onOpenPublicSample(snapshot, entry)}
                        title="读取官方公开前10章并拆书"
                      >
                        拆前10章
                      </button>
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
            <Button onClick={onOpenPublicRanking} icon={<Link2 size={17} />}>
              采集番茄榜单
            </Button>
          }
        />
      )}
    </section>
  );
}
