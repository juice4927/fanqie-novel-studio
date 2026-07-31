# 优化方案：长篇创作工作台（fanqie-novel-studio）

> 依据 `ANALYSIS.md`（2026-07-31）的六维评估与验证实测制定。每个优化项给出：问题定位 → 方案 → 工作量 → 验证方式。
> 优先级：**P0** 立即（安全/构建阻塞）→ **P1** 短期（工程健康）→ **P2** 中期（质量与安全加固）→ **P3** 长期（架构演进）。

---

## P0 — 立即处理（阻塞或高危）

### P0-1 封堵模型请求的 SSRF / 重定向漏洞（高危）

- **问题**：`electron/ai-service.ts:559-581` 的模型请求 `fetch` 无任何地址校验且默认跟随重定向；`electron/ipc-validation.ts:16` 的 `httpUrl` schema 只验协议，允许私网地址与 userinfo。渲染进程被 XSS 控制后可将 API 密钥外泄给任意端点，公网恶意服务可 302 跳内网。与榜单采集的强防护（`electron/ranking-service.ts:25-89`）形成鲜明对比。
- **方案**：
  1. 先明确端点策略：默认仅允许不含 userinfo 的 HTTPS 公网模型地址；如产品需要兼容本地模型或企业内网网关，增加显式的“受信任私有端点”开关和确认提示，不能静默放行；
  2. 私有端点不得自动复用已保存的云端 API 密钥，切换端点后应要求重新确认或单独保存凭据，阻断“修改地址后借用旧密钥”的外泄路径；
  3. 将 URL 协议、userinfo、IP 分类和重定向校验提取到公共网络安全模块。`ai-service.ts` 使用 `redirect: "manual"`，手动跟随重定向（上限 5 次），每跳重新执行对应端点策略；
  4. 当前 `ranking-service.ts` 的“先 DNS lookup、后 fetch”存在二次解析窗口，不能直接视为完备防护。网络层应将实际连接绑定到已校验地址，或在连接阶段核验远端地址，防止 DNS rebinding / TOCTOU；
  5. `httpUrl` schema 负责同步可判定的格式、协议和 userinfo 拒绝；DNS/IP 解析留在主进程网络边界。`normalizeProviderUrl` 对非法协议和 userinfo 直接拒绝，不做剥离后继续请求。
- **工作量**：约 1–2 人日（若不支持私有端点可缩短；若支持代理/内网模型需增加策略与测试）。
- **验证**：新增安全测试——IPv4/IPv6 私网与保留地址、IPv4-mapped IPv6、DNS 多 IP 部分私网、DNS rebinding 模拟、重定向跳私网、重定向上限、userinfo 拒绝、私有端点不复用云端密钥；回归 `npm test`。

### P0-2 完成 novel-revision 浏览器端接线，恢复构建绿灯

- **问题**：`src/lib/browser-api.ts:478` 的 `createBrowserApi()` 缺少 `analyzeNovelRevision` / `applyNovelRevision`，`tsc --noEmit` 失败（TS2739），`npm run build` 与 CI `verify` 当前必然失败。
- **方案**：
  1. 浏览器工作台仍暴露小说修订入口，因此优先实现可运行的确定性 demo：生成有限的修订建议，并复用 shared 层 `novel-revision.ts` 的快照、并发变更校验和应用函数；
  2. 如果当前迭代不准备支持浏览器 demo，则在浏览器环境明确隐藏/禁用入口并说明桌面版能力，不能只补一个运行时抛错的 stub；
  3. 为 analyze/apply 增加浏览器工作流测试，覆盖建议生成、选中应用、版本变化拒绝和持久化后重载。
- **工作量**：0.5–1 人日。
- **验证**：`npx tsc --noEmit` 零错误；`npm run build` 通过；新增浏览器修订工作流测试和 `npm test` 全绿；CI verify 恢复。

---

## P1 — 短期（工程健康，1–2 周内）

### P1-1 清理死代码与确定性重复

- **问题**：`database.ts:1571-1588` 保留了一套当前未参与原创度比对的 `normalizeForFingerprint` / `textWindows` / `hashText` 辅助函数；实际原创度写入和查询均走 `research-repository.ts` 的同一实现，因此不存在“调用路径导致结果不一致”，但死代码会误导维护。另有 `now()`、`compact`、`splitLines`、`issueTone`、图标组件和 `CommonProjectProps` 等重复定义。
- **方案**：
  1. 删除 `database.ts` 中确认无调用的指纹辅助函数；
  2. 为 `research-repository.ts` 的原创度归一化行为补测试，再根据规避标点干扰的产品目标决定是否改为“去空白+标点+符号+小写”，不把算法变更混入纯去重提交；
  3. 仅提取确实逐字重复、语义一致且有多个调用方的工具或组件。避免创建泛化的 `utils.ts` 杂物箱，优先使用领域命名模块。
- **工作量**：1–2 人日。
- **验证**：原创度归一化与匹配测试覆盖中文标点、英文大小写、空白变化和短文本；`npm test` 全绿；静态搜索确认目标死代码和逐字重复已清理。

### P1-2 补齐无事务写操作

- **问题**：多语句业务操作缺少统一原子性边界：`saveIssues` 会批量写 issue 并可能切换章节模式；`saveMetrics` 批量写多条记录；`saveRanking` 分别写 snapshot 与 entries；`saveResearchBook` 写 book、chapters 与 fingerprints；`saveAutoBackupSettings` 写多项设置。中途失败会留下逻辑半写状态。
- **方案**：只为需要“全成或全败”的多语句操作建立事务边界，不机械包裹单语句方法。事务应下沉到真正拥有同一个数据库连接的 repository/聚合操作中；`saveIssues` 改用 `persistChapterInTransaction` 或等价的同事务路径，避免嵌套事务。
- **工作量**：1 人日。
- **验证**：扩展 `tests/database.test.ts`：注入失败点（借助 `fault-injection.ts` 或 mock）断言半写状态不产生；`npm test` 全绿。

### P1-3 中文字面量状态建立单一数据源

- **问题**：`ChapterStatus`/`ProjectStatus` 是裸字面量联合（types.ts:13-25），业务代码、运行时校验和 UI 选项缺少可复用的状态集合。联合类型已经能检查赋值处的错别字，但不能直接供运行时遍历或校验使用。
- **方案**：在 `types.ts` 为每个状态联合增加对应 `as const` 数组，联合类型由数组派生；状态机转换规则单独集中定义。无需全面禁止业务代码中的状态字面量，仅对确实需要统一展示或转换的场景使用常量/规则表。
- **工作量**：0.5–1 人日。
- **验证**：`npm test` 全绿；编译期即可捕获错别字。

### P1-4 引入 lint 并接入 CI

- **问题**：无 eslint/prettier/biome 任何配置，格式与潜在 bug 仅靠 tsc 兜底。
- **方案**：选用 **biome**（零配置起步、速度快、含 formatter）；配置 `biome.json`（推荐 `recommended` 档 + 关闭与项目风格冲突的规则）；`npm run lint` 脚本；接入 CI `verify` job（在 build 前执行）。
- **工作量**：0.5–1 人日（含存量告警清理）。
- **验证**：CI 中 lint 步骤通过；本地 `npm run lint` 零告警。

### P1-5 清理工作区构建残留

- **问题**：release 约 1.5G，另有 release-inspect、release-p2-verify、release-unpacked-test、release-fixed、node_modules.partial 与 dev-*.log 等已忽略的本地构建残留。保留正式 `release/` 时，实际可回收空间应按删除前现场统计，不应将保留目录计入回收量。
- **方案**：删除 `release-inspect/`、`release-p2-verify/`、`release-unpacked-test/`、`release-fixed/`、`node_modules.partial-20260730/`、`dev-*.log`；保留 `release/`（含正式安装包）；将 `release-*` 通配加入 .gitignore（已有）。
- **工作量**：10 分钟。
- **验证**：删除前后统计各目标目录大小并记录实际回收量（按现有已知目录预计约 1GB 以上，不含保留的 `release/`）；`git status` 无变化。

---

## P2 — 中期（质量与安全加固，1 个月内）

### P2-1 启用 axe 无障碍扫描

- **问题**：`@axe-core/playwright` 已安装但全仓库零使用；e2e 仅有手动焦点陷阱断言。
- **方案**：在 `tests/e2e/workbench.spec.ts` 增加 `AxeBuilder` 扫描步骤（覆盖写作台、质检中心、状态账本三个主工作区），失败即中断；修复 WCAG A/AA 违规。
- **工作量**：1–2 人日（含修复）。
- **验证**：e2e 中 axe 扫描零违规。

### P2-2 补齐安全测试缺口

- **问题**：无 SSRF 用例（IPv6 变体/DNS 多 IP/重定向链）、无 credential-store 测试、无 preload 暴露面测试、备份缺路径穿越/损坏文件测试、structured-log 仅 1 个 happy path。
- **方案**：
  1. `tests/security.test.ts` 覆盖公共网络安全模块与模型端点策略矩阵：公网/受信任私网、`::ffff:` 映射、`fc00::/7`、DNS 混合地址、rebinding、重定向链、5 跳上限，以及私有端点凭据隔离；
  2. `credential-store.ts` 提取可注入的 PowerShell 执行器以便 mock（Windows 依赖下做契约测试）；
  3. `tests/backup.test.ts` 补恶意 manifest 路径穿越（`../`、绝对路径）、截断文件、超大数据条目；
  4. `structured-log.test.ts` 补裸密钥（无前缀）、URL 凭据、嵌套对象边界。
- **工作量**：2–3 人日。
- **验证**：新增用例全部通过；`npm test` 全绿。

### P2-3 覆盖率门禁

- **问题**：无覆盖率配置，测试质量无法量化。
- **方案**：vitest 接入 `@vitest/coverage-v8`，增加 `npm run test:coverage`；第一阶段只在 CI 采集并保存基线报告，识别关键模块缺口；第二阶段对新增/修改代码和 shared 核心模块设置不低于基线的门禁，再逐步提高目标。避免直接套用 75%/65% 等任意全局阈值，诱发低价值测试或规避统计。
- **工作量**：0.5–1 人日。
- **验证**：CI 稳定输出覆盖率报告；门禁阈值有基线数据和关键风险依据；新增代码不降低目标模块覆盖率。

### P2-4 模型请求成本与重试硬化

- **问题**：无请求级 token/预算硬上限；非暂时性错误（如 JSON 校验失败）也会无延迟消耗第二次完整调用（ai-service.ts:702-703）；`longTaskTimeoutMinutes` 默认值钳制到 5–15 分钟但无预算概念。
- **方案**：`runJson` 增加 `maxOutputTokens` 预算参数（按任务类型默认值，如草稿 4000、拆书 2000）；非暂时性错误重试次数降为 1 或直接失败；重试前将首次失败的输出摘要计入审计字段 `retry_context`（已有字段，利用之）。
- **工作量**：1–2 人日。
- **验证**：`tests/ai-service.test.ts` 补预算超限与重试次数断言。

### P2-5 错误体系结构化

- **问题**：重试分类依赖中文文案前缀 `startsWith("模型服务暂时不可用")`（ai-service.ts:678-688），脆弱且不利于维护；`providerError` 将模型回显 detail 前 300 字符透传（ai-provider.ts:200-204）。
- **方案**：定义 `AiErrorCode` 枚举（`rate-limited`/`timeout`/`server-error`/`json-invalid`/`network`…），`providerError` 返回 `{ code, retryable, message }`，重试决策改用 code；对外 message 统一截断 200 字符并剥离疑似密钥片段。
- **工作量**：1 人日。
- **验证**：错误分类单测覆盖全部 code 分支；`tests/security.test.ts` 密钥不回显用例保持通过。

---

## P3 — 长期（架构演进，按需排期）

### P3-1 拆分巨型单文件

- **现状**：`ai-service.ts` 1328 行（`runJson` 252 行）、`database.ts` 1440 行、`browser-api.ts` 1210 行、`WritingWorkspace.tsx` 1087 行、`styles.css` 2893 行。
- **方案**（按风险递增排序）：
  1. `ai-service.ts` → 先按现有行为搬移为 `ai/chapter.ts`、`ai/planning.ts`、`ai/research.ts`、`ai/facts.ts`、`ai/core.ts`；稳定后再单独把 `runJson` 重构为可配置管道，注入重试策略、预算和降级链；
  2. `database.ts` → 按聚合根拆：`db/projects.ts`、`db/chapters.ts`、`db/quality.ts`、`db/settings.ts`，`WorkspaceDatabase` 保留为组合门面；
  3. `WritingWorkspace.tsx` → 拆 `ChapterOutlinePanel` / `EditorPane` / `ChapterList`（复用已有虚拟滚动）/ `BatchPanel`；
  4. `browser-api.ts` → 拆 `seed.ts` / `state.ts` / `api-browser.ts` / `stubs.ts`。
- **风险控制**：纯搬移、行为重构和功能开发分成不同提交；每一步运行全量测试和 `tsc`。拆分边界以职责、依赖方向和可测试性为准，不为满足行数指标制造过碎模块。
- **工作量**：5–8 人日。
- **验证**：拆分后 `npm test` / `test:quality` / `test:scale` 全绿；公共 API 和行为快照不变；循环依赖不增加，核心模块可被独立测试。文件行数只作维护信号，不设机械的 600 行硬门禁。

### P3-2 AppApi 接口收敛（根治三份实现）

- **问题**：`AppApi`（types.ts:818）、preload IPC 映射、主进程 handler 和 browser-api demo 需要协同维护。`createBrowserApi(): AppApi` 已能在编译期发现缺失方法，本次 novel-revision 构建错误证明该约束有效；真正缺少的是减少 IPC 样板和验证各层映射一致性的机制。
- **方案**：
  1. 保留 `AppApi` 作为包含返回类型和业务语义的公开契约；`ipc-validation.ts` 的 Zod schema 作为 IPC 方法名与输入参数的运行时事实源，但不宣称它能生成浏览器实现或返回语义；
  2. 从 schema 键推导 `InvokeApiKey` 和参数类型，建立类型化的 `invoke`/`handle` 注册助手，减少 preload 与 main 的手写样板；
  3. 为 `AppApi`、schema、preload 暴露面和 main handler 增加契约测试，确保键集合一致；browser-api 继续通过显式返回类型或 `satisfies AppApi` 检查完整性；
  4. 不要求 browser-api 自动生成：每个新增能力仍需明确决定“demo 实现、禁用入口或桌面专属提示”。
- **工作量**：2–3 人日。
- **验证**：任一层漏注册或多暴露方法时，类型检查或契约测试失败；preload 不扩大允许调用的 IPC 面；`tsc --noEmit` 零错误。

### P3-3 走通发布流程

- **问题**：0 个 git tag；`release-windows` 流水线从未触发；`electron-updater` 未配置 publish 源（update-service.ts 的 `checkForUpdates` 必然失败被吞）。
- **方案**：
  1. 不补造无法逐一对应可信历史 commit 的 0.1.0–0.1.6 tag；从当前经验证、版本号明确的发布 commit 创建第一个可信 tag；
  2. 现有 release workflow 已通过命令行传入 GitHub publish 配置，可继续由 CI 注入 owner/repo，或在仓库元数据稳定后再固化到 package.json；
  3. 在签名证书和 publisher 信息确认可用后启用 `forceCodeSigning`，避免无证书环境直接阻塞普通本地构建；
  4. 完成一次真实签名发布，并增加“安装上一可信版本 → 检查新版本元数据/提示”的更新通道冒烟测试。
- **工作量**：1–2 人日（含一次真实发布演练）。
- **验证**：tag 指向已审计发布 commit；GitHub Release 生成签名安装包与 `latest.yml`；`npm run test:electron` 通过；从上一可信版本可看到更新提示。

### P3-4 性能与体验优化

- **问题**：`getDashboardActivity` 对每个项目发 3 条 SQL（N+1，database.ts:460-493）；ProjectPage 切 tab 整体重挂工作区、每次 reload 全量拉 `ProjectDetail`。是否存在显著 React 重渲染成本尚未通过 profile 证明，`React.memo` 使用数量本身不是性能指标。
- **方案**：先建立包含项目数、章节数、加载耗时、SQL 次数和渲染次数的基线；确认瓶颈后将 dashboard 聚合改为单条 SQL/CTE，ProjectPage 改为缓存或按需刷新。仅对 profile 证实昂贵且 props 稳定的列表项使用 `React.memo`；`getProject` 与 `getProjectOverview` 是否合并应依据数据载荷与调用语义决定。
- **工作量**：2–3 人日。
- **验证**：`tests/capacity.scale.test.ts` 保持通过；优化前后记录相同数据规模下的 SQL 次数、加载耗时和关键组件渲染次数，确认有可复现改善且无内存明显增长。

### P3-5 建立 docs/ 与领域设计沉淀

- **问题**：领域设计（门禁链、知识库版本、上下文编译规范）散落代码，无文档化路径。
- **方案**：`docs/` 下建立：`architecture.md`（分层与依赖方向）、`domain-rules.md`（门禁链/变更单/状态机图示）、`knowledge-base.md`（分类学与商业知识库的更新流程与版本绑定）、`security.md`（安全边界与威胁模型）；补 `license`/`repository`/`engines` 字段；生成 `AGENTS.md` 便于 AI 辅助开发。
- **工作量**：1–2 人日。
- **验证**：文档与代码同步（README 加链接）；`package.json` 元数据完整。

---

## 执行顺序建议

```
第 1 周：P0-2（恢复构建并走通浏览器修订）→ P0-1（端点策略 + SSRF）→ P1-5（清理）
第 2 周：P1-2（多语句事务）→ P1-1（死代码与确定性去重）→ P1-3（状态数据源）
第 3 周：P1-4（lint+CI）→ P2-2（安全测试）→ P2-1（axe）
第 4 周：P2-5（结构化错误）→ P2-4（预算与重试）→ P2-3（采集覆盖率基线）
后续：  P3-5（先沉淀边界文档）→ P3-2（IPC 契约收敛）→ P3-1（按边界拆文件）→ P3-3（可信发布）→ P3-4（基于 profile 优化）
```

每个 P0/P1 项完成后应单独提交，至少运行 `npm run build` 与 `npm test`；涉及 UI、Electron 边界或发布链路时再运行对应 e2e/Electron 测试。安全修复、算法变更和纯代码搬移不得混在同一提交，避免扩大回归与审查范围。
