# Bug 修复方案（2026-09-09）

> 依据：[BUG_REPORT_2026-09-09.md](./BUG_REPORT_2026-09-09.md)（高危 5 / 中危 12 / 低危 9 + 8/1 遗留 4 项）
> 状态：**方案待确认，尚未改动任何代码**
> 约束：不弱化人审门禁（AGENTS.md 第 1 条）；不放松安全边界（第 3 条）；多语句写库保持事务（第 5 条）；每个修复项自带回归测试。

---

## 一、批次总览

| 批次 | 内容 | 项数 | 预估改动 | 建议顺序 |
|---|---|---|---|---|
| A 接线级 | H1 本地端点、H2 密钥门禁 | 2 | 5 个文件 + 3 组测试 | 1 |
| B 数据正确性 | H3 质检消耗变更单、H4 开书包幂等、H5 恢复稿 | 3 | 6 个文件 + 3 组测试 | 2 |
| C 生成与账本 | M1、M4、M5、M6、M7、M8、M9、M12、M15 | 9 | 12 个文件 | 3 |
| D 孵化台与前端 | M2、M3、M10、M11 | 4 | 4 个文件 + 组件测试 | 4 |
| E 低危与遗留 | L1–L9、遗留 5/6/7c/7d | 9 | 10 个文件 | 5 |

批次内每项独立成 commit（Conventional Commits，修复与测试同一提交）；跨批次不混合。每批次完成后跑 `npm test` + `npm run build`；C 批涉及质量规则，额外跑 `npm run test:quality`。

---

## 二、批次 A：接线级（影响所有用户，先修）

### A1 H1 本地模型端点必然失败

**根因**：保存侧要求本地端点用 `http://`，解析侧无条件走只允许 https 的 `normalizeProviderUrl`。

**改法**：
1. `src/shared/ai/provider-url.ts:4` — `normalizeProviderUrl(baseUrl, options?: { allowInsecure?: boolean })`：仅当 `allowInsecure && protocol === "http:"` 放行，其余（userinfo / query / hash / https 校验）逻辑不变；保持与 `canonicalizeProviderUrl`（:29）同一套规则，避免两处判断分叉。
2. `electron/ai/route-resolver.ts:74` — 传 `{ allowInsecure: profile.localEndpoint === true }`。
3. `electron/ai-service.ts:195` — 传 `{ allowInsecure: route?.localEndpoint === true }`（这里还会用 route 的 baseUrl 再算一次 provider 缓存键，不修则第二处继续抛）。
4. `electron/ai-provider.ts:66` — 旧版遗留路径，先确认是否仍可达（`AiProvider` 类已无实例化点，仅 `ai-service.ts:104` 引用其导出常量）；若不可达则不动，可达则同样按 localEndpoint 放行。

**安全说明**：放行 http 不会突破出站边界——真正发请求时 `transport.ts:38` 的 `local: true` 走 `fetchLocalEndpointResponse`，其 `assertLocalEndpointUrl`（`netguard.ts:157-163`）只接受字面量回环/私网 IP 且禁止重定向。方案只影响 URL 规范化，不新增出站通道。

**测试**：
- `tests/ai-route-resolver.test.ts`：新增 http 本地来源（`localEndpoint: true`）→ 解析成功且 `localEndpoint === true`；http 非本地来源仍抛错。
- `tests/provider-url.test.ts`（若无则新建）：`allowInsecure` 下 http 放行、https 正常、query/userinfo 仍拒绝。
- `tests/ai-service.test.ts`：route 带 `localEndpoint` 时 `runJson` 不再抛「必须使用 HTTPS」。

**风险**：低。唯一的语义变化是「本地端点来源的 baseUrl 允许 http」，与保存侧校验一致。

### A2 H2 旧版密钥门禁未接线

**根因**：五处门禁读的是已废弃的 `apiCredential`（迁移后清空、渲染层无写入方），而请求实际用来源密钥。

**改法**：
1. `electron/main.ts` 新增 `hasUsableAiCredential()`（同步）：有来源时按「角色路由 → 默认来源 → 任一启用来源」解析，返回 `!requiresKey || Boolean(profileCredentials.get(id))`；无来源时回退旧版 `apiCredential`。
2. 替换门禁调用点：
   - `electron/chapter-generation-service.ts:99`：依赖项由 `getApiKey` 改为 `hasCredential`（`ChapterGenerationDependencies` 同步调整，`main.ts:593-598` 注入）。
   - `electron/handlers/ai-handlers.ts:184`（云端语义质检）、`:275`（事实提取）、`:428`/`:440`（`hasApiKey` 展示）：改用 `hasUsableAiCredential()`。
   - `electron/ai-service.ts:679`（语义拆书降级判断）：改用注入的凭据判断函数；`ai-service.ts:182` 的 `route?.apiKey || this.getApiKey()` 保持不动（它只是兜底取 key，不是门禁）。
3. 错误文案区分两种情形：「未配置任何来源」vs「来源 X 没有密钥」，后者沿用 `runJson` 现有提示。

**测试**：
- `tests/chapter-generation-service.test.ts`：注入「有来源+来源密钥、legacy 为空」→ 单章生成不再被拒。
- `tests/ai-handlers.test.ts`：同样配置下语义质检被调用、事实提取返回正常状态、`hasApiKey` 为 true。
- `tests/ai-service.test.ts`：拆书在来源密钥可用时不再降级为本地统计。

**风险**：中。门禁从「全局单密钥」改为「按来源判断」，需覆盖「无来源且无 legacy 密钥」仍拒绝的负例。

---

## 三、批次 B：数据正确性

### B1 H3 受保护章节质检消耗变更单

**根因**：质检把 `batchMode` 改成「逐章」走了受保护内容编辑通道，而 `batchMode` 是工作流派生标记，不是用户内容修改。

**改法**（`electron/database.ts:1207-1211`）：不调用 `persistChapterInTransaction`，改为在同一事务内做定向列更新：
```ts
if (plan.forceSequentialReview) {
  const chapter = this.projects.getChapter(db, chapterId);
  if (chapter && chapter.batchMode !== "逐章")
    db.prepare("UPDATE chapters SET batch_mode = ? WHERE id = ?").run("逐章", chapterId);
}
```
- 不消耗变更单、不改状态、不失效排期、不建修订（`batchMode` 不参与 FTS/embedding）。
- `chapterContentChanged` 保持包含 `batchMode`，因此**用户手动**在受保护章节上切换批次模式仍然被门禁拦住，人审边界不放松。
- 同时补一条：`saveIssues` 的 `upserts` 与 `batch_mode` 更新已在同一 `BEGIN IMMEDIATE` 内，无需额外事务。

**测试**（`tests/database.test.ts`）：待发布章节 + 一条硬性 issue + 一张已批准变更单 → issue 落库、章节状态仍「待发布」、排期不变、变更单仍「已批准」；无变更单时同样不抛错。

### B2 H4 开书包可重复生成

**根因**：按钮守卫是「没有已批准分卷」，而产出全是草稿，守卫永不为假；重复调用以新随机 id 插入重复章节。

**改法**：
1. `electron/handlers/project-handlers.ts:138` 增加服务端幂等守卫：`if (project.chapters.length || project.plans.length) throw new Error("已有规划或章节，开书包只能生成一次；如需重做请先删除对应草稿")`。
2. `src/pages/ProjectDashboard.tsx:191` 条件补上 `project.chapters.length === 0 && project.plans.length === 0`，按钮在已有任何规划/章节后不再出现。
3. 文案说明「开书包只在空项目上可用」。

**测试**（`tests/project-handlers.test.ts`）：第二次调用抛错且库内章节/规划数量不变；首次调用成功。

**备选（不推荐）**：让章节 id 按「项目+章号」确定性生成以覆盖写入——会静默覆盖用户已改过的章纲，违背人审门禁。

### B3 H5 新章恢复稿被丢弃

**根因**：新章 `revision=0`、`id=""`，而 `EMPTY_CHAPTER` 的 `updatedAt` 取当前时间，恒比恢复稿新。

**改法**：
1. `src/lib/chapter-draft.ts:21-23` 判定改为：
   - `!chapter.id`（尚未落库的新章）：恢复稿内容/章纲非空即采用，不比时间戳；
   - 已有章节：`revision` 严格比较；`revision` 相等时比较 `updatedAt`，且 `Date.parse` 为 NaN 视为无效副本（顺带修 L5/遗留 7b）。
2. `src/lib/chapter-draft.ts:30-41` `writeRecoveredChapter` 写入时补 `updatedAt: new Date().toISOString()`，避免「保存后继续输入」的本地内容因时间戳落后被丢弃。

**测试**（`tests/chapter-draft.test.ts`）：新章恢复稿被采用；非法 `updatedAt` 不采用；服务器 revision 更高时不采用；保存后本地新增内容可恢复。

**风险**：同 revision 下优先本地副本，极端情况可能"复活"用户已手动清空的新章草稿——只影响未落库新章，且内容非空才触发。

---

## 四、批次 C：生成与账本

| # | 改法要点 | 测试 |
|---|---|---|
| C1 M1 资源守恒误报 | `src/shared/story-constraints.ts:150-155`：先判 `amount === null \|\| amount <= available`，再仅当 `describedResource` 非空时做资源名匹配 | 「消耗了三万五」+ 两条无关资源事实 → 无 issue；匹配资源 → 有 issue |
| C2 M4 标签跨频道混入 | `src/shared/category-tags.ts:27-30` 增 `channel` 参数，匹配 `listName.includes(channel) && listName.includes(name)`；`electron/handlers/project-handlers.ts:133-137` 传 `profile.channel`（类型已有 `channel` 字段，IPC 签名不变） | 男频「都市种田」快照 + 女频「种田」查询 → 空；同频道 → 命中 |
| C3 M5 extraQuery 丢弃 | 把 `ai-profile-handlers.ts:128` 的 `withQuery` 提取到 `src/shared/ai/provider-url.ts`（纯函数），三个驱动（`openai-chat.ts:69`、`openai-responses.ts:146`、`anthropic-messages.ts:96`）构造 endpoint 时拼接 `config.extraQuery` | 驱动测试断言 URL 带 `api-version`；无参数时不产生 `?` |
| C4 M6 截断未识别 | `electron/ai-service.ts:427/433` 的截断判断去掉 `useAnthropic` 前缀（OpenAI 系同样处理）；驱动流式分支（`openai-chat.ts:107`）真实传递 `finishReason` 而非硬编码 `stop`；统一抛「模型输出达到上限，结果已截断」并**不进入结构修复重试** | 模拟 `finish_reason=length` → 抛截断错误且只请求一次 |
| C5 M7 能力协商选错行 | `electron/repositories/ai-profile-repository.ts:227` 增加 `ORDER BY probed_at DESC`；`electron/ai/route-resolver.ts:80-84` 跳过 `supportsJsonSchema === false && supportsJsonMode === false` 的明显失败行 | 先失败 probe 再成功 probe → 解析到 `openai-chat` |
| C6 M8 H2 未覆盖批量/修订 | 批量：`chapter-generation-service.ts:150` 改用 `ai.startDraftChapter(...)` 捕获 `jobId`，`saveGeneratedChapter` 失败时 `markAiJobApplicationFailed`（与单章 `:111-126` 同型）；修订：`ai-service.ts:1715` 增加可选 `onJobStarted`，`ai-handlers.ts:244-250` 捕获 jobId 后同样处理 | 批量/修订保存被乐观锁拒绝 → 任务落库为「失败」，缓存条目失效 |
| C7 M9 空正文重复章节 | `electron/worker.ts:257-258` 增加两侧 `content.trim()` 非空前提 | 双空 → 无 issue；相同非空 → 有 issue |
| C8 M12 变更单可回写 | `electron/database.ts:1197` 泛化分支排除 `changes`（抛「变更单不支持恢复历史版本」）；`facts` 恢复保留但补审计说明 | 恢复已应用变更单的旧修订 → 抛错且状态不变 |
| C9 遗留 5 变更单误消耗 | `authorizeRestore`（`:1161-1182`）返回新建变更单 id；`saveChapter`/`persistChapter`/`persistChapterInTransaction` 增加可选 `changeRequestId`，`consumeApprovedChange` 按 id 精确消耗；`restoreRevision` 把两者放进同一事务 | 用户已有同 target/baseVersion 的已批准变更单 + 恢复历史 → 用户单保持「已批准」，恢复单被消耗 |

---

## 五、批次 D：孵化台与前端

| # | 改法要点 | 测试 |
|---|---|---|
| D1 M2 切换候选不回写 | `IncubationWorkspace.tsx` 增本地 `selectedCandidateId` 状态（与 draft 同步），`selectedCandidate` 由本地状态推导；表头点击 `setSelectedCandidateId(id)` 并 `persist({ selectedCandidateId: id })`；`promote` 前用当前本地值显式覆盖 | 组件测试：切换后标题/体检/`promote` 都用新候选 |
| D2 M3 确认项跨候选泄漏 | 点击候选时把 `setAcknowledged([])` 的结果显式传给 persist（`persist(overrides, acknowledgedOverride)` 或改用 ref 读取最新值），保证写库的 acknowledged 属于目标候选 | 组件测试：A 确认后切 B → B 的阻断项仍为未确认 |
| D3 M10 故事圣经被 reload 重置 | `StoryBibleWorkspace.tsx:62` 改为按「项目 id + contract.version」同步，并用 dirty ref 判断：本地有未保存修改时不覆盖，改为提示「服务器版本已更新」 | 组件测试：编辑后触发 reload → 表单内容保留 |
| D4 M11 改存稿线清空候选 | `NewProjectModal.tsx:238-243` 拆分 `patchGeneration`（清候选）与 `patchMeta`（不清），`safeStockLine`（`:761-762`）走后者；`buildDraft`（`:330-350`）在 `concepts` 为空时回退到已存草稿的 `candidates`，`saveIncubation` 前不覆盖非空候选 | 组件测试：改存稿线后候选仍在；空候选不会覆盖已存草稿 |

---

## 六、批次 E：低危与其余遗留

| # | 改法要点 |
|---|---|
| E1 L1 回退后摘要过期 | `database.ts:1032-1042`：受保护编辑导致状态离开「已定稿」时，同步重建受影响摘要（或在生成上下文组装时过滤状态非定稿的摘要） |
| E2 L2 摘要无事务 | `database.ts:2010-2022` 循环包 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` |
| E3 L3 2 字搜索摘要错乱 | `search-repository.ts:37` 改为大小写不敏感查找（`toLowerCase().indexOf`），`index === -1` 时回退标题 |
| E4 L4 备份恢复预检 | `backup.ts:104` 前加 `stat` 源文件大小上限；`manifest.files` 声明值与条目数校验提前到解压循环之前，逐条目改用流式/限量解压 |
| E5 L5/L6/遗留 7b/7d | 随 B3 一起修（`Date.parse` NaN、`saveLatest` 清旧 `retryTimer`） |
| E6 L7/遗留 6 保存期间切章 | `WritingWorkspace.tsx:361-384` 保存期间置 busy（或在 `onSaved` 校验 `selectedId` 未变再更新签名/选中项） |
| E7 L8/遗留 L6 采用此方向 | `ProjectDashboard.tsx:331-355` 契约已审批时禁用按钮并提示走改纲变更单 |
| E8 L9 数字与 SSE | `story-constraints.ts:40-44` 支持「2万5」省略尾数；`ai/drivers/sse.ts:19` 仅在行首/行尾有分隔语义时 trim |
| E9 遗留 7c 恢复历史版本 | 恢复期间置 busy 并暂停 autosave，与 E6 共用一套机制 |

---

## 七、验证计划

| 阶段 | 命令 | 通过标准 |
|---|---|---|
| 每批次 | `npm test` | 611+ 项全绿，新增用例全绿 |
| 每批次 | `npm run build` | `tsc --noEmit` + vite + tsup 无错误 |
| C 批 | `npm run test:quality` | 16 项质量基准不回归 |
| A 批 | 手动冒烟 | 配一个本地端点来源（Ollama/LM Studio 或本地假服务）跑一次章纲生成，确认不再抛 HTTPS；再用纯云端来源确认单章生成不再报「尚未配置密钥」 |
| B 批 | 手动冒烟 | 开书包点两次；新章输入后关窗重开；受保护章节点质检 |
| 收尾 | `npm run test:e2e` | 22 项通过 |

---

## 八、提交拆分建议

```
fix(ai): allow http for local-endpoint sources in route resolution        # A1
fix(ai): gate AI tasks on profile credentials instead of the legacy key   # A2
fix(quality): stop quality runs from consuming approved change requests   # B1
fix(creation): make the launch pack idempotent                            # B2
fix(writing): keep local recovery drafts for unsaved new chapters         # B3
fix(quality): ... (C1)
... 每项一个 commit，修复与回归测试同提交
```

---

## 九、需要你拍板的 5 个选择

1. **H4 开书包**：已有规划/章节时直接拒绝（推荐）还是弹二次确认允许重生成？
2. **H2 门禁口径**：按「角色路由 → 默认来源 → 任一启用来源」判断（推荐），还是只认默认来源？
3. **H5 恢复策略**：同 revision 下本地副本优先（推荐，可能复活未落库新章的旧草稿）还是仅当服务器内容为空时采用？
4. **M12**：直接禁止恢复 `changes` 集合（推荐），还是允许但要求走变更单？
5. **M15**：按恢复变更单 id 精确消耗（推荐，需给保存链路加可选参数），还是按标题匹配（改动小但脆弱）？

---

## 十、明确不做

- 不重构 `saveIssues` / `persistChapter` 的整体结构，只做定向修正；
- 不改质量规则文案与提示词（C1 只改资源名匹配的判定顺序，不新增/删除规则）；
- 不放宽任何受保护章节的**用户内容**编辑门禁；
- 不新增出站通道，本地端点仍只允许字面量回环/私网 IP。

---

## 十一、实施记录（2026-09-09，已按推荐项完成）

**结果**：报告内 26 项（高 5 / 中 12 / 低 9）与 8/1 遗留 4 项全部修复，共改动 41 个文件（+1016 / -123），新增 1 个源文件、5 个测试文件。**尚未提交**，工作区保留全部改动。

| 项 | 落点 | 新增回归测试 |
|---|---|---|
| A1 本地端点 http | `provider-url.ts`（allowInsecure）、`route-resolver.ts:74`、`ai-service.ts:195` | `provider-url` / `ai-route-resolver` 各 +2 |
| A2 密钥门禁 | 新增 `electron/ai/credential-presence.ts`；`main.ts`、`ai-handlers`、`chapter-generation-service`、`ai-service` 注入 `hasAiCredential` | 新增 `ai-credential-presence.test.ts`（6 项） |
| B1 质检门禁 | `database.ts saveIssues` 改定向更新 `batch_mode` | `database.test.ts` +2 |
| B2 开书包幂等 | `project-handlers.ts:138` 守卫、`ProjectDashboard.tsx:191` 条件 | `project-handlers.test.ts` 扩展 |
| B3 恢复稿 | `chapter-draft.ts` 新章分支 + 写入补时间戳 + NaN 处理 | `chapter-draft.test.ts` +3 |
| C1 资源守恒 | `story-constraints.ts` 空资源名跳过 | +2 |
| C2 标签频道 | `category-tags.ts` 增 channel；两处调用传 `profile.channel` | +1 |
| C3 extraQuery | `withQuery` 提取到 `provider-url.ts`，三个驱动拼接 | `ai-driver.test.ts` +1 |
| C4 截断 | `ai-service.ts` 泛化截断判断；chat/responses 驱动透传 `finish_reason` | `ai-driver` +2、`ai-service` +1 |
| C5 能力行 | 仓储 `ORDER BY probed_at DESC` + 路由跳过双 false 行 | `ai-route-resolver` +2 |
| C6 批量/修订 | `draftChapter`/`reviseChapter` 增加 `onJobStarted`，保存失败补 `markAiJobApplicationFailed` | `chapter-generation-service` +1、`ai-handlers` +1 |
| C7 空正文重复 | `worker.ts:257` 两侧非空前提 | `genre-quality` +2 |
| C8 账本回写 | `database.ts restoreRevision` 拒绝 `changes` | `database.test.ts` +1 |
| C9 恢复消耗 | `saveChapter`/`savePlan`/`saveContract` 支持精确 `changeRequestId`；失败清理恢复单 | `database.test.ts` +1 |
| D1/D2 孵化台 | `IncubationWorkspace.tsx` 本地 `selectedCandidateId` + 显式 acknowledged | 新增 `incubation-workspace.test.tsx` |
| D3 故事圣经 | `StoryBibleWorkspace.tsx` 脏数据保护 + 「载入服务器版本」 | 新增 `story-bible-dirty.test.tsx`（2 项） |
| D4 存稿线 | `NewProjectModal.tsx` 拆 `patchMeta` | 新增 `new-project-modal.test.tsx` |
| E1/E2 摘要 | 章节离开定稿集时重建摘要；`updateSummaries` 包事务 | `database.test.ts` +1 |
| E3 搜索摘要 | `search-repository.ts` SQL 与 JS 均大小写不敏感 | `database.test.ts` +1 |
| E4 备份预检 | `backup.ts` 源文件 stat + 条目声明体积预检 | 既有备份测试覆盖 |
| E5/E8 低危 | `saveLatest` 清 retryTimer；「2万5」/「5亿3」；SSE 保留切开处空格 | `story-constraints` +2、`ai-sse` +1 |
| E6/E7/E9 前端 | 保存期间切章不拉回；已审批契约禁用「采用此方向」；恢复历史版本置 busy | 既有 e2e/组件测试覆盖 |

**验证**：`npx tsc --noEmit` 0 错误；`npm test` **647 passed / 1 skipped**；`npm run test:quality` 20 passed；`npm run build` 成功；`npm run test:e2e` **22 passed**。

**对既有测试的两处行为更新**（随行为变更同步）：
- `tests/ai-provider.test.ts`：`readChatCompletionStream` 返回值新增 `finishReason` 字段；
- `tests/ai-service.test.ts`：Anthropic 截断错误文案统一为「模型输出达到输出上限，结果已截断」。

**清理**：删除了审计子代理遗留的临时复现文件 `tests/_tmp-ui-review-repro.test.tsx`（未跟踪，断言的是修复前的旧行为）。

**未做**：未提交、未推送（等你确认后可分批提交，提交信息见第八节）。

