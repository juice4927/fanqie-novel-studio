# 出站代理方案（2026-09-08）

> 目标：给工作台加一个**可选**的出站代理通道，支持 HTTP/HTTPS/SOCKS5 与可选认证，覆盖全部 `netguard` 出站（模型调用 + 番茄公开页/榜单抓取）。默认关闭。
>
> 与 `AI_CONNECTION_PLAN.md` 的关系：该方案 §9.1 已把代理列为“另线推进”，只约定 dispatcher 工厂扩展点。**本文就是那条线**，沿用其接口约定（dispatcher 由解析器/工厂提供，不改 driver、runtime 与 netguard 的地址校验），并正面回答它留下的四个待解问题：系统代理 vs 显式地址、`ProxyAgent` 与 `createPublicLookup` 如何共存、自定义 CA 与 MITM 提示、代理凭据存放。
>
> 约束不变：所有出站流量仍走 `electron/netguard.ts`（AGENTS.md 规则 3）；代理凭据只进 Windows Credential Manager；`src/shared/` 保持纯净；不引入新的运行时依赖；人工门禁与审计语义不动。

## 实施状态（2026-09-08，已全部落地）

验收基线：`npx tsc --noEmit` ✅、`npm run lint` ✅、`npm test` 533 通过 / 1 跳过、`npm run test:quality` 16 通过、`npm run build` ✅、`npm run test:e2e` 20 通过。

| 提交 | 状态 | 落地内容 |
|---|---|---|
| 1 SSE 修复 | ✅ | `electron/ai/drivers/sse.ts` 三级兜底（逐行 → 无分隔拼接 → 换行拼接）+ `normalizeSseText`（裸 CR 归一、末尾孤立 CR 留给下一块），三个流式读取器统一使用；`tests/ai-sse.test.ts` 6 例 |
| 2 netguard 代理通道 | ✅ | `parseProxyUrl` / `configureOutboundProxy` / `getOutboundProxyConfig` / `checkProxyDestination` / `setOutboundProxyDnsObserver`；`GuardedFetchOptions.dispatcher` 由 `Agent` 放宽为 `Dispatcher`；优先级 `options.dispatcher ?? 代理 dispatcher ?? publicDispatcher` |
| 3 持久化与 IPC | ✅ | `network.proxy.enabled/url/username` + `cn.local.fanqie.novelstudio/outbound-proxy` 凭据 + `electron/handlers/network-handlers.ts` 三通道 + 启动配置（失败只回退直连）+ 浏览器预览桩 |
| 4 UI | ✅ | 设置页「网络代理」分区：启用开关、地址、用户名、密码、保存、测试连通性（先保存再探测） |
| 5 文档 | ✅ | `docs/security.md` 新增「出站代理（可选）」；`AGENTS.md` 规则 3 更新；本文件补实施状态 |

关键验证：`tests/outbound-proxy.test.ts` 用 `tests/stub-proxy.ts`（真实 CONNECT 桩代理）证明 Node 内置 fetch + `ProxyAgent` dispatcher 这条路径可用，并断言了 CONNECT 目标 `example.invalid:80` 与 `proxy-authorization: Basic ...`。

与计划的偏差：无。`saveProxySettings` 只把 enabled/url/username 写库，密码不落库；`hasPassword` 由 handler 注入。

顺带完成：`AI_CONNECTION_PLAN.md` §5.7 的本地端点豁免（`assertLocalEndpointUrl` + `fetchLocalEndpointResponse` + 驱动 `localEndpoint` 透传）已一并实现，本方案 §9「本地模型服务仍不可用」一条不再适用。

## 0. 一句话结论

`fetchPublicHttpResponse` 早就留了 `dispatcher` 注入口（`netguard.ts:108,127`）却从没人用过；本次只做三件事：把该注入口接到一个由设置页配置的 `ProxyAgent`、把代理地址校验从目的地校验里拆出来、把代理设置接进现有的 settings / Credential Manager / IPC 三件套。**不新增任何 HTTP 出口，不新增依赖**（undici 7.29 自带 `ProxyAgent`，且原生识别 `socks5://`）。

## 1. 现状（有据可查）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 全应用只有一个 HTTP 出口 | `electron/netguard.ts:112` `fetchPublicHttpResponse`；`electron/` 与 `src/` 内无裸 `fetch(`、无 `http(s).request`、无 `axios` |
| 2 | 调用方只有两处 | 模型：`electron/ai-service.ts:286`（`allowCrossOriginRedirect: false`）；公开页/榜单：`electron/ranking-service.ts:30`（`allowCrossOriginRedirect: true`） |
| 3 | dispatcher 注入口已存在但无人使用 | `netguard.ts:108` `dispatcher?: Agent`；`:127` `options.dispatcher ?? publicDispatcher`；全仓无调用方传参 |
| 4 | 目的地守卫有两层 | 语法层 `assertPublicHttpUrlSyntax`（`netguard.ts:56`）逐跳复检；DNS 层 `createPublicLookup`（`:76`）把连接固定到已校验 IP，防 DNS rebinding（BUG_REPORT M27） |
| 5 | 依赖里已有 undici 7.29，且 `ProxyAgent` 原生支持 SOCKS5 | `package.json:41`；`node_modules/undici/lib/dispatcher/proxy-agent.js:138-148` 在 `protocol === 'socks5:' \|\| 'socks:'` 时内部转交 `Socks5ProxyAgent` |
| 6 | 认证参数语义已核实 | 同上 `:119-127`：`token` 原样写入 `proxy-authorization` 头（需自带 `Basic ` 前缀）；`username`/`password` 仅透传给 SOCKS5 分支（`:143-144`） |
| 7 | 目前没有任何代理配置 | 全仓唯一“代理”字样是错误提示 `src/lib/error-message.ts:18` |
| 8 | SSE 多行 `data:` 已有半套修复 | `electron/ai-provider.ts:129-143` `parseSseData` 已按“逐行独立解析、失败再 `join("\n")`”兜底（即 BUG_VERIFICATION 建议写法），但字符串中间被切开时仍会失败，见 §7 提交 1 |

## 2. 设计决策

### 2.1 只加通道，不新增出口

代理 dispatcher 由 `netguard` 自己持有，`fetchPublicHttpResponse` 的优先级为：

```
options.dispatcher  →  已配置的代理 dispatcher  →  publicDispatcher
```

`ai-service.ts` 与 `ranking-service.ts` **一行都不用改**，AGENTS.md 规则 3 的“禁止裸 fetch”继续成立。

### 2.2 三种协议一条构造路径

不单独构造 `Socks5ProxyAgent`：`ProxyAgent` 在 URL 为 `socks5:`/`socks:` 时内部已转交（§1 第 5 条）。因此：

| 代理协议 | 构造 | 认证 |
|---|---|---|
| `http:` / `https:` | `new ProxyAgent({ uri, token? })` | `token: "Basic " + base64(user:pass)` |
| `socks5:` / `socks:` | `new ProxyAgent({ uri, username?, password? })` | `username` / `password` 选项 |
| `socks4:` | **拒绝**（undici 不支持） | — |

### 2.3 代理地址与目的地分开校验

新增 `parseProxyUrl(value): URL`，规则与目的地相反：

- 协议白名单：`http:` / `https:` / `socks5:` / `socks:`。
- 禁止 URL 内嵌凭据、路径、查询参数、片段（凭据走独立字段）。
- **允许** `localhost`、`127.0.0.1`、`[::1]`、私网地址——这正是本地代理的场景。
- 长度上限 2000（Zod 层）。

`assertPublicHttpUrlSyntax` 对**目的地**完全不变：开了代理也照样逐跳拒绝本机/私网字面量。

### 2.4 开代理后如何继续防私网（回答 §9.1）

`createPublicLookup` 的 DNS 固定依赖“本进程直连目的地”。走代理时目的地连接由代理建立，本进程拿不到那次 DNS，**这一层必然失效**。本方案的答案是“能校验的继续校验，不能校验的显式降级”：

| 目的地形态 | 无代理 | 有代理 |
|---|---|---|
| 字面量私网/本机 IP、`localhost` | 拒绝 | **仍拒绝**（语法层逐跳） |
| 域名，本地解析成功且含私网地址 | 拒绝 | **仍拒绝**（新增本地预解析校验） |
| 域名，本地解析成功且全为公网 | 固定该 IP 连接 | 放行，由代理解析（本地结果不再用于连接） |
| 域名，本地解析失败（NXDOMAIN/超时） | 拒绝 | **放行**，由代理解析；记 `netguard.proxy.dns_unresolved` 日志 |

实现：代理启用时，每次请求（含每个重定向跳）在发送前调用 `resolvePublicAddresses(hostname)`；解析成功且含私网即抛错，解析失败（或超过 3 秒）则放行。**这不是新增开销**——今天直连时每个连接本来就要做同样的本地解析，只是结果从“用于连接”变成“用于校验”。

放行理由是刻意的取舍：本地解析不到域名正是用户需要代理的原因（DNS 污染/被墙），若失败即拒绝，这个功能对它的主要场景就是不可用的。残余风险与加固方向见 §3.2。

### 2.5 显式地址，不做系统代理/PAC

只支持用户填写的显式代理地址，不读取 WinINET / 注册表 / PAC、不读 `HTTP(S)_PROXY` 环境变量。理由：行为可预测、可测试，且避免把 API 密钥隐式交给用户并未明确选择的系统代理。若将来需要，可在此接口上再加“跟随系统代理”的来源解析，不改调用方。

### 2.6 不做自定义 CA（本轮）

企业 MITM 代理需要自定义根证书才能通过 TLS 校验，本轮**不提供** CA 导入（那等于让应用信任一个用户提供的根证书，是独立的安全面）。后果：这类代理下模型请求会因证书校验失败而报错。UI 文案明确提示“请只填写你能信任的代理；密钥会经代理转发”。`ProxyAgent` 的 `proxyTls`/`requestTls` 已预留，将来若做 CA 需单独评审。

### 2.7 独立 IPC，不塞进 `AiSettings`

代理同时作用于榜单抓取，不是模型专属配置。因此新增三个通道，放在新模块 `electron/handlers/network-handlers.ts`：

- 不污染 `AiSettings` 的 `.strict()` 对象与 `saveAiSettings` 的“换端点即清密钥”逻辑；
- 不动 `tests/ai-handlers.test.ts` 里 `registerAiHandlers` 的 handler 键快照。

### 2.8 连通性测试打用户自己的模型地址

`testProxyConnection` 经 `netguard` 对 `ai.baseUrl` 发一次**不带密钥**的 GET：拿到任何 HTTP 状态码即判定链路通，返回状态码与耗时；不引入任何第三方探活地址，也不新增裸 fetch。测试对象是**已保存并生效**的配置（UI 流程：先保存、再测试）。

## 3. 安全模型

### 3.1 仍然成立的

- 全部出站仍经 `fetchPublicHttpResponse`，仍是唯一出口。
- 目的地逐跳 `assertPublicHttpUrlSyntax`；模型请求仍禁跨来源重定向、仍禁重定向改方法。
- 字面量本机/私网地址在任何配置下都拒绝。
- 代理凭据只进 Credential Manager，不写库、不写日志、不进备份。
- 代理默认关闭；启用需要用户显式保存一次。

### 3.2 降级与残余风险（必须写进 `docs/security.md`）

| 风险 | 说明 | 处理 |
|---|---|---|
| 目的地 DNS 固定失效 | 代理自己解析目的地，M27 的“固定已校验 IP”不再覆盖目的地 | 保留 §2.4 的本地预解析校验；剩余路径（本地解析失败）显式降级并记日志 |
| 本地解析失败时放行 | 攻击者若能让某域名本地解析失败、又让代理解析到私网，可绕过 | 属已知取舍；加固方向：对非本地代理改为 fail-closed（记为后续可选项，本轮不做） |
| 密钥经代理转发 | 代理可读取 Authorization / x-api-key | UI 明确提示“只填可信代理”；不做静默启用 |
| MITM 代理 | 自定义 CA 不被信任 | 本轮不支持 CA 导入（§2.6），失败即报错，不静默降级 TLS |
| 系统代理未跟随 | 用户以为“已设代理”实际应用没走 | UI 文案写明“只作用于本应用，不读取系统代理设置” |

### 3.3 明确不做

- 不启动任何本地代理进程（继续符合 `AI_CONNECTION_PLAN.md` §8“不做网关”）。
- 不做按来源/按任务的代理分流（全局开关；未来多来源落地后可在 `ai_profiles` 加 `proxy_id`，dispatcher 工厂是现成扩展点）。
- 不改 `electron-updater` 的既定例外（自动更新不受本设置影响）。

## 4. 接口设计

### 4.1 `electron/netguard.ts` 新增导出

```ts
export interface OutboundProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

/** 解析并校验代理地址；允许本机/私网，禁止 URL 内嵌凭据、路径、查询与片段。 */
export function parseProxyUrl(value: string): URL;

/** 配置或清除全局出站代理；传 null 恢复直连。构建失败时抛错且不改变现有配置。 */
export function configureOutboundProxy(config: OutboundProxyConfig | null): void;

/** 供日志与测试读取当前代理（不含密码）。 */
export function getOutboundProxyConfig(): { url: string; username?: string } | null;
```

改动点：`GuardedFetchOptions.dispatcher` 由 `Agent` 放宽为 `Dispatcher`（`ProxyAgent`/`Socks5ProxyAgent` 继承 `Dispatcher`，不是 `Agent`）；`fetchPublicHttpResponse` 按 §2.1 优先级取 dispatcher；代理启用时按 §2.4 做本地预解析校验。

### 4.2 共享类型（`src/shared/types.ts`）

```ts
export interface ProxySettings {
  enabled: boolean;
  url: string;
  username: string;
  hasPassword: boolean;
}

export interface ProxySettingsInput {
  enabled: boolean;
  url: string;
  username: string;
  password?: string; // 留空表示保持已保存的密码
}
```

`AppApi` 新增：

```ts
getProxySettings(): Promise<ProxySettings>;
saveProxySettings(input: ProxySettingsInput): Promise<ProxySettings>;
testProxyConnection(): Promise<{ ok: boolean; message: string }>;
```

### 4.3 IPC 与校验（`electron/ipc-validation.ts`）

| 通道 | 参数 schema 要点 |
|---|---|
| `getProxySettings` | `noArgs` |
| `saveProxySettings` | `.strict()` 对象：`enabled: boolean`；`url: z.string().max(2000)`（协议白名单 + 禁止内嵌凭据 refine）；`username: z.string().max(200)`；`password: z.string().max(1000).optional()` |
| `testProxyConnection` | `noArgs` |

权威校验仍在 `parseProxyUrl`（handler 内调用，错误信息带具体原因）；Zod 层只做长度与协议白名单，避免两套规则漂移。

### 4.4 持久化与凭据

| 项 | 位置 |
|---|---|
| 开关 / 地址 / 用户名 | 全局 `catalog.sqlite` 的 `settings` 表：`network.proxy.enabled` / `network.proxy.url` / `network.proxy.username` |
| 密码 | Windows Credential Manager，新 target `cn.local.fanqie.novelstudio/outbound-proxy` |
| 默认值 | `enabled=false`、`url=""`、`username=""`、无密码 |

`database.getProxySettings()` / `saveProxySettings()` 与现有 `getAiSettings()` / `saveAiSettings()` 同构（DB 层 `hasPassword` 恒为 `false`，由 handler 注入真实值）。`credential-store.ts` 新增 `readProxyCredential` / `writeProxyCredential` / `deleteProxyCredential`。

### 4.5 主进程接线（`electron/main.ts`）

启动时（`database` 创建之后、任何出站之前）：

```ts
const proxy = database.getProxySettings();
if (proxy.enabled && proxy.url) {
  try {
    const password = await readProxyCredential();
    configureOutboundProxy({ url: proxy.url, username: proxy.username || undefined, password: password || undefined });
    logger.write("info", "proxy.configured", { url: new URL(proxy.url).origin });
  } catch (error) {
    configureOutboundProxy(null); // 配置坏了只回退直连，绝不阻止启动
    logger.write("error", "proxy.configure.failed", { error: String(error) });
  }
}
```

保存流程：`parseProxyUrl` 校验 → 写/删凭据 → 写库 → `configureOutboundProxy` → 返回掩码设置。密码规则：填了就写；用户名清空则删凭据（无认证代理）；仅关闭开关时保留凭据。

## 5. UI（`src/pages/SettingsPage.tsx`）

在“模型供应商”下方新增 `<section className="settings-section">`，沿用 `Field` / `Input` / `Select` / `Button` 与 `.settings-actions`：

| 控件 | 说明 |
|---|---|
| 启用代理（Select：不使用 / 使用） | 对应 `enabled` |
| 代理地址（Input） | 占位 `http://127.0.0.1:7897`，提示支持 HTTP/HTTPS/SOCKS5 |
| 用户名（Input，可选） | 对应 `username` |
| 密码（Input type=password，可选） | 占位“已安全保存 / 留空保持不变” |
| 保存代理设置 / 测试代理连通性（Button） | 测试按钮先保存再探测，沿用现有 `testingConnection` 的 loading 模式 |

提示文案必须包含：作用范围（模型调用 + 公开榜单抓取）、密码存 Windows 凭据管理器、密钥会经代理转发请只填可信代理、不读取系统代理设置。

## 6. 文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/netguard.ts` | 改 | `parseProxyUrl`、`configureOutboundProxy`、`getOutboundProxyConfig`、dispatcher 类型放宽、代理 dispatcher 优先级、本地预解析校验 |
| `electron/credential-store.ts` | 改 | 代理凭据 target 与 read/write/delete |
| `electron/database.ts` | 改 | `getProxySettings` / `saveProxySettings` |
| `electron/ipc-validation.ts` | 改 | 三通道 Zod |
| `electron/preload.ts` | 改 | 三个桥接方法 |
| `electron/handlers/network-handlers.ts` | 新增 | 三个 handler + 依赖接口 |
| `electron/main.ts` | 改 | 启动配置 + 注册 handler |
| `src/shared/types.ts` | 改 | `ProxySettings` / `ProxySettingsInput` / `AppApi` |
| `src/pages/SettingsPage.tsx` | 改 | 网络代理分区 |
| `src/lib/browser-api.ts`、`src/lib/browser-demo.ts` | 改 | 浏览器预览的 localStorage 实现与默认值 |
| `electron/ai-provider.ts` | 改 | SSE 多行 `data:` 修复（提交 1，独立） |
| `docs/security.md`、`AGENTS.md`、`AI_CONNECTION_PLAN.md` | 改 | 安全模型、规则 3 补一句、§9.1 状态更新 |
| `tests/netguard.test.ts`、`tests/outbound-proxy.test.ts`、`tests/stub-proxy.ts`、`tests/network-handlers.test.ts`、`tests/database.test.ts`、`tests/security.test.ts`、`tests/ipc-contract.test.ts`、`tests/ai-provider.test.ts`、`tests/settings-page.test.tsx` | 改/新增 | 见 §8 |

## 7. 提交拆分

### 提交 1 — `fix(ai): 修复 SSE 单事件多行 data: 解析`

BUG_REPORT L1 的“逐行独立解析”兜底**已经在代码里**（`ai-provider.ts:129-143`），但还有两个洞：

- 代理把 JSON 从**字符串中间**切开时，`join("\n")` 会在字符串内插入换行 → 仍然 `SyntaxError`；
- 只归一化 `\r\n`，不支持裸 `\r` 作为行/事件分隔。

改动：`parseSseData` 改为三级兜底（逐行独立 → `join("")` → `join("\n")`）；三个流式读取器统一用 `normalizeSseText()`（`\r\n`→`\n`，裸 `\r`→`\n`，末尾 `\r` 留给下一块以免误断事件）。测试补 4 例：两个完整 JSON 行、字符串中间被切开、裸 CR 分隔、`[DONE]` 仍被过滤。

> 加代理后正是最容易触发该 bug 的场景（代理会重新分帧/缓冲），所以先修再上代理。

### 提交 2 — `feat(netguard): 可选出站代理通道`

`electron/netguard.ts` 三个导出 + 类型放宽 + §2.4 预解析校验；`tests/stub-proxy.ts`（node:http CONNECT 桩代理）+ `tests/outbound-proxy.test.ts` + `tests/netguard.test.ts` 增补。

### 提交 3 — `feat(settings): 代理设置的持久化与 IPC`

types / database / credential-store / ipc-validation / preload / network-handlers / main / browser-api / browser-demo 与对应测试。

### 提交 4 — `feat(ui): 设置页网络代理分区`

`SettingsPage.tsx` + `tests/settings-page.test.tsx`。

### 提交 5 — `docs(security): 记录代理策略与残余风险`

`docs/security.md` 新增“出站代理（可选）”；`AGENTS.md` 规则 3 补“代理仍走 netguard，禁止别处新建 fetch”；`AI_CONNECTION_PLAN.md` §9.1 标注已落地与本方案的接口对应关系。

## 8. 测试计划

| 层 | 文件 | 关键断言 |
|---|---|---|
| 地址校验 | `tests/netguard.test.ts` | 放行 `http://127.0.0.1:7897`、`socks5://127.0.0.1:1080`、`[::1]`；拒绝 `file:`/`ftp:`/`socks4:`、内嵌凭据、带路径/查询 |
| dispatcher 选择 | `tests/outbound-proxy.test.ts` | `null`→公共直连 Agent；http→ProxyAgent；socks5→ProxyAgent(socks)；构建失败不改现有配置 |
| 目的地守卫 | 同上 | 开代理后 `fetchPublicHttpResponse("http://127.0.0.1:...")` 仍抛错；解析到私网的域名仍抛错 |
| **端到端** | 同上 + `tests/stub-proxy.ts` | 真实 `globalThis.fetch` 的请求确实经隧道到达桩代理（桩断言收到 CONNECT 目标 host 与 `Basic` 认证头，返回 canned 响应）。这是“npm undici 的 `ProxyAgent` 能作为 Node 内置 fetch 的 dispatcher”的关键证据——现有代码虽有注入口，但没有任何测试走过真实全局 fetch 路径 |
| 持久化 | `tests/database.test.ts` | 默认关闭；往返一致；非法 URL 拒绝 |
| handler | `tests/network-handlers.test.ts` | 保存写凭据并重配置；`get` 掩码；清空用户名删凭据；连通性测试经桩代理返回状态码 |
| IPC 契约 | `tests/ipc-contract.test.ts` | 三个新通道存在、命名合规、列表有序 |
| 安全边界 | `tests/security.test.ts` | `validateIpcArgs("saveProxySettings", ...)` 拒绝 `file://`、内嵌凭据、超长输入 |
| SSE 修复 | `tests/ai-provider.test.ts` | §7 提交 1 的四例 |
| UI | `tests/settings-page.test.tsx` | 分区渲染、保存调用、测试按钮 loading/结果提示 |

## 9. 已知限制

- SOCKS5 在 undici 中标为 experimental，首次使用会打一次 `ExperimentalWarning`；`socks4` 不支持。
- 开代理后目的地 DNS 固定失效（§2.4/§3.2）。
- 本地模型服务（如 `http://127.0.0.1:11434`）仍不可用：目的地守卫不允许本机地址，与本次改动无关（`AI_CONNECTION_PLAN.md` §5.7 另议）。
- 自定义 CA / MITM 代理不支持（§2.6）。
- 自动更新沿用 `electron-updater` 的既定例外，不受本设置影响。

## 10. 验收

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`；UI 改动追加 `npm run test:e2e`。手工验证：填 `http://127.0.0.1:7897`（Clash 混合端口）→ 保存 → 测试连通 → 跑一次“连接测试”与一次流式章节生成；关闭代理后同样步骤应恢复直连。
