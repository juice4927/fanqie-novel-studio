# 优化方案（2026-09-08 复核版）

> 基线版本 v0.2.0（已发布）。本方案基于对当前工作区（含未提交 WIP）的实测与三路并行代码审计。
> 历史文档 `OPTIMIZATION_PLAN.md`（2026-07-31）与 `docs/OPTIMIZATION_EXECUTION.md` 的 P0–P2 已基本落地；`BUG_REPORT.md` 的高危项逐条抽查均已修复。本文件只列**当前仍然存在**的问题。

## 执行进展（2026-09-08）

已完成并验证（`tsc --noEmit` ✅、`npm run lint` ✅、`npm test` 396 通过 / 1 跳过、`npm run test:quality` 15 通过、`npm run test:e2e` 20 通过、`npm run build` ✅、`npm run test:scale` 通过）：

- P0-1 成本聚合按 6 位小数归一，`tests/quality-run.test.ts` 恢复通过。
- P0-3 `getAiSettings` 未显式保存时不再返回默认档位，任务级推理档位恢复生效；新增“显式全局档位覆盖任务默认”测试。
- P0-4 Biome 自动修复 14 个错误；删除无人传入的 `onDirtyChange` 死代码。
- P0-5 `npm audit fix` 升级 js-yaml 4.3.2、@xmldom/xmldom 0.8.15；生产依赖 0 漏洞（仅剩 esbuild 的开发期低危，需 vite 大版本升级，暂不处理）。
- P1-1 受保护章节的空正文编辑改为回到“待质检”，排期失效条件改为只看 `protectedEdit`。
- P1-2 “已发布”纳入硬性问题门禁。
- P1-3 事实替换降级为“有冲突”时不再关闭旧事实。
- P1-4 分卷摘要 `toChapter` 覆盖规划卷范围，写作中途可取到分卷记忆。
- P1-5 中文数字解析支持“亿”与“千/百”省略尾数；榜单 CSV 复用同一解析器（“3千”“十万”不再吞值）。
- P1-6 AI 修订保存传入章节生成守卫，请求期间的编辑不再被旧修订稿静默覆盖。
- P1-9 重新点击“新建章节”会取回本地恢复稿。

未执行 / 需确认：

- **P0-2 双轨质量运行机制合并**：`src/shared/quality-benchmark-run.ts` 与 `scripts/compare-quality-runs.ts` 仍是未跟踪文件，删除后 git 无法恢复。请确认保留 `quality-run.ts` 一套后再删。
- **P1-7 `saveChapter` 的 `expectedRevision` 校验**：渲染层在“保存成功但用户继续输入”时不会采纳服务端新 revision，直接开启会让下一次自动保存被拒。需要先让渲染层在保存成功后同步服务端 revision 而不覆盖正文，再开启服务端校验。
- P1-8（备份流式化）、P1-10（放弃修改时取消在途自动保存）与 P2/P3 各项目尚未开始。

## 一、实测基线

| 检查项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npm test` | ❌ 391 通过 / 1 失败（`tests/quality-run.test.ts` 成本浮点精度）/ 1 跳过 |
| `npm run lint` | ❌ 14 错误，分布在 11 个文件（集中在未提交的新代码） |
| `npm run test:quality` | ✅ 15 通过 |
| `npm run test:e2e` | ✅ 20 通过 |
| `npm run test:scale` | ✅ 10 书 × 1500 章 × 300 万字，133.6s |
| `npm run build` | ✅ |
| `npm audit --omit=dev` | ❌ js-yaml（high，经 electron-updater）、@xmldom/xmldom（moderate，经 mammoth） |

**结论：主干健康，但未提交的 WIP 让 CI 处于红灯状态（lint + 1 个测试失败）。这是当前第一优先级。**

## 二、P0 — 立即（0.5–1 人日，目标：恢复绿灯）

1. **修复质量运行成本聚合的浮点误差**。`src/shared/quality-run.ts:77` 直接累加 `cost`，得到 `0.060000000000000005`；`tests/quality-run.test.ts:32` 断言精确相等而失败。聚合时按 6 位小数归一（或改用整数“厘”累加），测试改用 `toBeCloseTo`。
2. **合并双轨的“质量运行/对比”机制**。现有两套并行实现：
   - `src/shared/quality-run.ts`（Zod + `corpusHash`，已被 `scripts/compare-quality.ts` 与 `package.json` 的 `quality:compare` 接线）；
   - `src/shared/quality-benchmark-run.ts`（手写校验 + `corpusVersion`，仅被未注册的 `scripts/compare-quality-runs.ts` 使用，169 行零测试）。
   两套报告 schema 互不兼容。建议保留前者，删除或移植后者，只保留一个 CLI 入口，并补边界测试（未知 fixture、重复案例、语料不匹配、成本聚合）。
3. **修复 `reasoningEffort` 优先级倒置（WIP 引入的回归）**。`electron/ai-service.ts:209` 写成 `settings.reasoningEffort ?? options.reasoningEffort`，而 `getAiSettings()`（`electron/database.ts:1350-1364`）永远返回默认值 `"medium"`，导致任务级档位（`ai-service.ts:1395/1469/1520` 的 `"low"`）全部失效。改为任务级优先，或让设置读取仅在用户显式保存过时返回值；补一个使用真实 `WorkspaceDatabase` 的测试（现有 fake settings 无该字段，所以测试测不出来）。
4. **清理 lint 与死代码**。`npx biome check --write .` 修复 14 个格式错误；删除已无人传入的 `onDirtyChange` prop（`src/pages/WritingWorkspace.tsx:81,267`，`ProjectPage` 已不再传）。
5. **处理依赖漏洞**。`npm audit fix` 升级 js-yaml（electron-updater 解析 `app-update.yml`，high）与 `@xmldom/xmldom`（mammoth 解析用户导入的 DOCX，moderate）；升级后跑全量测试确认 DOCX/TXT/EPUB 导入不回归。

## 三、P1 — 数据正确性与安全（3–5 人日）

1. **空正文让受保护章节脱离保护**。`src/shared/chapter-lifecycle.ts:53` 的“空正文→章纲”判断在 `protectedEdit` 之前，已定稿/待发布/已发布章节带批准变更清空正文后会变成“章纲”，此后编辑不再需要变更单；且 `electron/database.ts:830-834` 的排期重置条件 `protectedEdit && status === "待质检"` 不会触发，排期行仍停在“待发布”。修复：受保护编辑下空正文返回“待质检”或直接拒绝；排期重置改以 `protectedEdit` 为条件。
2. **发布动作不受硬性问题门禁**。`src/shared/chapter-lifecycle.ts:121-125` 只检查目标状态为待定稿/已定稿/待发布；若章节进入“待发布”后新增硬性问题，“待发布→已发布”仍会放行。修复：把“已发布”纳入硬性检查，或在发布前单独断言。
3. **事实替换在降级为“有冲突”后仍然生效**。`src/shared/fact-service.ts:35-42` 在冲突判定前就返回 `replacement`，`electron/database.ts:898-901` 无条件落库，于是旧“已确认”事实被关闭、新事实却是“有冲突”，该章之后没有任何已确认值。修复：冲突判定后再决定是否返回 replacement。
4. **分卷摘要的 `toChapter` 夹到“最后一章已定稿号”**。`src/shared/summaries.ts:156` 使 `buildLongTermMemory`（`:183-187`）在写作中途取不到当前分卷记忆（第一卷规划 1–60 章、只定稿第 1 章时 `toChapter=1`）。修复：保留规划卷末或取 `max(end, 当前章号)`，空 finalized 兜底。
5. **中文数字解析缺“亿”与省略尾数单位**。`src/shared/story-constraints.ts:37` 字符集不含“亿”（“三亿”解析为 3），`:54` 的省略尾数只处理“万”（“两千三”解析为 2003）。资源守恒门禁对亿级数值漏报。`src/shared/ranking-csv.ts:18-23` 同源问题（“3千”→“3”，纯中文“十万”→0，非法排名静默为 0）。修复：按“亿/万”分段解析并支持千/百省略，非法值显式报错或降级。
6. **AI 修订保存没有乐观锁，也不标记任务未应用**。`electron/handlers/ai-handlers.ts:240` 直接 `saveGeneratedChapter(id, revised)`，未传 guard、无 catch；对比草稿路径（`electron/chapter-generation-service.ts:95-114`）。请求期间章节被编辑会被旧 AI 稿静默覆盖，保存失败时任务仍显示“成功”且输出已缓存。修复：与草稿路径一致地传 guard 并在失败时 `markAiJobApplicationFailed`。
7. **`saveChapter` 不校验客户端 `revision`**。`electron/database.ts:728-760` 一律以 `previous.revision` 重算，只有 `saveGeneratedChapter` 有 `expected` 守卫。旧编辑器内容（AI 修订、历史恢复、批量修复期间）会静默覆盖新版本，autosave 模式还不进 revisions 表。修复：增加可选 `expectedRevision`，不匹配即拒绝。
8. **备份的内存与一致性**。`electron/backup.ts:50-65,103-128` 把每个文件读入内存、整包压缩与加密（创建侧无大小上限），恢复同样全量载入；`walk()` 未跳过 `trash/`，导致已删除项目仍进每次备份；`electron/database.ts:1552-1556` 的 checkpoint 在 TRUNCATE 失败时只降级 PASSIVE，备份出的 `.sqlite` 可能缺 WAL 中已提交事务。修复：流式分块处理、创建前估算上限、跳过 trash、checkpoint busy 时中止并报错。
9. **新建章节的草稿不会自动保存，恢复稿也没有入口**。`src/pages/WritingWorkspace.tsx:280-287` 的自动保存条件排除 `!draft.id`；恢复键 `new-N`（`src/lib/chapter-draft.ts:9`）只在挂载第一屏与 `getChapter` 时读取（`:87,232`），新建章节走 `:568` 不读恢复稿。新章内容未手动“建立版本”就退出应用会永久丢失。修复：新章也走 autosave，或新建/挂载时扫描 `new-*` 恢复稿并提示。
10. **放弃修改后，在途自动保存仍会写回被放弃的内容**。`src/pages/WritingWorkspace.tsx:492-507` 的 `canDiscardDraft` 只清恢复稿；`AutosaveCoordinator`（`src/lib/chapter-draft.ts:77-83,152-159`）没有取消接口。切章前先 `await flush()` 并明确提示，或增加 `cancelPending()`。

## 四、P2 — 性能与架构（2–4 周）

1. **事实检索全量加载**。`electron/database.ts:918-963` 载入全部事实与全部向量（无 LIMIT），在主线程做全量余弦相似度，`limit=80` 只在最后 `slice`；每次质检/编译上下文/生成正文都会执行。修复：过滤条件与数量上限下推 SQL、缓存向量或移入 worker。
2. **`getProject` 全量正文被滥用**。`electron/database.ts:575-597` 一次性 JOIN 全部正文与 records，而 `getReviewSuggestions` 只用 metrics（`electron/handlers/project-handlers.ts:130`）、概念生成/规划审查/上下文编译也各有子集（`ai-handlers.ts:273,308,360`）。修复：提供投影式 getter 或字段白名单。
3. **死索引与写放大**。`chapter_fts`（unicode61）全仓库没有任何 `MATCH` 查询，只有写入与健康检查计数；章节 embedding 每次保存都写（`electron/database.ts:844`），但读取只针对 `source_type='facts'`。修复：删除或为其设计真实查询路径；2 字检索目前走 `LIKE '%词%'` 全表扫描，可评估 n-gram 方案。
4. **渲染层每帧序列化整章正文**。`src/pages/WritingWorkspace.tsx:265` 在组件函数体里对整个 `draft`（含 400KB 正文）做 `JSON.stringify` 来算 `dirty`，滚动 `setScrollTop`（`:591-593`）会让它每帧执行；`filteredChapters`（`:319-322`）也没有 `useMemo`。修复：`dirtyRef` 布尔位 + 必要时才计算签名 + `useMemo`。
5. **切 tab 卸载写作台，且每次自动保存全量 reload**。`src/pages/ProjectPage.tsx:191-193` 条件挂载导致搜索词/滚动位置/面板状态丢失；`onSaved` 每次都 `getProject()` + `listInsights()`（`WritingWorkspace.tsx:195`、`ProjectPage.tsx:63-77`）。修复：写作台保持挂载（CSS 切换）、保存后局部更新、insights 与项目保存解耦。
6. **拆巨型文件**：`electron/ai-service.ts` 1531 行、`electron/database.ts` 1726 行、`src/pages/WritingWorkspace.tsx` 1632 行（29 个 useState + 5 个内联弹窗）、`src/lib/browser-api.ts` 1101 行、`src/styles.css` 3723 行。建议先抽 `WritingWorkspace` 的 5 个弹窗与 `useGeneratedDraftReview` hook（单章/批量采纳逻辑已重复四份，`WritingWorkspace.tsx:399-490,1029-1266`），再按聚合根拆数据库与 AI 服务。
7. **事务与提交后失败**。多实体修复批量应用无事务（`electron/main.ts:274-334`、`ai-handlers.ts:388-401`），中途失败会留下“契约已改、规划未改、变更单已消耗”的半应用状态；`touchProject` 在 `COMMIT` 之后仍在 try 内（`database.ts:749-751` 等 7 处），目录库失败会把已提交的保存上报为失败，AI 侧据此判定“未应用”并重复计费生成。
8. **worker 生命周期**。`electron/worker-client.ts:17-44` 崩溃即无条件 respawn（无退避/上限），`run()` 无超时且 `postMessage` 同步抛错会泄漏 pending；`electron/worker.ts:284-311` 的取消标记对 parse/quality 任务无效，且可能永久残留。
9. **CI 与门禁**。`tsconfig.json:20` 不包含 `tests/` 与 `scripts/`，它们的类型错误不会被 `tsc` 发现；覆盖率阈值 lines/statements 43、functions 60、branches 75 且未开 `perFile`（新增无测试模块不会让 CI 失败）；verify 里 `npm test` 与 `test:coverage` 跑两遍；CI 不跑 `test:scale` 与打包 asar 冒烟，tag 与 `package.json` 版本号无一致性校验。

## 五、P3 — 产品与长期

1. **美学评测闭环（层 1）**。`AESTHETIC_QUALITY_PLAN.md` 的 `aesthetic-benchmark.ts` 尚未开工；当前“好看”只有输入侧提示词引导，没有输出侧评测与回归护栏。层 1 约 3 人日，可独立交付。
2. **代码签名与更新通道**。v0.2.0 安装包未签名（SmartScreen 提示未知发布者）；配置证书 Secrets 后重新发布，并补一次“旧版本→新版本”的更新通道冒烟。
3. **AI 导演模式后续**。P0–P2 已落地；若要继续，优先把“渐进监督”的建议档位与人工确认流程打磨好，仍不引入自动定稿/发布。
4. **导航守卫改为多槽位**。`src/lib/navigation-guard.tsx:11-18` 的 `guardRef` 只保存最后一个守卫，未来多个编辑器同时注册会静默失效；改为 `Set<LeaveGuard>` 全部执行。
5. **可访问性小修**。Modal 强制聚焦第一个可聚焦元素，会抢走子控件 `autoFocus`（`src/components/UI.tsx:88`）；写作台的搜索框、标题输入、正文 textarea 无可访问名称（`WritingWorkspace.tsx:580-588,638-644,988-995`）；Segmented 无 `aria-pressed`；toast 无 `role="status"`。

## 六、执行顺序与验收

```
第 1 天   P0-1…P0-5（修浮点、并双轨、修 reasoningEffort、lint --write、audit fix）
第 1 周   P1-1…P1-5（门禁与账本正确性：空正文/发布门禁/事实替换/分卷摘要/数字解析）
第 2 周   P1-6…P1-10（AI 修订守卫、revision 校验、备份内存、新章草稿、放弃修改）
第 3–4 周 P2-1…P2-5（事实检索、投影 getter、死索引、渲染性能、tab 挂载）
后续      P2-6…P2-9（拆文件、事务、worker、CI 门禁）→ P3-1（美学基准层 1）→ P3-2（签名发布）
```

**每批验收**：`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`；涉及 UI 跑 `npm run test:e2e`；涉及数据层跑 `npm run test:quality`；发布前跑 `npm run test:scale` 与 `npm run test:electron`。

**提交纪律**（沿用 AGENTS.md）：Conventional Commits；安全修复、算法变更、纯重构分开提交；改质检/提示词先加 `quality-benchmark-corpus.ts` 案例再比基线。

**本次不做**：不自动定稿/发布（人工门禁不变）；美学分数不进硬性门禁；不为行数指标强行拆文件；不在本轮引入新的重型依赖。
