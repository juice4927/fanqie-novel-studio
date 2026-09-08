import { Network } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "../lib/error-message";
import type { AppApi, ProxySettings } from "../shared/types";
import { Button, Field, Input, Select } from "./UI";

/** 全局出站代理：作用于模型调用与公开榜单抓取；默认关闭。 */
export function NetworkProxySettings({
  api,
  notify,
}: {
  api: AppApi;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const supported = typeof api.getProxySettings === "function";
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void api
      .getProxySettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [api, supported]);

  if (!supported || !settings) return null;

  const save = async () => {
    const saved = await api.saveProxySettings({
      enabled: settings.enabled,
      url: settings.url,
      username: settings.username,
      ...(password ? { password } : {}),
    });
    setSettings(saved);
    setPassword("");
    return saved;
  };

  return (
    <>
      <div className="settings-title">
        <span className="settings-icon">
          <Network size={19} />
        </span>
        <div>
          <h2>网络代理</h2>
          <p>可选的出站代理，作用于模型调用与番茄公开页/榜单抓取；不读取系统代理设置。</p>
        </div>
        <span className={`badge badge-${settings.enabled ? "success" : "neutral"}`}>
          {settings.enabled ? "已启用" : "直连"}
        </span>
      </div>
      <div className="settings-form">
        <Field label="启用代理" hint="默认关闭；关闭后立即恢复直连">
          <Select
            value={settings.enabled ? "yes" : "no"}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.value === "yes" })}
          >
            <option value="no">不使用代理</option>
            <option value="yes">使用代理</option>
          </Select>
        </Field>
        <Field label="代理地址" hint="支持 http、https、socks5；例如 http://127.0.0.1:7897">
          <Input
            value={settings.url}
            onChange={(event) => setSettings({ ...settings, url: event.target.value })}
            placeholder="http://127.0.0.1:7897"
          />
        </Field>
        <div className="form-grid two">
          <Field label="用户名（可选）">
            <Input
              value={settings.username}
              onChange={(event) => setSettings({ ...settings, username: event.target.value })}
              placeholder="无认证代理可留空"
            />
          </Field>
          <Field label="密码（可选）" hint="只保存到 Windows 凭据管理器；留空表示保持已保存的密码">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={settings.hasPassword ? "已安全保存" : "无认证代理可留空"}
            />
          </Field>
        </div>
        <p className="muted">模型请求的密钥会经代理转发，请只填写你信任的代理；自动更新不走代理。</p>
        <div className="settings-actions">
          <Button
            onClick={() =>
              void save()
                .then(() => notify("代理设置已保存"))
                .catch((error) => notify(describeError(error), "error"))
            }
          >
            保存代理设置
          </Button>
          <Button
            variant="secondary"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                await save();
                const result = await api.testProxyConnection();
                notify(result.message, result.ok ? "success" : "error");
              } catch (error) {
                notify(describeError(error), "error");
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "测试中" : "测试代理连通性"}
          </Button>
        </div>
      </div>
    </>
  );
}
