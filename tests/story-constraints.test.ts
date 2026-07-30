import { describe, expect, it } from "vitest";
import { assertNoHardStoryConstraint, evaluateStoryConstraints, parseStoryNumber } from "../src/shared/story-constraints";
import type { LedgerFact } from "../src/shared/types";

const fact = (value: Partial<LedgerFact> & Pick<LedgerFact, "id" | "kind" | "subject" | "predicate" | "value">): LedgerFact => ({
  validFromChapter: 1,
  validToChapter: null,
  evidenceChapter: 1,
  confidence: "已确认",
  knowledgeScope: "公开",
  updatedAt: "2026-07-30T00:00:00.000Z",
  ...value,
});

describe("story constraints", () => {
  it("parses Arabic and common Chinese quantities", () => {
    expect(parseStoryNumber("50枚")).toBe(50);
    expect(parseStoryNumber("八十枚灵石")).toBe(80);
    expect(parseStoryNumber("一百二十块")).toBe(120);
    expect(parseStoryNumber("一万零三十")).toBe(10030);
  });

  it("blocks unresolved and overlapping confirmed state", () => {
    const findings = evaluateStoryConstraints([
      fact({ id: "a", kind: "能力", subject: "沈砚", predicate: "境界", value: "筑基三层" }),
      fact({ id: "b", kind: "能力", subject: "沈砚", predicate: "境界", value: "金丹一层" }),
      fact({ id: "c", kind: "地点", subject: "陆青", predicate: "所在地点", value: "京城", confidence: "有冲突" }),
    ], { number: 20, outline: "沈砚准备出发" });

    expect(findings.filter((item) => item.severity === "硬性")).toHaveLength(2);
    expect(() => assertNoHardStoryConstraint(findings)).toThrow("写前状态约束未通过");
  });

  it("blocks explicit overspending and warns on restricted secrets", () => {
    const findings = evaluateStoryConstraints([
      fact({ id: "money", kind: "资源", subject: "沈砚", predicate: "灵石余额", value: "五十枚灵石" }),
      fact({ id: "secret", kind: "秘密", subject: "皇帝中毒", predicate: "真相", value: "慢性乌头毒", knowledgeScope: "太医、皇后" }),
    ], { number: 8, outline: "沈砚支付八十枚灵石买下丹炉，并调查慢性乌头毒" });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "资源守恒", severity: "硬性" }),
      expect.objectContaining({ category: "知识边界", severity: "警告" }),
    ]));
  });

  it("does not guess conflicts from ordinary prose", () => {
    const findings = evaluateStoryConstraints([
      fact({ id: "money", kind: "资源", subject: "许棠", predicate: "现金余额", value: "五十元" }),
    ], { number: 3, outline: "许棠核对订单后去运输队谈合作" });
    expect(findings).toEqual([]);
  });
});
