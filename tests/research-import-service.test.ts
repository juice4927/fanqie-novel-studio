import { describe, expect, it, vi } from "vitest";
import { prepareLocalResearchBook } from "../src/shared/research-import-service";
import type { ImportPreview } from "../src/shared/types";

function createPreview(fileName: string): ImportPreview {
  return {
    fileName,
    sourceType: "TXT",
    detectedEncoding: "UTF-8",
    chapters: [
      { title: "第一章", content: "开篇", wordCount: 2 },
      { title: "第二章", content: "推进", wordCount: 2 },
    ],
    totalWords: 4,
    warnings: [],
  };
}

describe("local research book preparation", () => {
  it.each([
    ["C:\\samples\\旧城回声.txt", "旧城回声"],
    ["/samples/旧城回声.tar.gz", "旧城回声.tar"],
    [".手稿", ".手稿"],
  ])("normalizes the title from %s", (fileName, title) => {
    const book = prepareLocalResearchBook(
      createPreview(fileName),
      "都市脑洞",
      true,
      false,
      {
        createId: () => "book-1",
        currentTimestamp: () => "2026-07-31T00:00:00.000Z",
      },
    );

    expect(book).toMatchObject({
      id: "book-1",
      title,
      genre: "都市脑洞",
      sourceType: "TXT",
      chapterCount: 2,
      wordCount: 4,
      rightsConfirmed: true,
      cloudConsent: false,
      importedAt: "2026-07-31T00:00:00.000Z",
      status: "待拆解",
    });
  });

  it("rejects unauthorized material before allocating metadata", () => {
    const createId = vi.fn(() => "book-1");
    const currentTimestamp = vi.fn(() => "2026-07-31T00:00:00.000Z");

    expect(() =>
      prepareLocalResearchBook(
        createPreview("sample.txt"),
        "都市脑洞",
        false,
        false,
        { createId, currentTimestamp },
      ),
    ).toThrow("必须确认拥有材料的合法使用权");
    expect(createId).not.toHaveBeenCalled();
    expect(currentTimestamp).not.toHaveBeenCalled();
  });
});
