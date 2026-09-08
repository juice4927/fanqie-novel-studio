/** 已知的完整端点后缀；粘贴整条端点时自动截回基础地址。 */
const ENDPOINT_SUFFIXES = ["/chat/completions", "/responses", "/messages", "/completions"];

export function normalizeProviderUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("模型 API 地址必须使用 HTTPS");
  if (url.username || url.password) throw new Error("模型 API 地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("模型 API 基础地址不能包含查询参数或片段");
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/+$/, "");
}

export interface CanonicalProviderUrl {
  baseUrl: string;
  notices: string[];
}

export interface CanonicalProviderUrlOptions {
  /** 仅本地端点豁免允许 http。 */
  allowInsecure?: boolean;
}

/**
 * 把用户粘贴的地址规范成基础地址：
 * 完整端点自动截断、去尾斜杠、host 小写；查询参数与片段一律拒绝（Azure 的
 * api-version 走来源的 extraQuery 字段）。
 */
export function canonicalizeProviderUrl(
  input: string,
  options: CanonicalProviderUrlOptions = {},
): CanonicalProviderUrl {
  const notices: string[] = [];
  let trimmed = input.trim();
  if (!trimmed) throw new Error("模型 API 地址不能为空");
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      trimmed = trimmed.slice(0, -suffix.length);
      notices.push(`已从完整端点纠正为基础地址（去掉 ${suffix}）`);
      break;
    }
  }
  trimmed = trimmed.replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.username || url.password) throw new Error("模型 API 地址不能包含用户名或密码");
  if (url.search) throw new Error("基础地址不能带查询参数；请把参数填到来源的附加查询参数里");
  if (url.hash) throw new Error("模型 API 地址不能包含片段（#）");
  if (url.protocol !== "https:" && !(options.allowInsecure && url.protocol === "http:"))
    throw new Error("模型 API 地址必须使用 HTTPS（本地端点除外）");
  url.hostname = url.hostname.toLowerCase();
  return { baseUrl: url.toString().replace(/\/+$/, ""), notices };
}
