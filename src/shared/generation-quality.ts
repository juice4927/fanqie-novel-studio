export type GenerationDecisionAction = "adopted" | "reverted";

export interface GenerationDecision {
  chapterId: string;
  action: GenerationDecisionAction;
  at: string;
}

export type ReviewTier = "scrutiny" | "balanced" | "sample";

export interface GenerationQuality {
  total: number;
  adopted: number;
  reverted: number;
  revertRate: number;
  tier: ReviewTier;
}

const DEFAULT_WINDOW = 20;
const MIN_SAMPLE = 5;

export function computeGenerationQuality(
  decisions: readonly GenerationDecision[],
  window = DEFAULT_WINDOW,
): GenerationQuality {
  const recent = decisions.slice(-window);
  const adopted = recent.filter((item) => item.action === "adopted").length;
  const reverted = recent.filter((item) => item.action === "reverted").length;
  const total = recent.length;
  const revertRate = total ? reverted / total : 0;
  let tier: ReviewTier;
  if (total < MIN_SAMPLE) tier = "scrutiny";
  else if (revertRate >= 0.4) tier = "scrutiny";
  else if (revertRate > 0.15) tier = "balanced";
  else tier = "sample";
  return { total, adopted, reverted, revertRate, tier };
}

export function reviewTierLabel(tier: ReviewTier): string {
  if (tier === "scrutiny") return "建议逐章细审（打回率偏高或样本不足）";
  if (tier === "balanced") return "可扫读 + 按风险抽查";
  return "质量稳定，可只看摘要与异常";
}
