import { describe, expect, it } from "vitest";
import { captureFanqieOpeningSample } from "../electron/ranking-service";

describe.runIf(process.env.FANQIE_LIVE_TEST === "1")("Fanqie public opening sample (live)", () => {
  it("reads ten currently public opening chapters", async () => {
    const sample = await captureFanqieOpeningSample("https://fanqienovel.com/page/7623581376586976281");
    expect(sample.chapters).toHaveLength(10);
    expect(sample.chapters.map((chapter) => chapter.title)).toEqual(
      expect.arrayContaining([expect.stringContaining("第1章"), expect.stringContaining("第10章")]),
    );
    expect(sample.chapters.every((chapter) => chapter.wordCount > 500)).toBe(true);
    expect(sample.chapters.some((chapter) => /[\uE000-\uF8FF]/.test(chapter.content))).toBe(false);
    expect(sample.chapters[0].content).toContain("1955年");
  }, 30_000);
});
