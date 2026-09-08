import type { AuthScheme } from "./types";

/**
 * 请求头密钥拒绝名单。`extra_headers` 只允许非密钥元数据（如 OpenRouter 的
 * HTTP-Referer / X-Title）；任何密钥都必须走 auth_scheme 进 Credential Manager。
 */
const SECRET_HEADER_PATTERN = /(authorization|api[-_]?key|x-api-key|x-auth-|token|secret|key)/i;

export function isSecretHeaderName(name: string) {
  return SECRET_HEADER_PATTERN.test(name.trim());
}

export function assertNoSecretHeaders(headers: Record<string, string>) {
  for (const name of Object.keys(headers)) {
    if (isSecretHeaderName(name))
      throw new Error(`附加请求头「${name}」可能是凭据：密钥请选择对应的鉴权方式，值只保存在 Windows 凭据管理器`);
  }
}

export function parseAuthScheme(value: string): AuthScheme {
  const trimmed = value.trim();
  if (trimmed === "bearer" || trimmed === "x-api-key" || trimmed === "api-key" || trimmed === "none") return trimmed;
  if (trimmed.startsWith("custom-header:") && trimmed.slice("custom-header:".length).trim())
    return trimmed as AuthScheme;
  throw new Error(`不支持的鉴权方式：${value}`);
}

export function authSchemeLabel(scheme: AuthScheme) {
  if (scheme === "bearer") return "Bearer";
  if (scheme === "x-api-key") return "x-api-key";
  if (scheme === "api-key") return "api-key";
  if (scheme === "none") return "无需密钥";
  return `自定义请求头：${scheme.slice("custom-header:".length)}`;
}

/** 由鉴权方式推导请求头；密钥值只在内存中短暂存在，不落库、不落日志。 */
export function resolveAuthHeaders(scheme: AuthScheme, secret: string): Record<string, string> {
  if (scheme === "none") return {};
  if (!secret) throw new Error("该来源需要 API 密钥，请先填写");
  if (scheme === "bearer") return { Authorization: `Bearer ${secret}` };
  if (scheme === "x-api-key") return { "x-api-key": secret };
  if (scheme === "api-key") return { "api-key": secret };
  const name = scheme.slice("custom-header:".length).trim();
  if (!name) throw new Error("自定义鉴权头缺少头名");
  return { [name]: secret };
}
