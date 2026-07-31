// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResearchBooksView } from "../src/pages/ResearchBooksView";
import { ResearchInsightsView } from "../src/pages/ResearchInsightsView";
import { ResearchKnowledgeView } from "../src/pages/ResearchKnowledgeView";
import { ResearchRankingView } from "../src/pages/ResearchRankingView";
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
