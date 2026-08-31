import { describe, expect, it } from "vitest";
import { prepareFactSave } from "../src/shared/fact-service";
import type { LedgerFact } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: "fact-current",
    kind: "地点",
    subject: "林舟",
    predicate: "所在地",
    value: "北京",
    validFromChapter: 1,
    validToChapter: null,
    evidenceChapter: 1,
    confidence: "已确认",
    knowledgeScope: "公开",
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("fact save rules", () => {
  it("ends a matching active fact only after its replacement is confirmed", () => {
    const current = fact();
    const candidate = fact({
      id: "candidate",
      value: "上海",
      validFromChapter: 8,
      evidenceChapter: 8,
      confidence: "待确认",
      replacesFactId: current.id,
    });

    const pending = prepareFactSave([current], candidate, {
      factId: candidate.id,
      updatedAt: "2026-08-01T01:00:00.000Z",
    });
    expect(pending.fact.confidence).toBe("待确认");
    expect(pending.replacement).toBeUndefined();

    const confirmedAt = "2026-08-01T02:00:00.000Z";
    const confirmed = prepareFactSave(
      [current],
      { ...candidate, confidence: "已确认" },
      { factId: candidate.id, updatedAt: confirmedAt },
    );
    expect(confirmed.fact.confidence).toBe("已确认");
    expect(confirmed.replacement).toEqual({
      ...current,
      validToChapter: 7,
      updatedAt: confirmedAt,
    });
    expect(current.validToChapter).toBeNull();
  });

  it("does not end a fact with a different subject or predicate", () => {
    const current = fact();
    const prepared = prepareFactSave(
      [current],
      fact({
        id: "candidate",
        subject: "苏晚",
        value: "上海",
        validFromChapter: 8,
        evidenceChapter: 8,
        replacesFactId: current.id,
      }),
      { factId: "candidate", updatedAt: timestamp },
    );

    expect(prepared.replacement).toBeUndefined();
    expect(prepared.fact.confidence).toBe("已确认");
  });

  it("marks overlapping open values as conflicts but permits closed history", () => {
    const current = fact();
    const active = prepareFactSave([current], fact({ id: "active", value: "上海", validFromChapter: 2 }), {
      factId: "active",
      updatedAt: timestamp,
    });
    const historical = prepareFactSave(
      [current],
      fact({
        id: "historical",
        value: "上海",
        validFromChapter: 2,
        validToChapter: 3,
      }),
      { factId: "historical", updatedAt: timestamp },
    );

    expect(active.fact.confidence).toBe("有冲突");
    expect(historical.fact.confidence).toBe("已确认");
  });

  it("keeps ignored candidates out of conflicts", () => {
    const ignored = prepareFactSave([fact()], fact({ id: "ignored", value: "上海", confidence: "已忽略" }), {
      factId: "ignored",
      updatedAt: timestamp,
    });

    expect(ignored.fact.confidence).toBe("已忽略");
    expect(ignored.replacement).toBeUndefined();
    const replacement = prepareFactSave([fact({ confidence: "已忽略" })], fact({ id: "new", value: "上海" }), {
      factId: "new",
      updatedAt: timestamp,
    });
    expect(replacement.fact.confidence).toBe("已确认");
  });
});
