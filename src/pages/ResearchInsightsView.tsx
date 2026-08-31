import { Lightbulb } from "lucide-react";
import { Badge, EmptyState } from "../components/UI";
import { formatDate } from "../lib/format";
import type { InsightPack } from "../shared/types";
import styles from "./ResearchPage.module.css";

export function ResearchInsightsView({ insights }: { insights: InsightPack[] }) {
  return (
    <section className="section-band">
      {insights.length ? (
        <div className={styles.insightGrid}>
          {insights.map((insight) => (
            <article className={styles.insightItem} key={insight.id}>
              <div className={styles.insightTop}>
                <Badge tone="accent">{insight.genre}</Badge>
                <Badge
                  tone={insight.confidence === "高" ? "success" : insight.confidence === "中" ? "warning" : "neutral"}
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
                {insight.evidenceCount} 个章节证据 · {formatDate(insight.createdAt)}
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
  );
}
