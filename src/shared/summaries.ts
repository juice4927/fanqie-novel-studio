import type { Chapter, PlanNode, StorySummary } from "./types";

const CHANGE_WORDS =
  /死亡|牺牲|受伤|恢复|突破|晋级|获得|失去|交出|夺回|离开|抵达|加入|退出|决裂|和解|暴露|揭露|发现|得知|承诺|约定|怀疑|决定|失败|成功/;
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
  const stateChanges = unique(
    all.filter((item) => CHANGE_WORDS.test(item)),
    4,
  );
  const unresolved = unique(
    all
      .filter((item) => OPEN_WORDS.test(item))
      .slice(-8)
      .reverse(),
    4,
  ).reverse();
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

interface FinalizedChapterSummaryProject {
  chapters: readonly Chapter[];
  plans: readonly PlanNode[];
  summaries: readonly StorySummary[];
}

export function prepareFinalizedChapterSummaries(
  project: FinalizedChapterSummaryProject,
  chapter: Chapter,
  updatedAt: string,
): StorySummary[] {
  const summaries = new Map(project.summaries.map((summary) => [summary.id, summary]));
  const updates: StorySummary[] = [];
  const save = (summary: Omit<StorySummary, "version" | "updatedAt">) => {
    const previous = summaries.get(summary.id);
    const next: StorySummary = {
      ...summary,
      version: (previous?.version ?? 0) + 1,
      updatedAt,
    };
    summaries.set(next.id, next);
    updates.push(next);
  };
  const chapters = project.chapters.some((item) => item.id === chapter.id)
    ? project.chapters.map((item) => (item.id === chapter.id ? chapter : item))
    : [...project.chapters, chapter];
  const finalized = chapters.filter((item) => ["已定稿", "待发布", "已发布"].includes(item.status));

  chapter.content
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((scene, index) => {
      save({
        id: `scene:${chapter.id}:${index + 1}`,
        layer: "场景",
        title: `第${chapter.number}章·场景${index + 1}`,
        fromChapter: chapter.number,
        toChapter: chapter.number,
        content: scene.slice(0, 220),
      });
    });
  save({
    id: `chapter:${chapter.id}`,
    layer: "章节",
    title: `第${chapter.number}章 ${chapter.title}`,
    fromChapter: chapter.number,
    toChapter: chapter.number,
    content: buildChapterSummary(chapter),
  });

  const stageStart = Math.floor((chapter.number - 1) / 10) * 10 + 1;
  const stageEnd = stageStart + 9;
  const stageItems = [...summaries.values()].filter(
    (item) => item.layer === "章节" && item.fromChapter >= stageStart && item.fromChapter <= stageEnd,
  );
  save({
    id: `stage:${stageStart}`,
    layer: "十章阶段",
    title: `第${stageStart}–${stageEnd}章`,
    fromChapter: stageStart,
    toChapter: Math.max(...stageItems.map((item) => item.toChapter), chapter.number),
    content: aggregateStorySummaries(stageItems, 6000),
  });

  const volumes = project.plans
    .filter((plan) => plan.kind === "分卷" && plan.status === "已批准")
    .sort((left, right) => left.ordinal - right.ordinal);
  let cursor = 1;
  for (const volume of volumes) {
    const estimatedChapters = Math.max(1, Math.ceil(volume.targetWords / 2500));
    const end = cursor + estimatedChapters - 1;
    if (chapter.number >= cursor && chapter.number <= end) {
      const items = [...summaries.values()].filter(
        (item) => item.layer === "十章阶段" && item.fromChapter >= cursor && item.fromChapter <= end,
      );
      save({
        id: `volume:${volume.id}`,
        layer: "分卷",
        title: volume.title,
        fromChapter: cursor,
        toChapter: Math.min(end, Math.max(...finalized.map((item) => item.number))),
        content: `分卷目标：${volume.goal}\n${aggregateStorySummaries(items, 10000 - volume.goal.length - 6)}`,
      });
      break;
    }
    cursor = end + 1;
  }

  const stages = [...summaries.values()].filter((item) => item.layer === "十章阶段");
  save({
    id: "book",
    layer: "全书",
    title: "全书进展摘要",
    fromChapter: 1,
    toChapter: Math.max(...finalized.map((item) => item.number)),
    content: aggregateStorySummaries(stages, 16000),
  });
  return updates;
}

export function buildLongTermMemory(summaries: readonly StorySummary[], chapterNumber: number, maxCharacters = 12000) {
  const bounded = (content: string, budget: number) =>
    content.length <= budget
      ? content
      : `${content.slice(0, Math.floor(budget * 0.35))}\n…\n${content.slice(-Math.floor(budget * 0.65))}`;
  const book = summaries.find((summary) => summary.layer === "全书");
  const volume = summaries
    .filter(
      (summary) =>
        summary.layer === "分卷" && summary.fromChapter <= chapterNumber && summary.toChapter >= chapterNumber,
    )
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
    ...stages.map(
      (summary) => `【近期阶段 ${summary.fromChapter}-${summary.toChapter}】\n${bounded(summary.content, stageBudget)}`,
    ),
  ].filter(Boolean);
  const output = sections.join("\n");
  return output.slice(0, maxCharacters);
}
