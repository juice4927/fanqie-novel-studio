import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, type Dispatcher, ProxyAgent } from "undici";

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

/** 出站代理配置；密码只经内存传入，不落库、不落日志。 */
export interface OutboundProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

const PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks:"]);

/** 解析并校验代理地址：允许本机/私网，禁止 URL 内嵌凭据、路径、查询与片段。 */
export function parseProxyUrl(value: string): URL {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("代理地址不能为空");
  const url = new URL(trimmed);
  if (!PROXY_PROTOCOLS.has(url.protocol)) throw new Error("代理地址只支持 http、https、socks5 协议（不支持 socks4）");
  if (url.username || url.password) throw new Error("代理凭据请填到用户名与密码，不要写在地址里");
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash)
    throw new Error("代理地址不能包含路径、查询参数或片段");
  return url;
}

let proxyDispatcher: Dispatcher | null = null;
let proxyConfig: { url: string; username?: string } | null = null;
let proxyDnsObserver: (hostname: string) => void = () => {};

/** 记录“本地解析失败但按代理放行”的域名，由主进程接日志。 */
export function setOutboundProxyDnsObserver(observer: (hostname: string) => void) {
  proxyDnsObserver = observer;
}

/** 配置或清除全局出站代理；传 null 恢复直连。构建失败时抛错且不改变现有配置。 */
export function configureOutboundProxy(config: OutboundProxyConfig | null) {
  if (!config) {
    proxyDispatcher = null;
    proxyConfig = null;
    return;
  }
  const url = parseProxyUrl(config.url);
  const options: ConstructorParameters<typeof ProxyAgent>[0] & { username?: string; password?: string } = {
    uri: url.toString(),
  };
  if (config.username) {
    if (url.protocol === "socks5:" || url.protocol === "socks:")
      Object.assign(options, { username: config.username, password: config.password ?? "" });
    else
      Object.assign(options, {
        token: `Basic ${Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64")}`,
      });
  }
  const dispatcher = new ProxyAgent(options);
  proxyDispatcher = dispatcher;
  proxyConfig = { url: url.toString(), ...(config.username ? { username: config.username } : {}) };
}

/** 供日志与测试读取当前代理（不含密码）。 */
export function getOutboundProxyConfig() {
  return proxyConfig;
}

export type ProxyDnsCheck = "public" | "private" | "unresolved";

/**
 * 走代理时目的地由代理解析，本进程无法固定已校验 IP；这里做一次本地预解析：
 * 解析到私网即拒绝，解析失败（DNS 污染/被墙的常见场景）按代理放行并记日志。
 */
export async function checkProxyDestination(
  hostname: string,
  resolver: PublicAddressResolver = defaultResolver,
  timeoutMs = 3000,
): Promise<ProxyDnsCheck> {
  const normalized = hostnameWithoutBrackets(hostname);
  if (isIP(normalized)) return isPublicIpAddress(normalized) ? "public" : "private";
  try {
    const addresses = await Promise.race([
      resolver(normalized),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("dns-timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (!addresses.length) return "unresolved";
    return addresses.every((item) => isPublicIpAddress(item.address)) ? "public" : "private";
  } catch {
    return "unresolved";
  }
}

/** 本地模型端点：只接受字面量回环/私网 IP，不解析域名、不跟随重定向。 */
export function assertLocalEndpointUrl(url: URL) {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("本地端点只允许不含凭据的 HTTP 或 HTTPS 地址");
  const hostname = hostnameWithoutBrackets(url.hostname);
  if (!isIP(hostname)) throw new Error("本地端点只接受字面量 IP 地址（不接受域名）");
  if (isPublicIpAddress(hostname)) throw new Error("本地端点只允许回环或私有网络地址");
}

/** 直连本地模型服务：字面量 IP 无需 DNS，且禁止重定向。 */
export async function fetchLocalEndpointResponse(initialUrl: URL | string, init: RequestInit = {}) {
  const url = new URL(initialUrl);
  assertLocalEndpointUrl(url);
  return globalThis.fetch(url, { ...init, redirect: "error" });
}

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
  dispatcher?: Dispatcher;
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
    if (!options.dispatcher && proxyDispatcher) {
      const check = await checkProxyDestination(currentUrl.hostname);
      if (check === "private") throw new Error("地址不能解析到本机、私有网络或保留地址");
      if (check === "unresolved") proxyDnsObserver(hostnameWithoutBrackets(currentUrl.hostname));
    }
    const response = await fetchImpl(current, {
      ...requestInit,
      redirect: "manual",
      dispatcher: options.dispatcher ?? proxyDispatcher ?? publicDispatcher,
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
