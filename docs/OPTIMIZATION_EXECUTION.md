# 长篇创作工作台 全量分阶段优化执行方案（LLM 可直接执行）

> 本文件为执行蓝本：6 个相互独立、可逐个交付的阶段。每个阶段都是一次完整的执行单元，有明确文件目标、命令、验收标准和提交规范，执行完即推送到远端触发 CI。

## 摘要

对 `juice4927/fanqie-novel-studio`（main 分支）执行全量工程优化。当前基线：`tsc --noEmit` 0 错误、单测全绿、`npm run build` 通过。

## 阶段 0 — 落地执行文档

- 本文件即为阶段 0 产物；README「本地开发」小节上方加链接指向本文件。
- 提交：`docs: add phased optimization execution plan`；验收：文档存在、链接有效、`git status` 干净。

## 阶段 1 — 工程健康（P1：lint / 常量 / 死代码 / 事务）

- **引入 Biome**：`npm i -D biome`；新建 `biome.json`（linter recommended 全开、formatter 2 空格缩进、include `src/electron/tests/scripts`、ignore `dist/dist-electron/node_modules`）；`package.json` 增加 `lint`、`lint:fix`、`format` 脚本；逐条修复 `biome check .` 报告的问题（先 `--write` 自动修复，再手动修剩余），并在 `.github/workflows/release.yml` 的 verify job 中 `npm test` 前插入 `npm run lint`。
- **状态字面量单一数据源**：新建 `src/shared/status-constants.ts`，用 `as const` 定义章节/契约/规划/项目/排期/质检严重级状态数组；替换 `src/shared/`、`electron/`、`src/pages/` 中的裸字符串引用，显示文本保持不变；加一个「各状态数组非空且元素唯一」的单测。
- **死代码与重复清理**：先 grep 全仓确认调用方——删除 `database.ts` 中零调用的 `normalizeForFingerprint`/`textWindows`；**保留 `hashText`**；仅合并逐字重复且有多个调用方的 `now()`/`compact`/`splitLines` 工具；删除 `electron/contracts.ts` 中零实现的接口（grep 确认后）。
- **事务补齐**：审计 `saveIssues`/`saveMetrics`/`saveRanking`/`saveSchedule`/`saveChangeRequest`/`saveFact`/`saveExpectation`/`attachInsights`/`saveResearchBook`/`saveResearchAnalyses`/`updateResearchBook`/`saveInsight`，凡多语句写操作按 `saveContract` 已有的 `BEGIN IMMEDIATE`+`try/COMMIT`+`catch/ROLLBACK` 模式包裹；新增 3 个回滚测试（`saveIssues`/`saveMetrics`/`saveRanking` 注入中途失败，断言无半写状态）。
- 验收：`npm run lint` 零告警、`npx tsc --noEmit` 0 错误、`npm test` 全绿、`npm run build` 通过；按 lint/常量/死代码/事务拆 4 个独立提交。

## 阶段 2 — 安全与测试加固（P2：axe / 覆盖率 / 错误码 / 安全测试）

- **axe 扫描**：在 `tests/e2e` 主要页面（多书总览、系统设置、写作台）加载后运行 axe-core，断言无 critical/serious 违规。
- **覆盖率门禁**：`npm i -D @vitest/coverage-v8`；vitest 配置 coverage（provider v8，include `src/shared`/`src/lib`/`src/pages`，exclude electron 主进程与测试文件）；**阈值规则**：先实测当前覆盖率，设 `lines/statements/functions = max(60, 当前值-5)`、`branches = max(50, 当前值-5)`，并在 CI verify 中加 `npm run test:coverage`。
- **结构化错误码**：新建 `src/shared/error-codes.ts`（稳定 code）；`AiService` 抛带 `code`+`retryable` 的 `AppError`；把所有 `startsWith("模型服务暂时不可用")` 式中文前缀判定改为按 code 判定，中文文案仅作 UI 展示保留。
- **安全测试补齐**：扩展 `tests/security.test.ts`——备份包路径穿越（含 `../` 条目的伪造 zip 被拒）、凭据不进日志、诊断 ZIP 不含正文/数据库且脱敏用户目录、netguard 重定向跳私网被拒。
- 验收：新增测试全过、`npm test`/`npm run build` 绿；按 axe/覆盖率/错误码/安全测试拆 4 个独立提交。

## 阶段 3 — 架构演进（P3：拆大文件 / AppApi 收敛 / 代码分割）

- **拆巨型单文件（纯重构，无行为变化）**：
  - `electron/ai-service.ts`：抽出 `electron/prompt-assembly.ts`（各 `build*Prompt`/上下文组装）与 `electron/ai-request.ts`（请求循环核心，复用已有 `ai-retry.ts`）。
  - `electron/database.ts`：按聚合根抽 `repositories/project-chapters-repository.ts` 与 `repositories/project-ledger-repository.ts`，`WorkspaceDatabase` 保留门面方法委托。
  - `src/lib/browser-api.ts`：按 ai/project/research/system 四域拆成 4 个模块 + barrel 导出。
  - `src/pages/WritingWorkspace.tsx`：抽 hooks 与面板组件。
- **AppApi 收敛**：`AppApi` 保留为公开契约；在 `electron/ipc-validation.ts` 增加类型化 `invoke`/`handle` 注册助手（从 Zod schema 键推导）；新增契约测试断言 schema 键集合、preload 暴露面、main handler 三者一致。
- **前端代码分割**：`vite.config.ts` 配 `manualChunks`（react 全家桶独立 chunk）+ 路由级 `React.lazy`；目标构建后主 entry < 500 kB。
- 验收：行为零变化（纯重构），`tsc`/`npm test`/`npm run build` 全绿，构建无 500 kB 告警；AppApi 契约测试通过。

## 阶段 4 — 发布流水线（P3：版本 / 更新通道 / tag）

- 版本 `0.1.6 → 0.2.0`：同步更新 `package.json` 与 README 安装章节版本号。
- `package.json` build 增加 `publish: { provider: "github", owner: "juice4927", repo: "fanqie-novel-studio" }`，保证打包生成 `app-update.yml`，修复 `update-service.ts` 静默失败。
- **前置检查**：确认仓库 Secrets 已配 `WINDOWS_CERTIFICATE_BASE64`/`WINDOWS_CERTIFICATE_PASSWORD`/`WINDOWS_PUBLISHER_NAME`（`gh secret list`）。
  - 已配置：在验证通过的提交上打 `v0.2.0` tag 并推送，触发 `release-windows`；确认 Release 产出签名安装包与 `latest.yml`。
  - 未配置：**不打 tag**；改为本地 `npm run dist:win` 验证打包链路，并把「需配置签名 Secrets 才能完成发布」写入文档待办。
- 验收：版本号一致、更新通道配置生效；发布成功或（无证书时）本地打包成功 + 证书待办已记录。

## 阶段 5 — 性能与领域文档（P3）

- **性能**：`getDashboardActivity` 改为单条聚合查询；ProjectPage 切 tab 不再整体重挂；用 `tests/capacity.scale.test.ts` 记录优化前后基线。
- **领域文档**：新建 `docs/architecture.md`（分层与依赖方向）、`docs/domain-rules.md`（门禁链/变更单/状态机）、`docs/knowledge-base.md`（知识库更新与版本绑定流程）、`docs/security.md`（威胁模型与安全边界），README 增加链接。
- 验收：`test:scale` 通过、e2e 通过、SQL 次数与加载耗时改善有记录、四篇文档提交。

## 全局执行协议与测试计划

- **每阶段收尾命令**：`npx tsc --noEmit` → `npm test` → `npm run build`（阶段相关命令按阶段执行）；全绿后推送 `main` 并确认对应 CI run 通过再进入下一阶段（`gh run list` 检查）。
- **提交规范**：Conventional Commits；安全修复、算法变更、纯重构绝不混在同一提交；阶段内按子项独立提交。
- **网络**：GitHub 直连不稳时，`gh`/`git push` 前设置 `HTTPS_PROXY=http://127.0.0.1:7897`。
- **测试计划**：每阶段新增/修改的测试随该阶段提交，回归全量 `npm test` + 阶段专项 + CI verify。

## 假设与默认值

- 使用 **Biome**（非 ESLint/Prettier）；覆盖率阈值按「max(基准, 当前-5%)」规则首设，后续阶段可上调。
- 版本定为 **0.2.0** 作为首个可信 tag；如无签名证书则采用本地打包验证 + 证书待办的回退路径。
- 所有新文档（`docs/*`）与提交信息使用中文；git 身份沿用 `juice4927 <juice4927@users.noreply.github.com>`，不重写已发布历史。
- 阶段 0–5 在 `main` 上顺序执行，每阶段结束后仓库处于可发布状态。
