import { Download, Plus, RefreshCw, Star, Trash2, Upload, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { describeError } from "../lib/error-message";
import { PROVIDER_PRESETS, type ProviderPreset } from "../shared/ai/provider-presets";
import {
  type AiProfileHealth,
  type AiProfileView,
  type AiRoleRoute,
  MODEL_ROLE_LABELS,
  MODEL_ROLES,
  type ModelRole,
} from "../shared/ai/types";
import type { AppApi } from "../shared/types";
import { Badge, Button, Field, Input, Modal, Select } from "./UI";

const SURFACE_LABELS: Record<string, string> = {
  auto: "自动协商",
  "openai-chat": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

const AUTH_LABELS: Record<string, string> = {
  bearer: "Bearer（Authorization 头）",
  "x-api-key": "x-api-key 头",
  "api-key": "api-key 头",
  none: "无需密钥",
};

function emptyProfile(): AiProfileView {
  return {
    id: "",
    name: "",
    apiSurface: "auto",
    baseUrl: "",
    defaultModel: "",
    authScheme: "bearer",
    extraHeaders: {},
    extraQuery: {},
    localEndpoint: false,
    enabled: true,
    sortOrder: 0,
    notes: "",
    lastUsedAt: null,
    lastTestAt: null,
    lastTestOk: null,
    lastError: null,
    hasApiKey: false,
  };
}

function mapToLines(map: Record<string, string>) {
  return Object.entries(map)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function linesToMap(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) throw new Error(`格式应为「名称: 值」：${trimmed}`);
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}

export function AiProfileManager({
  api,
  notify,
}: {
  api: AppApi;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const supported = typeof api.listAiProfiles === "function";
  const [profiles, setProfiles] = useState<AiProfileView[]>([]);
  const [routes, setRoutes] = useState<AiRoleRoute[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiProfileView | null>(null);
  const [editingKey, setEditingKey] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [health, setHealth] = useState<AiProfileHealth[]>([]);
  const [transfer, setTransfer] = useState<{ mode: "export" | "import"; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [nextProfiles, nextRoutes, nextDefault, nextHealth] = await Promise.all([
      api.listAiProfiles(),
      api.listAiRoleRoutes(),
      api.getDefaultAiProfileId(),
      typeof api.listAiProfileHealth === "function" ? api.listAiProfileHealth() : Promise.resolve([]),
    ]);
    setProfiles(nextProfiles);
    setRoutes(nextRoutes);
    setDefaultId(nextDefault);
    setHealth(nextHealth);
  }, [api]);

  useEffect(() => {
    if (!supported) return;
    void reload().catch((error) => notify(describeError(error), "error"));
  }, [notify, reload, supported]);

  if (!supported) return null;

  const openNew = (preset?: ProviderPreset) => {
    setEditing({
      ...emptyProfile(),
      name: preset?.label ?? "",
      baseUrl: preset?.baseUrl ?? "",
      apiSurface: preset?.apiSurface ?? "auto",
      authScheme: preset?.authScheme ?? "bearer",
      defaultModel: preset?.defaultModel ?? "",
      localEndpoint: preset?.localEndpoint ?? false,
    });
    setEditingKey("");
    setHeadersText("");
    setQueryText("");
  };

  const openEdit = (profile: AiProfileView) => {
    setEditing(profile);
    setEditingKey("");
    setHeadersText(mapToLines(profile.extraHeaders));
    setQueryText(mapToLines(profile.extraQuery));
  };

  const save = async () => {
    if (!editing) return;
    try {
      const saved = await api.saveAiProfile(
        {
          ...editing,
          extraHeaders: linesToMap(headersText),
          extraQuery: linesToMap(queryText),
        },
        editingKey.trim() || undefined,
      );
      setEditing(null);
      await reload();
      notify(`来源「${saved.name}」已保存`);
    } catch (error) {
      notify(describeError(error), "error");
    }
  };

  const run = async (id: string, action: () => Promise<string>) => {
    setBusyId(id);
    try {
      notify(await action());
      await reload();
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusyId(null);
    }
  };

  const updateRoute = async (role: ModelRole, profileId: string, modelId: string) => {
    try {
      await api.setAiRoleRoute(role, profileId || null, modelId.trim() || null);
      await reload();
    } catch (error) {
      notify(describeError(error), "error");
    }
  };

  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  const defaultProfile = profiles.find((profile) => profile.id === defaultId) ?? null;

  return (
    <>
      <div className="settings-title">
        <span className="settings-icon">
          <Zap size={19} />
        </span>
        <div>
          <h2>模型来源</h2>
          <p>自由添加多个 API 来源，按角色分配模型；切换来源不会清空已保存的密钥。</p>
        </div>
        <Badge tone={defaultProfile ? "success" : "warning"}>
          {defaultProfile ? `默认：${defaultProfile.name}` : "未设默认来源"}
        </Badge>
      </div>

      <div className="settings-actions">
        <Button icon={<Plus size={16} />} onClick={() => openNew()}>
          添加来源
        </Button>
        <Button
          variant="secondary"
          icon={<Download size={16} />}
          onClick={() =>
            void api
              .exportAiProfiles()
              .then((text) => setTransfer({ mode: "export", text }))
              .catch((error) => notify(describeError(error), "error"))
          }
        >
          导出配置
        </Button>
        <Button
          variant="secondary"
          icon={<Upload size={16} />}
          onClick={() => setTransfer({ mode: "import", text: "" })}
        >
          导入配置
        </Button>
      </div>

      {profiles.length === 0 && (
        <p className="muted">还没有配置来源。添加一个后，正文、规划、质检与拆书可以各自指定模型。</p>
      )}

      {profiles.map((profile) => {
        const degradedUntil = health.find((item) => item.profileId === profile.id)?.degradedUntil ?? null;
        const degraded = degradedUntil !== null && Date.parse(degradedUntil) > Date.now();
        return (
          <div className="settings-form" key={profile.id}>
            <div className="settings-actions">
              <strong>{profile.name}</strong>
              {profile.id === defaultId && <Badge tone="accent">默认</Badge>}
              {!profile.enabled && <Badge tone="neutral">已停用</Badge>}
              {degraded && <Badge tone="danger">降级中</Badge>}
              {profile.lastTestOk === true && <Badge tone="success">连接正常</Badge>}
              {profile.lastTestOk === false && <Badge tone="danger">连接失败</Badge>}
              {profile.hasApiKey ? <Badge tone="success">密钥已保存</Badge> : <Badge tone="warning">无密钥</Badge>}
            </div>
            <p className="muted">
              {profile.baseUrl} · {SURFACE_LABELS[profile.apiSurface] ?? profile.apiSurface} · 默认模型{" "}
              {profile.defaultModel || "未设置"}
            </p>
            {profile.lastError && <p className="muted">{profile.lastError}</p>}
            <div className="settings-actions">
              <Button
                variant="secondary"
                disabled={busyId === profile.id}
                onClick={() =>
                  void run(profile.id, async () => {
                    const result = await api.testAiProfile(profile.id);
                    return result.ok ? result.message : `测试失败：${result.message}`;
                  })
                }
              >
                测试连接
              </Button>
              <Button
                variant="secondary"
                disabled={busyId === profile.id}
                onClick={() =>
                  void run(profile.id, async () => {
                    const models = await api.refreshAiProfileModels(profile.id);
                    return models.length
                      ? `已获取 ${models.length} 个模型`
                      : "该端点没有返回模型清单，可手动填写模型名";
                  })
                }
              >
                <RefreshCw size={14} /> 刷新模型
              </Button>
              <Button
                variant="secondary"
                disabled={profile.id === defaultId || !profile.enabled}
                onClick={() =>
                  void run(profile.id, async () => {
                    await api.setDefaultAiProfile(profile.id);
                    return `已把「${profile.name}」设为默认来源`;
                  })
                }
              >
                <Star size={14} /> 设为默认
              </Button>
              <Button variant="secondary" onClick={() => openEdit(profile)}>
                编辑
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void run(profile.id, async () => {
                    await api.saveAiProfile({ ...profile, enabled: !profile.enabled });
                    return profile.enabled ? `已停用「${profile.name}」` : `已启用「${profile.name}」`;
                  })
                }
              >
                {profile.enabled ? "停用" : "启用"}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (pendingDelete !== profile.id) {
                    setPendingDelete(profile.id);
                    return;
                  }
                  setPendingDelete(null);
                  void run(profile.id, async () => {
                    await api.deleteAiProfile(profile.id);
                    return `已删除「${profile.name}」`;
                  });
                }}
              >
                <Trash2 size={14} /> {pendingDelete === profile.id ? "确认删除" : "删除"}
              </Button>
            </div>
          </div>
        );
      })}

      <h3>角色路由</h3>
      <p className="muted">留空表示使用默认来源与其默认模型；角色路由优先于默认来源。</p>
      <div className="settings-form">
        {MODEL_ROLES.map((role) => {
          const route = routes.find((item) => item.role === role);
          const routeProfile = profiles.find((profile) => profile.id === route?.profileId) ?? null;
          return (
            <div className="form-grid two" key={role}>
              <Field label={MODEL_ROLE_LABELS[role]}>
                <Select
                  value={route?.profileId ?? ""}
                  onChange={(event) => void updateRoute(role, event.target.value, route?.modelId ?? "")}
                >
                  <option value="">默认来源</option>
                  {enabledProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="模型"
                hint={routeProfile ? `该来源默认：${routeProfile.defaultModel || "未设置"}` : undefined}
              >
                <Input
                  defaultValue={route?.modelId ?? ""}
                  placeholder="留空使用来源默认模型"
                  onBlur={(event) => {
                    if ((route?.modelId ?? "") !== event.target.value.trim())
                      void updateRoute(role, route?.profileId ?? "", event.target.value);
                  }}
                />
              </Field>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal
          title={editing.id ? `编辑来源：${editing.name}` : "添加来源"}
          onClose={() => setEditing(null)}
          width={720}
        >
          <div className="settings-form">
            {!editing.id && (
              <Field label="从预设开始" hint="预设只填地址与协议面，模型名以实际可用为准">
                <div className="settings-actions">
                  {PROVIDER_PRESETS.map((preset) => (
                    <Button key={preset.key} variant="secondary" onClick={() => openNew(preset)}>
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="名称">
              <Input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="例如：DeepSeek 主力"
              />
            </Field>
            <Field label="API 基础地址" hint="粘贴完整端点会自动纠正；查询参数请填到下方附加参数">
              <Input
                value={editing.baseUrl}
                onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
            </Field>
            <div className="form-grid two">
              <Field label="接口协议">
                <Select
                  value={editing.apiSurface}
                  onChange={(event) =>
                    setEditing({ ...editing, apiSurface: event.target.value as AiProfileView["apiSurface"] })
                  }
                >
                  {Object.entries(SURFACE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="鉴权方式">
                <Select
                  value={editing.authScheme}
                  onChange={(event) =>
                    setEditing({ ...editing, authScheme: event.target.value as AiProfileView["authScheme"] })
                  }
                >
                  {Object.entries(AUTH_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="form-grid two">
              <Field label="默认模型">
                <Input
                  value={editing.defaultModel}
                  onChange={(event) => setEditing({ ...editing, defaultModel: event.target.value })}
                  placeholder="deepseek-chat"
                />
              </Field>
              <Field label="本地端点" hint="仅 Ollama / LM Studio 等回环或私网地址；只接受字面量 IP">
                <Select
                  value={editing.localEndpoint ? "yes" : "no"}
                  onChange={(event) => setEditing({ ...editing, localEndpoint: event.target.value === "yes" })}
                >
                  <option value="no">否（仅公网 HTTPS）</option>
                  <option value="yes">是（允许 http://127.0.0.1 等）</option>
                </Select>
              </Field>
            </div>
            <Field label="API 密钥" hint="只保存到 Windows 凭据管理器；留空表示不修改已保存的密钥">
              <Input
                type="password"
                value={editingKey}
                onChange={(event) => setEditingKey(event.target.value)}
                placeholder={editing.hasApiKey ? "已安全保存" : "输入 API 密钥"}
              />
            </Field>
            <Field label="附加请求头" hint="每行「名称: 值」，只放非密钥元数据（如 HTTP-Referer）">
              <textarea
                className="input"
                rows={3}
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
              />
            </Field>
            <Field label="附加查询参数" hint="每行「名称: 值」，例如 Azure 的 api-version">
              <textarea
                className="input"
                rows={2}
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
              />
            </Field>
            <div className="settings-actions">
              <Button onClick={() => void save()}>{editing.id ? "保存修改" : "添加来源"}</Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                取消
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {transfer && (
        <Modal
          title={transfer.mode === "export" ? "导出来源配置" : "导入来源配置"}
          onClose={() => setTransfer(null)}
          width={720}
        >
          <div className="settings-form">
            <p className="muted">配置里不含密钥。导入后需要为每个来源重新填写一次密钥。</p>
            <textarea
              className="input"
              rows={16}
              readOnly={transfer.mode === "export"}
              value={transfer.text}
              onChange={(event) => setTransfer({ ...transfer, text: event.target.value })}
            />
            <div className="settings-actions">
              {transfer.mode === "export" ? (
                <Button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(transfer.text)
                      .then(() => notify("配置已复制到剪贴板"))
                      .catch(() => notify("复制失败，请手动选中复制", "error"))
                  }
                >
                  复制到剪贴板
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void api
                      .importAiProfiles(transfer.text)
                      .then(async (imported) => {
                        setTransfer(null);
                        await reload();
                        notify(`已导入 ${imported.length} 个来源`);
                      })
                      .catch((error) => notify(describeError(error), "error"))
                  }
                >
                  导入
                </Button>
              )}
              <Button variant="secondary" onClick={() => setTransfer(null)}>
                关闭
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
