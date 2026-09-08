import { fetchLocalEndpointResponse, fetchPublicHttpResponse } from "../netguard";

/** 供应商返回非 2xx 时抛出，携带状态码、正文与 Retry-After，供兼容性降档与重试策略判断。 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly retryAfter: string | null;

  constructor(init: { status: number; detail: string; retryAfter?: string | null }) {
    super(`模型接口返回 ${init.status}: ${init.detail.replace(/\s+/g, " ").slice(0, 300)}`);
    this.name = "ProviderHttpError";
    this.status = init.status;
    this.detail = init.detail;
    this.retryAfter = init.retryAfter ?? null;
  }
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  /** 本地模型端点：走字面量 IP 直连，不解析域名、不跟随重定向。 */
  local?: boolean;
}

/** 连接层唯一出站口：公网请求走 netguard，本地端点走受控直连。 */
export async function sendProviderRequest(
  request: ProviderRequest,
  options: { allowCrossOriginRedirect?: boolean } = {},
) {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...request.headers },
    body: JSON.stringify(request.body),
    signal: request.signal,
  };
  if (request.local) return fetchLocalEndpointResponse(request.url, init);
  return fetchPublicHttpResponse(request.url, init, {
    allowCrossOriginRedirect: options.allowCrossOriginRedirect ?? false,
  });
}

export async function readProviderError(response: Response) {
  const detail = (await response.text()).slice(0, 300);
  return new ProviderHttpError({
    status: response.status,
    detail,
    retryAfter: response.headers.get("retry-after"),
  });
}
