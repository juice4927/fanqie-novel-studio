import {
  BookCopy,
  CheckCircle2,
  FileInput,
  Lightbulb,
  LoaderCircle,
} from "lucide-react";
import type { ResearchBook } from "../shared/types";
import { Badge, Button, EmptyState } from "../components/UI";
import { formatCount } from "../lib/format";

interface ResearchBooksViewProps {
  books: ResearchBook[];
  busyBookId: string | null;
  onChooseFile: () => Promise<void>;
  onOpenAnalysis: (book: ResearchBook) => Promise<void>;
  onRequestDeconstruct: (book: ResearchBook) => Promise<void>;
}

export function ResearchBooksView({
  books,
  busyBookId,
  onChooseFile,
  onOpenAnalysis,
  onRequestDeconstruct,
}: ResearchBooksViewProps) {
  return (
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
                    {book.sourceType} · {book.chapterCount} 章 · {formatCount(book.wordCount)}字
                  </p>
                </div>
                <div className="book-consents">
                  <span>
                    <CheckCircle2 size={14} />
                    {book.sourceType === "公开试读" ? (book.sampleScope ?? "官方公开开篇样本") : "权利已确认"}
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
                    onClick={() => onOpenAnalysis(book)}
                  >
                    查看分层
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busyBookId !== null}
                  onClick={() => onRequestDeconstruct(book)}
                  icon={
                    busyBookId === book.id ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Lightbulb size={16} />
                    )
                  }
                >
                  {busyBookId === book.id ? "流式拆书中" : book.status === "已拆解" ? "重新拆解" : "生成洞察"}
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
            <Button onClick={onChooseFile} icon={<FileInput size={17} />}>
              导入样本
            </Button>
          }
        />
      )}
    </section>
  );
}
