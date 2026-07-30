import { describe, expect, it } from "vitest";
import { sanitizeResearchBatch, sanitizeResearchText } from "../electron/ai-service";

describe("research text sanitization", () => {
  it("redacts identifying metadata and stable entities before cloud analysis", () => {
    const source = "作者：某作者\n沈砚说道，他刚从云港市回来。《第七码头》记录了电话 13812345678 和 https://example.test/a。";
    const sanitized = sanitizeResearchText(source);
    expect(sanitized).not.toContain("某作者");
    expect(sanitized).not.toContain("沈砚");
    expect(sanitized).not.toContain("云港市");
    expect(sanitized).not.toContain("第七码头");
    expect(sanitized).not.toContain("13812345678");
    expect(sanitized).not.toContain("example.test");
    expect(sanitized).toContain("<角色1>");
    expect(sanitized).toContain("<地点组织1>");
  });

  it("redacts names in ordinary sentences and keeps placeholders stable across chapters", () => {
    const sanitized = sanitizeResearchBatch([
      { content: "大家都认识沈砚。沈砚，你终于从云港市回来了。" },
      { content: "第二天，沈砚去了云港市。" },
    ]);
    expect(sanitized.join("\n")).not.toContain("沈砚");
    expect(sanitized.join("\n")).not.toContain("云港市");
    expect(sanitized[0].match(/<角色1>/g)?.length).toBe(2);
    expect(sanitized[1]).toContain("<角色1>");
    expect(sanitized[0]).toContain("<地点组织1>");
    expect(sanitized[1]).toContain("<地点组织1>");
  });
});
