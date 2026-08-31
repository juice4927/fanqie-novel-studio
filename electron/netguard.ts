import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_REDIRECT_LIMIT = 5;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blockedAddresses.addSubnet(network, prefix, "ipv6");

function hostnameWithoutBrackets(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
}

export function isPublicIpAddress(address: string) {
  const normalized = hostnameWithoutBrackets(address.split("%")[0]);
  const family = isIP(normalized);
  if (family === 4) return !blockedAddresses.check(normalized, "ipv4");
  if (family === 6) {
    if (normalized.startsWith("::ffff:") || /^0{1,4}(?::0{1,4}){4}:ffff:/i.test(normalized)) return false;
    return !blockedAddresses.check(normalized, "ipv6");
  }
  return false;
}

export function assertPublicHttpUrlSyntax(url: URL) {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("只允许不含凭据的 HTTP 或 HTTPS 地址");
  const hostname = hostnameWithoutBrackets(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost"))
    throw new Error("地址不能指向本机、私有网络或保留地址");
  if (isIP(hostname) && !isPublicIpAddress(hostname)) throw new Error("地址不能指向本机、私有网络或保留地址");
}

export type PublicAddressResolver = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultResolver: PublicAddressResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function resolvePublicAddresses(hostname: string, resolver: PublicAddressResolver = defaultResolver) {
  const addresses = await resolver(hostnameWithoutBrackets(hostname));
  if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address)))
    throw new Error("地址不能解析到本机、私有网络或保留地址");
  return addresses;
}

export function createPublicLookup(resolver: PublicAddressResolver = defaultResolver): LookupFunction {
  return (hostname, options, callback) => {
    void resolvePublicAddresses(hostname, resolver).then(
      (addresses) => {
        const requestedFamily = typeof options === "object" ? options.family : 0;
        const candidates =
          requestedFamily === 4 || requestedFamily === 6
            ? addresses.filter((item) => item.family === requestedFamily)
            : addresses;
        if (!candidates.length) {
          callback(new Error("地址没有符合要求的公网 IP"), "", 0);
          return;
        }
        if (typeof options === "object" && options.all) {
          callback(null, candidates as Array<{ address: string; family: 4 | 6 }>);
          return;
        }
        const selected = candidates[0];
        callback(null, selected.address, selected.family);
      },
      (error) => callback(error instanceof Error ? error : new Error(String(error)), "", 0),
    );
  };
}

const publicDispatcher = new Agent({
  connect: { lookup: createPublicLookup() },
});

interface GuardedFetchOptions {
  allowCrossOriginRedirect?: boolean;
  redirectLimit?: number;
  dispatcher?: Agent;
  fetchImpl?: typeof fetch;
}

export async function fetchPublicHttpResponse(
  initialUrl: URL | string,
  init: RequestInit = {},
  options: GuardedFetchOptions = {},
) {
  let current: URL | string = initialUrl;
  const requestInit = { ...init };
  const redirectLimit = options.redirectLimit ?? DEFAULT_REDIRECT_LIMIT;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
    const currentUrl = new URL(current);
    assertPublicHttpUrlSyntax(currentUrl);
    const response = await fetchImpl(current, {
      ...requestInit,
      redirect: "manual",
      dispatcher: options.dispatcher ?? publicDispatcher,
    } as RequestInit);
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("HTTP 重定向缺少目标地址");
    if (redirects === redirectLimit) throw new Error("HTTP 重定向次数过多");
    const next = new URL(location, currentUrl);
    if (!options.allowCrossOriginRedirect && next.origin !== currentUrl.origin)
      throw new Error("模型服务不允许跨来源重定向");
    const method = (requestInit.method ?? "GET").toUpperCase();
    if (
      (response.status === 301 || response.status === 302 || response.status === 303) &&
      method !== "GET" &&
      method !== "HEAD"
    )
      throw new Error("模型服务重定向不允许更改请求方法");
    await response.body?.cancel();
    current = next;
  }
  throw new Error("HTTP 重定向次数过多");
}
