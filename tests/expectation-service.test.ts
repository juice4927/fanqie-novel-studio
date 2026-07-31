import { describe, expect, it } from "vitest";
import { prepareExpectationSave } from "../src/shared/expectation-service";
import type { ExpectationEntry } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function expectation(
  overrides: Partial<ExpectationEntry> = {},
): ExpectationEntry {
  return {
    id: "expectation-1",
    title: "确认红伞女孩身份",
    description: "解释她为何能听见回声",
    sourceChapter: 2,
    expectedPayoffChapter: 8,
    actualPayoffChapter: null,
    status: "待兑现",
    payoffResult: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("expectation save rules", () => {
  it("normalizes text and assigns persistence metadata", () => {
    const savedAt = "2026-08-01T01:00:00.000Z";
    const candidate = {
      ...expectation({
        id: "",
        title: "  新期待  ",
        description: "  新描述  ",
      }),
      createdAt: undefined,
    };
    const saved = prepareExpectationSave(
      undefined,
      candidate,
      {
        expectationId: "expectation-new",
        createdAt: savedAt,
        updatedAt: savedAt,
      },
    );

    expect(saved).toMatchObject({
      id: "expectation-new",
      title: "新期待",
      description: "新描述",
      createdAt: savedAt,
      updatedAt: savedAt,
    });
  });

  it("preserves the original creation time when updating", () => {
    const previous = expectation();
    const saved = prepareExpectationSave(
      previous,
      expectation({ createdAt: "2026-08-01T00:00:00.000Z" }),
      {
        expectationId: previous.id,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T01:00:00.000Z",
      },
    );

    expect(saved.createdAt).toBe(previous.createdAt);
    expect(saved.updatedAt).toBe("2026-08-02T01:00:00.000Z");
  });

  it.each([
    [expectation({ title: "   " }), "期待标题不能为空"],
    [
      expectation({ sourceChapter: 8, expectedPayoffChapter: 7 }),
      "预计兑现章不能早于提出章",
    ],
    [
      expectation({ status: "已兑现", actualPayoffChapter: null }),
      "已兑现期待必须填写实际兑现章",
    ],
  ])("rejects invalid expectation state", (candidate, message) => {
    expect(() =>
      prepareExpectationSave(undefined, candidate, {
        expectationId: candidate.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow(message);
  });
});
