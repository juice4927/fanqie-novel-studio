import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import mammoth from "mammoth";
import { XMLParser } from "fast-xml-parser";
import { load as loadHtml } from "cheerio";
import type { Chapter, Genre, ImportPreview, LedgerFact, QualityIssue, StoryContract } from "../src/shared/types";

interface WorkerRequest {
  id: string;
  task: "parse-document" | "quality-check";
  payload: unknown;
}

interface QualityPayload {
  projectId: string;
  chapter: Chapter;
  previousChapter?: Chapter;
  facts: LedgerFact[];
  contract: StoryContract;
  genre: Genre;
  originalityMatches: Array<{ researchRef: string; fingerprint: string }>;
}

function cleanText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string) {
  return [...text].filter((char) => !/\s/.test(char)).length;
}

function splitChapters(text: string) {
  const normalized = cleanText(text);
  const heading = /^\s*(第[0-9零〇一二三四五六七八九十百千万两]+[章节回]\s*[^\n]{0,40})\s*$/gm;
  const matches = [...normalized.matchAll(heading)];
  if (!matches.length) return [{ title: "正文", content: normalized, wordCount: countWords(normalized) }];
  const chapters: Array<{ title: string; content: string; wordCount: number }> = [];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    const content = cleanText(normalized.slice(start, end));
    if (content) chapters.push({ title: match[1].trim(), content, wordCount: countWords(content) });
  });
  const preface = cleanText(normalized.slice(0, matches[0].index));
  if (preface && countWords(preface) > 100) chapters.unshift({ title: "序章", content: preface, wordCount: countWords(preface) });
  return chapters;
}

async function parseTxt(filePath: string) {
  const buffer = await readFile(filePath);
  let encoding = "UTF-8";
  let text = new TextDecoder("utf-8").decode(buffer);
  const replacementRatio = (text.match(/�/g)?.length ?? 0) / Math.max(text.length, 1);
  if (replacementRatio > 0.002) {
    text = new TextDecoder("gb18030").decode(buffer);
    encoding = "GB18030";
  }
  return { text, encoding };
}

async function parseEpub(filePath: string) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const parser = new XMLParser({ ignoreAttributes: false });
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) throw new Error("EPUB 缺少 META-INF/container.xml");
  const container = parser.parse(containerXml);
  const rootfiles = container.container.rootfiles.rootfile;
  const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = rootfile["@_full-path"] as string;
  const opfXml = await zip.file(opfPath)?.async("text");
  if (!opfXml) throw new Error("EPUB 缺少内容清单");
  const packageData = parser.parse(opfXml).package;
  const manifestItems = Array.isArray(packageData.manifest.item) ? packageData.manifest.item : [packageData.manifest.item];
  const spineItems = Array.isArray(packageData.spine.itemref) ? packageData.spine.itemref : [packageData.spine.itemref];
  const manifest = new Map<string, string>(manifestItems.map((item: Record<string, string>) => [String(item["@_id"]), String(item["@_href"])]));
  const opfDirectory = path.posix.dirname(opfPath);
  const chapters: Array<{ title: string; content: string; wordCount: number }> = [];
  for (const item of spineItems) {
    const href = manifest.get(item["@_idref"]);
    if (!href) continue;
    const entryPath = path.posix.normalize(path.posix.join(opfDirectory, href));
    const html = await zip.file(entryPath)?.async("text");
    if (!html) continue;
    const $ = loadHtml(html);
    $("script, style, nav").remove();
    const title = cleanText($("h1, h2, title").first().text()) || `第${chapters.length + 1}章`;
    const content = cleanText($("body").text());
    if (countWords(content) > 20) chapters.push({ title, content, wordCount: countWords(content) });
  }
  return chapters;
}

export async function parseDocument(filePath: string): Promise<ImportPreview> {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const warnings: string[] = [];
  let chapters: ImportPreview["chapters"];
  let sourceType: ImportPreview["sourceType"];
  let detectedEncoding = "文档内部编码";
  if (extension === ".txt") {
    const result = await parseTxt(filePath);
    chapters = splitChapters(result.text);
    sourceType = "TXT";
    detectedEncoding = result.encoding;
  } else if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    chapters = splitChapters(result.value);
    sourceType = "DOCX";
    if (result.messages.length) warnings.push(...result.messages.slice(0, 3).map((item) => item.message));
  } else if (extension === ".epub") {
    chapters = await parseEpub(filePath);
    sourceType = "EPUB";
  } else {
    throw new Error("仅支持 TXT、EPUB 和 DOCX 文件");
  }
  if (chapters.length === 1) warnings.push("未识别到标准章节标题，请在导入后检查切章结果。");
  const duplicateTitles = chapters.length - new Set(chapters.map((chapter) => chapter.title)).size;
  if (duplicateTitles > 0) warnings.push(`发现 ${duplicateTitles} 个重复章节标题。`);
  return {
    fileName,
    sourceType,
    detectedEncoding,
    chapters,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    warnings,
  };
}

function repeatedPhrases(content: string) {
  const compact = content.replace(/[\s，。！？；：“”‘’、]/g, "");
  const counts = new Map<string, number>();
  for (let index = 0; index <= compact.length - 8; index += 4) {
    const phrase = compact.slice(index, index + 8);
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 4).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

export function qualityCheck(payload: QualityPayload): QualityIssue[] {
  const { projectId, chapter, previousChapter, facts, contract, genre, originalityMatches } = payload;
  const issues: QualityIssue[] = [];
  const add = (severity: QualityIssue["severity"], category: string, message: string, evidence = "") => issues.push({
    id: randomUUID(), projectId, chapterId: chapter.id, severity, category, message, evidence,
    status: "待处理", createdAt: new Date().toISOString(),
  });
  if (!chapter.title.trim()) add("硬性", "章节完整性", "章节标题不能为空");
  if (!chapter.outline.trim()) add("警告", "章纲", "当前章节没有经过章纲约束");
  if (chapter.wordCount < 1200) add("警告", "篇幅", `本章仅 ${chapter.wordCount} 字，可能不足以完成情节目标`);
  if (chapter.wordCount > 4200) add("建议", "篇幅", `本章 ${chapter.wordCount} 字，建议检查移动端阅读节奏`);
  if (chapter.content && !/[？?!！…]$/.test(chapter.content.trim())) add("建议", "章末钩子", "章末缺少明显的问题、变化或未完成动作");
  if (chapter.isKeyChapter && chapter.batchMode === "五章批次") add("硬性", "审批模式", "关键章节必须切换为逐章审批");
  for (const pattern of contract.prohibitedPatterns.filter(Boolean)) {
    if (chapter.content.includes(pattern)) add("硬性", "禁写清单", `正文命中禁写项：${pattern}`, pattern);
  }
  for (const phrase of repeatedPhrases(chapter.content)) add("建议", "重复表达", `短语“${phrase[0]}”在本章密集出现 ${phrase[1]} 次`, phrase[0]);
  for (const fact of facts.filter((item) => item.confidence === "有冲突")) {
    add("硬性", "状态账本", `${fact.subject} 的“${fact.predicate}”存在未解决冲突`, `${fact.value}（第${fact.evidenceChapter}章）`);
  }
  for (const match of originalityMatches.slice(0, 5)) {
    add(
      "硬性",
      "原创门禁",
      "正文与研究隔离库中的样本存在 24 字连续表达重合",
      `匿名研究引用 ${match.researchRef} / 指纹 ${match.fingerprint}`,
    );
  }
  if (previousChapter && chapter.content.slice(0, 80) === previousChapter.content.slice(0, 80)) add("硬性", "重复章节", "本章开头与上一章完全相同");
  const genreHints: Record<Genre, string[]> = {
    "都市脑洞": ["目标", "反馈"], "玄幻/仙侠": ["代价", "层级"], "历史/架空": ["局势", "因果"],
    "现言甜宠": ["关系", "情绪"], "古言宅斗": ["信息差", "关系"], "年代重生": ["时代", "选择"],
  };
  if (chapter.outline && !genreHints[genre].some((hint) => chapter.outline.includes(hint))) {
    add("建议", "题材规则", `章纲未明确体现${genre}常用的“${genreHints[genre].join(" / ")}”检查维度`);
  }
  return issues;
}

parentPort?.on("message", async (request: WorkerRequest) => {
  try {
    const result = request.task === "parse-document"
      ? await parseDocument(String((request.payload as { filePath: string }).filePath))
      : qualityCheck(request.payload as QualityPayload);
    parentPort?.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
