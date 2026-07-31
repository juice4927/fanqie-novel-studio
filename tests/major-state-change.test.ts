import { describe, expect, it } from "vitest";
import { findMajorStateChange, resolveMajorStateKeywords } from "../src/shared/major-state-change";

describe("major state changes", () => {
  it("shares generic gates across genres", () => {
    expect(findMajorStateChange("主角身份揭露，局势逆转", "都市脑洞")).toBe("身份揭露");
  });

  it("adds genre-specific gates", () => {
    expect(findMajorStateChange("两人在雨夜正式分手", "现言甜宠")).toBe("分手");
    expect(findMajorStateChange("老祖渡劫失败", "玄幻/仙侠")).toBe("渡劫");
    expect(findMajorStateChange("两人在雨夜正式分手", "玄幻/仙侠")).toBeUndefined();
  });

  it("supports literal additions and exclusions", () => {
    const rules = { include: ["灵根[碎裂]", "分手"], exclude: ["离婚", "分手"] };
    expect(resolveMajorStateKeywords("现言甜宠", rules)).not.toContain("分手");
    expect(findMajorStateChange("本章发生离婚", "现言甜宠", rules)).toBeUndefined();
    expect(findMajorStateChange("灵根[碎裂]成为事实", "现言甜宠", rules)).toBe("灵根[碎裂]");
  });
});
