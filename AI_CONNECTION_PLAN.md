# AI 连接层重构方案（2026-09-08 · 修订 6 · 已实施）

> 目标：把“每次请求现场试错”的单体连接方式，换成成熟框架通用的**声明式能力 + 协议适配器 + 中间件管道**三层结构；同时把“AI 来源”从一条全局配置升级为**可自由增删、按角色路由、切换不打断在途任务的来源清单**。
> 约束不变：所有出站流量仍走 `electron/netguard.ts`；密钥只进 Windows Credential Manager；`src/shared/` 保持纯净；不引入重型依赖；人工门禁与审计语义不动。
>
> 修订 2 相对修订 1 的变化：新增 §5（API 来源管理完整设计，含本地端点安全决策）、§6（IPC 与双端契约），扩展 §7 文件清单、§8 分期、§9 风险、§10 测试。
> 修订 3 相对修订 2 的变化：补上评审发现的缺口——密钥不得进 `extra_headers`（§5.2/§5.3）、凭据列举走 `CredEnumerate`（§5.4）、模型清单作用域与 `/models` 防护（§5.4）、空状态与引用校验（§5.4）、缓存域迁移成本（§5.9）、单次覆盖的 IPC 通道（§5.5/§6）、`model_not_found`（§4.4）、成本小数归一（§4.6）、手工验收脚本（§8.1）、工期拆分（§8）；代理支持另线推进，本方案只约定 dispatcher 接口（§9.1）。
> 修订 4 相对修订 3 的变化：把代理线（另一窗口的「本地代理支持」方案）合并进来，新增 §5.10 全局出站代理（HTTP/HTTPS/SOCKS5、凭据入凭据管理器、代理地址校验与目的地校验分离、DNS rebinding 残余风险、与本地端点豁免的关系），§9.1 改为指向 §5.10。
> 修订 5 相对修订 4 的变化：锁定 §5.7 为**选项 B**（逐条显式豁免本地端点），§7/§8/§10 中相关条件表述改为已定。**方案已无待决项。**
> 修订 6（实施）：P0/P1/P3a/P3b 已完成，P2/P4 部分完成；§5.7 与 §5.10 因 `netguard.ts` 由代理线占用而暂缓。详见下方「实施状态」。

## 实施状态（2026-09-08）

验收基线：`npx tsc --noEmit` ✅、`npm run lint` ✅、`npm test` 533 通过 / 1 跳过、`npm run test:quality` 16 通过、`npm run build` ✅、`npm run test:e2e` 20 通过。

| 阶段 | 状态 | 落地内容 |
|---|---|---|
| P0 纯搬移 | ✅ | `src/shared/ai/{types,errors,provider-url,auth,stream-json,catalog,provider-presets}.ts`；三家协议的解析器移入 `electron/ai/drivers/*`；`ai-provider.ts` 收薄为兼容门面 |
| P1 传输与驱动 | ✅ | `electron/ai/transport.ts`（`ProviderHttpError` + 唯一出站口）；三个驱动实现 `ModelDriver.generate/stream`；`apiSurface` 进入设置与 DB；协商结果落库 `model_capabilities` |
| P2 预算与流式 | ⚠️ 部分 | 网络重试（3 次）与结构修复（2 次）已独立计数；流式字段名可配置（`streamField`）。**未做**：数组元素等嵌套路径的流式提取，仍只支持顶层字符串字段 |
| P3a 数据与凭据 | ✅ | `ai_profiles` / `ai_role_routes` / `model_capabilities` 三表 + 迁移；`AiProfileRepository`；按来源凭据（`CredEnumerate` 前缀列举 + 内存缓存 + 旧密钥迁移）；11 个 IPC |
| P3b UI | ✅ | 设置页「模型来源」管理（12 个预设、编辑、测试连接、刷新模型、设为默认、停用、删除、导入导出）+ 角色路由；侧栏快速切换默认来源；浏览器预览桩同步 |
| P4 路由与覆盖 | ⚠️ 部分 | 五角色路由 + 单次覆盖（**仅正文生成链路**：`generateChapterDraft → coordinator → runJson.override`）+ `/models` 刷新 + 导入导出。其余任务入口的 override 参数未接 |
| §5.7 本地端点 | ✅ | `assertLocalEndpointUrl` + `fetchLocalEndpointResponse` 直连通道 + 驱动 `localEndpoint` 透传；只接受字面量回环/私网 IP、不解析域名、禁止重定向 |
| §5.10 全局代理 | ✅ | 按 `OUTBOUND_PROXY_PLAN.md` 全部落地：HTTP/HTTPS/SOCKS5、凭据入凭据管理器、目的地预解析、设置页分区；SSE 多行/裸 CR 解析一并修复 |

实现与设计的偏差（以代码为准）：

- 凭据 target 沿用仓库既有命名 `cn.local.fanqie.novelstudio/ai/<profileId>`，未采用文档里的 `fanqie-novel-studio:ai:<id>`。
- 旧版单来源表单保留为「模型供应商（单来源回退）」区块：没有配置来源时仍然生效，已配置来源时以来源与角色路由为准（避免破坏既有设置页测试与用户配置）。
- 路由解析是**同步**的（`startDraftChapter` 必须在返回前拿到 jobId），来源密钥因此由主进程内存缓存提供、启动后预热；密钥尚未预热时任务会提示「来源 X 还没有可用的 API 密钥」。
- 单次覆盖到别的来源时会丢弃角色路由里属于原来源的模型名，改用目标来源的默认模型。
- 新增 17 个测试文件；`tests/database.test.ts` 的 catalog `user_version` 断言随新迁移由 6 更新为 7。
- 代理线（`OUTBOUND_PROXY_PLAN.md`）已合并实施，`netguard.ts` 的 dispatcher 优先级为 `options.dispatcher ?? 代理 dispatcher ?? 公网 dispatcher`；本地端点走独立直连通道，两者都只放宽“连接目标”，不放宽目的地校验。

## 0. 一句话结论

当前 `electron/ai-service.ts:144-607` 的 `runJson` 同时承担了协议适配、能力探测、重试、结构修复、超时、成本核算、审计七件事，其中“这个端点支不支持 Responses / JSON mode / 流式 / 大 max_tokens”是**每个任务现场试出来的**，试错结果不落库，于是每次生成都要重新付一遍失败请求的代价。方案的核心是把这些从**运行时代码判断**改成**声明数据 + 一次协商 + 持久化缓存**，用 `ModelDriver` 收口三家协议，并把供应商配置做成可增删、可路由、可快速切换的来源清单。

## 1. 现状诊断（有据可查）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | 协议靠模型名正则选择 | `ai-provider.ts:55-61` `usesResponsesApi(/^gpt/)`、`supportsReasoning(/^(gpt-(5\|6)\|o\d)/)` | 网关上的 `gpt-3.5`、Azure 部署名、代理改名的模型全部误判；`tests/ai-provider.test.ts:129` 把该行为固化成契约 |
| 2 | 能力推断是死代码 | `ai-provider.ts:13-23` 两个分支都返回 `{ jsonMode: true }` | JSON mode 永远被尝试，不支持的服务端每次都先吃一个 400 |
| 3 | 能力降级不持久化 | `ai-service.ts:343-404` 五种 fallback 都靠 `attempt -= 1` 现场重试 | 服务端拒绝 `response_format`/`stream_options`/`/responses` 时，**每个新任务都重放同样的失败请求** |
| 4 | 网络重试与结构修复共用 3 次预算 | `ai-service.ts:245` 单层 `for attempt < 3`，`:597` 校验失败也消耗同一计数 | 模型第三次 JSON 格式错时，已没有网络重试额度；反之网络抖动会吃掉修复额度 |
| 5 | 错误分类靠中文字符串前缀 | `ai-service.ts:507-598` 用 `lastError.startsWith("模型接口返回")` 等分支 | 改一句提示语就断逻辑；无法区分鉴权失败 / 余额不足 / 上下文超限 / 内容策略 |
| 6 | 429 不看 `Retry-After` | `ai-provider.ts:369-377` 只给可重试集合；`ai-service.ts:567` 退避固定 1s/2s 无抖动 | 被限流时要么打得更狠，要么等得比要求更久 |
| 7 | 单密钥、单模型 | `types.ts:434-450` 一份 `protocol/baseUrl/model`；`credential-store.ts` 一个凭据 target；`ai-handlers.ts:412-423` 换 host 即清空密钥 | 想在“拆书用便宜模型、写正文用旗舰模型”之间切换必须改设置并重输密钥 |
| 8 | 成本用全局单价算 | `ai-service.ts:233-235` 取 `settings.input/outputPricePerMillion` | 一旦按任务分模型，成本统计立刻失真；现状也是手填单价，换模型要人工改 |
| 9 | 流式结构化绑死 `content` 字段 | `ai-service.ts:275-277` 只抽顶层 `content` 字符串 | 没有 `content` 字段的结构化任务拿不到增量 UI 流 |
| 10 | 单次 AbortController 跨尝试复用 | `ai-service.ts:203` 在循环外创建 | 一次空闲超时后无法对同一次任务做干净的重试；取消与超时的边界靠 `timeoutError` 变量兜 |
| 11 | 输出上限写死 | `ai-service.ts:223` 草稿 16k / 长任务 12k / 其他 8k，被拒才降到 8192 | 与模型真实上限无关，既可能截断也可能浪费一次 400 |
| 12 | `embeddingModel` 是死配置 | `types.ts:442`、`database.ts:1368`、`SettingsPage.tsx:317-319` | 设置项已改为“本地检索（无需配置）”，字段仍被持久化，易误导 |

**结论**：不是“多加几个 if”，而是连接层的**信息模型**缺一层。成熟框架的做法是把这些信息变成声明数据，本方案照此重排。

## 2. 对标：成熟框架各自解决哪一段

| 框架 / 项目 | 关键机制 | 本方案取舍 |
|---|---|---|
| Vercel AI SDK v5 | `LanguageModelV2` 统一模型接口；`openai.responses()` 与 `openai.chat()` 是**两个模型构造器**而非运行时猜测；`generateObject/streamObject` + `repairText`；`wrapLanguageModel` 中间件；`APICallError.isRetryable` | 借**形状**不引依赖：定义等价的 `ModelDriver`、中间件管道、错误分类纯函数 |
| models.dev（Cline / OpenCode / Roo 的模型目录） | 模型能力与定价是 JSON 元数据：`limit.context/output`、`cost.input/output`、`tool_call`、`reasoning`、`modalities` | 内置一份裁剪快照 + 用户覆盖；能力/定价不再写死在代码里 |
| LiteLLM / Portkey / OpenRouter | `provider/model` 统一命名、按请求的 fallback 链、遵守 `Retry-After`、按目录定价核算、供应商冷却 | 进程内路由策略（不做网关进程）；熔断与 fallback 放 P5 |
| Instructor / LangChain `withStructuredOutput` | 校验失败 → 带错误信息重问的**独立修复循环**，与网络重试分离 | 结构化输出阶梯独立预算，见 4.3 |
| Cherry Studio / LobeChat | 多供应商 profile，每个 profile 独立 keyring；`LobeRuntimeAI` 每协议一个 runtime 类；供应商健康检查 | 多来源 + 按来源存凭据 + 健康状态，见 §5 |
| Continue / Cline | 按角色选模型（chat / edit / apply / summarize） | 五角色路由，见 4.6 与 §5.5 |
| OpenCode / Zed / Continue 的设置体验 | 预设模板 + `/models` 自动拉取 + 手动输入兜底；粘贴完整端点自动纠正 | 见 §5.3、§5.4 |

**为什么现在不直接引入 `ai` SDK**：它需要把 netguard 的 undici dispatcher 接进自定义 `fetch`、把现有五套带测试的 SSE 解析器全部替换、并新增一个跨主进程的重型依赖（`OPTIMIZATION_PLAN_2026-09.md` 明确“本轮不引入重型依赖”）。触发重新评估的条件写在 §9。

## 3. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│ electron/ai/runtime.ts        runStructured({role, schema})  │  ← 唯一入口
│   ├─ resolveRoute(role)        来源 + 模型 + 能力声明        │
│   ├─ withCache                  命中即返回（现有 findAiJob） │
│   ├─ structuredOutput           阶梯 + 独立修复预算          │
│   │    └─ withRetry             网络/限流重试 + Retry-After  │
│   │         └─ withTimeout      每次尝试独立 AbortController │
│   │              └─ driver.generate / driver.stream          │
│   │                   └─ transport → netguard                │  ← 公网/代理 dispatcher
│   ├─ withTelemetry              用量/首字/成本（目录定价）   │
│   └─ withAudit                  startAiJob / finishAiJob     │
└──────────────────────────────────────────────────────────────┘
        │                    │                      │
┌───────▼────────┐  ┌────────▼────────┐  ┌──────────▼─────────┐
│ drivers/       │  │ shared/ai/      │  │ 来源管理（§5）      │
│ openai-chat    │  │ errors.ts       │  │ ai_profiles         │
│ openai-responses│ │ catalog.ts      │  │ ai_role_routes      │
│ anthropic-msgs │  │ presets.ts      │  │ 凭据按来源存         │
│                │  │ provider-url.ts │  │ 探测缓存表           │
└────────────────┘  └─────────────────┘  └────────────────────┘
```

分层原则与仓库现有约定一致：`src/shared/ai/` 只放纯类型、纯函数、内置数据快照；协议适配器与网络只在 `electron/`。

### 3.1 核心接口（示意）

```ts
// src/shared/ai/types.ts —— 纯类型，双端可 import
export type ApiSurface = "openai-chat" | "openai-responses" | "anthropic-messages";
export type ModelRole = "draft" | "plan" | "review" | "extract" | "utility";

export interface ModelCapabilities {
  apiSurface: ApiSurface;
  contextWindow?: number;
  maxOutputTokens?: number;
  jsonSchema: "native" | "json-mode" | "prompt-only";  // 结构化输出的最高档
  streaming: boolean;
  streamUsage: boolean;          // 是否支持 stream_options.include_usage
  reasoning?: { supported: boolean; efforts: Array<"low" | "medium" | "high"> };
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  source: "catalog" | "probe" | "remote" | "user";
}

// electron/ai/drivers/types.ts
export interface DriverRequest {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schema?: unknown;              // JSON Schema（由 Zod 转）
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  stream: boolean;
  signal: AbortSignal;
}
export type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "refusal"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; reason: "stop" | "length" | "content-filter" | "unknown" };

export interface ModelDriver {
  readonly apiSurface: ApiSurface;
  generate(request: DriverRequest): Promise<{ text: string; usage: Usage }>;
  stream(request: DriverRequest): Promise<{ parts: AsyncIterable<StreamPart>; result: Promise<{ text: string; usage: Usage }> }>;
}
```

`stream()` 返回“流 + 最终结果 Promise”是 AI SDK v5 的形态，调用方既能增量渲染，也能 await 终值。

## 4. 六个关键机制

### 4.1 协议面声明 + 一次性协商（替代模型名正则）

- `ai_profiles.api_surface` 显式声明。默认取内置目录；目录没有该模型时用 `"auto"`。
- `"auto"` 只做一次协商：按 `openai-responses → openai-chat` 顺序探测，成功即把结果写入探测缓存，此后不再试错。
- 删除 `usesResponsesApi` / `supportsReasoning` 两个正则；`aiEndpoint` 改为按 `apiSurface` 取路径（现有 `anthropic-messages` 分支保留）。
- **会改契约**：`tests/ai-provider.test.ts:129`（GPT→Responses 路由）改为断言“声明的 apiSurface 决定路径”；`:790`（兼容网关上的 Claude）继续成立，因为它本来就靠 protocol 字段。

### 4.2 能力目录 + 探测缓存（替代每请求试错）

四层解析，后者覆盖前者：

1. **内置快照** `src/shared/ai/catalog.ts`：裁剪自 models.dev，覆盖常用模型（GPT/Claude/DeepSeek/Qwen/GLM/Kimi/豆包等）的 `apiSurface / context / maxOutput / pricing / reasoning / jsonSchema`。纯数据，可离线。
2. **远端清单**：`GET {base}/models` 拉取后写入 `model_capabilities`（`source=remote`），只补“有哪些模型”，能力字段仍以目录/探测为准。
3. **探测结果**：`model_capabilities` 表按 `(profile_id, model_id, api_surface)` 记录 `supports_*`、`probed_at`、`source`。**否定结果同样缓存**（带 7 天 TTL），成功后写入协商面。
4. **用户覆盖**：设置页可手动勾选“该模型支持 JSON Schema / 流式”，覆盖以上三层。

降级路径变成：`driver` 收到“不支持”类错误 → 记录探测结果 → **本次请求立即降档重试，后续请求直接按降档后的能力构造**。现有五种 fallback 逻辑保留语义，但从“每次现场”变成“一次学会”。

### 4.3 结构化输出阶梯 + 独立预算

按能力声明选择最高档，失败逐级降：

```
native json_schema（Responses text.format / 兼容端点 response_format: json_schema）
  → json_object 模式
  → 工具调用（P5，可选）
  → prompt-only + 去围栏 + JSON 修复重问
```

两条独立预算：

- **网络重试**：最多 3 次，只针对 `retryable` 错误（含 `Retry-After`、抖动退避）。
- **结构修复**：最多 2 次，把 Zod 校验错误摘要回灌给模型重问，不消耗网络额度。

现有 `stripCodeFence`、`repairInstruction` 思路保留；`JsonStringFieldExtractor` 泛化为 `JsonPathStreamExtractor`，支持任意顶层字符串字段与数组元素，解决 §1-9。

### 4.4 错误分类纯函数（替代中文字符串前缀）

```ts
// src/shared/ai/errors.ts
export type ProviderErrorKind =
  | "auth" | "permission" | "quota" | "rate_limit" | "context_length"
  | "content_filter" | "model_not_found" | "invalid_request" | "unsupported_capability"
  | "server" | "network" | "timeout" | "cancelled";

export function classifyProviderError(input: {
  status?: number; code?: string; detail?: string; retryAfter?: string | null;
}): { kind: ProviderErrorKind; retryable: boolean; retryAfterMs?: number };
```

- 映射到现有 `AppErrorCode`（`PROVIDER_UNAVAILABLE / PROVIDER_TIMEOUT / PROVIDER_HTTP_ERROR / PROVIDER_TRUNCATED / TASK_CANCELLED`），UI 文案继续走 `src/lib/error-message.ts`。
- `retryable` 由分类函数决定，`ai-service.ts` 里那 90 行 `startsWith` 分支删除。
- 新增可读性收益：401/403 提示“密钥无效或无权限”，402/quota 提示“余额不足”，`context_length` 提示“上下文超限，请缩短输入”，`model_not_found` 提示“模型已下线或改名，请在来源里换一个模型”。
- `model_not_found` 与 `invalid_request` 必须区分：前者不重试、不触发能力降档，直接建议换模型；否则一次模型下线会白白消耗三次重试和一轮降档探测。

### 4.5 来源、凭据与角色路由（概览，完整设计见 §5）

- 供应商配置从“一条全局设置”升级为 `ai_profiles` 列表，每个来源独立地址、协议面、鉴权方式、默认模型与凭据。
- 凭据 target 改为 `fanqie-novel-studio:ai:<profileId>`；切换来源不再清空密钥。
- 角色路由 `ai_role_routes` 决定“正文 / 规划 / 质检 / 提取 / 小任务”各用哪个来源的哪个模型。
- 任务启动时快照来源与模型，切换只影响之后启动的任务。

### 4.6 按角色选模型 + 目录定价

| 角色 | 覆盖任务 | 默认 |
|---|---|---|
| `draft` | 正文生成、AI 修订 | 默认来源的默认模型 |
| `plan` | 立项三案、结构/章纲、规划审查、改纲 | 同上 |
| `review` | 语义质检 | 同上 |
| `extract` | 状态提取、拆书批次/阶段汇总 | 可指定便宜模型 |
| `utility` | 连接测试、标题/摘要类小任务 | 可指定便宜模型 |

- `runStructured({ role })` 取代隐式“全局那一个模型”；未配置时逐级回退到默认来源。
- 成本按**实际使用模型的目录定价**计算，`settings.input/outputPricePerMillion` 降级为“目录缺失时的兜底覆盖”。
- 金额聚合复用 `src/shared/quality-run.ts` 的 6 位小数归一，不引入新的浮点断言（`OPTIMIZATION_PLAN_2026-09.md` 的 P0-1 刚修过同类问题）。
- 审计记录 `ai_jobs` 增 `profile_id / role`，模型可追溯，不破坏现有列表。

## 5. API 来源管理：自由添加、记住、一键切换

### 5.1 验收场景（用户故事）

1. 作者手里有 DeepSeek 和 Claude 两个 key：各加一个来源，随时切换，**不用重输 key**。
2. 作者希望“拆书/状态提取用便宜模型，写正文用旗舰模型”，配置一次长期记住。
3. 作者用 OneAPI / NewAPI 自建网关：地址、模型名自己填，程序不因为“不认识模型名”而报错。
4. 作者给来源起名“主力”“备用便宜”，能一眼看到上次测试结果，坏了有红点。
5. 作者换电脑时导出配置（**不含密钥**），到新机导入后只补 key。
6. 作者想接本地 Ollama / LM Studio（需要 §5.7 的安全决策）。

### 5.2 数据模型

存在 catalog 库（全局配置，随备份走；**密钥不在库里**）：

```sql
CREATE TABLE ai_profiles (
  id TEXT PRIMARY KEY,                        -- uuid；凭据 target 用它
  name TEXT NOT NULL,                         -- “DeepSeek 主力”
  api_surface TEXT NOT NULL,                  -- auto | openai-chat | openai-responses | anthropic-messages
  base_url TEXT NOT NULL,                     -- 规范化后的基础地址
  default_model TEXT NOT NULL DEFAULT '',
  auth_scheme TEXT NOT NULL,                  -- bearer | x-api-key | api-key | custom-header:<头名> | none
  extra_headers TEXT NOT NULL DEFAULT '{}',   -- JSON；只放非密钥元数据（如 HTTP-Referer/X-Title），见 §5.3
  extra_query TEXT NOT NULL DEFAULT '{}',     -- JSON；Azure api-version 等
  local_endpoint INTEGER NOT NULL DEFAULT 0,  -- 仅 §5.7 选项 B 启用
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  last_test_at TEXT,
  last_test_ok INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_role_routes (
  role TEXT PRIMARY KEY,                      -- draft | plan | review | extract | utility
  profile_id TEXT,                            -- NULL = 使用默认来源
  model_id TEXT,                              -- NULL = 使用该来源的 default_model
  updated_at TEXT NOT NULL
);

CREATE TABLE model_capabilities (             -- 见 4.2
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_surface TEXT NOT NULL,
  supports_json_schema INTEGER,               -- NULL = 未知
  supports_json_mode INTEGER,
  supports_streaming INTEGER,
  supports_stream_options INTEGER,
  supports_reasoning INTEGER,
  max_output_tokens INTEGER,
  context_window INTEGER,
  probed_at TEXT NOT NULL,
  source TEXT NOT NULL,                       -- catalog | probe | remote | user
  PRIMARY KEY (profile_id, model_id, api_surface)
);

ALTER TABLE ai_jobs ADD COLUMN profile_id TEXT;   -- 审计可追溯
ALTER TABLE ai_jobs ADD COLUMN role TEXT;
```

默认来源记在 settings 的 `ai.defaultProfileId`。来源是**全局配置**，不随作品变化（作品级锁定见 §5.5 与 §8 P5）。

**密钥永远不进数据库**：`auth_scheme` 是唯一的密钥入口。固定方案（`bearer`/`x-api-key`/`api-key`）的头名由 driver 决定；自建网关的任意头名用 `custom-header:<头名>`，头名存库、值存 Credential Manager。`extra_headers` 只允许非密钥元数据，写入前用拒绝名单校验（大小写不敏感匹配 `authorization`、`api-key`、`x-api-key`、`x-auth-*`、`*token*`、`*secret*`、`*key*`），命中即拒绝。这样 `catalog.sqlite` 与加密备份里永远没有明文凭据。

### 5.3 添加来源：预设模板 + 自定义 + 地址规范化

**预设模板**（`src/shared/ai/provider-presets.ts`，12 项）。模板只预填，模型 ID 与能力最终以 `/models` 刷新和目录为准：

| 模板 | 基础地址 | 协议面 | 鉴权 | 备注 |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | auto（→responses） | Bearer | |
| Anthropic | `https://api.anthropic.com/v1` | anthropic-messages | `x-api-key` + `anthropic-version` | |
| DeepSeek | `https://api.deepseek.com/v1` | openai-chat | Bearer | deepseek-chat / deepseek-reasoner |
| 阿里云百炼（兼容模式） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | openai-chat | Bearer | |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | openai-chat | Bearer | |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | openai-chat | Bearer | |
| 火山方舟豆包 | `https://ark.cn-beijing.volces.com/api/v3` | openai-chat | Bearer | 模型填接入点 ID |
| OpenRouter | `https://openrouter.ai/api/v1` | openai-chat | Bearer | 附加头 `HTTP-Referer` / `X-Title` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | openai-chat | Bearer | |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/v1` | openai-chat / responses | `api-key` 头 | `extra_query` 填 `api-version` |
| 自建网关（OneAPI/NewAPI） | 用户填 | openai-chat | Bearer | |
| 本地模型（Ollama/LM Studio） | `http://127.0.0.1:11434/v1` | openai-chat | none | **需 §5.7 显式开启** |

**自定义**：名称、基础地址、协议面、鉴权方式、默认模型、附加请求头（只收非密钥元数据，见 §5.2 的拒绝名单）、附加查询参数。需要任意头名传密钥时选 `custom-header:<头名>`，值单独入 Credential Manager。

**地址规范化 `canonicalizeProviderUrl`**（在现有 `normalizeProviderUrl` 之上，纯函数放 `src/shared/ai/provider-url.ts`）：

1. 去首尾空白、去尾斜杠、host 转小写；
2. 粘贴的是完整端点（以 `/chat/completions`、`/responses`、`/messages`、`/completions` 结尾）→ 自动截掉并提示“已从完整端点纠正为基础地址”；
3. 含 `?` 或 `#` → 拒绝；查询参数唯一合法入口是 `extra_query`（Azure 用）；
4. 缺 `/v1` 且协议面是 OpenAI 兼容 → 标记“路径变体待协商”，首次请求按 `["", "/v1"]` 顺序探测一次并记住；
5. 拒绝 URL 内嵌用户名/密码；
6. 非 `https` 仅在 §5.7 选项 B 的本地端点下允许。

添加后立即跑一次“测试连接”（可跳过），成功则回写能力与健康状态。

### 5.4 记住来源

- **凭据**：`fanqie-novel-studio:ai:<profileId>`，每来源独立。渲染层只拿 `hasApiKey` 布尔，永不接触明文；`structured-log` 白名单过滤密钥字段；导出不含密钥；删除来源时同步删除凭据条目。
- **凭据列举不能逐个读**：`electron/credential-store.ts:101-133` 每次操作 spawn 一次 `powershell.exe`，N 个来源就是 N 次进程启动（百毫秒级）。给内联 PowerShell 脚本加 `CredEnumerate`，按 `fanqie-novel-studio:ai:` 前缀一次返回已存在的来源 id；主进程维护 `Set<profileId>` 缓存，启动时水合一次，保存/删除时增量更新。`listAiProfiles()` 只读缓存，不做同步凭据 I/O。
- **模型清单**：`refreshAiProfileModels(id)` 经 netguard 调 `GET {base}/models`（OpenAI 兼容），结果与目录快照、用户手填三方合并。响应加 2 MB 上限与 schema 校验，超限或畸形按“清单不可用”处理；404/405 归类为“该端点不支持模型清单”，不报错。
- **模型下拉的作用域**：只显示「该来源远端清单 ∪ 该来源手工添加过的模型 ∪ 目录中属于该来源模板的模型」，并始终允许自由输入。不能把别家来源的模型列进来，否则选错模型只会得到难以理解的 404。
- **健康状态**：`last_test_at / last_test_ok / last_error / last_used_at`，设置页与切换器显示红/绿点与最近错误摘要。
- **排序**：`sort_order` + 最近使用置顶 + 可置顶收藏。
- **零来源与空状态**：全新工作区没有来源时，设置页与写作台显示“先添加一个模型来源”的引导卡片，接上现有 first-run checklist（`64a0561`）；AI 任务入口在无来源时禁用并说明原因，而不是等点了生成才报“尚未配置 AI API 密钥”。
- **删除默认来源**：`ai.defaultProfileId` 指向已删除/停用来源时，自动回退到排序最前的启用来源；没有启用来源则进入空状态。`ai_role_routes` 的 `profile_id` 没有外键（SQLite 默认不开），仓储层写入前必须校验来源存在且启用，删除来源时清空指向它的路由。
- **导入导出**：`exportAiProfiles()` 输出带 `schemaVersion` 的 JSON（名称、地址、协议面、鉴权方式、默认模型、角色路由、附加头；**不含密钥**）；`importAiProfiles(json)` 校验后合并，冲突按 id/名称提示，密钥留空待填。
- **删除**：先检查引用（角色路由、在途任务），有引用时提示“将被重置为默认来源”；删除后清凭据条目。软删除（`enabled=0`）用于“停用但保留配置”。

### 5.5 切换语义（不打断在途任务、不串味）

三层，优先级从高到低：

1. **单次覆盖**：写作台/任务面板的“本次使用”，只对当前这次任务生效，不落库，UI 明示“仅本次”。
2. **角色路由** `ai_role_routes`：`draft / plan / review / extract / utility → (来源, 模型)`。这是“记住方便更换”的主入口。
3. **默认来源** `ai.defaultProfileId` + `profile.default_model`：角色未配置时的兜底。

规则：

- **在途任务快照**：任务启动时把 `profileId / model / apiSurface / role` 快照进 job；切换只影响之后启动的任务。
- **缓存键**：`findAiJob` 的 provider 由 `profileId + origin` 组成；改显示名不影响命中，换来源即换缓存域，避免“用 A 的缓存冒充 B”。
- **单次覆盖的传输通道**：给需要覆盖的任务入口（`generateChapterDraft`、`generateChapterBatch`、`generatePlanningDraft`、`runQualityCheck`、`extractChapterFacts`、`testAiConnection`）加可选参数 `override?: { profileId?: string; model?: string }`，随请求一次性传给 `resolveRoute`，不写库、不改默认路由。相比“主进程会话级覆盖”，显式参数没有“忘记清理导致后续任务串味”的风险。
- **快速切换器**：顶栏下拉列出启用来源（名称 + 默认模型 + 健康点 + 最近使用），选中后询问“设为默认来源 / 仅本次使用”。
- **常驻可见**：写作台顶部一行“正文：Claude Sonnet · 质检：DeepSeek Chat · 拆书：GLM-4.6”，点击直达角色路由。
- **一致性提醒**：同一作品相邻章节由不同 `draft` 模型生成时，章节详情与质检页标注“本章模型与上一章不同”，提示可能的声音漂移；可选“作品级锁定”（P5）让某本书固定用同一来源。

### 5.6 设置页与快速切换器（线框）

```
系统设置 › 模型来源
┌────────────────────────────────────────────────────────────┐
│ 默认来源  [ DeepSeek 主力 ▾ ]      [+ 添加来源]  [导入] [导出] │
├────────────────────────────────────────────────────────────┤
│ ● DeepSeek 主力     api.deepseek.com/v1     openai-chat      │
│   deepseek-chat        上次测试 3 分钟前 ✅   密钥已保存      │
│   [测试连接] [设为默认] [角色路由] [编辑] [停用] [删除]        │
│ ● Claude 正文       api.anthropic.com/v1    anthropic        │
│   上次测试 昨天 ❌ 401 密钥无效            [重新填写密钥]      │
└────────────────────────────────────────────────────────────┘

角色路由
┌───────────────┬────────────────────────┬─────────────────────┐
│ 角色           │ 来源                    │ 模型                 │
│ 正文 / 修订    │ Claude 正文             │ claude-sonnet-4     │
│ 结构 / 章纲    │ Claude 正文             │ claude-opus-4       │
│ 语义质检       │ DeepSeek 主力           │ deepseek-chat       │
│ 状态提取 / 拆书│ DeepSeek 主力（便宜）   │ deepseek-chat       │
│ 连接测试 / 小任务│ DeepSeek 主力          │ deepseek-chat       │
└───────────────┴────────────────────────┴─────────────────────┘
```

添加来源弹窗：模板网格 → 表单（名称/地址/协议面/鉴权/默认模型/附加头）→ 测试连接五项检查清单（地址合法性 / DNS 与 TLS / 鉴权 / 结构化输出 / 流式），逐项显示结果与耗时。

### 5.7 本地与私有端点（已决定选 B，已实现）

- 现状：`netguard.assertPublicHttpUrlSyntax` 拒绝 localhost 与私网，`createPublicLookup` 只解析公网 IP。因此 Ollama / LM Studio / 局域网 OneAPI **当前不可能**接入。
- **决定（2026-09-08）：采用 B。** 仅当 `local_endpoint=1` 时允许 `http://127.0.0.1[:port]`、`http://[::1][:port]` 与用户手工确认的 RFC1918 地址。实现为 netguard 独立入口 `assertLocalEndpointUrl` + 直连 dispatcher：**只接受字面量 IP**（不接受域名，防 DNS rebinding）、**跳过 DNS 解析**、**禁止重定向**、仅该来源生效、默认关闭并弹风险提示。
- 被否的两个选项（留档）：**A. 不支持本地**——最保守，但把 Ollama / LM Studio 用户挡在门外，与“自由添加来源”的目标冲突；**C. 全局关闭防护**——会同时削弱模型端点与榜单抓取的边界，违背 `docs/security.md`，不采纳。
- 配套：按仓库既有先例（`153d0bf docs(update): document the update channel and security exception`）在 `docs/security.md` 补一节“本地模型端点例外”，写明：仅显式配置、仅字面量回环/私网 IP、不解析域名、不跟随重定向、不进备份、不在默认配置中出现。
- 与 §5.10 的关系：本地模型端点是“来源级”豁免，代理端点是“全局出站”豁免，两者都需要 netguard 放宽 loopback/私网，但**都只放宽连接目标，不放宽业务目标 URL 的校验**；两处例外都要在 `docs/security.md` 分别记录。

### 5.8 失败、熔断、并发与预算（P5 可选）

- **熔断**：同一来源连续 3 次可重试类失败 → 冷却 5 分钟，切换器显示“降级中”；冷却结束半开探测一次。
- **并发**：每来源默认最多 2 个在途请求（现有 `isGenerationActive(projectId)` 只管单作品）。
- **限流**：客户端令牌桶 + 遵守 `Retry-After`，避免 429 风暴。
- **预算**：每来源可设每日/每月上限，接近时提醒、超出时拒绝并建议切换；默认关闭，避免误伤。

### 5.9 迁移

1. 启动时若无 `ai_profiles` 且有旧 `ai.baseUrl`：用旧值创建一个“默认来源”，`api_surface` 由旧 `protocol` 映射，`default_model` 取旧 `ai.model`。
2. 凭据迁移：读旧 target → 写 `fanqie-novel-studio:ai:<新id>` → 成功后再删旧 target；失败保留旧 target 并在设置页提示“密钥需重新填写”，不阻塞启动。
3. 旧字段 `ai.protocol / ai.baseUrl / ai.model` 保留一个版本周期只读兼容；`saveAiSettings` 写旧字段时同步更新默认来源。
4. `ai.embeddingModel` 停止读写并标注废弃（本地 bigram 检索不需要）。
5. 迁移脚本走 `runMigrations` 的 `BEGIN IMMEDIATE` 事务，`PRAGMA user_version` 递增；catalog 与 project 库各自迁移。
6. **缓存域迁移**：`findSuccessful()` 用 `provider` 做查询条件（`ai-audit-repository.ts:57-64`），provider 从 baseUrl 改成 `profileId+origin` 后，升级前所有成功任务的缓存都命中不了，拆书批次会重新计费。迁移时给默认来源记录一条 `legacy_provider` 别名，缓存未命中时再用旧 provider 串回查一次；多来源场景无法回查的，在升级说明里写明“首次重跑会重新计费”。

### 5.10 全局出站代理（已实施）

**范围**：一个全局开关，作用于**全部 netguard 出站**——模型调用（`ai-service.ts` 经 `fetchPublicHttpResponse`）与番茄公开页/榜单抓取（`ranking-service.ts:29-41` 的 `fetchPublicResponse`）。国内直连交给 Clash 等代理自身的分流规则，应用内不做按域名分流。

**协议**：HTTP、HTTPS、SOCKS5。undici 7.29 的 `ProxyAgent` 原生识别 `socks5:`/`socks:`（内部转交 `Socks5ProxyAgent`），三种协议一条构造路径、**不新增依赖**；`socks4` 直接拒绝。SOCKS5 是 undici 实验特性，首次构造会打印一次 `ExperimentalWarning`，日志只记一次，不刷屏。

**认证**：支持用户名/密码。密码只进 Windows Credential Manager（新 target `fanqie-novel-studio:proxy`），配置表只存 URL 与用户名（可选）。URL 内不允许内嵌凭据（沿用 `ipc-validation.ts:21-28` `httpUrl` 的拒绝规则）；HTTP(S) 用 `token: "Basic " + base64(user:pass)`，SOCKS5 用 `username`/`password` 选项；undici 的 `auth` 与 `token` 不能同传，只走 `token`。

**注入点（已存在，扩类型即可）**：`netguard.ts` 的 `GuardedFetchOptions.dispatcher` 已经存在但没人传过（约 `netguard.ts:108`）。把类型从 `Agent` 放宽为 `Dispatcher`（`ProxyAgent`/`Socks5ProxyAgent` 继承 `Dispatcher` 而非 `Agent`），新增 `configureOutboundProxy(config | null)` 构建并缓存代理 dispatcher；`fetchPublicHttpResponse` 取值顺序改为 `options.dispatcher ?? activeProxyDispatcher ?? publicDispatcher`。**不新增任何 fetch 出口**。

**代理地址校验与目的地校验分离**（关键）：代理端点通常是 `127.0.0.1:7890`，而 netguard 默认拒绝 loopback/私网。因此新增 `assertProxyUrlSyntax(url)`：允许 `http`/`https`/`socks5`，允许 loopback 与私网（代理本来就是本地/内网服务），禁止 URL 内嵌凭据、禁止 `socks4`；**目标 URL 仍走 `assertPublicHttpUrlSyntax` + 公网解析校验**，两条规则互不替代。

**DNS rebinding 的残余风险（必须写明）**：走代理后目标域名由代理解析，netguard 的 `createPublicLookup` 不再参与，无法固定已校验 IP。缓解：目标 URL 先过语法校验（拒绝字面量私网/保留地址）；启用代理时可选做一次本地 DNS 预检（复用 `resolvePublicAddresses`，解析到私网即拒绝），但 TOCTOU 仍存在。把这条作为**已接受的残余风险**写进 `docs/security.md`，与 `electron-updater` 直连 GitHub Releases 的既定例外（`docs/security.md:21`）并列。若要求更强保证，只剩“禁止代理”或“只允许经代理访问白名单域名”两条路。

**不覆盖**：`electron-updater` 直连 GitHub Releases，不经 netguard，代理不作用于它。

**配置与 UI**：catalog settings 存 `network.proxy.enabled` / `network.proxy.url` / `network.proxy.username`；新增 IPC `getProxySettings` / `saveProxySettings` / `testProxyConnection`（注意 `tests/ipc-contract.test.ts` 要求频道名唯一、升序、匹配 `/^[a-z][a-zA-Z0-9]+$/`）；设置页新增“网络代理”区块：启用开关、代理地址、用户名/密码、测试连接（经代理请求一个已知公网地址并报告耗时）；浏览器预览桩 `src/lib/browser-api.ts:987-1003` 同步实现。

**与来源的关系**：代理是全局的，不挂在来源上，`ai_profiles` 不需要 `proxy_id`；将来若需按来源走不同代理再引入，表结构已可扩展。

**测试**：`tests/netguard-proxy.test.ts` 覆盖 `configureOutboundProxy` 的构建/缓存/清除、`options.dispatcher` 优先级、代理地址允许 loopback 而目标地址仍拒绝私网；HTTP 代理用 `ProxyAgent` + 注入 `fetchImpl` 验证 CONNECT 与 `proxy-authorization` 头；SOCKS5 需要本地桩 SOCKS 服务器（工作量单独计），至少覆盖“`socks4` 被拒绝”与构造参数映射；凭据用例断言配置表与日志无密码明文。

**顺带修复**：BUG_REPORT L1（SSE 多行 `data:` 整体 parse）。现状是 `parseSseData` 已按“逐行独立解析、失败才合并”实现，`tests/ai-provider.test.ts:54-61` 已验证；需先用 git 历史确认是否已修复，再决定改动范围。与 driver 搬移的交互：**先独立提交 L1（若需要），再搬移解析器**，搬移时保留该用例。

**分期与文件冲突**：代理线独立于本方案 P0–P4，作为 P5 的并行项。两条线会同时改 `electron/netguard.ts` 与 `electron/credential-store.ts`：建议先合代理线的 `configureOutboundProxy` 与代理密码 target，再合本方案的按来源凭据，避免同文件冲突。

## 6. IPC 与双端契约

新增 `AppApi` 方法，三处同步：`electron/preload.ts`、`src/lib/browser-api.ts`（浏览器预览 demo 实现）、`electron/ipc-validation.ts`（入参校验）。

| 方法 | 作用 |
|---|---|
| `listAiProfiles()` | 来源列表（含 `hasApiKey`、健康状态、最近使用） |
| `saveAiProfile(profile, apiKey?)` | 新建/编辑；密钥单独入 Credential Manager |
| `deleteAiProfile(id)` | 校验引用后删除并清凭据 |
| `setDefaultAiProfile(id)` | 设默认来源 |
| `setAiRoleRoute(role, profileId, modelId)` | 设置角色路由 |
| `testAiProfile(id)` | 五项检查并回写能力/健康状态 |
| `refreshAiProfileModels(id)` | 拉取 `/models` 并合并目录 |
| `exportAiProfiles()` / `importAiProfiles(json)` | 不含密钥的配置迁移 |

约束：渲染层永不接触密钥明文；`apiKey` 仅在非空时下发；所有地址参数先过 `canonicalizeProviderUrl` 再过 netguard；`saveAiProfile` 拒绝 `extra_headers` 中的凭据类头名（见 §5.2）；任务入口新增可选 `override?: { profileId?: string; model?: string }`，只对本次请求生效（见 §5.5）。

## 7. 文件级改造清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/shared/ai/types.ts` | 新增 | `ApiSurface / ModelRole / ModelCapabilities / AiProfile / AiRoleRoute` 纯类型 |
| `src/shared/ai/catalog.ts` | 新增 | 内置模型快照 + `resolveCapabilities()` 四层解析纯函数 |
| `src/shared/ai/errors.ts` | 新增 | `classifyProviderError` 纯函数 |
| `src/shared/ai/provider-presets.ts` | 新增 | 12 个预设模板 |
| `src/shared/ai/provider-url.ts` | 新增 | `canonicalizeProviderUrl` 地址规范化 |
| `src/shared/ai/auth.ts` | 新增 | 鉴权头解析（含 `custom-header:<头名>`）+ `extra_headers` 密钥拒绝名单（纯函数） |
| `src/shared/ai/stream-json.ts` | 新增 | `JsonPathStreamExtractor`（迁移 `JsonStringFieldExtractor`） |
| `electron/ai/drivers/*.ts` | 新增（多为搬移） | 三份 `ModelDriver`；现有 `readChatCompletionStream/readResponsesStream/readAnthropicStream/parse*Output` 整体移入 |
| `electron/ai/transport.ts` | 新增 | 唯一 HTTP 出口，封装 `fetchPublicHttpResponse` + 鉴权头 + `Retry-After`；dispatcher 由 `options.dispatcher` 注入（§5.10 代理 / §5.7 本地端点） |
| `electron/ai/runtime.ts` | 新增 | 中间件管道与 `runStructured` |
| `electron/ai/route-resolver.ts` | 新增 | 三层切换优先级、任务快照 |
| `electron/repositories/ai-profile-repository.ts` | 新增 | 对齐现有 `ai-audit-repository.ts` 的仓储风格 |
| `electron/ai-service.ts` | 瘦身 | 只保留领域任务方法，内部改调 `runStructured`；`runJson` 保留签名做过渡 |
| `electron/ai-provider.ts` | 拆分 | 解析器移入 drivers；删除 `usesResponsesApi / supportsReasoning / inferProviderCapabilities` |
| `electron/credential-store.ts` | 扩展 | 按来源读写删 + `CredEnumerate` 前缀列举 + 内存缓存 + 旧 target 迁移 + 代理密码 target（`fanqie-novel-studio:proxy`） |
| `electron/database.ts` | 扩展 | 三张表 + `ai_jobs` 两列 + 迁移 + 来源设置读写 |
| `electron/handlers/ai-handlers.ts` | 扩展 | §6 的 8 个 IPC |
| `electron/preload.ts`、`src/lib/browser-api.ts`、`electron/ipc-validation.ts` | 同步 | 三处契约一致；含 §5.10 的三个代理 IPC 与 `assertProxyUrlSyntax` 校验 |
| `src/pages/SettingsPage.tsx` | 改造 | 来源列表 + 角色路由 + 添加弹窗 + 测试清单 + 网络代理区块（§5.10） |
| `src/components/AiProfileSwitcher.tsx` | 新增 | 顶栏快速切换器 |
| `electron/netguard.ts` | 扩展 | `Dispatcher` 类型放宽 + `assertProxyUrlSyntax` + `configureOutboundProxy`（§5.10）+ `assertLocalEndpointUrl` + 直连 dispatcher（§5.7 已定 B） |
| `docs/security.md` | 扩展 | §5.10 的代理残余风险（与 updater 例外并列）+ §5.7 已定 B 的“本地模型端点例外” |
| `src/shared/types.ts` | 扩展 | `AiSettings` 增 `profiles/defaultProfileId`，旧字段标 deprecated |

## 8. 分期与验收

| 阶段 | 内容 | 人日 | 验收 |
|---|---|---|---|
| P0 | 纯搬移：`shared/ai/{types,errors,catalog,provider-url}` + `electron/ai/drivers/*`，`ai-service` 行为不变 | 0.5–1 | `npx tsc --noEmit`、`npm test`、`npm run test:quality` 全绿，无断言改动 |
| P1 | `transport` + `ModelDriver` 接入；`apiSurface` 显式化 + 协商持久化 | 1–1.5 | 新增 `tests/ai-driver-*.test.ts`、`tests/ai-capabilities.test.ts`；改写 `ai-provider.test.ts:129`；`tests/security.test.ts` 仍断言仅 netguard 出网 |
| P2 | 结构化阶梯 + 独立修复预算 + `JsonPathStreamExtractor` | 1–2 | 新增“校验失败不消耗网络重试”“流式任意字段”用例；现有成本/用量用例保持 |
| P3a | 三张表 + 迁移 + `ai-profile-repository` + 凭据改造（`CredEnumerate` 与缓存）+ 8 个 IPC | 2 | 新增 `tests/ai-profile-repository.test.ts`、`tests/ai-profile-secrets.test.ts`、`tests/ai-profile-migration.test.ts`、`tests/provider-url.test.ts` |
| P3b | 设置页来源列表 + 添加弹窗 + 角色路由 UI + 空状态 + browser-demo 对齐 | 1.5–2 | 新增 `tests/settings-ai-profiles.test.tsx`；`tests/settings-page.test.tsx` 扩展；`npm run test:e2e` |
| P4 | 快速切换器 + 单次覆盖通道 + 测试五项清单 + `/models` 刷新 + 导入导出 | 1.5–2 | 新增 `tests/ai-role-routing.test.ts`、`tests/ai-task-override.test.ts`、`tests/provider-presets.test.ts`；`npm run test:e2e` |
| P5（可选/并行） | §5.7 本地端点（已定 B）/ §5.10 全局代理（并行线）/ 熔断与并发 / 预算 / 作品级锁定 / fallback 链 | 1–2 + 代理线 | 新增 `tests/netguard-local-endpoint.test.ts`、`tests/netguard-proxy.test.ts`；`npm run test:e2e` |

每阶段合并前：`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`；涉及 UI 加 `npm run test:e2e`，涉及提示词/质检加 `npm run test:quality`，发布前 `npm run test:scale` 与 `npm run test:electron`。

提交纪律：P0 是纯搬移，单独提交；P1 的协议选择属于算法变更，单独提交；P3/P4 的凭据与来源配置属于安全相关，单独提交；§5.7 的 netguard 例外必须单独提交并附 `docs/security.md` 说明。

### 8.1 手工验收脚本（每期发布前跑一遍）

1. **密钥留存**：添加两个来源并各存密钥 → 重启应用 → 两个来源都显示“密钥已保存”，切换来源不触发重新输入。
2. **切换不串味**：开始一次拆书 → 中途把默认来源切到另一个 → 在途任务仍用原来源（审计 `ai_jobs.profile_id` 不变），下一次任务用新来源。
3. **缓存迁移**：升级前完成一次拆书 → 升级后用同一本书重新拆 → 日志显示命中旧 provider 别名，不重复计费。
4. **单次覆盖**：写作台选“仅本次使用”另一个模型生成一章 → 审计记录该章为覆盖模型，之后的任务回到角色路由。
5. **导入导出**：导出配置 → 换一个工作区导入 → 来源与角色路由完整，密钥为空且提示“需重新填写”；导出文件里搜不到任何密钥串。
6. **凭据不进库**：用 `strings` 或十六进制查看 `catalog.sqlite` 与导出备份，搜不到密钥明文；自定义头名场景同样搜不到。
7. **空状态**：新建工作区 → 写作台与设置页显示“先添加来源”，AI 入口禁用并给出原因。

## 9. 非目标与风险

- **不做网关**：不新增本地代理进程、不代理第三方请求、不做多租户。
- **不做云同步配置**：来源配置靠导入导出迁移，不上传。
- **不引入 `ai` SDK**：除非出现以下需求之一——需要工具调用/多模态/agent 循环、需要跨供应商流式工具事件归一化、或现有解析器维护成本超过接入成本。届时用“自定义 `fetch` + netguard dispatcher”把 SDK 接到 `transport` 后面，`ModelDriver` 接口保持不变。
- **不上传任何创作数据**：`/models` 刷新只取模型元数据；请求体内容策略不变（拆书仍只发脱敏片段）。
- **不弱化人工门禁**：连接层只负责“取回候选”，不写章节状态、不自动定稿。
- **风险**：
  - 内置快照会过期 → 用户覆盖 + 探测缓存 + `/models` 刷新三重兜底。
  - 多来源放大“声音漂移” → 一致性提醒 + 可选作品级锁定。
  - 来源数量膨胀导致设置页复杂 → 启用/停用 + 最近使用排序 + 折叠。
  - 协商探测会多一次请求 → 一次性，落库后消除。
  - §5.7 的安全例外若设计不当会打开 SSRF 面 → 只字面量 IP、不解析域名、不跟随重定向、仅显式配置生效。
  - 任意头名传密钥若绕过校验会明文落库 → 拒绝名单 + 密钥值只允许走 `custom-header` 进凭据库（§5.2）。
  - 缓存域迁移会让历史缓存一次性失效 → `legacy_provider` 别名回查兜底（§5.9）。

### 9.1 代理支持（已实施，完整设计见 §5.10）

代理方案已并入本方案并落地，完整设计在 **§5.10**（HTTP/HTTPS/SOCKS5、凭据入凭据管理器、代理地址校验与目的地校验分离、DNS rebinding 残余风险、UI 与 IPC）。边界：

- 代理由 netguard 的 `configureOutboundProxy` 全局管理，**不按来源配置**；`transport.ts` 的 `options.dispatcher` 只用于 §5.7 的本地端点直连，以及未来按来源走不同代理的扩展点。
- 代理不覆盖 `electron-updater`（它直连 GitHub Releases，不经 netguard），也不放宽目标 URL 的公网校验。
- 关键证据：`tests/outbound-proxy.test.ts` 用真实 CONNECT 桩代理验证了 Node 内置 fetch + `ProxyAgent` dispatcher 这条路径。

## 10. 测试清单

| 文件 | 覆盖 |
|---|---|
| `tests/ai-errors.test.ts` | 12 类错误分类、`Retry-After` 解析、`retryable` 判定 |
| `tests/ai-catalog.test.ts` | 目录解析优先级（user > probe > remote > catalog）、缺失模型兜底 |
| `tests/provider-url.test.ts` | 端点后缀纠正、`/v1` 变体、查询串拒绝、内嵌凭据拒绝、本地判定 |
| `tests/provider-presets.test.ts` | 12 个模板字段完整性与地址合法性 |
| `tests/ai-driver-openai.test.ts` | chat 请求体、JSON mode 降档、流式与非流式解析 |
| `tests/ai-driver-responses.test.ts` | `text.format`、refusal、`response.failed/incomplete` |
| `tests/ai-driver-anthropic.test.ts` | Messages 路径、`max_tokens` 截断、usage 合并 |
| `tests/ai-capabilities.test.ts` | 协商只发生一次、否定结果缓存与 TTL、降档后不再试错 |
| `tests/ai-structured-output.test.ts` | 阶梯降档、修复预算独立于网络重试 |
| `tests/ai-profile-repository.test.ts` | 来源 CRUD、排序、停用、删除前的引用检查 |
| `tests/ai-profile-migration.test.ts` | 旧设置与旧凭据迁移、缓存 provider 别名回查、幂等、失败不阻塞启动 |
| `tests/ai-role-routing.test.ts` | 三层优先级、任务快照不串味、缓存键含来源 |
| `tests/settings-ai-profiles.test.tsx` | 添加/编辑/删除/测试连接/角色路由 UI 流程 |
| `tests/netguard-local-endpoint.test.ts` | 仅字面量回环/私网、不解析域名、禁重定向（§5.7 已定 B） |
| `tests/ai-profile-secrets.test.ts` | `extra_headers` 拒绝名单、`custom-header` 值只进凭据库、导出与日志无密钥 |
| `tests/ai-task-override.test.ts` | 单次覆盖只影响本次请求、不改角色路由、审计记录覆盖模型 |
| `tests/credential-enumerate.test.ts` | 前缀列举、缓存水合与增量更新（用注入的假执行器） |
| `tests/netguard-proxy.test.ts` | 代理 dispatcher 构建/缓存/清除、`options.dispatcher` 优先级、代理地址允许 loopback 而目标仍拒私网、`socks4` 拒绝、密码不入库 |
