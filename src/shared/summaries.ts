import type { Chapter, StorySummary } from "./types";

const CHANGE_WORDS = /死亡|牺牲|受伤|恢复|突破|晋级|获得|失去|交出|夺回|离开|抵达|加入|退出|决裂|和解|暴露|揭露|发现|得知|承诺|约定|怀疑|决定|失败|成功/;
const OPEN_WORDS = /尚未|仍未|还没|必须|需要|准备|即将|等待|寻找|追查|怀疑|秘密|伏笔|承诺|约定|危机|威胁|问题|线索/;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sentences(value: string) {
  return value
    .split(/(?<=[。！？!?])/u)
    .map(clean)
    .filter((item) => item.length >= 6);
}

function unique(items: string[], limit: number) {
  return [...new Set(items)].slice(0, limit);
}

function outlineField(outline: string, labels: string[]) {
  for (const label of labels) {
    const match = outline.match(new RegExp(`${label}[：:]\\s*([^；;\\n]+)`));
    if (match?.[1]) return clean(match[1]);
  }
  return "未明确记录";
}

export function buildChapterSummary(chapter: Chapter) {
  const all = sentences(chapter.content);
  const stateChanges = unique(all.filter((item) => CHANGE_WORDS.test(item)), 4);
  const unresolved = unique(all.filter((item) => OPEN_WORDS.test(item)).slice(-8).reverse(), 4).reverse();
  const ending = all.slice(-2).join("") || clean(chapter.content.slice(-220)) || "无正文";
  return [
    `目标：${outlineField(chapter.outline, ["目标", "目的"])}`,
    `冲突：${outlineField(chapter.outline, ["冲突", "阻力", "障碍"])}`,
    `结果：${outlineField(chapter.outline, ["结果", "结局", "落点"])}`,
    `状态变化：${stateChanges.join("｜") || "未识别到明确状态变化"}`,
    `未解决事项：${unresolved.join("｜") || "未识别到明确未解决事项"}`,
    `章末推进：${ending}`,
  ].join("\n");
}

function summaryLine(summary: StorySummary) {
  const fields = summary.content.split("\n").filter((line) => /^(结果|状态变化|未解决事项|章末推进)：/.test(line));
  return `${summary.title}：${fields.join("；") || summary.content}`;
}

export function aggregateStorySummaries(items: StorySummary[], maxCharacters: number) {
  if (!items.length) return "暂无已定稿章节摘要";
  const budget = Math.max(200, maxCharacters);
  const lines = [...items].sort((left, right) => left.fromChapter - right.fromChapter).map(summaryLine);
  const result: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (used + line.length + 1 > budget && result.length) break;
    result.unshift(line.slice(0, budget));
    used += line.length + 1;
  }
  return result.join("\n");
}

export function buildLongTermMemory(
  summaries: readonly StorySummary[],
  chapterNumber: number,
  maxCharacters = 12000,
) {
  const bounded = (content: string, budget: number) =>
    content.length <= budget
      ? content
      : `${content.slice(0, Math.floor(budget * 0.35))}\n…\n${content.slice(-Math.floor(budget * 0.65))}`;
  const book = summaries.find((summary) => summary.layer === "全书");
  const volume = summaries
    .filter((summary) => summary.layer === "分卷" && summary.fromChapter <= chapterNumber && summary.toChapter >= chapterNumber)
    .at(-1);
  const stages = summaries
    .filter((summary) => summary.layer === "十章阶段" && summary.toChapter < chapterNumber)
    .slice(-3);
  const scale = Math.min(1, maxCharacters / 11500);
  const bookBudget = Math.max(800, Math.floor(4000 * scale));
  const volumeBudget = Math.max(600, Math.floor(3000 * scale));
  const stageBudget = Math.max(400, Math.floor(1400 * scale));
  const sections = [
    book ? `【全书进展】\n${bounded(book.content, bookBudget)}` : "【全书进展】暂无全书摘要",
    volume ? `【当前分卷记忆】\n${bounded(volume.content, volumeBudget)}` : "",
    ...stages.map((summary) => `【近期阶段 ${summary.fromChapter}-${summary.toChapter}】\n${bounded(summary.content, stageBudget)}`),
  ].filter(Boolean);
  const output = sections.join("\n");
  return output.slice(0, maxCharacters);
}
