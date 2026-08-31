export interface PromptFixture {
  id: string;
  requiredKeys: string[];
  forbiddenFacts: string[];
  maxCharacters: number;
}

export interface PromptEvaluation {
  fixtureId: string;
  structureScore: number;
  factScore: number;
  repetitionScore: number;
  costScore: number;
  totalScore: number;
}

function repeatedRatio(text: string) {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 16) return 0;
  const windows = new Map<string, number>();
  for (let index = 0; index <= compact.length - 8; index += 4) {
    const part = compact.slice(index, index + 8);
    windows.set(part, (windows.get(part) ?? 0) + 1);
  }
  return (
    [...windows.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0) /
    Math.max(windows.size, 1)
  );
}

export function evaluatePromptOutput(
  fixture: PromptFixture,
  output: unknown,
  inputTokens = 0,
  outputTokens = 0,
): PromptEvaluation {
  const record = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const text = JSON.stringify(output ?? "");
  const present = fixture.requiredKeys.filter((key) => Object.hasOwn(record, key)).length;
  const structureScore = fixture.requiredKeys.length ? (present / fixture.requiredKeys.length) * 100 : 100;
  const conflicts = fixture.forbiddenFacts.filter((fact) => text.includes(fact)).length;
  const factScore = Math.max(0, 100 - conflicts * 50);
  const repetitionScore = Math.max(0, 100 - repeatedRatio(text) * 120);
  const charactersScore = Math.min(100, (fixture.maxCharacters / Math.max(text.length, 1)) * 100);
  const tokenPenalty = Math.max(0, inputTokens + outputTokens - 20_000) / 1000;
  const costScore = Math.max(0, charactersScore - tokenPenalty);
  const totalScore = structureScore * 0.35 + factScore * 0.35 + repetitionScore * 0.2 + costScore * 0.1;
  return { fixtureId: fixture.id, structureScore, factScore, repetitionScore, costScore, totalScore };
}

export function comparePromptVersions(baseline: PromptEvaluation[], candidate: PromptEvaluation[]) {
  const average = (items: PromptEvaluation[]) =>
    items.reduce((sum, item) => sum + item.totalScore, 0) / Math.max(items.length, 1);
  const baselineScore = average(baseline);
  const candidateScore = average(candidate);
  return {
    baselineScore,
    candidateScore,
    delta: candidateScore - baselineScore,
    regressed: candidateScore + 2 < baselineScore,
  };
}
