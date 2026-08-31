import type { ExpectationEntry } from "./types";

interface PrepareExpectationSaveOptions {
  expectationId: string;
  createdAt: string;
  updatedAt: string;
}

export type ExpectationSaveCandidate = Omit<ExpectationEntry, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<ExpectationEntry, "id" | "createdAt" | "updatedAt">>;

export function prepareExpectationSave(
  previous: ExpectationEntry | undefined,
  candidate: ExpectationSaveCandidate,
  options: PrepareExpectationSaveOptions,
): ExpectationEntry {
  const next: ExpectationEntry = {
    ...candidate,
    id: options.expectationId,
    title: candidate.title.trim(),
    description: candidate.description.trim(),
    createdAt: previous?.createdAt ?? candidate.createdAt ?? options.createdAt,
    updatedAt: options.updatedAt,
  };
  if (!next.title) throw new Error("期待标题不能为空");
  if (next.expectedPayoffChapter !== null && next.expectedPayoffChapter < next.sourceChapter) {
    throw new Error("预计兑现章不能早于提出章");
  }
  if (next.status === "已兑现" && !next.actualPayoffChapter) {
    throw new Error("已兑现期待必须填写实际兑现章");
  }
  return next;
}
