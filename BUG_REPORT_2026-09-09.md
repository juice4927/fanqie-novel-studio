# Bug 排查报告（2026-09-09，只读检查，未改动任何代码）

> 检查对象：`main` @ `e663bd0`（v0.6.0，工作区 clean）
> 方法：`npm test`（105 文件 / 611 项全绿）+ `tsc` 未跑（本次为只读审查）+ 4 路并行代码审查（新功能 / 数据层 / AI 层 / 领域与前端）+ 逐条人工复核触发链 + 关键项动态执行真实模块验证
> 基线：已先读 `BUG_REPORT.md`（2026-07-31）与 `BUG_VERIFICATION_2026-08-01.md`，以下均为**未在其中出现的新问题**或**仍未修复的遗留项**。
> 统计：**高危 5 项、中危 12 项、低危 9 项**；8/1 报告 7 项遗留中 3 项已修、4 项仍在（见第五节）。

---

## 一、高危

### H1 本地模型端点（http）在路由解析阶段必然抛错，所有 AI 任务直接失败

- **位置**：`electron/ai/route-resolver.ts:74`；`src/shared/ai/provider-url.ts:7`；`electron/handlers/ai-profile-handlers.ts:99-101`、`:217-218`；预设 `src/shared/ai/provider-presets.ts:132-141`
- **触发**：新建来源时选「本地模型（Ollama / LM Studio）」预设（`http://127.0.0.1:11434/v1`）或手动打开「本地端点」开关并保存，然后运行任意 AI 任务。
- **原因**：保存侧对本地端点**强制要求 http**，解析侧却无条件走只允许 https 的 `normalizeProviderUrl`：
  ```ts
  // route-resolver.ts:74
  const baseUrl = normalizeProviderUrl(profile.baseUrl);
  // provider-url.ts:7
  if (url.protocol !== "https:") throw new Error("模型 API 地址必须使用 HTTPS");
  ```
- **后果**：`runJson` 第一步 `resolveRoute` 就抛错且无兜底，正文生成、章纲、质检、拆书全部不可用；而设置页「测试连接」走 `probeProfile` 直接建驱动、不经路由，能成功——形成"测试通过、生成全挂"的矛盾。现有测试 `tests/ai-route-resolver.test.ts:140` 的 local 来源仍用 https 地址，故未覆盖。
- **验证**：已用 esbuild 打包真实 `createAiRouteResolver` 执行 → `THREW: 模型 API 地址必须使用 HTTPS`。

### H2 旧版单密钥门禁未接线：`getApiKey()` 恒为空 → 单章 AI 生成被拒，语义质检 / 事实提取 / 语义拆书静默降级

- **位置**：`electron/main.ts:117-119`（`getApiKey` 只读 `apiCredential`）、`:128-132`（迁移后清空）、`:549-552`（启动时只从旧凭据读取）；受害点 `electron/chapter-generation-service.ts:99`、`electron/handlers/ai-handlers.ts:184`、`:275`、`:428`、`electron/ai-service.ts:679`
- **触发**：按现行主流程在「来源与角色路由」新建来源并保存密钥（写入 `profileCredentials` / Credential Manager），从未使用过旧版单密钥；或旧密钥已被 `migrateLegacyAiCredential` 迁移并清空。
- **证据**：渲染层已无任何 `saveApiKey` / `clearApiKey` 调用（全 `src/` grep 为空），即 `apiCredential` 不再有写入方；而真正发请求用的是 `route.apiKey`（`ai-service.ts:182`）。
- **后果**：
  1. `chapter-generation-service.ts:99` → 单章「AI 生成草稿」直接抛「尚未配置 AI API 密钥」（批量 `generateBatch` 不查该门禁，行为自相矛盾）；
  2. `ai-handlers.ts:184` → 云端语义质检被静默跳过，只返回本地规则；
  3. `ai-handlers.ts:275` → 定稿后状态账本自动提取返回「未配置」；
  4. `ai-service.ts:679` → 语义拆书永远降级为本地统计；
  5. `ai-handlers.ts:428` → 设置页 / 仪表盘永远显示「未配置密钥」。
- **备注**：开发机若仍残留旧版 Credential Manager 条目则不会复现，属典型"只在干净环境暴露"的接线 bug。测试均注入假 `getApiKey`，未覆盖生产接线。

### H3 受保护章节上运行质检：消耗已批准变更单、章节被拉回待质检、排期失效；无变更单时质检结果整批丢失

- **位置**：`electron/database.ts:1207-1211`（`saveIssues` 强制 batchMode）、`:931-934`（受保护编辑门禁）、`:984-989`（排期失效）；`src/shared/chapter-lifecycle.ts:24-46`（`batchMode` 计入内容变更）；`src/shared/quality-issue-service.ts:24`（任一条硬性问题即 `forceSequentialReview`）
- **触发**：五章批次章节（`batchMode !== "逐章"`）进入 `已定稿 / 待发布 / 已发布` 后，其质检结果中出现**任意一条硬性问题**（例如 `electron/worker.ts:242-256` 只要项目里存在一条 `confidence === "有冲突"` 的事实就会产出硬性 issue；原创门禁、禁写清单同理），然后点「运行质检」。
- **原因链**：质检写入 issue → `forceSequentialReview` 为真 → 把 `batchMode` 改成 `逐章` → `chapterContentChanged` 判定为受保护编辑 → 走变更单门禁。
  ```ts
  // database.ts:1207-1211
  if (plan.forceSequentialReview) {
    const chapter = this.projects.getChapter(db, chapterId);
    if (chapter && chapter.batchMode !== "逐章")
      this.persistChapterInTransaction(db, id, { ...chapter, batchMode: "逐章" });
  }
  ```
- **后果**：
  - 有已批准变更单：变更单被静默标记「已应用」（用户并未应用）、章节 `待发布 → 待质检`、排期 `待发布 → 待排期`、`batchMode` 被改；
  - 无变更单：抛「已定稿或进入发布流程的章节只能通过匹配的已批准变更单修改」，`saveIssues` 事务回滚，**本次质检结果全部丢失**，该章质检功能不可用。
- **验证**：数据层子代理用真实 `WorkspaceDatabase` 实验复现（`待发布 + 已批准变更单 + 一条硬性 issue` → 章节待质检 / 排期待排期 / 变更单已应用；无变更单时抛错且 `issues persisted: 0`）。UI 侧按钮只受 `editorBusy` 限制（`WritingWorkspace.tsx:980-992`），且注释明确「重复质检不应因状态机报错」（`:592-594`），说明这是被预期支持的用法。

### H4 「生成开书包」按钮守卫永不为假，二次点击会整份复制前 10 章与全部规划

- **位置**：`src/pages/ProjectDashboard.tsx:59`（`approvedPlans` 只统计「已批准」）、`:191`（按钮条件）、`:200-217`（无二次确认）；`electron/handlers/project-handlers.ts:148-155`；`electron/ai-service.ts:1091/1103`（产出固定「草稿」）、`:1156-1159`（章节 id 用 `randomUUID()`）；`electron/repositories/project-repository.ts:76-79`（`INSERT OR REPLACE` 主键为 id，number 无唯一约束）
- **触发**：契约已审批 → 点一次「生成开书包」→ 按钮**仍然显示**（产出全是草稿，守卫永不满足）→ 再点一次。
- **后果**：第 1–10 章以新 id 重新插入，章节列表出现两套「第1章…第10章」，宏观阶段/分卷整份重复，每个副本各自生成 expectation。全库无删除章节入口（无 `deleteChapter` 通道/UI），只能删整本书或手工改库，属不可逆数据污染。
- **验证**：代码链路已逐环复核（按钮条件 → handler → 草稿状态 → 随机 id → `INSERT OR REPLACE`）。

### H5 新章本地恢复稿 100% 被丢弃：未保存正文永久丢失

- **位置**：`src/pages/WritingWorkspace.tsx:59-78`（`EMPTY_CHAPTER` 每次调用写 `updatedAt: new Date().toISOString()`、`revision: 0`、`id: ""`）、`:92-94`、`:292-294`（新章也会写恢复稿）、`:548-557`（新建章节读取恢复稿）；`src/lib/chapter-draft.ts:21-23`（判定）
- **触发**：上次会话点「新建章节」输入正文后离开/崩溃（新章 `id` 为空不会自动保存，但恢复稿已写入）→ 本次再点「新建章节」（或项目 0 章时进入写作台）。
- **原因**：恢复稿 `revision` 与 `EMPTY_CHAPTER` 同为 0，而 `EMPTY_CHAPTER.updatedAt` 恒为当前时间，必然比恢复稿新：
  ```ts
  // chapter-draft.ts:21-23
  if (parsed.id !== chapter.id || parsed.revision < chapter.revision) return chapter;
  if (parsed.revision === chapter.revision && Date.parse(parsed.updatedAt) < Date.parse(chapter.updatedAt))
    return chapter;
  ```
- **后果**：恢复稿静默失效，新章整章内容丢失；UI 却提示「已保留本地恢复稿」（`WritingWorkspace.tsx:276-280`）。同类问题：保存返回前继续输入，该次恢复稿也会被判为旧副本丢弃（保存后服务器 `updatedAt` 更新，而本地草稿的 `updatedAt` 仍是旧值）。
- **验证**：领域层子代理用真实模块执行复现（新章恢复正文被丢弃；保存后新增内容被丢弃）。现有测试 `tests/chapter-draft.test.ts:94-107` 手工写死旧 `updatedAt`，故未覆盖真实路径。

---

## 二、中危

| # | 位置 | 触发 | 后果 |
|---|---|---|---|
| M1 | `src/shared/story-constraints.ts:147-155` | 章纲写「消耗了三万五」这类**金额后无单位/无资源名**的写法 | `describedResource` 为空串，`label.includes("")` 恒真 → 跳过条件失效，该笔支出被算到**每一条**资源事实上，产出硬性「资源守恒」误报；`assertNoHardStoryConstraint` 直接阻断 AI 生成/五章批次 |
| M2 | `src/pages/IncubationWorkspace.tsx:83-84, 106-115, 252-255` | 孵化台三案对比表头点选另一方案 | 选中态只从 prop 推导，点击仅写库不改本地状态 → 界面停留旧方案；随后 `promote()` 的 `persist({})` 用闭包里的旧 `selectedCandidate` 把库里 id **覆盖回旧方案**，立项用错方案 |
| M3 | `src/pages/IncubationWorkspace.tsx:65-67, 252-255` | 先对候选 A 的阻断项点「人工确认」，再点候选 B，然后离开并返回 | `setAcknowledged([])` 只改本地，同一事件里 `persist` 写入的是「B 的 id + A 的 acknowledged」；重载后 A 的确认继承给 B，B 的阻断门禁被绕过 |
| M4 | `src/shared/category-tags.ts:29` | 本地已采集「男频·都市种田」后选女频「种田」，或选同名跨频道分类 | 只做 `listName.includes(categoryName)`、无频道限定 → 混入别的频道/分类快照，「标签证据」与写入草稿的 `evidence.categoryTags` 失真（`ranking-service.ts:451-453` 已有 `includes(channel) && includes(name)` 的正确写法） |
| M5 | `electron/ai-service.ts:308` → `electron/ai/drivers/*.ts` | 来源需要查询参数（Azure OpenAI 的 `api-version`） | `extraQuery` 传给了驱动但无人消费（全库仅 `/models` 用），生成/探测 URL 参数被静默丢弃 → 除模型下拉外该来源不可用 |
| M6 | `electron/ai-service.ts:427, 433`；`electron/ai/drivers/openai-chat.ts:64, 107`；`openai-responses.ts:101-104` | OpenAI 系输出触顶（`finish_reason=length` / `response.incomplete`） | 只对 Anthropic 检查截断 → 截断 JSON 被当成结构错误再修复 2 次（同内容最多付 3 次费），最后报无意义的「模型输出不符合结构要求」 |
| M7 | `electron/ai/route-resolver.ts:79-84`；`electron/main.ts:571-584` | 来源 `apiSurface: "auto"` 的模型首次 `/responses` 返回 400/404 并降级 | 降级时写入的失败能力行（`supported=false`）排在成功行之前，路由解析只按 modelId 取第一条、**不看 support 字段** → 之后每个任务都先打一次注定失败的请求 |
| M8 | `electron/chapter-generation-service.ts:163`；`electron/handlers/ai-handlers.ts:244-250` | 批量生成 / AI 修订期间章节被编辑或定稿，保存被乐观锁拒绝 | 仅单章路径（`:111-126`）调 `markAiJobApplicationFailed`；批量与修订路径缺失 → 任务中心显示「成功」、无 error，付费输出未落盘，重试再次计费（BUG_REPORT H2 同型，修复未覆盖这两条路径） |
| M9 | `electron/worker.ts:257-258`；`WritingWorkspace.tsx:980-992` | 对尚未写正文的章纲章运行质检，且上一章正文也为空 | `"" === ""` 成立 → 写入硬性「重复章节」；该问题会阻断定稿（`chapter-lifecycle.ts:127-131`）与五章批次（`chapter-batch-service.ts:58`），用户需手动忽略一条不存在的问题 |
| M10 | `src/pages/StoryBibleWorkspace.tsx:62`；触发源 `ProjectPage.tsx:150-158`、`WritingWorkspace.tsx:202-215`（autosave `onSaved` 调 `reload`，effect 不检查 `active`） | 在故事圣经编辑契约未保存时，侧栏改「当前阶段」，或此前写作台有在途自动保存完成 | `reload` 返回全新 `project` 对象 → effect 用服务器版本覆盖整个表单，未保存的契约编辑无提示丢失 |
| M11 | `src/components/NewProjectModal.tsx:238-243, 761-762, 330-350, 353-360` | 生成三套方案后在「安全存稿线」输入框改数字（或清空重输） | `patch()` 对所有定位字段一刀切清空候选；若此前保存过立项草稿，再点「更新立项草稿」即把空候选写回库（zod `candidates` 只有 `.max(6)` 无 `.min(1)`），已付费生成的方案永久丢失 |
| M12 | `electron/database.ts:1156-1199`（泛化分支 `:1197`）；`electron/ipc-validation.ts:694` | `listRevisions(projectId, "changes", id)` 取到变更单被消耗前的「已批准」修订，再 `restoreRevision` | 变更单状态可从「已应用」被改回「已批准」（实测），事实账本同理可回退——人审审计链可被任意回写 |

---

## 三、低危

| # | 位置 | 问题 |
|---|---|---|
| L1 | `electron/database.ts:1032-1042` | 受保护章节经变更单回退到「待质检」时不重算摘要，旧正文摘要继续进入生成上下文（`context-compiler.ts:204` 的 `longTermMemory` 不过滤状态） |
| L2 | `electron/database.ts:2010-2022` | `updateSummaries` 的多条 `saveRecord` 未包 `BEGIN IMMEDIATE`，中途失败留下半写摘要（违反 AGENTS.md 第 5 条） |
| L3 | `electron/repositories/search-repository.ts:12-50` | 2 字搜索时 SQL `LIKE` 大小写不敏感、JS `indexOf` 大小写敏感 → 命中但摘要错乱（`index=-1` 导致 `slice` 拼接异常） |
| L4 | `electron/backup.ts:103-149` | 恢复先 `readFile` 整包再校验；2GB/文件数限额只累加清单**自述值**，逐条目先完整解压再比对，声明值可绕过 |
| L5 | `src/lib/chapter-draft.ts:22` | 恢复稿 `updatedAt` 非法时 `Date.parse` 为 NaN，比较恒 false → 误返回陈旧恢复副本（8/1 遗留 7b，仍在） |
| L6 | `src/lib/chapter-draft.ts:85-96` | `saveLatest` 覆盖 `pending` 时未清旧 `retryTimer`，空转一次 `flush()`（无数据影响，8/1 遗留 7d，仍在） |
| L7 | `src/pages/WritingWorkspace.tsx:361-384, 743` | 手动保存不置 busy，保存期间可切章 → 返回时 `setSelectedId(saved.id)` 把选中项拉回旧章、签名错乱（8/1 遗留 6，仍在） |
| L8 | `src/pages/ProjectDashboard.tsx:331-355` | 契约已审批后「采用此方向」仍可点，服务端必拒（已加 catch，不再是 unhandled rejection，但按钮缺 guard；8/1 遗留 L6，仍在） |
| L9 | `src/shared/story-constraints.ts:40-44`；`electron/ai/drivers/sse.ts:19` | 「2万5」解析为 20000（应为 25000）；SSE 逐行 `trim()` 会吞掉跨行切开处的空格（影响极小） |

---

## 四、8/1 报告遗留项复核

| 遗留项 | 结论 | 依据 |
|---|---|---|
| H4 UI 层无限重试循环 | ✅ 已修 | autosave effect 依赖已不含 `notify`（`WritingWorkspace.tsx:307`），`onError` 走 `notifyRef.current` |
| H6 千/百省略式 | ✅ 已修 | 「三千五」=3500、「一百五」=150 等已正确；仅混合写法「2万5」残留（见 L9） |
| 遗留 3 M3×M4 清空正文路径排期僵尸化 | ✅ 已修 | `chapter-lifecycle.ts:53-56` 受保护编辑优先返回「待质检」；`database.ts:984-989` 排期失效条件改为只看 `protectedEdit` |
| 遗留 1（H4 UI 循环） | ✅ 同上 | — |
| 遗留 4 L1 SSE 多行解析 | ✅ 已修 | 实现迁至 `electron/ai/drivers/sse.ts:15-34` 三级兜底，`tests/ai-sse.test.ts` 覆盖 |
| 遗留 5 M15 恢复消耗错变更单 | ❌ 仍在 | `database.ts:1918` 仍按 `createdAt` 升序取最早匹配；`authorizeRestore` 在事务外写变更单（`:1161-1182`） |
| 遗留 6 保存期间切章 | ❌ 仍在 | 见 L7 |
| 遗留 7a 备份无 stat 预检 | ❌ 仍在 | 见 L4 |
| 遗留 7b/7c/7d | ❌ 仍在 | 见 L5、L6；7c（恢复历史版本不置 busy、不暂停 autosave）与 L7 同源 |
| 遗留 L6 契约已审批「采用此方向」 | ❌ 仍在 | 见 L8 |

---

## 五、检查声明

- 本次为**只读检查**：未修改任何源代码文件（仅新建本文档）。
- 已执行：`npm test`（105 文件 / 611 项通过、1 项跳过）、全库 grep 核对、真实模块动态执行（本地端点路由解析、恢复稿判定、资源守恒解析等，由子代理在仓库外临时目录完成，仓库 `git status` 保持 clean）。
- 未执行：`npm run build` / e2e / 打包（本次只读审查，未产生构建产物）。
- 建议修复顺序：H1、H2（接线级，影响所有用户）→ H3、H4、H5（数据正确性/丢失）→ M 组 → 遗留 5 与 L 组。
- 每项修复建议补对应回归测试：本地端点路由解析、profile 密钥接线、受保护章节质检、开书包幂等、新章恢复稿、空资源名资源守恒。
