import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApi } from "../src/lib/browser-api";

const capturedAt = "2026-07-31T08:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(capturedAt);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser ranking workflow", () => {
  it("uses the shared CSV parser for quoted fields and Chinese units", async () => {
    const api = createBrowserApi();
    const snapshot = await api.importRankingCsv(
      [
        "排名,书名,作者,题材,字数,状态,标签,链接",
        '1,"城,市回声",林舟,都市脑洞,1.2万,连载,"悬疑,成长",https://example.com/book',
      ].join("\n"),
      "测试榜",
    );

    expect(snapshot).toMatchObject({
      source: "CSV 手动导入",
      capturedAt,
      status: "成功",
      entries: [
        {
          rank: 1,
          title: "城,市回声",
          words: 12_000,
          tags: ["悬疑", "成长"],
          sourceUrl: "https://example.com/book",
        },
      ],
    });
    expect(snapshot.entries[0].snapshotId).toBe(snapshot.id);
    expect((await api.listRankings())[0]).toEqual(snapshot);
  });
});
