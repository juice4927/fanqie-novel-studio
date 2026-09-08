import { afterEach, describe, expect, it } from "vitest";
import {
  checkProxyDestination,
  configureOutboundProxy,
  fetchPublicHttpResponse,
  getOutboundProxyConfig,
  parseProxyUrl,
  setOutboundProxyDnsObserver,
} from "../electron/netguard";
import { type StubProxy, startStubProxy } from "./stub-proxy";

const proxies: StubProxy[] = [];

afterEach(async () => {
  configureOutboundProxy(null);
  setOutboundProxyDnsObserver(() => undefined);
  while (proxies.length) await proxies.pop()?.close();
});

describe("代理地址校验", () => {
  it("放行 http/https/socks5 的本机与私网地址", () => {
    expect(parseProxyUrl("http://127.0.0.1:7897").port).toBe("7897");
    expect(parseProxyUrl("socks5://127.0.0.1:1080").protocol).toBe("socks5:");
    expect(parseProxyUrl("https://[::1]:8443").hostname).toBe("[::1]");
  });

  it("拒绝 socks4、其它协议、内嵌凭据与路径查询", () => {
    expect(() => parseProxyUrl("socks4://127.0.0.1:1080")).toThrow(/socks4|socks5/);
    expect(() => parseProxyUrl("file:///etc/passwd")).toThrow(/只支持/);
    expect(() => parseProxyUrl("http://user:pass@127.0.0.1:7897")).toThrow(/用户名与密码/);
    expect(() => parseProxyUrl("http://127.0.0.1:7897/proxy")).toThrow(/路径/);
    expect(() => parseProxyUrl("http://127.0.0.1:7897?x=1")).toThrow(/路径/);
    expect(() => parseProxyUrl("")).toThrow(/不能为空/);
  });

  it("配置失败不改变现有配置", () => {
    configureOutboundProxy({ url: "http://127.0.0.1:7897" });
    expect(getOutboundProxyConfig()?.url).toBe("http://127.0.0.1:7897/");
    expect(() => configureOutboundProxy({ url: "socks4://127.0.0.1:1080" })).toThrow();
    expect(getOutboundProxyConfig()?.url).toBe("http://127.0.0.1:7897/");
  });

  it("对外只暴露不含密码的配置", () => {
    configureOutboundProxy({ url: "http://127.0.0.1:7897", username: "u", password: "secret" });
    expect(getOutboundProxyConfig()).toEqual({ url: "http://127.0.0.1:7897/", username: "u" });
    expect(JSON.stringify(getOutboundProxyConfig())).not.toContain("secret");
  });
});

describe("代理模式下的目的地守卫", () => {
  it("字面量私网地址直接判定为 private", async () => {
    await expect(checkProxyDestination("127.0.0.1")).resolves.toBe("private");
    await expect(checkProxyDestination("[::1]")).resolves.toBe("private");
  });

  it("解析到私网地址判为 private，解析失败判为 unresolved", async () => {
    await expect(
      checkProxyDestination("internal.example", async () => [{ address: "10.0.0.5", family: 4 }]),
    ).resolves.toBe("private");
    await expect(
      checkProxyDestination("public.example", async () => [{ address: "93.184.216.34", family: 4 }]),
    ).resolves.toBe("public");
    await expect(
      checkProxyDestination("blocked.example", async () => {
        throw new Error("nxdomain");
      }),
    ).resolves.toBe("unresolved");
  });

  it("开代理后本地字面量目的地仍然被拒绝", async () => {
    configureOutboundProxy({ url: "http://127.0.0.1:7897" });
    await expect(fetchPublicHttpResponse("http://127.0.0.1:9/ping", { method: "GET" })).rejects.toThrow(/本机|私有/);
  });
});

describe("真实 fetch 经代理隧道", () => {
  it("请求经 CONNECT 到达桩代理并带回响应", async () => {
    const proxy = await startStubProxy("proxied");
    proxies.push(proxy);
    configureOutboundProxy({ url: proxy.url, username: "user", password: "pass" });
    const unresolved: string[] = [];
    setOutboundProxyDnsObserver((hostname) => unresolved.push(hostname));

    const response = await fetchPublicHttpResponse("http://example.invalid/ping", { method: "GET" });

    expect(await response.text()).toBe("proxied");
    expect(proxy.connectTargets).toEqual(["example.invalid:80"]);
    expect(proxy.authorizationHeaders[0]).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    expect(unresolved).toEqual(["example.invalid"]);
  }, 15_000);
});
