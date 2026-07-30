export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderCapabilities {
  jsonMode: boolean;
  usageShape: "openai" | "responses" | "unknown";
}

export function inferProviderCapabilities(baseUrl: string): ProviderCapabilities {
  const host = (() => { try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return ""; } })();
  if (host.endsWith("openai.com") || host.includes("deepseek") || host.includes("dashscope"))
    return { jsonMode: true, usageShape: "openai" };
  return { jsonMode: true, usageShape: "unknown" };
}

export function parseProviderUsage(body: unknown): ProviderUsage {
  const usage = (body as { usage?: Record<string, unknown> })?.usage ?? {};
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
  };
}

export function rejectsJsonMode(status: number, detail: string) {
  return status === 400 && /response.?format|json.?mode|unsupported/i.test(detail);
}

export function providerError(status: number, detail: string) {
  const compact = detail.replace(/\s+/g, " ").slice(0, 300);
  return [429, 502, 503, 504].includes(status)
    ? `模型服务暂时不可用 ${status}: ${compact}`
    : `模型接口返回 ${status}: ${compact}`;
}
