import { describe, expect, it } from "vitest";
import {
  compileAestheticGuidance,
  normalizeAestheticProfile,
} from "../src/shared/aesthetic-profile";

describe("project aesthetic profile", () => {
  it("keeps legacy projects neutral instead of assigning a house style", () => {
    const normalized = normalizeAestheticProfile();
    const guidance = compileAestheticGuidance();

    expect(normalized).toMatchObject({
      narrativeDistance: "适中",
      emotionalTemperature: "均衡",
    });
    expect(guidance).toContain("尚未指定专项审美");
    expect(guidance).toContain("不套用清冷、热烈");
  });

  it("compiles distinct instructions for different books", () => {
    const cold = compileAestheticGuidance({
      ...normalizeAestheticProfile(),
      narrativeDistance: "远距",
      emotionalTemperature: "冷峻",
      proseTexture: "坚硬、简短",
      emotionalExpression: "不解释内心，以行动余波呈现",
    });
    const warm = compileAestheticGuidance({
      ...normalizeAestheticProfile(),
      narrativeDistance: "贴身",
      emotionalTemperature: "热烈",
      proseTexture: "明快、有生活气",
      emotionalExpression: "允许直接而饱满的情绪流动",
    });

    expect(cold).toContain("情绪温度：冷峻");
    expect(cold).toContain("冷峻不等于人物没有反应");
    expect(cold).toContain("叙事距离：远距");
    expect(warm).toContain("情绪温度：热烈");
    expect(warm).toContain("鲜明反应、直接关系碰撞");
    expect(warm).toContain("叙事距离：贴身");
    expect(cold).not.toBe(warm);
  });
});
