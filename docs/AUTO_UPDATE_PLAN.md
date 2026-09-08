# 自动更新完整方案

> 版本：2026-09-08 · 基线 v0.2.1（已发布）
> 现状：`electron-updater` 已接入，发布通道（GitHub Release + `latest.yml`）已打通，但更新过程对用户完全不可见，且未设置自动备份密码时更新会被静默放弃。

## 1. 现状核对

| 项 | 现状 | 位置 |
|---|---|---|
| 更新依赖 | `electron-updater` 已安装 | `package.json` |
| 检查时机 | 打包版启动 15 秒后检查一次，此后不再检查 | `electron/update-service.ts:22` |
| 下载 | `autoDownload = true`，后台自动下载 | `update-service.ts:7` |
| 安装 | 下载完成后先建加密快照，再 `quitAndInstall` **静默重启** | `update-service.ts:13-21`、`electron/main.ts:417-426` |
| 快照 | `pre-update-<版本>.novelbak`，需 Windows 凭据管理器里的自动备份密码 | `main.ts:419-420` |
| 用户界面 | 无。全仓库无更新相关 IPC，设置页无"更新"字样 | — |
| 发布通道 | GitHub Release + `latest.yml`，v0.2.1 已实测可下载 | `.github/workflows/release.yml` |
| 测试 | 无 | — |

### 缺陷

1. **不可见**：没有版本号、检查按钮、下载进度、更新说明，用户不知道更新存在。
2. **隐性死结**：`beforeInstall` 依赖自动备份密码，未保存就抛错并放弃更新，只在 JSONL 日志记 `update.backup_failed`。
3. **静默重启**：下载完成直接 `quitAndInstall`，不询问；写作台有自动保存与恢复稿，其他工作台的未保存编辑会丢；进行中的 AI 生成会中断。
4. **不健壮**：无重试、无周期检查（长会话拿不到更新）、无测试。

## 2. 目标与非目标

**目标**

- 更新可见：当前版本、检查、下载进度、更新说明、就绪提示。
- 更新可控：安装必须用户确认；提供"自动检查""退出时自动安装"两个开关。
- 更新安全：安装前强制加密快照；备份失败或生成任务进行中拒绝安装；不丢数据。
- 更新可诊断：失败有明确文案，日志有结构化记录。

**非目标**

- 不引入 beta/灰度通道（列为后续可选）。
- 不改动人工门禁与发布流程。
- 不提供自定义更新源（安全边界，见 §8）。

## 3. 总体架构

```text
渲染层                                主进程
┌────────────────────┐   invoke     ┌─────────────────────────────┐
│ 设置页「软件更新」卡片 │ ──────────▶ │ update-handlers             │
│ 全局就绪横幅         │             │   getUpdateStatus           │
└────────────────────┘             │   checkForUpdates           │
          ▲                        │   installUpdate             │
          │ studio:update-status   │   saveUpdateSettings        │
          │ （事件推送）             └──────────────┬──────────────┘
          └───────────────────────────────────────┤
                                                  ▼
                                    ┌─────────────────────────────┐
                                    │ UpdateService（状态机）      │
                                    │  electron-updater           │
                                    │  WorkspaceDatabase（settings）│
                                    │  createEncryptedBackup      │
                                    │  chapterGeneration          │
                                    └─────────────────────────────┘
```

安全边界：`electron-updater` 自带 HTTPS 直连 GitHub，是 `netguard.ts` 的既定例外；更新源固定为 `juice4927/fanqie-novel-studio`，不暴露自定义 URL，只请求 `latest.yml`，不上传任何创作数据。需在 `docs/security.md` 记录。

## 4. 状态机与数据结构

```text
idle ──check──▶ checking ──┬──▶ up-to-date ──(6h / 手动)──▶ checking
                           ├──▶ available ──download──▶ downloading ──▶ downloaded
                           └──▶ error ──(退避重试)──▶ checking
downloaded ──install──▶ installing ──▶ 退出并安装
```

```ts
export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null; // downloading 时 0–100
  releaseNotes: string | null;
  lastCheckedAt: string | null; // ISO
  error: string | null; // 已脱敏
  autoCheck: boolean;
  autoInstallOnQuit: boolean;
  backupPasswordRequired: boolean; // 未保存自动备份密码
  canInstall: boolean; // phase === "downloaded" && !backupPasswordRequired
}
```

持久化（`settings` 表，复用现有 key-value 存储）：

| key | 默认 | 说明 |
|---|---|---|
| `update.autoCheck` | `"1"` | 启动及每 6 小时自动检查 |
| `update.autoInstallOnQuit` | `"0"` | 退出时自动安装已下载更新 |

`WorkspaceDatabase` 新增公开方法 `getUpdateSettings()` / `saveUpdateSettings(input)`（`getSetting/setSetting` 目前是私有，需要公开包装）。

## 5. IPC 契约

| 通道 | 签名 | 说明 |
|---|---|---|
| `getUpdateStatus` | `() => UpdateStatus` | 拉取当前状态 |
| `checkForUpdates` | `() => UpdateStatus` | 手动检查；未打包时返回 `idle` 并附说明 |
| `installUpdate` | `(password?: string) => void` | 立即安装；`password` 用于未保存自动备份密码时的一次性快照 |
| `saveUpdateSettings` | `({autoCheck, autoInstallOnQuit}) => UpdateStatus` | 保存偏好 |
| `studio:update-status` | 事件（主进程 → 渲染层） | 状态推送，仿 `studio:chapter-facts-extracted` |

同步改动：`src/shared/types.ts`（`UpdateStatus` + AppApi）、`electron/ipc-validation.ts`（Zod schema，`schemas satisfies Record<InvokeApiKey, …>` 会强制补齐）、`electron/preload.ts`、`src/lib/browser-api.ts`（桌面能力降级）。

## 6. 主进程设计

`electron/update-service.ts` 重写为工厂：

```ts
createUpdateService({
  logger,
  database,            // getUpdateSettings / saveUpdateSettings / listProjects
  isGenerationActive,  // (projectId: string) => boolean
  readBackupPassword,  // () => Promise<string | null>
  createBackup,        // (password: string) => Promise<void>
  publish,             // (status: UpdateStatus) => void
}): {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(password?: string): Promise<void>;
  saveSettings(input: { autoCheck: boolean; autoInstallOnQuit: boolean }): UpdateStatus;
  dispose(): void;
};
```

### 关键流程

1. **启动**：`app.isPackaged && !NOVEL_STUDIO_DISABLE_AUTO_UPDATE && autoCheck` → 15s 后检查，此后每 6h（定时器 `unref`）。
2. **check()**：置 `checking` → `autoUpdater.checkForUpdates()`；`update-available` → `available`（`autoDownload=true` 自动进入 `downloading`）；`update-not-available` → `up-to-date`。
3. **download-progress**：更新 `progressPercent` 并推送；节流到约 500ms 一次，避免 IPC 洪水。
4. **update-downloaded**：置 `downloaded`，**不重启**；读取是否有自动备份密码，设置 `backupPasswordRequired / canInstall`，推送状态。
5. **install(password?)**：
   - 忙碌守卫：遍历 `database.listProjects()`，任一 `isGenerationActive(id)` → 抛"正在生成正文，请等待完成或取消任务后再安装"。
   - 取密码：`password ?? readBackupPassword()`；都没有 → 抛"需要备份密码才能安装更新"（UI 弹一次性输入）。
   - `database.checkpointAll()` → `createBackup(password)` 生成 `pre-update-<currentVersion>.novelbak`。
   - 置 `installing` → `autoUpdater.quitAndInstall(false, true)`。
   - 备份失败：保持 `downloaded`，记录 `update.backup_failed`，把错误抛给 UI。
6. **失败退避**：check 失败后 30min → 2h → 6h 重试，最多 3 次，之后等下个启动周期。
7. **退出时安装**（`autoInstallOnQuit=true`）：`before-quit` 中 `event.preventDefault()` → 执行备份 → `quitAndInstall`；备份失败则放行正常退出并保留已下载的更新包。

### 安装时序

```text
用户点「立即重启并安装」
  → installUpdate(password?)
  → 忙碌检查
  → checkpointAll
  → 加密快照（UI 显示"正在备份…"）
  → quitAndInstall → 退出 → NSIS 静默安装 → 自动重启
  → 新版本启动
```

## 7. 渲染层设计

### 设置页「软件更新」卡片（放在"系统健康"之前）

- 当前版本 `status.currentVersion`、上次检查时间 `lastCheckedAt`。
- 按钮 `检查更新`（`checking` 时禁用并转圈）。
- 状态行按 phase 展示：
  - `up-to-date`：已是最新版本
  - `available` / `downloading`：发现 0.2.2，正在后台下载（进度条）
  - `downloaded`：0.2.2 已就绪
  - `error`：`describeError(error)` + 重试
- `releaseNotes` 折叠展示。
- 主按钮 `立即重启并安装`（`canInstall` 时可用；`backupPasswordRequired` 时点击弹一次性密码输入）。
- 次按钮 `稍后`（仅关闭提示，保留已下载的包）。
- 开关：`自动检查更新`（默认开）、`退出时自动安装`（默认关）。

### 全局就绪横幅（`src/App.tsx`）

`downloaded` 时显示：`新版本 0.2.2 已就绪` + `重启安装` / `稍后`。点击前先在渲染层做未保存检查（写作台 dirty 时先保存或确认）。

## 8. 安全与隐私

- 更新源固定为 `juice4927/fanqie-novel-studio`，不提供自定义地址；`electron-updater` 使用 HTTPS 并内建 `latest.yml` 的 sha512 校验。
- 更新检查只 GET `latest.yml`，不发送任何本地数据、正文、账本或凭据。
- 关闭方式：设置开关 / `NOVEL_STUDIO_DISABLE_AUTO_UPDATE=1` / 未打包运行（`app.isPackaged=false` 自动禁用）。
- 安装前强制加密快照；备份失败即中止安装，保留当前版本。
- 未签名导致的 SmartScreen 提示在 README 说明；配置证书后可通过 `win.publisherName` 校验发布者。
- 在 `docs/security.md` 记录"electron-updater 直连 GitHub 是 netguard 的例外"。

## 9. 文件级改动清单

| 文件 | 改动 |
|---|---|
| `electron/update-service.ts` | 重写为有状态服务（保留 beforeInstall 语义） |
| `electron/main.ts` | 注入服务、注册 handler、推送状态、退出时安装钩子 |
| `electron/handlers/update-handlers.ts` | 新增 4 个通道 |
| `electron/ipc-validation.ts` | 4 个 Zod schema |
| `electron/preload.ts` | 4 个方法 + `onUpdateStatus` |
| `src/shared/types.ts` | `UpdateStatus` + AppApi |
| `src/lib/browser-api.ts` | 桌面能力降级实现 |
| `electron/database.ts` | `getUpdateSettings` / `saveUpdateSettings` |
| `src/pages/SettingsPage.tsx` | 「软件更新」卡片 |
| `src/App.tsx` | 就绪横幅 |
| `src/styles.css` | 卡片 / 进度条 / 横幅样式 |
| `docs/security.md`、`README.md` | 策略与例外说明 |
| `tests/update-service.test.ts` | 新增状态机测试 |
| `tests/settings-page.test.tsx` | 更新卡片 UI 用例 |

## 10. 测试方案

- `tests/update-service.test.ts`（注入假的 autoUpdater）：
  - 检查 → 发现 → 下载进度 → 就绪 → 安装调用；
  - 无备份密码时 `canInstall=false`、`backupPasswordRequired=true`；
  - 生成任务进行中 `install` 抛错；
  - 备份失败保持 `downloaded`；
  - 退避重试最多 3 次。
- `tests/settings-page.test.tsx`：卡片在各 phase 的渲染、按钮禁用/可用、一次性密码弹窗。
- e2e：用 `NOVEL_STUDIO_DISABLE_AUTO_UPDATE=1` 保证测试不触发真实网络。
- 手工端到端：安装 0.2.1 → 发布 0.2.2 → 观察发现/下载/横幅/安装/版本变化/数据完整。

## 11. 实施步骤（提交切分）

1. `feat(update): expose update state and IPC` — 服务 + 类型 + schema + preload + handlers + 单元测试（不含 UI）
2. `feat(update): add update card and ready banner` — 设置卡片 + 横幅 + 样式 + UI 测试
3. `fix(update): require explicit install and surface backup-password blocker` — 移除自动 `quitAndInstall`、一次性密码、忙碌守卫
4. `test(update): cover state machine and install guard`
5. `docs(update): document channel, settings and security exception`

每步验收：`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`；涉及 UI 追加 `npm run test:e2e`。

## 12. 验收标准

- 0.2.1 安装版能发现 0.2.2、后台下载、显示就绪横幅、点击安装后备份并重启，版本号变为 0.2.2，项目/章节/账本/凭据完整。
- 未设置自动备份密码时，安装按钮给出明确原因并可临时输入密码，不再静默失败。
- 关闭"自动检查更新"后不再发起任何网络请求。
- 正文生成任务进行中点击安装被拒绝并提示。
- 点"稍后"不丢失已下载的更新包。
- `npm test`、`test:coverage`、`build`、`test:e2e`、`test:electron` 全绿。

## 13. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 无签名安装触发 SmartScreen | README 说明；后续配证书 |
| 大工作区备份耗时长 | 备份前显示进度、允许取消；`pre-update-*.novelbak` 可手动清理 |
| GitHub 限流 / 网络不可达 | 退避重试 + 错误可见 + 手动重试 |
| electron-updater 行为差异 | 固定版本 + 假实现单元测试 + 手工端到端验收 |
| 更新后数据不兼容 | 安装前快照 + 现有 `migration-runner`；必要时回退旧安装包 |

回滚开关：`NOVEL_STUDIO_DISABLE_AUTO_UPDATE=1`；或从 Release 下载旧版覆盖安装（工作区数据不删除）。

## 14. 工作量

| 阶段 | 内容 | 估计 |
|---|---|---|
| 1 | 服务 + IPC + 单元测试 | 1 天 |
| 2 | 设置卡片 + 就绪横幅 + 样式 | 0.5 天 |
| 3 | 显式安装 + 一次性密码 + 忙碌守卫 + 退出安装 | 1 天 |
| 4 | 文档 + 端到端验收 | 0.5 天 |
| 合计 | | **约 3 人日** |

后续可选：代码签名、差分更新（需随 Release 上传 `.blockmap`）、beta 通道（`latest-beta.yml` + prerelease 标签）。
