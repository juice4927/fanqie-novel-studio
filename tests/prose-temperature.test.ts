import { describe, expect, it } from "vitest";
import { analyzeProseTemperature } from "../src/shared/prose-temperature";

describe("prose temperature analysis", () => {
  it("flags long report-like prose with little embodied or sensory response", () => {
    const reportLike = "沈青禾翻开田册，逐项核对田亩与户数，随后把结果记入新册。".repeat(70);

    const metrics = analyzeProseTemperature(reportLike);

    expect(metrics.characters).toBeGreaterThan(1200);
    expect(metrics.lowTemperature).toBe(true);
  });

  it("keeps restrained prose acceptable when people and senses carry the impact", () => {
    const embodied =
      "雨声砸在破瓦上，沈青禾攥紧湿冷的衣角，喉咙发紧。老人扶起孩子，眼泪落下来，却还是把最后半袋米递了回去。".repeat(
        45,
      );

    const metrics = analyzeProseTemperature(embodied);

    expect(metrics.characters).toBeGreaterThan(1200);
    expect(metrics.embodiedEmotionPerThousand).toBeGreaterThan(2.5);
    expect(metrics.lowTemperature).toBe(false);
  });

  it("uses the current project's target temperature instead of one global threshold", () => {
    const moderatelyCool = `${"沈青禾翻开田册，逐项核对田亩与户数，随后把结果记入新册。".repeat(70)}她攥紧手指，胸口发紧。窗外传来雨声，冷风掠过窗纸。`;

    expect(analyzeProseTemperature(moderatelyCool, "冷峻").lowTemperature).toBe(false);
    expect(analyzeProseTemperature(moderatelyCool, "热烈").lowTemperature).toBe(true);
  });
});
