export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export function parseProviderUsage(body: unknown): ProviderUsage {
  const usage = (body as { usage?: Record<string, unknown> })?.usage ?? {};
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
  };
}
