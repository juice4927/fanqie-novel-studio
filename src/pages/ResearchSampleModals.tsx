import { LoaderCircle, ScanText } from "lucide-react";
import type {
  AiSettings,
  Genre,
  ImportPreview,
  RankingEntry,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../shared/types";
import { GENRES } from "../shared/types";
import { Badge, Button, Field, Modal, Select, Textarea } from "../components/UI";
import { formatCount } from "../lib/format";
import {
  estimateCjkTextTokens,
  TOKEN_ESTIMATE_WARNING,
} from "../shared/token-estimator";

function splitPastedText(text: string): ImportPreview["chapters"] {
  const pattern =
    /^\s*(第[0-9零〇一二三四五六七八九十百千万两]+[章节回]\s*[^\n]{0,40})\s*$/gm;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) {
    return [
      {
        title: "正文",
        content: text.trim(),
        wordCount: text.replace(/\s/g, "").length,
      },
    ];
  }
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

function buildPastedPreview(text: string): ImportPreview {
  const chapters = splitPastedText(text);
  return {
    fileName: "粘贴样本",
    sourceType: "粘贴",
    detectedEncoding: "浏览器文本",
    chapters,
    totalWords: chapters.reduce((sum, item) => sum + item.wordCount, 0),
    warnings: chapters.length === 1 ? ["未识别到标准章节标题"] : [],
  };
}

interface PublicSampleModalProps {
  entry: RankingEntry | null;
  cloudConsent: boolean;
  reading: boolean;
  onCloudConsentChange: (value: boolean) => void;
  onClose: () => void;
  onImportAndDeconstruct: () => void;
}

function PublicSampleModal({
  entry,
  cloudConsent,
  reading,
  onCloudConsentChange,
  onClose,
  onImportAndDeconstruct,
}: PublicSampleModalProps) {
  if (!entry) return null;
  return (
    <Modal
      title="读取公开前10章并拆书"
      onClose={() => !reading && onClose()}
    >
      <div className="form-stack">
        <div className="source-preview">
          <ScanText size={20} />
          <span>
            <strong>{entry.title}</strong>
            <small>{entry.author} · 番茄小说官方公开试读</small>
          </span>
        </div>
        <p className="inline-warning">
          只读取官方详情页公开的第1至第10章。遇到登录、付费、验证或正文无法可靠识别时立即停止；结论仅代表开篇样本。
        </p>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={cloudConsent}
            onChange={(event) => onCloudConsentChange(event.target.checked)}
          />
          <span>允许将这10章正文发送到已配置的 AI 进行语义拆书</span>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" disabled={reading} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={reading}
            icon={
              reading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ScanText size={16} />
              )
            }
            onClick={onImportAndDeconstruct}
          >
            {reading ? "正在读取" : "读取并拆书"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PasteSampleModalProps {
  open: boolean;
  text: string;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onPreview: (preview: ImportPreview) => void;
}

export function PasteSampleModal({
  open,
  text,
  onTextChange,
  onClose,
  onPreview,
}: PasteSampleModalProps) {
  if (!open) return null;
  return (
    <Modal title="粘贴样本文本" onClose={onClose}>
      <div className="form-stack">
        <Field label="样本文本">
          <Textarea
            rows={16}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={text.trim().length < 20}
            onClick={() => onPreview(buildPastedPreview(text))}
          >
            预览切章
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ImportPreviewModalProps {
  preview: ImportPreview | null;
  genre: Genre;
  rightsConfirmed: boolean;
  cloudConsent: boolean;
  onGenreChange: (value: Genre) => void;
  onRightsConfirmedChange: (value: boolean) => void;
  onCloudConsentChange: (value: boolean) => void;
  onClose: () => void;
  onCommit: () => void;
}

function ImportPreviewModal({
  preview,
  genre,
  rightsConfirmed,
  cloudConsent,
  onGenreChange,
  onRightsConfirmedChange,
  onCloudConsentChange,
  onClose,
  onCommit,
}: ImportPreviewModalProps) {
  if (!preview) return null;
  return (
    <Modal title="确认样本导入" onClose={onClose} width={760}>
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
              onChange={(event) => onGenreChange(event.target.value as Genre)}
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
            checked={rightsConfirmed}
            onChange={(event) =>
              onRightsConfirmedChange(event.target.checked)
            }
          />
          <span>我确认拥有该材料的合法使用权</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={cloudConsent}
            onChange={(event) => onCloudConsentChange(event.target.checked)}
          />
          <span>允许本地脱敏后按章发送给已配置的云模型</span>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!rightsConfirmed} onClick={onCommit}>
            导入研究隔离区
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ResearchAnalysisModalProps {
  book: ResearchBook | null;
  analyses: ResearchAnalysisRecord[];
  onClose: () => void;
}

function ResearchAnalysisModal({
  book,
  analyses,
  onClose,
}: ResearchAnalysisModalProps) {
  if (!book) return null;
  return (
    <Modal title={`${book.title} · 四层拆解证据`} onClose={onClose} width={820}>
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
            .filter((item) => item.layer !== "章节" || item.fromChapter <= 20)
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
  );
}

interface CloudDeconstructModalProps {
  book: ResearchBook | null;
  aiSettings: AiSettings | null;
  onClose: () => void;
  onConfirm: () => void;
}

function CloudDeconstructModal({
  book,
  aiSettings,
  onClose,
  onConfirm,
}: CloudDeconstructModalProps) {
  if (!book || !aiSettings) return null;
  const inputTokens = estimateCjkTextTokens(book.wordCount);
  const outputTokens =
    book.chapterCount * 500 +
    Math.ceil(book.chapterCount / 10) * 900 +
    Math.ceil(book.chapterCount / 100) * 1200;
  const cost =
    (inputTokens / 1_000_000) * aiSettings.inputPricePerMillion +
    (outputTokens / 1_000_000) * aiSettings.outputPricePerMillion;
  return (
    <Modal title="确认云端拆书任务" onClose={onClose}>
      <div className="cost-preview">
        <div>
          <span>样本规模</span>
          <strong>
            {book.chapterCount}章 · {formatCount(book.wordCount)}字
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
            {aiSettings.inputPricePerMillion || aiSettings.outputPricePerMillion
              ? `¥${cost.toFixed(2)}`
              : "未填写模型单价"}
          </strong>
        </div>
      </div>
      <p className="inline-warning">
        {TOKEN_ESTIMATE_WARNING}。任务按章脱敏，分十章阶段、分卷和全书逐层汇总。实际用量由模型分词与输出长度决定，不设强制费用上限。
      </p>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onConfirm}>确认执行</Button>
      </div>
    </Modal>
  );
}

export interface ResearchSampleModalsProps {
  publicSampleModal: PublicSampleModalProps;
  pasteModal: PasteSampleModalProps;
  importPreviewModal: ImportPreviewModalProps;
  analysisModal: ResearchAnalysisModalProps;
  cloudDeconstructModal: CloudDeconstructModalProps;
}

export function ResearchSampleModals({
  publicSampleModal,
  pasteModal,
  importPreviewModal,
  analysisModal,
  cloudDeconstructModal,
}: ResearchSampleModalsProps) {
  return (
    <>
      <PublicSampleModal {...publicSampleModal} />
      <PasteSampleModal {...pasteModal} />
      <ImportPreviewModal {...importPreviewModal} />
      <ResearchAnalysisModal {...analysisModal} />
      <CloudDeconstructModal {...cloudDeconstructModal} />
    </>
  );
}
