import { useEffect, useState } from "react";
import { ArchiveRestore, Database, FolderLock, HardDrive, KeyRound, Save, ShieldCheck } from "lucide-react";
import type { AiSettings, AppApi } from "../shared/types";
import { Badge, Button, Field, Input } from "../components/UI";

export function SettingsPage({ api, notify }: { api: AppApi; notify: (message: string, tone?: "success" | "error") => void }) {
  const [settings, setSettings] = useState<AiSettings>({ baseUrl: "https://api.openai.com/v1", model: "gpt-4.1", embeddingModel: "text-embedding-3-small", hasApiKey: false, inputPricePerMillion: 0, outputPricePerMillion: 0 });
  const [apiKey, setApiKey] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api.getAiSettings(), api.getWorkspacePath()]).then(([nextSettings, path]) => { setSettings({ ...nextSettings, inputPricePerMillion: nextSettings.inputPricePerMillion ?? 0, outputPricePerMillion: nextSettings.outputPricePerMillion ?? 0 }); setWorkspace(path); }); }, []);

  const run = async (operation: "backup" | "restore") => {
    setBusy(true);
    try {
      const result = operation === "backup" ? await api.createBackup(password) : await api.restoreBackup(password);
      if (result) notify(operation === "backup" ? `加密备份已创建：${result}` : `备份已校验并恢复到副本目录：${result}`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); }
    finally { setBusy(false); }
  };

  return <div className="page settings-page">
    <header className="page-header"><div><p className="eyebrow">本地工作台</p><h1>系统设置</h1><p>模型调用、凭据、独立工作区与加密备份。</p></div></header>
      <section className="settings-section"><div className="settings-title"><span className="settings-icon"><KeyRound size={19} /></span><div><h2>模型供应商</h2><p>兼容 OpenAI Chat Completions 协议的服务地址。</p></div><Badge tone={settings.hasApiKey ? "success" : "warning"}>{settings.hasApiKey ? "密钥已保存" : "未配置密钥"}</Badge></div><div className="settings-form"><Field label="API 基础地址"><Input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></Field><div className="form-grid two"><Field label="创作与分析模型"><Input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></Field><Field label="向量模型"><Input value={settings.embeddingModel} onChange={(event) => setSettings({ ...settings, embeddingModel: event.target.value })} /></Field></div><div className="form-grid two"><Field label="输入价格 / 百万 Token"><Input type="number" min={0} step="0.01" value={settings.inputPricePerMillion} onChange={(event) => setSettings({ ...settings, inputPricePerMillion: Number(event.target.value) })} /></Field><Field label="输出价格 / 百万 Token"><Input type="number" min={0} step="0.01" value={settings.outputPricePerMillion} onChange={(event) => setSettings({ ...settings, outputPricePerMillion: Number(event.target.value) })} /></Field></div><Field label="API 密钥" hint={settings.hasApiKey ? "留空会保留 Windows Credential Manager 中的现有密钥" : "密钥保存到 Windows Credential Manager，不写入项目数据库或备份包"}><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? "已安全保存" : "输入 API 密钥"} /></Field><div className="settings-actions"><Button icon={<Save size={16} />} onClick={async () => { try { const saved = await api.saveAiSettings({ baseUrl: settings.baseUrl, model: settings.model, embeddingModel: settings.embeddingModel, inputPricePerMillion: settings.inputPricePerMillion, outputPricePerMillion: settings.outputPricePerMillion }, apiKey || undefined); setSettings(saved); setApiKey(""); notify("模型设置已保存"); } catch (error) { notify(String(error), "error"); } }}>保存模型设置</Button></div></div></section>
    <section className="settings-section"><div className="settings-title"><span className="settings-icon"><Database size={19} /></span><div><h2>本地工作区</h2><p>全局目录库、研究隔离库和每本书的独立数据库。</p></div></div><div className="workspace-path"><HardDrive size={18} /><code>{workspace || "正在读取..."}</code></div><div className="security-points"><span><ShieldCheck size={16} />每本书独立 project.sqlite</span><span><FolderLock size={16} />研究原文不进入创作上下文</span><span><ShieldCheck size={16} />正文与规划保留历史版本</span></div></section>
    <section className="settings-section"><div className="settings-title"><span className="settings-icon"><ArchiveRestore size={19} /></span><div><h2>加密备份</h2><p>AES-256-GCM 加密，使用文件清单校验恢复完整性。</p></div></div><div className="backup-row"><Field label="备份密码" hint="至少 8 个字符；密码不会被保存"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><div className="backup-actions"><Button variant="secondary" disabled={password.length < 8 || busy} onClick={() => run("restore")} icon={<ArchiveRestore size={16} />}>校验并恢复副本</Button><Button disabled={password.length < 8 || busy} onClick={() => run("backup")} icon={<FolderLock size={16} />}>创建加密备份</Button></div></div></section>
  </div>;
}
