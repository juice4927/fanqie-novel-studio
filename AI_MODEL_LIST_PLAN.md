# 模型清单自动获取方案（2026-09-08 · 已实施）

> 目标：把已经存在的 `/models` 拉取通道补成一条完整数据链——**自动触发 + 本地读回 + 输入建议 + 换端点清缓存**，让「获取模型」从一次性的手动动作变成常态能力，用户不必再手打模型 ID。
> 约束不变：所有出站流量仍走 `electron/netguard.ts`（本地端点走既有豁免）；`src/shared/` 保持纯净；渲染层永不接触密钥；不引入新依赖；不做用户未主动触发的静默预取。
>
> 本方案是 `AI_CONNECTION_PLAN.md` §5.4「模型下拉的作用域」（该文件 `:331`）的补完，不是新需求：P4 记了「`/models` 刷新」（`:23`），但只落地了拉取与落库，没有落地下拉。

## 实施状态（2026-09-08，已全部落地，尚未提交）

验收基线：`npm run lint` ✅、`npm test` 557 通过 / 1 跳过、`npm run build` ✅。

| §8 提交 | 状态 | 落地内容 |
|---|---|---|
| 1 `feat(ai)` | ✅ | `AiProfileModelOption` + `listAiProfileModels` + `refreshAiProfileModels(id, force?)` + 主进程 10 分钟节流；preload / `AppApi` / IPC 校验 / 浏览器预览桩同步 |
| 2 `fix(ai)` | ✅ | `saveProfile` 包 `BEGIN IMMEDIATE`，`baseUrl` 或 `apiSurface` 变化时清空该来源的能力行 |
| 3 `feat(ui)` | ✅ | 默认模型与角色路由模型输入框挂 `datalist`；打开编辑弹窗 / 测试连接成功 / 保存成功后自动刷新；hint 两态 |
| 4 `docs` | ✅ | 本文件与 `AI_CONNECTION_PLAN.md` 实施状态回写 |

实现与设计的偏差（以代码为准）：

- hint 收敛为两态（「该端点不支持模型清单」与「暂时没有模型清单，可手动填写」）：有缓存时直接显示数量，自动刷新失败静默，没有单独的「正在使用上次缓存」提示。
- 节流命中时直接返回该来源 `source=remote` 的缓存行，不发请求；失败与空清单同样计入 TTL，避免反复开关弹窗连打对方。
- 手工填写的 `defaultModel` 与角色路由 `modelId` 若还没有能力行，会以 `source=user` 合成进候选列表。
- 保存来源、测试连接成功、删除来源都会清掉该来源的节流记录：否则一次 401 尝试会占用 10 分钟 TTL，用户补上密钥后反而拉不到清单。
- 新增 9 个用例（`tests/ai-profile-models.test.ts` 5 个、仓储 1 个、设置页组件 3 个）。

## 0. 一句话结论

`refreshAiProfileModels` 已经把远端清单写进了 `model_capabilities` 表，但**没有任何通道把它读回渲染层**，两个模型输入框仍是纯文本框，拉取结果只在 toast 里出现一次就消失；本次补上读回 IPC、输入建议与自动触发，并顺手修掉「换端点后旧清单残留」这个会在下拉上线后变成 404 的隐患。

## 1. 现状（有据可查）

| # | 现象 | 证据 | 影响 |
|---|---|---|---|
| 1 | 拉取只有手动入口 | `src/components/AiProfileManager.tsx:251-264`「刷新模型」按钮 | 用户不点就永远没有清单；换端点后也不会自动重拉 |
| 2 | 清单不回填任何输入框 | 默认模型 `AiProfileManager.tsx:414-420`、角色路由模型 `:337-345` 都是纯 `Input` | 拿到 500 个模型名后仍要手打或复制粘贴 |
| 3 | 没有读回通道 | `electron/handlers/ai-profile-handlers.ts` 只注册了 `refreshAiProfileModels`（`:240`）；`listModelCapabilities` 只出现在类型联合里（`:29`），没有对应 `register` | 重启应用后清单不可见，只能重新联网拉 |
| 4 | 数据其实已落库 | `model_capabilities` 表，远端行 `source=remote`，主键 `(profile_id, model_id, api_surface)`（`electron/database.ts:252-266`） | 缺的只是读出来 |
| 5 | 换端点不清旧清单 | `saveProfile` 不动 `model_capabilities`（`electron/repositories/ai-profile-repository.ts:102-149`），只有 `deleteProfile` 清（`:158`） | 下拉上线后会列出别家来源的模型，选错只会得到难懂的 404（正是 `AI_CONNECTION_PLAN.md:331` 要避免的） |
| 6 | 无清单端点静默为空 | `ai-profile-handlers.ts:243`（anthropic 直接返回 `[]`）、`:258`（404/405 返回 `[]`） | 行为本身正确，但 UI 只弹一句 toast，没有区分「不支持清单」与「暂时拉不到」 |
| 7 | 方案原本就要求下拉 | `AI_CONNECTION_PLAN.md:331`（§5.4 模型下拉作用域）、`:23`（P4 已记 `/models` 刷新） | 本次是把设计补完 |
| 8 | 双端契约需要同步 | `electron/preload.ts:102`、`src/shared/types.ts:1026`、`electron/ipc-validation.ts:653`、`src/lib/browser-api.ts:1049`（预览桩返回 `[]`） | 新增通道必须四处同步，否则预览/测试会漂移 |

## 2. 设计决策

### 2.1 触发时机：只在用户动作上取数

| 时机 | 行为 | 理由 |
|---|---|---|
| 打开「编辑来源」弹窗（已有来源） | 先用本地清单渲染，缓存超过 TTL 才后台拉一次 | 用户此刻正要挑模型，是最自然的取数点 |
| 「测试连接」成功后 | 静默拉一次 | 凭据刚被验证，成功率高，失败不打扰 |
| 保存来源成功后（含新建） | 静默拉一次 | 新建来源首次得到清单 |
| 手动「刷新模型」 | 强制拉，忽略 TTL | 保留现有语义与用户控制感 |
| 应用启动 / 进入设置页 | **只读数据库**，不发请求 | 出站请求必须来自用户动作，不做静默预取 |

自动刷新失败一律静默（编辑弹窗里不弹错）；手动刷新失败照常 `notify(error)`。

### 2.2 节流放在主进程

模块级 `Map<profileId, number>` 记录上次尝试时间，`MODELS_REFRESH_TTL_MS = 10 * 60 * 1000`；成功、空清单、失败都算一次尝试，避免反复开关弹窗连打对方限流。手动 `force=true` 绕过。

不放在渲染层的原因：组件卸载即丢状态，防不住「反复开关弹窗」；主进程本来就能读 `probedAt`。跨重启不保留节流状态——可接受，重启后每个来源最多多发一次请求。

### 2.3 清单作用域：严格按 `AI_CONNECTION_PLAN.md` §5.4

只列**该来源**的模型，三部分合并，全部来自本地、不发网络请求：

1. `model_capabilities` 中该来源的全部行（`remote` 远端清单 / `probe` 实际用过并探测过 / `user` 用户覆盖）；
2. 该来源的 `defaultModel`（可能还没落能力行）；
3. 指向该来源的角色路由 `modelId`。

去重后排序：`defaultModel` 置顶，其余按字典序。**永不跨来源合并**——网关改名很常见，列别家的模型只会制造 404。

### 2.4 换端点即清缓存

`saveProfile` 比较新旧 `baseUrl` 或 `apiSurface`，任一变化就删除该来源的 `model_capabilities` 行（`probe`/`user` 也删——换了端点，旧探测结论同样失效）。

`saveProfile` 目前不是事务，需要包 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`（AGENTS.md 规则 5）。

### 2.5 空清单是正常状态，不是错误

| 情况 | 处理 |
|---|---|
| `anthropic-messages` 协议面 | 不发请求，直接返回 `[]`（现状保持），hint 提示「该端点不支持模型清单」 |
| HTTP 404 / 405 | 返回 `[]`，不写库、不报错（现状保持），hint 同上 |
| 其它非 2xx / 网络失败 | 手动刷新报错；自动刷新静默，有缓存就继续用缓存 |
| 清单为空 | 输入框退化为纯文本框（现状），**不清空用户已填的值**，始终允许自由输入 |

### 2.6 明确不做

- 不做启动预取、定时轮询、批量刷新全部来源；
- 不做模型能力自动探测（那是 `probe` 的职责，已在 `electron/main.ts:571` 的落库回调里）；
- 不引入第三方搜索式下拉组件——`datalist` 够用，仓库已有先例（`src/pages/StoryBibleWorkspace.tsx:193`，且 `src/components/UI.tsx:52` 的 `Input` 直接透传属性）；
- 不预置「目录中属于该来源模板的模型」——内置目录是**模型名正则**（`src/shared/ai/catalog.ts:36` 的 `PATTERNS`），没有 provider→模型列表的映射；预设已带 `defaultModel`，远端清单一拉即得。若后续需要离线候选，再给 `ProviderPreset` 加 `suggestedModels`（见 §9）。

## 3. 接口设计

### 3.1 共享类型（`src/shared/ai/types.ts`）

```ts
/** 渲染层可见的模型候选；不含密钥与请求细节。 */
export interface AiProfileModelOption {
  modelId: string;
  /** remote=远端清单，probe=实际用过并探测过，user=用户覆盖 */
  source: CapabilitySource;
  /** 最近一次写入时间（ISO）。 */
  fetchedAt: string;
}
```

### 3.2 IPC（`electron/handlers/ai-profile-handlers.ts`）

| 通道 | 签名 | 行为 |
|---|---|---|
| `listAiProfileModels`（新增） | `(id: string) => Promise<AiProfileModelOption[]>` | 只读本地；来源不存在抛「来源不存在」 |
| `refreshAiProfileModels`（扩参） | `(id: string, force?: boolean) => Promise<string[]>` | `force` 缺省 `false`；TTL 内直接返回缓存、不发请求；`anthropic-messages` 直接返回 `[]` |

`refresh` 的返回类型保持 `string[]`，避免破坏既有契约（`tests/settings-ai-profiles.test.tsx:83` 等桩）。响应上限 2 MB、最多 500 个、404/405 归为「不支持」的既有防护全部保留。

### 3.3 双端契约（四处同步）

| 文件 | 改动 |
|---|---|
| `electron/preload.ts:102` | 新增 `listAiProfileModels`；`refreshAiProfileModels` 透传 `force` |
| `src/shared/types.ts:1026` | `AppApi` 同步两个签名 |
| `electron/ipc-validation.ts:653` | `listAiProfileModels: idOnly`；`refreshAiProfileModels: z.tuple([id, z.boolean().optional()])` |
| `src/lib/browser-api.ts:1049` | 桩返回 `[]` |

### 3.4 UI（`src/components/AiProfileManager.tsx`）

- 新增状态 `modelOptions: Record<string, AiProfileModelOption[]>` 与 `loadModels(profileId, force)`；
- 编辑弹窗：`useEffect` 监听 `editing?.id`，已有来源时 `loadModels(id, false)`；
- 「默认模型」`Input` 加 `list` 指向 `<datalist id={`ai-model-options-${profileId}`}>`（仅编辑已有来源；新建来源用预设 `defaultModel`）；
- 角色路由「模型」`Input` 的 `list` 指向当前路由来源的清单；路由为「默认来源」时不挂 `datalist`；
- 「刷新模型」按钮改为 `loadModels(id, true)`，成功后更新状态并 toast「已获取 N 个模型」；
- `Field` 的 `hint` 三态：`已获取 N 个模型（远端 M / 探测 K / 手填 J）` / `该端点不支持模型清单，可手动填写` / `暂时拉不到清单，正在使用上次缓存`。

### 3.5 仓库层（`electron/repositories/ai-profile-repository.ts`）

- `saveProfile` 包事务，并在 `baseUrl` 或 `apiSurface` 变化时删除该来源的能力行；
- 复用现有 `listCapabilities`，不新增查询方法。

## 4. 安全与隐私

- `/models` 只取模型元数据，不发送任何创作内容；请求构造沿用现有 netguard 路径与本地端点豁免，本方案不新增出站口；
- 只对**已保存**的来源发请求，不探测用户输入到一半的地址；
- 渲染层只拿到 `modelId`/`source`/`fetchedAt`，不接触密钥与请求头；
- 清单是缓存而非配置：`exportAiProfiles` 继续不导出（保持现状）；
- 自动刷新不改变任何人工门禁语义。

## 5. 测试

| 层 | 文件 | 用例 |
|---|---|---|
| 仓储 | `tests/ai-profile-repository.test.ts` | `baseUrl` 变化清能力行；`apiSurface` 变化清；两者不变则保留；事务回滚后不残留 |
| IPC | `tests/ai-profile-models.test.ts`（新增） | `listAiProfileModels` 去重/排序/`defaultModel` 置顶；TTL 内二次调用不发请求（stub netguard）；`force` 绕过；404 返回空且不写行；`anthropic-messages` 不请求 |
| 组件 | `tests/settings-ai-profiles.test.tsx` | 远端模型出现在 `datalist`；角色模型 `datalist` 只含本来源；「刷新模型」传 `force=true`；打开弹窗触发一次读取 |

验收命令：`npm test` + `npm run build`（AGENTS.md 推送前要求）。设置页没有 e2e 覆盖，本次不新增 e2e。

## 6. 手工验收脚本

1. DeepSeek 来源（OpenAI 兼容，已存密钥）：打开「编辑」→ 数秒内 hint 显示模型数；「默认模型」下拉可选 `deepseek-chat` / `deepseek-reasoner`；
2. Anthropic 来源：不出现下拉，提示「该端点不支持模型清单」，手填仍能保存并生效；
3. 把某来源 `baseUrl` 改成另一地址并保存 → 旧模型从下拉中消失；
4. 断网后打开编辑弹窗 → 不报错，有缓存则显示缓存并提示「暂时拉不到清单」；
5. 角色路由选该来源后，其「模型」下拉只出现该来源的模型；
6. 反复开关弹窗 3 次 → 抓包/日志确认 10 分钟 TTL 内只发出一次 `/models` 请求。

## 7. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/shared/ai/types.ts` | 新增 | `AiProfileModelOption` |
| `electron/handlers/ai-profile-handlers.ts` | 修改 | `listAiProfileModels`；`refresh` 加 `force` 与 TTL 节流 |
| `electron/repositories/ai-profile-repository.ts` | 修改 | `saveProfile` 事务 + 端点变化清能力行 |
| `electron/preload.ts` | 修改 | 两个签名透传 |
| `src/shared/types.ts` | 修改 | `AppApi` 同步 |
| `electron/ipc-validation.ts` | 修改 | 校验规则 |
| `src/lib/browser-api.ts` | 修改 | 预览桩 |
| `src/components/AiProfileManager.tsx` | 修改 | datalist + 自动刷新 + hint 三态 |
| `tests/ai-profile-models.test.ts` | 新增 | handler 级用例 |
| `tests/ai-profile-repository.test.ts` | 修改 | 清缓存用例 |
| `tests/settings-ai-profiles.test.tsx` | 修改 | 组件级用例 |

## 8. 提交拆分

按 AGENTS.md「不混提交」原则拆成四个：

1. `feat(ai): expose the stored model list to the renderer` — 类型 + `listAiProfileModels` + 双端契约 + handler 测试；
2. `fix(ai): drop stale model capabilities when a profile endpoint changes` — 仓库层清缓存（独立提交，是行为修复）；
3. `feat(ui): suggest fetched models in the source editor` — datalist + 自动刷新触发 + 组件测试；
4. `docs(plan): record the model-list work` — 实施后把本方案状态与偏差写回，并在 `AI_CONNECTION_PLAN.md` 实施状态里补一行。

## 9. 风险与后续

| 风险 | 缓解 |
|---|---|
| 自动刷新增加出站请求 | 只在用户动作时触发 + 主进程 10 分钟 TTL + 手动强制；不做启动预取 |
| 清单可能有数百个模型，`datalist` 体验一般 | 500 上限已有；默认模型置顶；始终允许自由输入 |
| 换端点后旧模型串味 | §2.4 清缓存 + 仓储测试 |
| 节流状态重启丢失 | 可接受：重启后每个来源最多多发一次 |
| 网关 `/models` 返回非标准形状 | 现状已按「清单不可用」处理，不抛错 |

后续可选（本轮不做）：给 `ProviderPreset` 加 `suggestedModels`（2–4 个常见模型 ID），让首次配置在无网络/无密钥时也有候选。

## 10. 已落地的默认取值

以下取值已按推荐值实现，如需调整改这一处即可：

| 参数 | 取值 | 说明 |
|---|---|---|
| 自动刷新 TTL | 10 分钟 | 越长越省请求，越短越新鲜 |
| 保存后自动刷新 | 开 | 若嫌请求多可去掉，仅保留打开弹窗与测试成功后 |
| 测试连接后自动刷新 | 开 | 复用刚验证过的凭据 |
