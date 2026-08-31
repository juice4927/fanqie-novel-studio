// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResearchBooksView } from "../src/pages/ResearchBooksView";
import { ResearchInsightsView } from "../src/pages/ResearchInsightsView";
import { ResearchKnowledgeView } from "../src/pages/ResearchKnowledgeView";
import { RankingImportModal } from "../src/pages/ResearchRankingModals";
import { ResearchRankingView } from "../src/pages/ResearchRankingView";
import { PasteSampleModal } from "../src/pages/ResearchSampleModals";
import type { InsightPack, ResearchBook } from "../src/shared/types";

const book: ResearchBook = {
  id: "book-1",
  title: "公开样本",
  author: "作者",
  genre: "都市脑洞",
  sourceType: "公开试读",
  sampleScope: "官方公开前10章",
  chapterCount: 10,
  wordCount: 20_000,
  rightsConfirmed: false,
  cloudConsent: true,
  importedAt: "2026-07-31T00:00:00.000Z",
  status: "已拆解",
};

describe("research tab views", () => {
  it("routes the empty ranking action through its semantic callback", async () => {
    const onOpenPublicRanking = vi.fn();
    render(
      <ResearchRankingView
        analytics={null}
        rankings={[]}
        onOpenPublicSample={vi.fn()}
        onOpenPublicRanking={onOpenPublicRanking}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "采集番茄榜单" }));
    expect(onOpenPublicRanking).toHaveBeenCalledOnce();
  });

  it("routes book analysis and deconstruction without owning workflow state", async () => {
    const onOpenAnalysis = vi.fn(async () => {});
    const onRequestDeconstruct = vi.fn(async () => {});
    render(
      <ResearchBooksView
        books={[book]}
        busyBookId={null}
        onChooseFile={vi.fn(async () => {})}
        onOpenAnalysis={onOpenAnalysis}
        onRequestDeconstruct={onRequestDeconstruct}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "查看分层" }));
    await userEvent.click(screen.getByRole("button", { name: "重新拆解" }));
    expect(onOpenAnalysis).toHaveBeenCalledWith(book);
    expect(onRequestDeconstruct).toHaveBeenCalledWith(book);
  });

  it("renders insight and commercial knowledge tabs independently", () => {
    const insight = {
      id: "insight-1",
      name: "关系代价",
      genre: "都市脑洞",
      audienceNeed: "持续兑现能力代价",
      openingPromise: "开篇明确规则",
      conflictEngine: "救人与遗忘互相拉扯",
      emotionalRhythm: "递进",
      retentionDevices: "关系悬念",
      longFormEngine: "规则和组织逐层扩张",
      marketGap: "现实关系反馈",
      risks: "避免重复",
      evidenceCount: 10,
      confidence: "中",
      createdAt: "2026-07-31T00:00:00.000Z",
    } satisfies InsightPack;
    const { rerender } = render(<ResearchInsightsView insights={[insight]} />);
    expect(screen.getByText("关系代价")).toBeTruthy();

    rerender(<ResearchKnowledgeView />);
    expect(screen.getByText("中国网文商业拆解")).toBeTruthy();
  });
});

describe("research workflow modals", () => {
  it("keeps the CSV import action behind a non-empty payload", async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <RankingImportModal
        open
        rankingName="番茄男频阅读榜·都市脑洞"
        rankingCsv=""
        onRankingNameChange={vi.fn()}
        onRankingCsvChange={vi.fn()}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect((screen.getByRole("button", { name: "保存快照" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <RankingImportModal
        open
        rankingName="番茄男频阅读榜·都市脑洞"
        rankingCsv="排名,书名\n1,样本书"
        onRankingNameChange={vi.fn()}
        onRankingCsvChange={vi.fn()}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "保存快照" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("builds the same chapter preview from pasted text", async () => {
    const onPreview = vi.fn();
    render(
      <PasteSampleModal
        open
        text={"第一章 开端\n这是第一章的正文内容。\n第二章 转折\n这是第二章的正文内容。"}
        onTextChange={vi.fn()}
        onClose={vi.fn()}
        onPreview={onPreview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "预览切章" }));
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "粘贴样本",
        sourceType: "粘贴",
        warnings: [],
        chapters: [
          expect.objectContaining({ title: "第一章 开端" }),
          expect.objectContaining({ title: "第二章 转折" }),
        ],
      }),
    );
  });
});
