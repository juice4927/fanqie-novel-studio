# Bug 排查报告与修复方案（只读检查，未改动任何代码）

> 检查日期：2026-07-31 ｜ 方法：6 路并行代码审查（数据层 / AI 层 / 领域层 / 前端与 IPC / 安全 / 交叉验证）+ 逐条核对触发链
> 范围：electron/（全部）、src/shared/（36 文件）、src/pages/、src/lib/、src/components/、tests/
> 统计：**高危 6 项、中危 18 项、低危 12 项**（另列 12 项已排除的疑似项，避免误修）

---

## 一、高危（建议优先修复）

### H1 全文搜索 2 字词恒为空（功能级失效）
- **位置**：`electron/repositories/search-repository.ts:6-10`；佐证 `database.ts:791-794`
- **触发**：搜索恰好 2 个字符的词（"张三""主角""线索"等中文人名/术语）
- **原因**：查询发往 `chapter_fts_tri`（trigram tokenizer），trigram 只收录 ≥3 字符序列，2 字查询必然空集；而支持 2 字词的 `chapter_fts`（unicode61）全库无任何查询使用
- **修复**：长度 <3 时回退查 `chapter_fts`，或对 2 字词走 `LIKE '%词%'` 扫描

### H2 AI 任务标记"成功"但章节保存失败，付费输出永久丢失
- **位置**：`ai-service.ts:644` + `chapter-generation-service.ts:136-147` + `database.ts:730-736`
- **触发**：任务运行期间用户编辑过章纲/章节（revision+1），`persistChapterInTransaction` 的乐观锁拒绝保存；但 `finishAiJob` 已先把任务落库为"成功"
- **后果**：任务中心显示成功、无 error，章节未保存；重试重新计费；输入未变还会命中缓存，循环"成功→保存失败"
- **修复**：保存失败时把 job 补写为"失败/未应用"并失效本次缓存条目；guard 检查提前到 `finishAiJob` 之前

### H3 手动保存与自动保存并发竞态 → 静默数据丢失
- **位置**：`src/pages/WritingWorkspace.tsx:270-287`（save）+ `223-227`（autosave 定时器）
- **触发**：输入后 2 秒窗口内点"建立版本"并继续输入；手动 `saveChapter` 绕过 `AutosaveCoordinator`，与自动保存并发到达主进程
- **后果**：旧快照后写覆盖新快照；手动保存 resolve 后 `setDraft(旧)` 抹掉正在输入的内容，UI 显示"已保存"——静默丢稿
- **修复**：手动保存也走 `AutosaveCoordinator.saveLatest()` 单路径串行；响应回来时若 `draftRef` 签名已变则不覆盖

### H4 自动保存持久错误无限重试 → 按钮永久卡死
- **位置**：`src/lib/chapter-draft.ts:81-93` + `WritingWorkspace.tsx:170-173`
- **触发**：受保护章节（已定稿/待发布）编辑后触发保存被主进程拒绝，或正文超 200K zod 拒绝——持久性错误
- **后果**：`pending ??= snapshot` 后每 1.5s 无限重试，waiter 永不 resolve，"质检中/生成中"busy 卡死，toast 反复弹
- **修复**：区分瞬时/持久错误；持久错误直接 reject 全部 waiter 并终止重试；加最大重试次数上限

### H5 项目 ID 无字符集校验 → 任意路径创建/破坏 SQLite（安全）
- **位置**：`database.ts:349-359`（`projectDb`）+ `ipc-validation.ts:6`（id 仅 trim+max(200)）
- **触发**：IPC 传 `projectId = "..\\..\\任意目录"`；`projectDb` 在抛"项目不存在"**之前**先 `mkdirSync` + `openDatabase` + 执行迁移 DDL
- **后果**：渲染进程一旦有任意代码执行，即获得主进程文件系统级写原语：任意位置建库、破坏已有 SQLite、越权读数据
- **修复**：id schema 收紧为 UUID 格式；`projectDb` 内 `path.resolve` 后断言在 `projectsRoot` 内

### H6 中文数字解析缺陷 → 资源守恒误判（漏报超支）
- **位置**：`src/shared/story-constraints.ts:17-38`
- **触发**：章纲写"消耗了三万五"→ 解析为 30005（应为 35000）；"消耗了3.5万"→ 丢弃"万"后缀解析为 3.5
- **后果**：可用量在 30005~35000 之间时超支不报，硬性约束漏检；也会方向性误报
- **修复**：阿拉伯数字后接"万/千/百"乘对应倍数；中文解析处理"X万Y"省略式

---

## 二、中危

### 领域层逻辑
| # | 位置 | 触发 | 后果 | 修复 |
|---|---|---|---|---|
| M1 | `fact-service.ts:45-54` | 先忽略一条候选事实，再建同键不同值事实 | 新事实被强制"有冲突"，逐章门禁+硬性告警死循环，无法消解 | 冲突判定排除 `confidence="已忽略"` |
| M2 | `summaries.ts:162-165` | 分卷实际章数超过 `targetWords/2500` 估计 | 卷摘要 `toChapter` 被全局定稿章号污染，跨卷内容错乱，长期记忆归卷错误 | `toChapter` 夹取到本卷 `[cursor, end]` 范围 |
| M3 | `chapter-lifecycle.ts:52-56` | 草稿/待质检/待定稿章节清空全部正文保存 | 状态不回到"章纲"，空正文可继续流转到定稿（与新建/受保护路径规则矛盾） | 内容为空统一返回"章纲" |
| M4 | `chapter-lifecycle.ts:53` + `schedule-service.ts:51-53` | 已排期待发布章节经变更单修改内容 | 状态回"待质检"但排期仍"待发布"，`assertChapterTransition` 拒绝流转，排期僵尸化 | 状态回退时同步失效相关排期 |
| M5 | `ranking-csv.ts:20-24` | 字数列为"约1.2万" | `Math.round(NaN*10000)` 返回 NaN 写入 entries，后续排序/聚合全 NaN；"亿"解析为 0 | 先剥离非数字字符再乘单位；NaN 回退 0 |
| M6 | `fact-service.ts:23-36` | 同键多条历史无期限事实 | `find` 取首条做截断替换，替换错对象后其余同键事实触发冲突，替换机制失效 | 按 `validFromChapter` 取最近一条 |
| M7 | `planning.ts:9-20` | `PlanNode.targetWords` 缺失/NaN（旧数据） | `Math.ceil(NaN)`→NaN，全链卷范围失效，`deriveChapterBatchMode` 边界判断失效 | 入口 `Number.isFinite` 校验 |
| M8 | `change-request-service.ts:41-50` | 对"已应用/已拒绝"变更单再次决定 | 可把"已应用"改回"已批准"，`findMatchingApproval` 重复应用同一修改 | 仅允许"待审批"→"已批准/已拒绝" |
| M9 | `novel-revision.ts:56-61` | `repair.before` 为空且 start/end 超界 | 空 slice 与 before 相等通过校验，`after` 静默追加文末污染正文 | 校验 `end <= content.length`；空 before 仅允许插入语义 |
| M10 | `token-estimator.ts:25-33` | 入参 NaN（如 targetWords 为 NaN） | `Math.max(0, Math.ceil(NaN))` 仍 NaN，费用估算失真 | 入参 `Number.isFinite` 归一 |

### 数据层
| # | 位置 | 触发 | 后果 | 修复 |
|---|---|---|---|---|
| M11 | `database.ts:1102-1135` | saveRanking 中途失败（磁盘满/约束冲突） | 快照已提交但 entries 半写，榜单静默失真；主键冲突使重试无法自愈 | `BEGIN IMMEDIATE` 包裹 |
| M12 | `database.ts:300-338`（迁移 2） | 老库存在 `payload.number` 缺失/JSON null | `CAST(...)` 得 NULL 违反 NOT NULL，整个迁移回滚，项目库**永久不可用** | `COALESCE(CAST(...), 1)`（其余字段都有兜底，唯独 number 没有） |
| M13 | `database.ts:958-973, 1048-1053` | 批量 upsert 中途失败 | issues/metrics 半写；saveIssues 还嵌套独立事务的 saveChapter | 整批包事务 |
| M14 | `database.ts:349-359` | 无效 projectId 调用任意公开方法 | 每次在 projects/ 下创建空库目录并缓存，永不清理，health check 持续告警 | 入口先查 catalog 存在性 |
| M15 | `database.ts:945-956` | 对已审批契约/已定稿章节恢复历史版本 | 恢复路径不产生变更单，被保护校验拦截，**受保护实体历史版本永远无法恢复** | 恢复路径显式绕过保护并记审计 |
| M16 | `database.ts:620-645, 1415-1433` | `consumeApprovedChange` 提交后、写契约前 DB 错误 | 变更单已消耗但契约未更新，用户失去一次合法改纲机会；approveContract 两库两步提交不同步 | saveContract 包项目库事务；approveContract 协调两库 |
| M17 | `database.ts:319-337`（迁移 2） | 老库升级 | FTS/embeddings 不回填，升级后所有既有章节搜索不可用，需手动 rebuild | 迁移末尾回填索引 |
| M18 | `repositories/research-repository.ts:21-29, 38-42` | 同一 book.id 重复导入；saveAnalyses DELETE 后失败 | 旧章节残留/重复；分析结果整批丢失 | 先删后插并包事务 |

### AI 层
| # | 位置 | 触发 | 后果 | 修复 |
|---|---|---|---|---|
| M19 | `ai-service.ts:450-456, 652-653` | 取消恰在成功路径同步段 | cancelJob 返回 true 但任务实际成功，UI 与结果矛盾；cancelledJobs Set 永久残留 | 成功路径也 delete；cancelJob 先查终态 |
| M20 | `ai-provider.ts:38-41` + `ai-service.ts:497, 604-609` | gpt 模型配只实现 chat/completions 的第三方端点 | 强制走 /responses 且无降级路径（`useJsonMode` 被短路），所有结构化功能直接失败 | responses 400 时降级 json_object 或切端点 |
| M21 | `ai-service.ts:644, 707-708` | finishAiJob 写库失败 | 被当模型输出错误重试→**重复计费**；3 次后 activeRequests.delete 不执行，取消功能失效+Map 泄漏 | finishAiJob 移出重试路径，finally 保证清理 |
| M22 | `worker-client.ts:26-32` | worker 以非 0 码退出且未先触发 error | pending 永不 settle，健康检查 UI 永久"运行中"；exit 0 时不 respawn，后续消息丢失 | exit 时先 reject 全部 pending |

### 前端
| # | 位置 | 触发 | 后果 | 修复 |
|---|---|---|---|---|
| M23 | `WritingWorkspace.tsx:977-984` | 恢复历史版本 | 未 getChapter 重载 draft，合并 effect 保留旧正文，恢复静默失效，随后保存用旧正文覆盖 | 复用 applyNovelRevision 的重载写法 |
| M24 | `WritingWorkspace.tsx:230-238` + `ProjectPage.tsx:107-128` | 编辑中直接切 tab/返回总览 | beforeunload 不覆盖 React 导航，未保存草稿仅存 localStorage；恢复副本不可用时静默丢失 | 卸载前 dirty 则同步保存或确认 |
| M25 | `WritingWorkspace.tsx:198-204` + `chapter-draft.ts:12-19` | 跨会话重新打开有陈旧恢复副本的章节 | 恢复副本无条件覆盖服务器新内容（AI 生成/批次更新后） | 恢复前比较 updatedAt/revision，服务器更新则丢弃 |
| M26 | `WritingWorkspace.tsx:265-269, 368-373` | 滚动连续触发 loadMoreSearch 或中途改词 | 并发请求同 offset 重复追加；旧词响应混入新词结果 | in-flight 标志 + query 代 |

### 安全
| # | 位置 | 触发 | 后果 | 修复 |
|---|---|---|---|---|
| M27 | `ranking-service.ts:50-68` | 恶意域名诱导定时采榜 | **DNS rebinding**：lookup 时公网 IP、fetch 时改答内网，主进程以本机身份 GET 内网服务 | fetch 固定使用已校验 IP（自定义 dispatcher），禁止重解析 |
| M28 | `worker.ts:84-95, 97-140` | 导入高压缩比 EPUB/DOCX 或数 GB TXT | ZIP 炸弹/超大文件全量解压读入内存，worker OOM、应用卡死 | 读前 stat 限大小；loadAsync 前统计条目数与 uncompressedSize 总和 |
| M29 | `backup.ts:56, 96` | 离线破解 | scrypt 用 Node 默认 N=16384（低于 OWASP 推荐），8 位短密码可暴力破解；恢复无解压总量限制可 DoS | 显式 N=2^17；恢复前校验 manifest 总字节数与文件数 |

---

## 三、低危

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| L1 | `ai-provider.ts:75-79, 111-115` | SSE 单事件多行 `data:` 被 join("\n") 后整体 JSON.parse 失败，特定代理下所有流式任务不可用 | 逐行解析各自 JSON 并依次处理 |
| L2 | `ai-service.ts:1183-1186` | 流式任务失败/取消时无结束事件，UI 面板悬挂"生成中"；降级非流式后误判零输出 | 失败路径也发 failed/complete 事件 |
| L3 | `worker.ts:328-331` | 取消标记在任务完成后残留，Set 泄漏 | 任务结束时清理 |
| L4 | `ipc-validation.ts:9` vs 前端 | 正文 >200K 被 zod 拒绝且前端无提示（走 autosave 则触发 H4 死循环） | 前端字数提示/分段保存 |
| L5 | `WritingWorkspace.tsx:230-238` | Electron 中 beforeunload 返回非空会取消关闭但不弹框，窗口无法关闭 | 主进程 close 事件 + dialog 确认 |
| L6 | `ProjectDashboard.tsx:291-305` | 契约已审批时"采用此方向"必失败且不保存表单 | approved 时禁用并提示走变更单 |
| L7 | `WritingWorkspace.tsx:214-229` | 每键击同步 JSON.stringify ~400KB 写 localStorage，大章节明显卡顿，易超 5MB 配额 | 恢复副本写入 1s 防抖 |
| L8 | `ranking-csv.ts:61` + `ResearchRankingView.tsx:122,127` | CSV 链接列无协议白名单直插 `<a href>`（当前被 CSP 拦截，纵深防御缺失） | 解析时强制 http/https、拒绝 userinfo |
| L9 | `system-handlers.ts:361-389` | 诊断包静默包含全部项目书名与工作区路径 | 导出前明示内容清单；health.json label 脱敏 |
| L10 | `backup.ts:60-85` | 成功路径 unlink(previous) 失败会进 catch 用旧备份覆盖刚写入的新备份 | unlink 失败仅告警不恢复旧文件 |
| L11 | `backup.ts:20-29` | pruneAutoBackups 单个 unlink 失败（Windows 文件占用）导致整轮备份记为失败、保留数不足 | 单文件失败仅记录并继续 |
| L12 | `health-service.ts:40-44` + `system-handlers.ts:221,268` | 健康检查与备份 checkpointAll 重叠时 TRUNCATE 返回 SQLITE_BUSY，自动备份整轮失败 | checkpointAll 捕获 BUSY 降级 PASSIVE 或互斥 |

---

## 四、已排查并排除的疑似项（避免误修）

- 项目级 `ai_jobs` 唯一索引 → 死表（无读写方），catalog 级唯一索引已在迁移 4 删除，重试路径不冲突
- 章节切换竞态 → `chapterRequestRef` 请求代 + cleanup 双重保护，无覆盖
- 虚拟滚动越界 → `slice` 自动截断；compactList 仅移动端触发
- IPC 通道覆盖 → 70+ 通道均有 schema 与 handler
- `summaries.ts` 的 `Math.max(...[])` = -Infinity → 调用方保证 finalized 非空
- `aggregateStorySummaries` 截断行记账 → 截断只发生在剩余空间为 0 时，行为一致
- `paragraph-diff` Uint16Array 溢出 → 单章对比段数远低于 65535
- `TRANSITIONS` 缺"章纲" → 章纲→草稿是自动派生路径，不经过 assertChapterTransition
- `credential-store` PowerShell 调用 → 固定脚本 + env/stdin 传参，target 硬编码，无命令注入
- CSV 公式注入 → 仅解析不导出，无注入面
- XXE（fast-xml-parser）→ 5.2.5 内置实体上限且不加载外部实体；mammoth 不读外部文件
- EPUB/备份 zip-slip → 条目只读不落盘 / manifest 路径校验完备

---

## 五、修复批次建议

**批次 1（本周，数据安全与核心功能）**：H1 H2 H3 H4 H6 M1 M3 M12
**批次 2（下周，一致性与并发）**：H5 M2 M4 M11 M13 M14 M15 M16 M17 M19 M21 M22
**批次 3（安全加固）**：M27 M28 M29 L8 L9
**批次 4（体验与健壮性）**：M5 M6 M7 M8 M9 M10 M18 M20 M23 M24 M25 M26 L1-L7 L10-L12

每批完成后跑全量 `npm test` + `test:quality`；批次 1 中 H3/H4 建议补对应竞态与重试的回归测试（现有测试未覆盖）。
