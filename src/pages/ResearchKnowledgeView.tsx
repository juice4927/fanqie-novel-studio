import { BookOpenText, ExternalLink } from "lucide-react";
import { Badge } from "../components/UI";
import { COMMERCIAL_KNOWLEDGE_SOURCES, COMMERCIAL_KNOWLEDGE_VERSION } from "../shared/commercial-knowledge";
import { GENRE_PLUGINS } from "../shared/genre-plugins";
import { GENRES } from "../shared/types";
import styles from "./ResearchPage.module.css";

export function ResearchKnowledgeView() {
  return (
    <section className="section-band knowledge-base">
      <div className="section-heading">
        <div>
          <h2>中国网文商业拆解</h2>
          <p>版本 {COMMERCIAL_KNOWLEDGE_VERSION}</p>
        </div>
        <Badge tone="success">已用于拆书与写作</Badge>
      </div>
      <div className={styles.knowledgeLoop}>
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
      <div className={styles.genreKnowledgeGrid}>
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
                  <dd>{plugin.subtypes.map((item) => item.name).join("、")}</dd>
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
                  <dd>{plugin.fatigueRules.map((item) => item.name).join("、")}</dd>
                </div>
                <div>
                  <dt>专属账本</dt>
                  <dd>{plugin.ledgerTemplates.map((item) => item.label).join("、")}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className={styles.knowledgeSourceList}>
        {COMMERCIAL_KNOWLEDGE_SOURCES.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
            <span>
              <Badge tone={source.authority === "平台官方" ? "accent" : "neutral"}>{source.authority}</Badge>
              <strong>{source.title}</strong>
              <small>{source.appliesTo}</small>
            </span>
            <ExternalLink size={15} />
          </a>
        ))}
      </div>
      <p className={styles.knowledgeBoundary}>
        平台官方方法用于确定分析维度；作者经验只作观察提示。字数和看点密度不作为机械门禁，创作契约、人物动机、事实与知识边界始终优先。
      </p>
    </section>
  );
}
