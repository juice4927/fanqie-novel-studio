import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNetworkHandlers } from "../electron/handlers/network-handlers";
import { configureOutboundProxy, getOutboundProxyConfig } from "../electron/netguard";
import type { ProxySettings } from "../src/shared/types";

type Handler = (input?: unknown) => Promise<unknown>;

function createRuntime(initial: Partial<ProxySettings> = {}) {
  const handlers = new Map<string, Handler>();
  let settings: ProxySettings = {
    enabled: false,
    url: "",
    username: "",
    hasPassword: false,
    ...initial,
  };
  const credentials = new Map<string, string>();
  const testConnection = vi.fn(async () => ({ ok: true, message: "代理连通" }));
  registerNetworkHandlers({
    register: ((key: string, handler: Handler) => handlers.set(key, handler)) as never,
    getSettings: () => settings,
    saveSettings: (input) => {
      settings = { ...input, hasPassword: settings.hasPassword };
      return settings;
    },
    readProxyCredential: async () => credentials.get("proxy") ?? "",
    writeProxyCredential: async (value) => {
      credentials.set("proxy", value);
    },
    deleteProxyCredential: async () => {
      credentials.delete("proxy");
    },
    testConnection,
    log: vi.fn(),
  });
  return { handlers, credentials, testConnection, getSettings: () => settings };
}

afterEach(() => configureOutboundProxy(null));

describe("代理设置 handler", () => {
  it("保存时写凭据并立即生效，返回掩码设置", async () => {
    const runtime = createRuntime();
    const saved = (await runtime.handlers.get("saveProxySettings")!({
      enabled: true,
      url: "http://127.0.0.1:7897",
      username: "user",
      password: "secret",
    })) as ProxySettings;

    expect(saved).toEqual({ enabled: true, url: "http://127.0.0.1:7897", username: "user", hasPassword: true });
    expect(runtime.credentials.get("proxy")).toBe("secret");
    expect(getOutboundProxyConfig()).toEqual({ url: "http://127.0.0.1:7897/", username: "user" });
    expect(JSON.stringify(getOutboundProxyConfig())).not.toContain("secret");
  });

  it("留空密码保持已保存的密码，清空用户名则删除凭据", async () => {
    const runtime = createRuntime();
    await runtime.handlers.get("saveProxySettings")!({
      enabled: true,
      url: "http://127.0.0.1:7897",
      username: "user",
      password: "secret",
    });
    await runtime.handlers.get("saveProxySettings")!({
      enabled: true,
      url: "http://127.0.0.1:7897",
      username: "user",
    });
    expect(runtime.credentials.get("proxy")).toBe("secret");

    await runtime.handlers.get("saveProxySettings")!({ enabled: true, url: "http://127.0.0.1:7897", username: "" });
    expect(runtime.credentials.has("proxy")).toBe(false);
    expect(getOutboundProxyConfig()).toEqual({ url: "http://127.0.0.1:7897/" });
  });

  it("关闭开关立即恢复直连", async () => {
    const runtime = createRuntime();
    await runtime.handlers.get("saveProxySettings")!({ enabled: true, url: "http://127.0.0.1:7897", username: "" });
    expect(getOutboundProxyConfig()).not.toBeNull();
    await runtime.handlers.get("saveProxySettings")!({ enabled: false, url: "http://127.0.0.1:7897", username: "" });
    expect(getOutboundProxyConfig()).toBeNull();
  });

  it("非法地址与启用但空地址都被拒绝", async () => {
    const runtime = createRuntime();
    await expect(
      runtime.handlers.get("saveProxySettings")!({ enabled: true, url: "socks4://127.0.0.1:1080", username: "" }),
    ).rejects.toThrow(/socks4|socks5/);
    await expect(runtime.handlers.get("saveProxySettings")!({ enabled: true, url: "", username: "" })).rejects.toThrow(
      /代理地址/,
    );
  });

  it("未启用时连通性测试直接返回失败，不发起请求", async () => {
    const runtime = createRuntime();
    await expect(runtime.handlers.get("testProxyConnection")!()).resolves.toEqual({
      ok: false,
      message: "请先启用并保存代理设置",
    });
    expect(runtime.testConnection).not.toHaveBeenCalled();
  });
});
