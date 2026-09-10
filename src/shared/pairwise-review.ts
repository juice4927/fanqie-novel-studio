/**
 * 成对比较评测：同一裁判对 A/B 与 B/A 各判一次，用换序一致性抵消位置偏差
 * （Balanced Position Calibration）；长度控制胜率按字数回归残差校正，避免"更长 = 更好"。
 * 纯模块：不依赖 electron / React，也不发起网络请求。
 */

export interface DraftCandidate {
  id: string;
  text: string;
}

export interface PairwiseVerdict {
  winnerId: string;
  confidence?: number;
  rationale?: string;
}

export interface DraftPairInput {
  baseline: DraftCandidate;
  candidate: DraftCandidate;
  judge: (a: DraftCandidate, b: DraftCandidate) => Promise<PairwiseVerdict>;
}

export interface PairwiseComparison {
  winnerId: string | null;
  disagreement: boolean;
  firstVerdict: PairwiseVerdict;
  swappedVerdict: PairwiseVerdict;
}

export interface WinRatePair {
  candidateWon: boolean;
  baselineChars: number;
  candidateChars: number;
}

export interface LengthControlledWinRate {
  rawWinRate: number;
  lengthControlledWinRate: number;
  lengthAdjustment: number;
}

/** 把裁判给出的胜者映射回原始 id；同时兼容按位置作答（a/b）的裁判。 */
function resolveWinnerId(winnerId: string, a: DraftCandidate, b: DraftCandidate): string | null {
  const value = winnerId.trim();
  if (value === a.id) return a.id;
  if (value === b.id) return b.id;
  const positional = value.toLocaleLowerCase("zh-CN");
  if (positional === "a") return a.id;
  if (positional === "b") return b.id;
  return null;
}

export async function compareDrafts(input: DraftPairInput): Promise<PairwiseComparison> {
  const { baseline, candidate, judge } = input;
  const firstVerdict = await judge(baseline, candidate);
  const swappedVerdict = await judge(candidate, baseline);
  // 换序后 a/b 位置互换，胜者必须先映射回原始 id 再比较，否则会把位置偏好误判为一致。
  const firstWinnerId = resolveWinnerId(firstVerdict.winnerId, baseline, candidate);
  const swappedWinnerId = resolveWinnerId(swappedVerdict.winnerId, candidate, baseline);
  const agreed = firstWinnerId !== null && firstWinnerId === swappedWinnerId;
  return {
    winnerId: agreed ? firstWinnerId : null,
    disagreement: !agreed,
    firstVerdict,
    swappedVerdict,
  };
}

/**
 * 长度控制胜率（AlpacaEval-LC 的最小二乘简化版，不引入依赖）。
 * 对 win ~ 1 + Δchars 做普通最小二乘回归，Δchars = candidateChars - baselineChars：
 *   slope = Σ(Δi - Δ̄)(yi - ȳ) / Σ(Δi - Δ̄)²
 *   lengthAdjustment = slope × Δ̄
 *   lengthControlledWinRate = clamp01(rawWinRate - lengthAdjustment)
 * 回归在 Δchars = 0 处的截距即"字数拉平后的胜率"，因此"更长 = 更好"的长度偏差会被扣掉。
 */
export function lengthControlledWinRate(pairs: readonly WinRatePair[]): LengthControlledWinRate {
  if (!pairs.length) return { rawWinRate: 0, lengthControlledWinRate: 0, lengthAdjustment: 0 };
  const wins = pairs.map((pair) => (pair.candidateWon ? 1 : 0));
  const diffs = pairs.map((pair) => pair.candidateChars - pair.baselineChars);
  const rawWinRate = wins.reduce<number>((sum, win) => sum + win, 0) / wins.length;
  const meanDiff = diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    covariance += (diffs[index] - meanDiff) * (wins[index] - rawWinRate);
    variance += (diffs[index] - meanDiff) ** 2;
  }
  const slope = variance ? covariance / variance : 0;
  const lengthAdjustment = slope * meanDiff;
  const controlled = Math.min(1, Math.max(0, rawWinRate - lengthAdjustment));
  return { rawWinRate, lengthControlledWinRate: controlled, lengthAdjustment };
}
