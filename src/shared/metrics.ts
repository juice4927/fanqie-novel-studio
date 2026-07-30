import Papa from "papaparse";
import type { MetricSnapshot, ReviewSuggestion } from "./types";

const metricAliases = {
  chapterNumber: ["章节", "章节号", "chapter", "chapterNumber"],
  recordedAt: ["日期", "记录时间", "date", "recordedAt"],
  exposure: ["曝光", "exposure"],
  clicks: ["点击", "点击阅读", "clicks"],
  reads: ["阅读", "阅读人数", "reads"],
  firstChapterCompletion: ["首章读完", "首章完读率", "firstChapterCompletion"],
  threeChapterRetention: ["三章留存", "threeChapterRetention"],
  retention: ["留存", "阶段留存", "retention"],
  follows: ["追读", "追更", "follows"],
  bookshelfAdds: ["加书架", "书架", "bookshelfAdds"],
  revenue: ["收益", "revenue"],
  comments: ["评论摘要", "评论", "comments"],
} as const;

function csvValue(row: Record<string, string>, aliases: readonly string[], fallback = "") {
  for (const alias of aliases) {
    const key = Object.keys(row).find((candidate) => candidate.trim().toLowerCase() === alias.toLowerCase());
    if (key && row[key] !== undefined && row[key] !== "") return row[key].trim();
  }
  return fallback;
}

function csvNumber(value: string) {
  const parsed = Number(value.replace(/[,%￥¥\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvOptionalPercent(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(/[%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseMetricsCsv(csvText: string, createId: () => string = () => crypto.randomUUID()): MetricSnapshot[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
  return parsed.data.map((row) => ({
    id: createId(),
    chapterNumber: csvNumber(csvValue(row, metricAliases.chapterNumber)) || null,
    recordedAt: csvValue(row, metricAliases.recordedAt, new Date().toISOString()),
    exposure: csvNumber(csvValue(row, metricAliases.exposure)),
    clicks: csvNumber(csvValue(row, metricAliases.clicks)),
    reads: csvNumber(csvValue(row, metricAliases.reads)),
    firstChapterCompletion: csvOptionalPercent(csvValue(row, metricAliases.firstChapterCompletion)),
    threeChapterRetention: csvOptionalPercent(csvValue(row, metricAliases.threeChapterRetention)),
    retention: csvNumber(csvValue(row, metricAliases.retention)),
    follows: csvNumber(csvValue(row, metricAliases.follows)),
    bookshelfAdds: csvNumber(csvValue(row, metricAliases.bookshelfAdds)),
    revenue: csvNumber(csvValue(row, metricAliases.revenue)),
    comments: csvValue(row, metricAliases.comments),
  }));
}

function average(items: MetricSnapshot[], key: "exposure" | "reads" | "retention" | "follows") {
  return items.length ? items.reduce((sum, item) => sum + item[key], 0) / items.length : 0;
}

function averageOptional(items: MetricSnapshot[], key: "firstChapterCompletion" | "threeChapterRetention") {
  const values = items.map((item) => item[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizeMetrics(metrics: MetricSnapshot[]) {
  const total = metrics.reduce((sum, item) => ({
    exposure: sum.exposure + item.exposure,
    clicks: sum.clicks + (item.clicks ?? 0),
    reads: sum.reads + item.reads,
    follows: sum.follows + item.follows,
    bookshelfAdds: sum.bookshelfAdds + (item.bookshelfAdds ?? 0),
    revenue: sum.revenue + item.revenue,
  }), { exposure: 0, clicks: 0, reads: 0, follows: 0, bookshelfAdds: 0, revenue: 0 });
  return {
    ...total,
    clickRate: total.exposure ? total.clicks / total.exposure * 100 : null,
    validReadRate: total.clicks ? total.reads / total.clicks * 100 : null,
    firstChapterCompletion: averageOptional(metrics, "firstChapterCompletion"),
    threeChapterRetention: averageOptional(metrics, "threeChapterRetention"),
    followRate: total.reads ? total.follows / total.reads * 100 : null,
    bookshelfRate: total.reads ? total.bookshelfAdds / total.reads * 100 : null,
  };
}

export function analyzeMetrics(metrics: MetricSnapshot[]): ReviewSuggestion[] {
  const ordered = [...metrics].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (ordered.length < 2) return [{ id: "data-volume", category: "数据质量", observation: "当前指标不足两个时间点。", recommendation: "继续收集至少一周数据后再判断趋势，不据单点数据改纲。", evidence: `${ordered.length} 个时间点`, confidence: "低" }];
  const split = Math.max(1, Math.floor(ordered.length / 2));
  const before = ordered.slice(0, split);
  const after = ordered.slice(split);
  const suggestions: ReviewSuggestion[] = [];
  const funnel = summarizeMetrics(ordered);
  if (funnel.clickRate !== null && funnel.clickRate < 10) suggestions.push({ id: "click-rate", category: "简介", observation: "曝光到点击的入口转化偏低。", recommendation: "先核对书名、封面和简介是否向同一目标读者承诺同一种核心幻想，不改正文主线。", evidence: `点击率 ${funnel.clickRate.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (funnel.firstChapterCompletion !== null && funnel.firstChapterCompletion < 35) suggestions.push({ id: "chapter-one", category: "开篇", observation: "首章读完率偏低。", recommendation: "复核首章是否尽早落下主角目标、具体压力、主动行动和首次可见反馈。", evidence: `首章读完率 ${funnel.firstChapterCompletion.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (funnel.threeChapterRetention !== null && funnel.threeChapterRetention < 25) suggestions.push({ id: "three-chapter", category: "转化", observation: "三章留存偏低。", recommendation: "检查前三章是否完成一次完整承诺与回报循环，并建立清晰的下一阶段目标。", evidence: `三章留存 ${funnel.threeChapterRetention.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (funnel.bookshelfRate !== null && funnel.bookshelfRate < 5) suggestions.push({ id: "bookshelf", category: "转化", observation: "阅读到加书架的转化偏低。", recommendation: "检查当前免费阅读段是否形成稳定的长线承诺，而不是只完成一次性反转。", evidence: `加书架率 ${funnel.bookshelfRate.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  const retentionChange = average(after, "retention") - average(before, "retention");
  const readChange = average(before, "reads") ? (average(after, "reads") / average(before, "reads") - 1) * 100 : 0;
  const followRateBefore = average(before, "reads") ? average(before, "follows") / average(before, "reads") * 100 : 0;
  const followRateAfter = average(after, "reads") ? average(after, "follows") / average(after, "reads") * 100 : 0;
  if (retentionChange <= -3) {
    const weakest = [...after].filter((item) => item.chapterNumber !== null).sort((a, b) => a.retention - b.retention)[0];
    suggestions.push({ id: "retention-drop", category: "节奏", observation: "后半段平均留存较前半段下降。", recommendation: `复核${weakest?.chapterNumber ? `第${weakest.chapterNumber}章附近` : "下降时间点附近"}的目标兑现、信息增量和章末推动力，先提交近期章纲变更单。`, evidence: `留存变化 ${retentionChange.toFixed(1)} 个百分点`, confidence: ordered.length >= 7 ? "中" : "低" });
  }
  if (readChange < -15 && average(after, "exposure") >= average(before, "exposure") * .9) suggestions.push({ id: "read-drop", category: "开篇", observation: "曝光相对稳定但阅读下降。", recommendation: "检查书名、简介和最近发布章节的入口承诺是否一致，不直接归因于单章。", evidence: `阅读变化 ${readChange.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (followRateAfter + .5 < followRateBefore) suggestions.push({ id: "follow-drop", category: "章纲", observation: "阅读到追读的转化走低。", recommendation: "检查未来五章是否连续兑现核心承诺，并减少重复冲突。", evidence: `追读率 ${followRateBefore.toFixed(1)}% → ${followRateAfter.toFixed(1)}%`, confidence: ordered.length >= 7 ? "中" : "低" });
  if (!suggestions.length) suggestions.push({ id: "stable", category: "数据质量", observation: "当前数据未出现达到规则阈值的明显变化。", recommendation: "保持现有规划，继续按周记录；不要因小幅波动改动终局或卷目标。", evidence: `${ordered.length} 个时间点`, confidence: ordered.length >= 7 ? "中" : "低" });
  return suggestions;
}
