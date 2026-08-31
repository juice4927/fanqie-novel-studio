import { describe, expect, it } from "vitest";
import {
  AI_JOB_STATUSES,
  CHANGE_REQUEST_STATUSES,
  CHAPTER_STATUSES,
  CONTRACT_STATUSES,
  EXPECTATION_STATUSES,
  PLAN_STATUSES,
  PROJECT_STATUSES,
  QUALITY_SEVERITIES,
  QUALITY_STATUSES,
  RESEARCH_BOOK_STATUSES,
  REVIEW_EXPERIMENT_STATUSES,
  SCHEDULE_STATUSES,
} from "../src/shared/status-constants";
import type { ChapterStatus, ProjectStatus } from "../src/shared/types";

describe("status constants", () => {
  const groups = [
    PROJECT_STATUSES,
    CHAPTER_STATUSES,
    CONTRACT_STATUSES,
    PLAN_STATUSES,
    SCHEDULE_STATUSES,
    CHANGE_REQUEST_STATUSES,
    QUALITY_SEVERITIES,
    QUALITY_STATUSES,
    EXPECTATION_STATUSES,
    REVIEW_EXPERIMENT_STATUSES,
    AI_JOB_STATUSES,
    RESEARCH_BOOK_STATUSES,
  ];

  it.each(groups.map((group, index) => [index, group]))("status group %i is non-empty and unique", (_index, group) => {
    expect(group.length).toBeGreaterThan(0);
    expect(new Set(group).size).toBe(group.length);
  });

  it("ProjectStatus derives from the canonical project statuses", () => {
    const statuses: ProjectStatus[] = PROJECT_STATUSES;
    expect(statuses).toContain("连载中");
    expect(statuses).toContain("归档");
  });

  it("ChapterStatus derives from the canonical chapter statuses", () => {
    const statuses: ChapterStatus[] = CHAPTER_STATUSES;
    expect(statuses).toContain("已定稿");
    expect(statuses).toContain("待发布");
  });

  it("quality severities include the hard-gate level", () => {
    expect(QUALITY_SEVERITIES).toContain("硬性");
  });
});
