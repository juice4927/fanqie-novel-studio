# Bug 修复验证报告（只读检查，未改动任何代码）

> 检查日期：2026-08-01 ｜ 对象：`master` 分支工作区当前状态（含 40 个文件、576 行未提交修改）
> 背景：2026-07-31 的 `BUG_REPORT.md` 列出高危 6 项、中危 18 项、低危 12 项；此后工作区出现一批未提交修改（修复批次）。本文档验证该批次对原报告各项的修复情况，并记录验证过程中新发现的遗留问题。
> 方法：全量 `git diff` 审读 + `tsc --noEmit`（通过，0 错误）+ 4 路并行只读审查（AI 层 / 前端保存 / 领域层 / 数据层与安全）+ 关键点人工复核

## 结论统计

按 BUG_REPORT.md 表格实际条目口径（高危 6、中危 M1-M29 共 29、低危 12，合计 47 项；注：原报告"中危 18 项"的统计口径与其表格编号至 M29 不一致，本文档以表格条目为准）：

- **已确认修复：43 项**（高危 4/6、中危 29/29、低危 10/12）
- **部分修复：2 项**（H4 仅 coordinator 层修复、UI 层回归循环仍在；H6 "X千/百"省略式遗留）
- **未修复：2 项**（L1 SSE 多行 `data:` 解析、L6 契约已审批时"采用此方向"仍必失败）
- **新发现遗留问题：4 项**（M3×M4 清空正文路径排期僵尸化、M15 变更单消耗边缘、保存期间切章 UI 错乱、恢复备份源文件大小预检等微小项）

---

## 一、检查范围与方法

| 项目 | 内容 |
|---|---|
| 检查日期 | 2026-08-01 |
| 检查对象 | 工作区当前文件内容（非 git HEAD），含 40 个文件的未提交修改 |
| 静态检查 | `npx tsc --noEmit` 通过（0 类型错误） |
| 并行审查 | 4 路只读子代理：AI 层（ai-service/ai-provider/worker/worker-client）、前端保存（WritingWorkspace/chapter-draft/ProjectPage）、领域层（src/shared/*）、数据层与安全（database/repositories/backup/netguard/ranking-service） |
| 人工复核 | 事务嵌套、两库锁顺序、H2 缓存失效闭环、parseStoryNumber 边界、H4 回归循环触发链 |
| 改动 | 无（`git status` 保持原样，未修改任何文件） |

---

## 二、修复验证结果表（对照 BUG_REPORT.md）

图例：✅ 已修复 ｜ ⚠️ 部分修复 ｜ ❌ 未修复

### 高危

| # | 状态 | 当前证据位置 | 验证要点 |
|---|---|---|---|
| H1 全文搜索 2 字词恒为空 | ✅ | `repositories/search-repository.ts:9-27` | 长度 <3 时回退 `LIKE '%词%' ESCAPE` 查询，标题/正文双匹配，`[...normalized]` 按码点计数 |
| H2 AI 任务标"成功"但章节保存失败 | ✅ | `chapter-generation-service.ts:139-148`；`ai-audit-repository.ts:73-76` | 保存失败时 `markAiJobApplicationFailed` 将 job 改"失败"；`findSuccessful`（:42）只查 `status='成功'` → 缓存条目随之失效，重试不再命中旧结果，"成功→保存失败"循环闭环 |
| H3 手动/自动保存并发竞态 | ✅ | `chapter-draft.ts:55-61,88-91`；`WritingWorkspace.tsx:288-311` | `saveLatest` 走 coordinator 单路径串行；flush 运行期间 enqueue 只写 `pendingAutosave` 不覆盖 `pending`；保存响应回来时按 signature 比较，输入已变则不覆盖 |
| H4 自动保存持久错误无限重试 | ⚠️ | coordinator：`chapter-draft.ts:97-113`；UI 回归循环：`App.tsx:49` + `WritingWorkspace.tsx:235` | coordinator 层已修（transient 正则区分瞬时/持久 + `maxRetries=3`，持久错误 reject 全部 waiter）；但 `notify` 是内联箭头函数（含 `reload()`），每次渲染新引用 → autosave effect 依赖含 `notify` → 失败弹 toast → reload → 重渲染 → effect 重建 2s 定时器 → 再次 enqueue……错误持续时 UI 层无限循环仍存在，coordinator 的 retryCount 每轮被重置 |
| H5 项目 ID 无字符集校验 | ✅ | `ipc-validation.ts:6-7`；`database.ts:355-365` | id regex 限制 `[\p{Letter}\p{Number}._:-]` 且首字符非点（UUID 全部通过，`..\` 被拒）；`projectDb` 先查 catalog 存在性、再 `path.resolve` 前缀断言，之后才 `mkdirSync` |
| H6 中文数字解析缺陷 | ⚠️ | `story-constraints.ts:18-22,40-42` | "3.5万"→35000、"三万五"→35000 已修；`omittedTail` 只匹配 `/万(...)$/`，"三千五"→3005、"一百五"→105 仍错（千/百省略式未处理，见遗留问题 2） |

### 中危（M1-M29 全部已修复 ✅，2 项带边缘遗留）

| # | 状态 | 当前证据位置 | 验证要点 |
|---|---|---|---|
| M1 已忽略事实触发冲突死循环 | ✅ | `fact-service.ts:49` | 冲突判定排除 `confidence === "已忽略"` |
| M2 卷摘要 toChapter 跨卷污染 | ✅ | `summaries.ts:162-165` | `Math.min(end, Math.max(...finalized.map(n => n.number)))` 夹取到本卷估计范围 |
| M3 空正文继续流转到定稿 | ✅ | `chapter-lifecycle.ts:51` | `!next.content.trim()` 统一返回"章纲"，且置于 forcedStatus/protectedEdit 判断之前 |
| M4 排期僵尸化 | ✅（主场景） | `database.ts:821-824` | `protectedEdit && 状态==待质检` 时同章未发布排期置"待排期"；**清空正文变体未覆盖**（见遗留问题 3） |
| M5 榜单字数 NaN | ✅ | `ranking-csv.ts:20-28` | 先剥离逗号再取数字段，亿/万乘数，"约1.2万"→12000，NaN 回退 0 |
| M6 同键多事实替换错对象 | ✅ | `fact-service.ts:23-35` + `ai-service.ts:1226-1232` | 替换走 `replacesFactId` id 精确匹配；上游按 `validFromChapter` 降序取最近一条写入该 id |
| M7 PlanNode.targetWords NaN | ✅ | `planning.ts:10-11,17-18` | 入口 `Number.isFinite` 校验，非法直接抛错 |
| M8 已应用/已拒绝变更单再次决定 | ✅ | `change-request-service.ts:46` | 仅 `status === "待审批"` 可作出决定 |
| M9 空 before 超界插入污染正文 | ✅ | `novel-revision.ts:59` | 校验 `repair.end > chapter.content.length` |
| M10 token-estimator NaN | ✅ | `token-estimator.ts:22,36` | 入参 `Number.isFinite` 归一为 0 |
| M11 saveRanking 半写 | ✅ | `database.ts:1166-1206` | `BEGIN IMMEDIATE` 包裹快照 + entries 循环 |
| M12 迁移 2 number 列 NOT NULL 失败 | ✅ | `database.ts:324` | `COALESCE(CAST(json_extract(...) AS INTEGER), 1)` |
| M13 saveIssues/saveMetrics 半写 | ✅ | `database.ts:1014-1031,1106-1117` | 均包 `BEGIN IMMEDIATE`；`persistChapterInTransaction` 自身不开事务，嵌套安全 |
| M14 无效 projectId 建空库目录 | ✅ | `database.ts:358-359` | catalog 存在性检查先于 mkdirSync |
| M15 受保护实体历史版本无法恢复 | ✅（带边缘） | `database.ts:981-1012,1498-1516` | `authorizeRestore` 生成"已批准"变更单（baseVersion=当前版本），saveChapter/savePlan/saveContract 内 `consumeApprovedChange` 按 targetKind+targetId+baseVersion 匹配消耗；**边缘**：消耗取 createdAt 最早匹配项，可能误耗用户原有合法变更单（见遗留问题 5） |
| M16 变更单消耗与契约写库不同步 | ✅ | `database.ts:631-650,652-669` | saveContract 单库事务；approveContract 两库事务，db→catalog 固定加锁顺序，全代码库唯一两库路径，同步执行无死锁 |
| M17 迁移后 FTS 不回填 | ✅ | `database.ts:338-343` | 迁移 2 末尾 `DELETE` + `INSERT ... SELECT` 回填两套 FTS 索引（迁移 1 已建表，顺序正确） |
| M18 研究库重复导入/半写 | ✅ | `research-repository.ts:21-38,47-58` | saveBook/saveAnalyses 均 `BEGIN IMMEDIATE` + 先删后插 |
| M19 取消与成功路径矛盾、Set 残留 | ✅ | `ai-service.ts:451-457,665-666` | 成功路径同步段无 await，无竞态窗口；成功/失败/超时/取消全路径清理 `cancelledJobs`/`activeRequests` |
| M20 Responses API 无降级 | ✅ | `ai-provider.ts:34-39`；`ai-service.ts:592-617` | `rejectsResponsesApi`（400/404/405 + 特征词）→ 降级 chat/completions 并重置 `useJsonMode`；降级标志单调翻转，`attempt -= 1` 无死循环（最多 4 次降级探测 + 3 次正式，受 deadline 约束） |
| M21 finishAiJob 失败重复计费 | ✅ | `ai-service.ts:652-657,678-680` | 落库失败包装为"AI 任务审计落库失败"直接抛出，不进重试路径；`activeRequests` 显式清理 |
| M22 worker 退出 pending 悬挂 | ✅ | `worker-client.ts:29-36` | exit 时 reject 全部 pending 再决定 respawn；error/exit 双触发安全（error 先清空）；close() 置 `closing` 防 respawn |
| M23 恢复历史版本静默失效 | ✅ | `WritingWorkspace.tsx:1007-1020` | restore 后 `getChapter` 重载 draft、更新 `lastSavedSignature`、清恢复副本（与 applyNovelRevision 路径一致） |
| M24 切 tab/返回丢草稿 | ✅ | `ProjectPage.tsx:70,97,113,171,196` | `confirmLeaveWriting` + `onDirtyChange` 联动，dirty 时确认后离开 |
| M25 恢复副本覆盖服务器新内容 | ✅ | `chapter-draft.ts:17-19` | `parsed.revision < chapter.revision` 返回服务器版；相等时比较 `updatedAt` |
| M26 搜索并发追加/旧词混入 | ✅ | `WritingWorkspace.tsx:246,273-287` | `searchRequestRef` 请求代 + `searchLoadingRef` in-flight 防重入 + offset 一致性检查 |
| M27 榜单采集 DNS rebinding | ✅ | `netguard.ts:89-91,112-116` | 自定义 `Agent` dispatcher 固定使用已校验 IP 的 lookup，重定向每跳重新校验，不重解析 |
| M28 导入 ZIP 炸弹/超大文件 | ✅ | `worker.ts:29-42,158-171` | 100MB 文件上限、10000 条目上限、200MB 解压总量上限（读 zip 头元数据，不解压）；TXT/DOCX 同样 stat 预检 |
| M29 备份 scrypt 弱参数/恢复 DoS | ✅ | `backup.ts:11-13,115-117` | `N=2^17`（maxmem 256MB ≥ 128×N×r=128MB）；恢复前校验文件数与 2GB 总量；MAGIC_V1 旧备份走默认参数兼容读取 |

### 低危

| # | 状态 | 当前证据位置 | 验证要点 |
|---|---|---|---|
| L1 SSE 多行 data: 整体 parse 失败 | ❌ | `ai-provider.ts:77-91,113-141` | 同一事件多行 `data:` 仍 `join("\n")` 后整体 `JSON.parse`，代理拆分 JSON 时抛 SyntaxError → 流式任务全部失败（与 BUG_REPORT 描述一致，未修复） |
| L2 流式任务失败无结束事件 | ✅ | `ai-service.ts:1202-1210` | draft-chapter 失败/取消路径发 `{type:"failed"}`；其余 stream:true 调用无 UI 面板，直接 throw 不悬挂 |
| L3 worker 取消标记残留 | ✅ | `worker.ts:343-369` | 成功/失败/取消路径均走 `finally` 删除 `cancelledTasks` 标记 |
| L4 正文超 200K 无提示 | ✅ | `WritingWorkspace.tsx:797-805` | ≥190K 显示 warning Badge、>200K 显示 danger Badge |
| L5 beforeunload 窗口无法关闭 | ✅ | `main.ts:362-372` | `will-prevent-unload` + `dialog.showMessageBoxSync`（"继续编辑"/"放弃并关闭"） |
| L6 契约已审批时"采用此方向"必失败 | ❌ | `ProjectDashboard.tsx:291-305` | 按钮无 `contract.approved` 检查；已审批时 `saveContract` 抛"只能通过已批准的改纲变更单修改"，且 onClick 无 try/catch → unhandled rejection，其余字段不保存 |
| L7 每键击写 localStorage | ✅ | `WritingWorkspace.tsx:219-224` | 恢复副本写入 500ms 防抖 |
| L8 CSV 链接注入 | ✅ | `ranking-csv.ts:30-35` | `safeHttpUrl`：协议白名单 http/https、拒绝 userinfo，解析失败返回空串 |
| L9 诊断包静默包含项目信息 | ✅ | `system-handlers.ts:363-364`；`main.ts:165-177` | 导出前 `dialog.showMessageBox` 明示内容清单，默认按钮"取消" |
| L10 备份成功路径 unlink 失败覆盖新备份 | ✅ | `backup.ts:84` | `unlink(previous).catch(() => {})`，失败仅告警不恢复旧文件 |
| L11 pruneAutoBackups 单文件失败整轮失败 | ✅ | `backup.ts:31` | 单文件 unlink 失败仅记录并继续 |
| L12 checkpoint 与健康检查 BUSY | ✅ | `database.ts:1463-1476` | TRUNCATE 返回 busy 或抛 busy/locked 时降级 PASSIVE |

---

## 三、遗留问题明细（7 项）

### 遗留 1：H4 UI 层回归循环——错误持续时无限重试仍在（中危）

- **位置**：`src/App.tsx:49`（`notify={(message, tone) => { notify(message, tone); void reload(); }}` 内联箭头）+ `src/pages/WritingWorkspace.tsx:235`（autosave effect 依赖数组含 `notify`）
- **触发**：受保护章节（已定稿/待发布）编辑触发保存被主进程拒绝，或正文超 200K zod 拒绝——任何持续存在的保存错误
- **循环链**：保存失败 → coordinator `onError` → toast（含 reload）→ App 重渲染 → `notify` 新引用 → effect cleanup 清 2s 定时器并重建 → 再次 enqueue → 再次失败……每轮 `retryCount` 复位，`maxRetries=3` 形同虚设
- **后果**：toast 反复弹出、状态栏反复"保存中"，与 BUG_REPORT 原 H4 症状一致（coordinator 层已修但 UI 层变相回归）
- **修复建议**：effect 依赖改用 `notifyRef.current`（组件已有 `notifyRef`）；或 ProjectPage 侧用 `useCallback` 稳定 notify 引用

### 遗留 2：H6 "X千/百"省略式仍解析错误（中危）

- **位置**：`src/shared/story-constraints.ts:40-42`
- **触发**：章纲写"消耗了三千五"、"借出一百五"
- **后果**：`omittedTail` 只匹配 `/万([一二两三四五六七八九])$/`，"三千五"→ 3005（应为 3500）、"一百五"→ 105（应为 150）；可用量在 3005~3500 之间时超支漏报
- **修复建议**：省略式推广到千/百（如 `/千([一二两三四五六七八九])$/` → `digit*100`），注意与"零"的交互（"三千零五"不触发省略式）

### 遗留 3：M3×M4 交互缺口——清空正文路径下排期僵尸化残留（中危）

- **位置**：`electron/database.ts:821-824`（排期失效条件 `next.status === "待质检"`）+ `src/shared/chapter-lifecycle.ts:51`（空正文优先返回"章纲"）
- **触发**：已排期待发布章节经已批准变更单**清空正文**后保存
- **后果**：`deriveChapterStatus` 因空正文检查在前返回"章纲"，`next.status === "待质检"` 不成立 → 排期不失效仍"待发布"；后续 `assertChapterTransition("章纲"→"待发布")` 无此迁移边 → 僵尸排期残留（M4 主场景非空修改已修复，此变体未覆盖）
- **修复建议**：排期失效条件改为"受保护编辑且正文为空或状态为待质检"（或对状态不等于原状态/排期未发布的章节统一失效）

### 遗留 4：L1 SSE 多行 data: 合并后整体 parse（未修复，中危）

- **位置**：`electron/ai-provider.ts:77-91`（`readChatCompletionStream`）、`113-141`（`readResponsesStream`）
- **触发**：代理把单个 JSON 事件拆成多行 `data:`（或事件间无空行分隔）
- **后果**：`join("\n")` 后整体 `JSON.parse` 抛 SyntaxError → 该代理下所有流式任务失败（重试 3 次后任务失败）
- **修复建议**：按事件内逐 `data:` 行尝试独立 `JSON.parse`，单行可解析则依次处理；多行无法逐行解析时再按事件合并兜底

### 遗留 5：M15 恢复历史版本——变更单消耗边缘问题（低危）

- **位置**：`electron/database.ts:1512`（`consumeApprovedChange` 按 `createdAt` 升序取最早匹配）+ `981-1012`（`authorizeRestore` 在事务外写变更单）
- **触发**：用户已有同 target、同 baseVersion 的"已批准"未应用变更单时恢复历史版本
- **后果**：恢复操作消耗用户原有合法变更单，新创建的恢复变更单残留"已批准"；且恢复保存失败时变更单残留（非原子）
- **修复建议**：恢复变更单写入与保存同事务；消耗时优先匹配 `title === "恢复历史版本"` 或按 `createdAt` 降序/精确 id

### 遗留 6：保存期间可切章——UI 错乱窗口（低危，原有行为）

- **位置**：`src/pages/WritingWorkspace.tsx:288-311`（save 不设 busy）+ `:407`（章节列表按钮仅 `disabled={editorBusy}`，不含 saving）
- **触发**：点"建立版本"后立即切换章节
- **后果**：保存完成后 `lastSavedSignature.current = snapshotSignature`（旧章签名）覆盖切章效果 → 新章 dirty 恒 true 状态栏错乱；`setSelectedId(saved.id)` 强制跳回旧章
- **修复建议**：save 期间置 busy 或保存完成时校验 `selectedId` 未变化再更新签名/选择

### 遗留 7：微小项汇总（低危）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 7a | `electron/backup.ts:93` | 恢复时先整体 `readFile` 读入加密文件再查限制，无源文件大小预检 | 读前 `stat` 限大小 |
| 7b | `src/lib/chapter-draft.ts:19` | `Date.parse(parsed.updatedAt)` 为 NaN 时比较恒 false → 误返回恢复副本 | 非法日期视为无效恢复副本 |
| 7c | `src/pages/WritingWorkspace.tsx:1007-1020` | 恢复历史版本按钮不设 busy、不暂停 autosave，in-flight 旧内容可能后写覆盖恢复结果 | 恢复期间暂停 autosave 或置 busy |
| 7d | `src/lib/chapter-draft.ts:104-107` | `saveLatest` 覆盖 pending 后旧 `retryTimer` 不取消（空转一次 flush，无害） | 覆盖 pending 时清除旧 timer |

---

## 四、修复建议批次

**批次 A（数据正确性，优先）**
- 遗留 2：`parseStoryNumber` 省略式推广到千/百，补测试（"三千五"→3500、"一百五"→150、含"零"不误触发）
- 遗留 3：M3×M4 清空正文路径下排期失效，补数据库测试
- 遗留 5：M15 恢复变更单与保存同事务、消耗匹配精确化

**批次 B（AI 可用性）**
- 遗留 4：L1 SSE 逐 `data:` 行独立解析
- 遗留 1：H4 UI 层回归循环——effect 依赖改用 `notifyRef.current`（组件已有该 ref），补重试回归测试

**批次 C（体验与健壮性）**
- 遗留 6：保存期间切章置 busy/签名校验
- 遗留 7a-7d：backup 源文件 stat 预检、M25 日期解析 NaN、恢复版本暂停 autosave、retryTimer 清理
- 遗留 7 之外：L6 ProjectDashboard 已审批契约时禁用"采用此方向"并提示走变更单（未修复项）

每批完成后跑全量 `npm test` + `npm run test:quality`；批次 A/B 建议补对应回归测试（现有测试未覆盖"三千五"边界与 H4 UI 循环）。

---

## 五、检查声明

- 本次为**只读检查**：未修改、未创建、未删除任何源代码文件（仅新建本文档）。
- 检查基于工作区当前文件内容（含 40 个文件的未提交修复批次），未运行可能产生写操作的命令（未跑 `npm test`，测试会写 `test-results/`）。
- 验证方法包括：`git diff` 全量审读、`npx tsc --noEmit`（0 错误）、4 路并行只读审查、关键触发链人工复核（事务嵌套、两库锁顺序、缓存失效闭环、数字解析边界、重试循环）。
- 本文档与 `BUG_REPORT.md` 的关系：后者是 2026-07-31 的原始问题清单，本文档验证其修复状态并补充新发现；修复实施时建议以本文档第三节、第四节为工作项清单。



