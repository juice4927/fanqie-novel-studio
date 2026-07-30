import type { MetricSnapshot, ReviewSuggestion } from "./types";

function average(items: MetricSnapshot[], key: "exposure" | "reads" | "retention" | "follows") {
  return items.length ? items.reduce((sum, item) => sum + item[key], 0) / items.length : 0;
}

export function analyzeMetrics(metrics: MetricSnapshot[]): ReviewSuggestion[] {
  const ordered = [...metrics].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (ordered.length < 2) return [{ id: "data-volume", category: "数据质量", observation: "当前指标不足两个时间点。", recommendation: "继续收集至少一周数据后再判断趋势，不据单点数据改纲。", evidence: `${ordered.length} 个时间点`, confidence: "低" }];
  const split = Math.max(1, Math.floor(ordered.length / 2));
  const before = ordered.slice(0, split);
  const after = ordered.slice(split);
  const suggestions: ReviewSuggestion[] = [];
  const retentionChange = average(after, "retention") - average(before, "retention");
  const readChange = average(before, "reads") ? (average(after, "reads") / average(before, "reads") - 1) * 100 : 0;
  const followRateBefore = average(before, "reads") ? average(before, "follows") / average(before, "reads") * 100 : 0;
  const followRateAfter = average(after, "reads") ? average(after, "follows") / average(after, "reads") * 100 : 0;
  if (retentionChange <= -3) suggestions.push({ id: "retention-drop", category: "节奏", observation: "后半段平均留存较前半段下降。", recommendation: "复核下降时间点附近的目标兑现、信息增量和章末推动力，先提交近期章纲变更单。", evidence: `留存变化 ${retentionChange.toFixed(1)} 个百分点`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (readChange < -15 && average(after, "exposure") >= average(before, "exposure") * .9) suggestions.push({ id: "read-drop", category: "开篇", observation: "曝光相对稳定但阅读下降。", recommendation: "检查书名、简介和最近发布章节的入口承诺是否一致，不直接归因于单章。", evidence: `阅读变化 ${readChange.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (followRateAfter + .5 < followRateBefore) suggestions.push({ id: "follow-drop", category: "章纲", observation: "阅读到追读的转化走低。", recommendation: "检查未来五章是否连续兑现核心承诺，并减少重复冲突。", evidence: `追读率 ${followRateBefore.toFixed(1)}% → ${followRateAfter.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (!suggestions.length) suggestions.push({ id: "stable", category: "数据质量", observation: "当前数据未出现达到规则阈值的明显变化。", recommendation: "保持现有规划，继续按周记录；不要因小幅波动改动终局或卷目标。", evidence: `${ordered.length} 个时间点`, confidence: ordered.length >= 7 ? "中" : "低" });
  return suggestions;
}
