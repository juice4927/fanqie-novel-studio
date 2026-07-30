import type { RankingCaptureSchedule, RankingSnapshot } from "./types";

export function nextRankingRun(frequency: RankingCaptureSchedule["frequency"], from = new Date()) {
  const days = frequency === "每日" ? 1 : 7;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function completeRankingSchedule(
  schedule: RankingCaptureSchedule,
  snapshot: RankingSnapshot,
  from = new Date(),
): RankingCaptureSchedule {
  return {
    ...schedule,
    lastRunAt: snapshot.capturedAt,
    nextRunAt: nextRankingRun(schedule.frequency, from),
    lastStatus: snapshot.status,
    lastError: snapshot.error,
  };
}

export function failRankingSchedule(
  schedule: RankingCaptureSchedule,
  error: unknown,
  from = new Date(),
): RankingCaptureSchedule {
  return {
    ...schedule,
    lastRunAt: from.toISOString(),
    nextRunAt: nextRankingRun(schedule.frequency, from),
    lastStatus: "失败",
    lastError: error instanceof Error ? error.message : String(error),
  };
}
