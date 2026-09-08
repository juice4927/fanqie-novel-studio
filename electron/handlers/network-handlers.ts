import type { ProxySettings, ProxySettingsInput } from "../../src/shared/types";
import { configureOutboundProxy, parseProxyUrl } from "../netguard";
import type { RegisterHandler } from "./types";

export interface NetworkHandlerDependencies {
  register: RegisterHandler;
  getSettings: () => ProxySettings;
  saveSettings: (input: ProxySettingsInput) => ProxySettings;
  readProxyCredential: () => Promise<string>;
  writeProxyCredential: (value: string) => Promise<void>;
  deleteProxyCredential: () => Promise<void>;
  testConnection: (settings: ProxySettings, password: string) => Promise<{ ok: boolean; message: string }>;
  log: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
}

/** 出站代理设置：与模型来源解耦，作用于全部 netguard 出站。 */
export function registerNetworkHandlers({
  register,
  getSettings,
  saveSettings,
  readProxyCredential,
  writeProxyCredential,
  deleteProxyCredential,
  testConnection,
  log,
}: NetworkHandlerDependencies): void {
  const masked = async (settings: ProxySettings): Promise<ProxySettings> => ({
    ...settings,
    hasPassword: Boolean(await readProxyCredential().catch(() => "")),
  });

  register("getProxySettings", () => masked(getSettings()));

  register("saveProxySettings", async (input) => {
    const url = input.url.trim();
    if (input.enabled && !url) throw new Error("启用代理前请先填写代理地址");
    if (url) parseProxyUrl(url);

    if (input.password) await writeProxyCredential(input.password);
    else if (!input.username.trim()) await deleteProxyCredential().catch(() => undefined);

    const saved = saveSettings({ enabled: input.enabled, url, username: input.username.trim() });
    if (saved.enabled && saved.url) {
      const password = await readProxyCredential().catch(() => "");
      configureOutboundProxy({
        url: saved.url,
        username: saved.username || undefined,
        password: password || undefined,
      });
      log("info", "proxy.configured", { url: new URL(saved.url).origin });
    } else {
      configureOutboundProxy(null);
      log("info", "proxy.disabled", {});
    }
    return masked(saved);
  });

  register("testProxyConnection", async () => {
    const settings = getSettings();
    if (!settings.enabled || !settings.url) return { ok: false, message: "请先启用并保存代理设置" };
    const password = await readProxyCredential().catch(() => "");
    return testConnection(settings, password);
  });
}
