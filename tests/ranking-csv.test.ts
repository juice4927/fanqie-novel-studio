import { describe, expect, it } from "vitest";
import { parseRankingCsv } from "../src/shared/ranking-csv";

function options() {
  let sequence = 0;
  return {
    createId: () => `ranking-${++sequence}`,
    capturedAt: "2026-07-31T08:00:00.000Z",
  };
}

describe("ranking CSV parser", () => {
  it("supports reordered English headers, blank rows, and stable ownership", () => {
    const snapshot = parseRankingCsv(
      [
        "title,rank,words,tags,sourceUrl,status,author,genre",
        'Example,2,"1,234","悬疑、成长",https://example.com/book,连载,Author,都市脑洞',
        "",
      ].join("\n"),
      "English list",
      options(),
    );

    expect(snapshot).toMatchObject({
      id: "ranking-1",
      capturedAt: "2026-07-31T08:00:00.000Z",
      status: "成功",
      entries: [
        {
          id: "ranking-2",
          snapshotId: "ranking-1",
          rank: 2,
          title: "Example",
          words: 1_234,
          tags: ["悬疑", "成长"],
        },
      ],
    });
  });

  it("reports recoverable row shape errors as a partial success", () => {
    const snapshot = parseRankingCsv("rank,title\n1,Example,unexpected", "Malformed list", options());

    expect(snapshot.status).toBe("部分成功");
    expect(snapshot.error).toBeTruthy();
    expect(snapshot.entries).toHaveLength(1);
  });

  it("parses decorated Chinese units and rejects unsafe links", () => {
    const snapshot = parseRankingCsv(
      "书名,字数,链接\n甲,约1.2万,javascript:alert(1)\n乙,1.5亿,https://example.com/book",
      "单位",
      options(),
    );
    expect(snapshot.entries.map((entry) => entry.words)).toEqual([12_000, 150_000_000]);
    expect(snapshot.entries.map((entry) => entry.sourceUrl)).toEqual(["", "https://example.com/book"]);
  });
});
