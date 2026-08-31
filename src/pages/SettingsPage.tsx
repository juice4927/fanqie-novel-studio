import { useEffect, useState } from "react";
import { Activity, ArchiveRestore, CalendarClock, Database, FileArchive, FolderLock, HardDrive, KeyRound, Play, RefreshCw, RotateCcw, Save, ShieldCheck, Square, Wrench } from "lucide-react";
import type { AiJobRecord, AiSettings, AppApi, AutoBackupSettings, HealthCheckTask, SystemHealthReport } from "../shared/types";
import { Badge, Button, Field, Input, Select } from "../components/UI";

const DEFAULT_AUTO_BACKUP: AutoBackupSettings = {
  enabled: false, frequency: "daily", retentionCount: 7, hasPassword: false,
  lastRunAt: null, lastStatus: "未运行", lastError: null, nextRunAt: null,
};

const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;
const elapsed = (from: string, to: string | null) => to ? `${((Date.parse(to) - Date.parse(from)) / 1000).toFixed(1)}s` : "--";
const upsertAiJob = (jobs: readonly AiJobRecord[], incoming: AiJobRecord) => [
  incoming,
  ...jobs.filter((job) => job.id !== incoming.id),
].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export function SettingsPage({ api, notify }: { api: AppApi; notify: (message: string, tone?: "success" | "error") => void }) {
  const [settings, setSettings] = useState<AiSettings>({ protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1", embeddingModel: "text-embedding-3-small", hasApiKey: false, inputPricePerMillion: 0, outputPricePerMillion: 0, longTaskTimeoutMinutes: 10 });
  const [apiKey, setApiKey] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [password, setPassword] = useState("");
  const [autoBackup, setAutoBackup] = useState(DEFAULT_AUTO_BACKUP);
  const [autoBackupPassword, setAutoBackupPassword] = useState("");
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [healthTask, setHealthTask] = useState<HealthCheckTask | null>(null);
  const [aiJobs, setAiJobs] = useState<AiJobRecord[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api.getAiSettings(), api.getWorkspacePath(), api.getAutoBackupSettings(), api.listAiJobs()]).then(([nextSettings, path, nextAutoBackup, jobs]) => { setSettings({ ...nextSettings, inputPricePerMillion: nextSettings.inputPricePerMillion ?? 0, outputPricePerMillion: nextSettings.outputPricePerMillion ?? 0, longTaskTimeoutMinutes: nextSettings.longTaskTimeoutMinutes ?? 10 }); setWorkspace(path); setAutoBackup(nextAutoBackup); setAiJobs(jobs); }); }, [api]);
  useEffect(() => {
    if (!aiJobs.some((job) => job.status === "运行中")) return;
    const timer = window.setTimeout(() => void api.listAiJobs().then(setAiJobs), 1000);
    return () => window.clearTimeout(timer);
  }, [aiJobs, api]);
  useEffect(() => {
    if (!healthTask || healthTask.status !== "运行中") return;
    const timer = window.setTimeout(() => {
      void api.getSystemHealthCheck(healthTask.id).then((next) => {
        setHealthTask(next);
        if (next.report) setHealth(next.report);
        if (next.status === "失败") notify(next.error || "健康检查失败", "error");
      }).catch((error) => notify(error instanceof Error ? error.message : String(error), "error"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, healthTask, notify]);

  const run = async (operation: "backup" | "restore") => {
    setBusy(true);
    try {
      const result = operation === "backup" ? await api.createBackup(password) : await api.restoreBackup(password);
      if (result) notify(operation === "backup" ? `加密备份已创建：${result}` : `备份已校验并恢复到副本目录：${result}`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); }
    finally { setBusy(false); }
  };

  const retryAiJob = async (jobId: string) => {
    try {
      const retried = await api.retryAiJob(jobId);
      setAiJobs((current) => upsertAiJob(current, retried));
      notify("AI 任务已重新开始");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return <div className="page settings-page">
    <header className="page-header"><div><p className="eyebrow">本地工作台</p><h1>系统设置</h1><p>模型调用、凭据、独立工作区与加密备份。</p></div></header>
      <section className="settings-section"><div className="settings-title"><span className="settings-icon"><KeyRound size={19} /></span><div><h2>模型供应商</h2><p>支持 OpenAI Responses、兼容 Chat Completions，以及 Anthropic Claude Messages API。</p></div><Badge tone={settings.hasApiKey ? "success" : "warning"}>{settings.hasApiKey ? "密钥已保存" : "未配置密钥"}</Badge></div><div className="settings-form"><Field label="接口协议" hint="通过 OpenRouter、OneAPI 等兼容网关调用 Claude 时，仍选择 OpenAI 兼容接口"><Select value={settings.protocol} onChange={(event) => { const protocol = event.target.value as AiSettings["protocol"]; setApiKey(""); setSettings({ ...settings, protocol, baseUrl: protocol === "anthropic-messages" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1", model: protocol === "anthropic-messages" ? "claude-sonnet-4-20250514" : "gpt-4.1", hasApiKey: false }); }}><option value="openai-compatible">OpenAI / 兼容接口</option><option value="anthropic-messages">Anthropic Claude</option></Select></Field><Field label="API 基础地址"><Input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} placeholder={settings.protocol === "anthropic-messages" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"} /></Field><div className="form-grid two"><Field label="创作与分析模型" hint={settings.protocol === "anthropic-messages" ? "填写 Anthropic 控制台当前可用的 Claude 模型 ID" : undefined}><Input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></Field><Field label="相关事实检索" hint="使用本地汉字相似度索引，正文和账本不会因此上传"><Input value="本地检索（无需配置）" disabled /></Field></div><Field label="长任务总时限" hint="适用于状态提取、语义质检、拆书、故事结构和批量章纲；流式连续 180 秒无数据仍会提前停止"><Select value={settings.longTaskTimeoutMinutes} onChange={(event) => setSettings({ ...settings, longTaskTimeoutMinutes: Number(event.target.value) })}><option value={5}>5 分钟</option><option value={10}>10 分钟（推荐）</option><option value={15}>15 分钟</option></Select></Field><div className="form-grid two"><Field label="输入价格 / 百万 Token"><Input type="number" min={0} step="0.01" value={settings.inputPricePerMillion} onChange={(event) => setSettings({ ...settings, inputPricePerMillion: Number(event.target.value) })} /></Field><Field label="输出价格 / 百万 Token"><Input type="number" min={0} step="0.01" value={settings.outputPricePerMillion} onChange={(event) => setSettings({ ...settings, outputPricePerMillion: Number(event.target.value) })} /></Field></div><Field label={settings.protocol === "anthropic-messages" ? "Anthropic API 密钥" : "API 密钥"} hint={settings.hasApiKey ? "协议和地址不变时留空会保留现有密钥；切换供应商时需要重新输入" : "密钥保存到 Windows Credential Manager，不写入项目数据库或备份包"}><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? "已安全保存" : settings.protocol === "anthropic-messages" ? "输入 sk-ant-... 密钥" : "输入 API 密钥"} /></Field><div className="settings-actions"><Button icon={<Save size={16} />} onClick={async () => { try { const saved = await api.saveAiSettings({ protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model, embeddingModel: settings.embeddingModel, inputPricePerMillion: settings.inputPricePerMillion, outputPricePerMillion: settings.outputPricePerMillion, longTaskTimeoutMinutes: settings.longTaskTimeoutMinutes }, apiKey || undefined); setSettings(saved); setApiKey(""); notify("模型设置已保存"); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } }}>保存模型设置</Button></div></div></section>
    <section className="settings-section"><div className="settings-title"><span className="settings-icon"><Database size={19} /></span><div><h2>本地工作区</h2><p>全局目录库、研究隔离库和每本书的独立数据库。</p></div></div><div className="workspace-path"><HardDrive size={18} /><code>{workspace || "正在读取..."}</code></div><div className="security-points"><span><ShieldCheck size={16} />每本书独立 project.sqlite</span><span><FolderLock size={16} />研究原文不进入创作上下文</span><span><ShieldCheck size={16} />正文与规划保留历史版本</span></div></section>
    <section className="settings-section">
      <div className="settings-title"><span className="settings-icon"><Activity size={19} /></span><div><h2>AI 任务中心</h2><p>查看任务状态、真实 Token、费用和中断记录。</p></div><Badge tone={aiJobs.some((job) => job.status === "运行中") ? "warning" : "neutral"}>{aiJobs.filter((job) => job.status === "运行中").length} 个运行中</Badge></div>
      {aiJobs.length ? <div className="ai-job-list">{aiJobs.slice(0, 30).map((job) => <article key={job.id}><div><strong>{job.inputSummary}</strong><small>{job.taskType} · {job.model} · {new Date(job.createdAt).toLocaleString()}</small><small>响应头 {elapsed(job.createdAt, job.headersAt)} · 首字 {elapsed(job.createdAt, job.firstTokenAt)} · {job.chunkCount} chunks / {job.attemptCount} 次请求{job.completedAt ? ` · 完成于 ${new Date(job.completedAt).toLocaleTimeString()}` : ""}</small>{job.error && <small className="job-error">{job.error}</small>}</div><span className={`job-status job-${job.status}`}>{job.status}</span><span className="job-usage">{job.inputTokens + job.outputTokens} Token<br />¥{job.actualCost.toFixed(4)} · {(job.durationMs / 1000).toFixed(1)}s</span>{job.status === "运行中" ? <Button variant="secondary" icon={<Square size={13} />} onClick={async () => { await api.cancelAiJob(job.id); setAiJobs(await api.listAiJobs()); }}>取消</Button> : job.retryable ? <Button variant="secondary" icon={<RotateCcw size={13} />} onClick={() => retryAiJob(job.id)}>重试</Button> : null}</article>)}</div> : <p className="health-empty">还没有 AI 调用记录。失败或中断后可回到原操作重试，五章批次会跳过已有正文。</p>}
    </section>
    <section className="settings-section"><div className="settings-title"><span className="settings-icon"><ArchiveRestore size={19} /></span><div><h2>加密备份</h2><p>AES-256-GCM 加密，使用文件清单校验恢复完整性。</p></div></div><div className="backup-row"><Field label="备份密码" hint="至少 8 个字符；密码不会被保存"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><div className="backup-actions"><Button variant="secondary" disabled={password.length < 8 || busy} onClick={() => run("restore")} icon={<ArchiveRestore size={16} />}>校验并恢复副本</Button><Button disabled={password.length < 8 || busy} onClick={() => run("backup")} icon={<FolderLock size={16} />}>创建加密备份</Button></div></div></section>
    <section className="settings-section">
      <div className="settings-title"><span className="settings-icon"><CalendarClock size={19} /></span><div><h2>自动加密备份</h2><p>专用密码存入 Windows Credential Manager，备份保存在工作区 backups 目录。</p></div><Badge tone={autoBackup.lastStatus === "失败" ? "danger" : autoBackup.enabled ? "success" : "neutral"}>{autoBackup.enabled ? autoBackup.lastStatus : "未启用"}</Badge></div>
      <div className="settings-form">
        <label className="backup-toggle"><input type="checkbox" checked={autoBackup.enabled} onChange={(event) => setAutoBackup({ ...autoBackup, enabled: event.target.checked })} />启用自动备份</label>
        <div className="form-grid two">
          <Field label="备份频率"><Select value={autoBackup.frequency} onChange={(event) => setAutoBackup({ ...autoBackup, frequency: event.target.value as AutoBackupSettings["frequency"] })}><option value="daily">每天</option><option value="weekly">每周</option></Select></Field>
          <Field label="保留份数" hint="自动轮换 1–30 份"><Input type="number" min={1} max={30} value={autoBackup.retentionCount} onChange={(event) => setAutoBackup({ ...autoBackup, retentionCount: Number(event.target.value) })} /></Field>
        </div>
        <Field label="自动备份专用密码" hint={autoBackup.hasPassword ? "留空会保留 Credential Manager 中的现有密码" : "首次启用必须设置至少 8 位密码；忘记后无法恢复备份"}><Input type="password" value={autoBackupPassword} onChange={(event) => setAutoBackupPassword(event.target.value)} placeholder={autoBackup.hasPassword ? "已安全保存" : "至少 8 个字符"} /></Field>
        <div className="backup-status-grid"><span>上次执行<strong>{autoBackup.lastRunAt ? new Date(autoBackup.lastRunAt).toLocaleString() : "尚未运行"}</strong></span><span>下次执行<strong>{autoBackup.nextRunAt ? new Date(autoBackup.nextRunAt).toLocaleString() : "未安排"}</strong></span>{autoBackup.lastError && <span className="backup-error">最近错误<strong>{autoBackup.lastError}</strong></span>}</div>
        <div className="settings-actions">
          <Button variant="secondary" disabled={!autoBackup.enabled || busy} icon={<Play size={16} />} onClick={async () => { setBusy(true); try { const result = await api.runAutoBackup(); setAutoBackup(result); notify(result.lastStatus === "成功" ? "自动备份已完成" : result.lastError || "自动备份失败", result.lastStatus === "成功" ? "success" : "error"); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } }}>立即备份</Button>
          <Button disabled={busy || autoBackup.retentionCount < 1 || autoBackup.retentionCount > 30 || (autoBackup.enabled && !autoBackup.hasPassword && autoBackupPassword.length < 8)} icon={<Save size={16} />} onClick={async () => { setBusy(true); try { const saved = await api.saveAutoBackupSettings({ enabled: autoBackup.enabled, frequency: autoBackup.frequency, retentionCount: autoBackup.retentionCount }, autoBackupPassword || undefined); setAutoBackup(saved); setAutoBackupPassword(""); notify(autoBackup.enabled ? "自动备份已启用" : "自动备份已关闭，专用密码已删除"); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } }}>保存自动备份设置</Button>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <div className="settings-title"><span className="settings-icon"><Activity size={19} /></span><div><h2>系统健康</h2><p>检查数据库完整性、章节搜索索引、项目目录和本地空间占用。</p></div>{health && <Badge tone={health.status === "正常" ? "success" : health.status === "警告" ? "warning" : "danger"}>{health.status}</Badge>}</div>
      <div className="settings-form">
        {health ? <><div className="health-summary"><span>作品<strong>{health.projectCount}</strong></span><span>章节<strong>{health.chapterCount}</strong></span><span>失败 AI 任务<strong>{health.failedAiJobs}</strong></span><span>工作区<strong>{formatBytes(health.workspaceBytes)}</strong></span><span>备份<strong>{formatBytes(health.backupBytes)}</strong></span></div><div className="health-check-list">{health.checks.map((check) => <article key={check.id} className={`health-${check.status}`}><span><i /> <strong>{check.label}</strong><small>{check.detail}</small></span>{check.repairable && check.projectId && <Button variant="secondary" disabled={busy} icon={<Wrench size={14} />} onClick={async () => { setBusy(true); try { const report = await api.rebuildSearchIndexes(check.projectId!); setHealth(report); notify("章节搜索索引已从正文记录重建"); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } }}>重建索引</Button>}</article>)}</div></> : <p className="health-empty">健康检查只读取数据库结构和统计信息，不读取或上传正文内容。</p>}
        {healthTask?.status === "运行中" && <div className="health-progress" role="status"><div><span>{healthTask.label}</span><strong>{healthTask.completed} / {healthTask.total}</strong></div><progress max={Math.max(healthTask.total, 1)} value={healthTask.completed} /></div>}
        {healthTask?.status === "已取消" && <p className="health-empty">健康检查已取消，未修改任何数据。</p>}
        <div className="settings-actions"><Button variant="secondary" disabled={busy} icon={<FileArchive size={16} />} onClick={async () => { setBusy(true); try { const result = await api.exportDiagnosticBundle(); if (result) notify(`诊断包已导出：${result}`); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } }}>导出诊断包</Button>{healthTask?.status === "运行中" ? <Button variant="secondary" icon={<Square size={14} />} onClick={async () => { await api.cancelSystemHealthCheck(healthTask.id); setHealthTask(await api.getSystemHealthCheck(healthTask.id)); }}>取消检查</Button> : <Button disabled={busy} icon={<RefreshCw size={16} />} onClick={async () => { try { const task = await api.startSystemHealthCheck(); setHealthTask(task); if (task.report) setHealth(task.report); } catch (error) { notify(error instanceof Error ? error.message : String(error), "error"); } }}>{health ? "重新检查" : "运行健康检查"}</Button>}</div>
      </div>
    </section>
  </div>;
}
