# 项目分析报告：长篇创作工作台（fanqie-novel-studio）

> 分析日期：2026-07-31 ｜ 版本：0.1.6 ｜ 分析方式：静态深审 + 测试实测

## 一、项目概述

面向番茄小说长篇连载的**本地优先 Windows 写作工作台**（Electron 桌面应用），覆盖"榜单研究 → 样本拆书 → 原创立项 → 300 万字滚动规划 → 逐章/五章批次写作 → 状态账本 → 质检 → 发布排期 → 数据复盘"完整创作闭环，并为每本书建立独立 SQLite 数据库与检索索引。

| 维度 | 数据 |
|---|---|
| 技术栈 | Electron 43、React 19、TypeScript 5.9（strict）、Vite 7、tsup、node:sqlite（WAL）、Zod 4、Vitest、Playwright |
| 源码规模 | 约 3.2 万行（electron 7.4k + src/shared 4.9k + src/pages 6.2k + src/lib 1.3k + tests 8.4k） |
| 测试规模 | 64 个测试文件、310+ 用例、6 类测试套件（单元/集成/质量基准/容量/e2e/Electron 冒烟） |
| 发布历史 | 6 个安装包（0.1.0 → 0.1.6），NSIS 安装器 + 免安装版 |
| Git 历史 | 73 提交、单作者、2 天内完成（07-30:14 / 07-31:59），0 个 tag |

## 二、评分总表（10 分制）

| 维度 | 权重 | 得分 | 一句话结论 |
|---|---|---|---|
| 架构设计 | 20% | **8.0** | 分层思想优秀（shared 纯函数层零反向依赖），但巨型单文件拖累 |
| 代码质量 | 15% | **7.0** | strict TS + 认真错误处理，无 lint、魔法值与重复代码较多 |
| 测试体系 | 20% | **8.5** | 六类测试套件全绿，质量/提示词基准是亮点；axe 与覆盖率缺失 |
| 安全性 | 15% | **7.5** | IPC/凭据/采集防护认真到位，但模型请求存在真实 SSRF 弱点 |
| 产品/领域设计 | 20% | **9.0** | 最强维度：完整工作流 + 人工门禁链 + 商业化知识库 |
| 工程实践 | 10% | **6.5** | CI 设计良好但从未走 Git 发布流程，配置与卫生有缺口 |
| **加权总分** | | **7.9 / 10** | 领域深度远超个人项目的成熟作品，工程短板集中在收尾环节 |

## 三、维度详析

### 3.1 架构设计 8.0/10

**亮点**
- **领域层干净单向依赖**：`src/shared/` 36 个文件近 100% 纯函数，对 electron 零引用（已验证 grep 0 命中），确定性规则可被主进程与浏览器端双端复用，如章节生命周期 `chapter-lifecycle.ts`、契约审批 `contract-service.ts`。
- **主进程按域拆分**：handlers（ai/project/research/system 四组）+ repositories（项目/研究/修订/搜索/AI 审计五类），`main.ts` 只做装配（依赖注入）。
- **worker 线程隔离**：文档解析（TXT/EPUB/DOCX）、20 条本地质检规则、全库健康检查都跑在 worker 线程，含取消机制与自动重生（`worker-client.ts`），避免阻塞 IPC/UI。
- **数据层三库隔离**：catalog / research / 每项目独立 project.sqlite，研究样本与创作数据物理隔离。

**问题**
- **巨型单文件**：`ai-service.ts` 1328 行（核心方法 `runJson` 252 行）、`browser-api.ts` 1210 行、`database.ts` 1440 行、`WritingWorkspace.tsx` 1087 行——虽有分层意图，但单体内部职责仍过重。
- **AppApi 三份实现**：同一接口在 `preload.ts`（IPC 版）、`browser-api.ts`（localStorage demo 版）、`shared/types.ts`（类型）三处维护，接口扩展要改三处——本次 novel-revision 断点即因此产生。
- **死接口**：`contracts.ts` 的 `ModelProvider`/`RankingSourceAdapter`/`DocumentImporter` 等接口全仓库零实现；`ProviderCapabilities.usageShape` 定义后从未读取。

### 3.2 代码质量 7.0/10

**亮点**
- TypeScript strict 全开、`noEmit` 类型门禁；提交粒度小且消息规范（conventional commits）。
- 领域规则实现方式统一（`prepare*Save` 纯函数 + 数据库门面），行为可预测。

**问题**
- **无任何 lint 配置**（无 eslint/prettier/biome），格式与潜在 bug 全靠 tsc 兜底。
- **魔法值泛滥**：阈值、权重、字数预算（30 章/5 章/20 章/80 条/3500 字/16000 字）、评分权重（0.35/0.2/0.15/0.2/0.1）、退避参数（1000×2^n）散落各文件，无命名常量层。
- **重复代码**：`compact` 工具三处、`now()` 四处、`splitLines`/`issueTone`/图标组件三处逐字重复、两个 SSE 解析器骨架重复、`getProject` 与 `getProjectOverview` 几乎逐行重复、**指纹函数双实现且结果不一致**（database.ts 去标点小写 vs research-repository.ts 只去空白，同一内容两处指纹不同，影响原创度比对一致性）。
- **中文字面量状态无单一数据源**："已批准/已定稿/待发布"等约 10 处裸字符串散落，无 `as const` 数组约束，错别字无编译期保护。
- 错误分类依赖中文文案前缀（`startsWith("模型服务暂时不可用")`），脆弱且不利于国际化。

### 3.3 测试体系 8.5/10

**亮点（实测全绿）**
- `npm test`：60 文件 / 310 用例通过（12.1s），覆盖数据库 34 例、AI 服务、全部 shared 领域服务。
- `npm run test:quality`：15 用例通过——质量评测基准（召回率/准确率/严重级别/证据准确率/误报控制，硬性问题漏检即失败）与提示词回归基准（结构/事实/重复/成本，绑定 `PROMPT_VERSION`）是业界少见的设计。
- `npm run test:scale`：**实测通过**——10 本书 × 1500 章 × 300 万字写入后，聚合查询与概览性能断言达标（113s）。
- 故障注入（`NOVEL_STUDIO_FAULTS`：disk-full / power-loss-before-commit / credential-unavailable）+ 写入真实损坏 SQLite 验证健康诊断。
- 浏览器工作流测试（browser-*-workflow 系列）覆盖 13 个用户流程；e2e 双视口（desktop 1440×900 + Pixel 7 移动端）含 overflow 断言。

**问题**
- **axe 依赖已装但零使用**：`@axe-core/playwright` 在 devDependencies 中，全仓库无一处调用，a11y 仅靠手动断言。
- 安全测试缺口：无 SSRF（IPv6 变体/DNS 多 IP/重定向链）、凭据存储、preload 暴露面、备份路径穿越/损坏文件、日志脱敏边界用例。
- 无覆盖率报告配置；e2e 仅 7 个功能测试，主要工作区（写作台/质检）无 e2e 覆盖。

### 3.4 安全性 7.5/10

**亮点**
- **IPC 纵深防御**：75 个通道全部 Zod strict schema（拒绝未知字段+规模限制，正文 ≤200k、CSV ≤20M）+ 主窗口 sender 校验 + 未注册通道默认拒绝 + 错误不回显参数值。
- **渲染进程加固**：sandbox + contextIsolation + 无 Node 集成 + CSP（`connect-src 'self'`）+ 权限请求全拒 + 外链仅 http/https 无凭据。
- **凭据**：API 密钥与备份密码存 Windows Credential Manager（PowerShell+C# P/Invoke，经 stdin/stdout base64 传递，不出现在命令行），不写 SQLite/日志/备份包。
- **榜单采集 SSRF 防护完整**：IPv4/IPv6 私网保留地址全拒 + DNS 全解析地址校验 + 手动重定向逐跳复检（上限 5 次）+ 5MB 响应上限 + 域名路径白名单。
- **加密备份**：AES-256-GCM + scrypt，写临时文件→自校验→原子替换→失败回滚；恢复校验 manifest 与路径穿越。

**问题（按严重度）**
1. **模型 baseUrl 无 SSRF/重定向防护（高危）**：`saveAiSettings` 的 URL 仅验协议，AI 请求 `fetch` 默认跟随重定向且无地址校验——若渲染进程被 XSS 控制，可把请求指向任意端点并外泄 `Authorization: Bearer <API key>`，且公网恶意服务可 302 跳内网。与榜单采集的强防护形成鲜明对比。
2. 模型错误信息透传：`providerError` 将服务端 detail 前 300 字符带入异常并回传渲染进程。
3. 自动更新实际不可用：`electron-updater` 未配置 publish 源，`checkForUpdates` 失败被吞；未启用签名强制校验。
4. 次要：`openExternal` 不拦私网地址（低危）；`getWorkspacePath` 向渲染进程暴露完整路径。

### 3.5 产品/领域设计 9.0/10

**亮点**
- **完整商业写作方法论落地**：番茄分类学（37 个题材，手写种子含核心幻想/开篇抓手/禁忌）、六题材插件（冲突引擎/回报阶梯/疲劳规则/账本模板）、中国商业网文知识库（带平台官方与作者经验证据溯源）、六步商业叙事循环。
- **人工门禁链**：契约未审批不能生成 → 规划批准门禁 → 关键章/卷界/重大状态变化/事实冲突强制逐章 → 硬性问题未解决不能定稿 → 已批准内容修改必须先批准变更单（版本号+快照双重校验）→ AI 只产出候选不自动定稿。这是 AI 写作工具最稀缺的"人机边界"设计。
- **本地优先与隐私隔离**：研究样本与创作数据物理隔离、云端拆书仅发脱敏片段（角色/地名稳定替换为占位符）、原创度指纹本地比对、文风统计只用本项目正文。
- **上下文工程**：11 区块最小上下文（契约+商业指引+滚动 30 章纲+近 5 章摘要+文风统计+期待账本+知情范围）、诊断元数据不进模型、token 预估与成本预览。

**问题**
- 领域设计完全散落在代码中，无 `docs/` 目录沉淀（仅 README 摘要），知识库的更新迭代缺少文档化路径。

### 3.6 工程实践 6.5/10

**亮点**
- CI 两段式：`verify`（test+build+e2e+Electron 冒烟）→ `release-windows`（v* 标签触发、证书签名、GitHub Release + latest.yml 更新通道）。
- 结构化 JSON 日志（脱敏+诊断包导出）、AI 审计留存（90 天/5000 条）、自动更新前强制加密快照、版本化安装包。

**问题**
- **0 个 git tag**：6 个版本安装包从未走 Git 发布流程，`release-windows` 流水线实际未跑过。
- 无 license/repository/engines 元数据；无 AGENTS.md/.editorconfig。
- 工作区约 **2.5GB 构建残留**（release 1.5G + release-inspect/p2-verify/unpacked-test 各 300M+ + node_modules.partial 15M + dev-*.log），虽被 .gitignore 覆盖但污染磁盘。
- 单作者两天 73 提交（refactor 占 52%），反映"集中突击 + 事后重构"的开发模式，可追溯性有限。

## 四、验证实测记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | ❌ 1 个错误：`browser-api.ts` 缺 `analyzeNovelRevision`/`applyNovelRevision`（novel-revision 功能桌面端已接、浏览器端未接，WIP 断点） |
| 单元/集成 | `npm test` | ✅ 60 文件 / 310 用例通过，12.1s |
| 质量/提示词基准 | `npm run test:quality` | ✅ 6 文件 / 15 用例通过 |
| 容量测试 | `npm run test:scale` | ✅ 10 书 × 1500 章 × 300 万字通过，112.8s |
| e2e / Electron 冒烟 | `npm run test:e2e` / `test:electron` | 未运行（需 Playwright 浏览器环境，CI 已覆盖） |

## 五、风险清单

| 优先级 | 风险 | 位置 |
|---|---|---|
| 高 | 模型 baseUrl 无 SSRF/重定向防护，API 密钥可经恶意端点外泄 | `electron/ai-service.ts:559-581`、`ipc-validation.ts:16` |
| 高 | novel-revision 未完成导致 `npm run build` 与 CI verify 当前失败 | `src/lib/browser-api.ts:478` |
| 中 | 指纹函数双实现不一致，原创度比对结果依赖调用路径 | `database.ts:1571` vs `research-repository.ts:6` |
| 中 | `saveIssues` 等多处写操作无事务包裹，部分失败留半写状态 | `database.ts:958-973` |
| 中 | 自动更新通道未配置，升级功能形同虚设 | `update-service.ts`、`package.json` build |
| 低 | 错误分类依赖中文文案、无 lint、无覆盖率门禁，回归风险随规模增长 | 多处 |
| 低 | 工作区 2.5GB 构建残留 | 根目录 |

## 六、改进建议（按性价比排序）

1. **补上模型请求的 SSRF 防护**（复用 `ranking-service.ts` 的 `assertPublicHttpUrl` + `redirect: "manual"`），封堵唯一高危弱点。
2. **完成 novel-revision 浏览器端接线**，恢复 `npm run build` 绿灯；同时把 `AppApi` 三份实现收敛为"类型 + preload 生成器 + browser 适配器"。
3. **引入最小 lint 配置**（biome 或 eslint），并给中文字面量状态建立 `as const` 单一数据源。
4. **启用 axe 扫描**（依赖已装），补齐 SSRF/凭据/备份路径穿越安全测试。
5. **为 6 个已有版本补打 tag 走通 release 流水线**，配置自动更新发布源与 `forceCodeSigning`。
6. **清理构建残留目录**（release-inspect/release-p2-verify/release-unpacked-test/node_modules.partial），约回收 2.5GB。
7. **拆分超大文件**：优先 `ai-service.ts`（按任务域拆）与 `database.ts`（按聚合根拆），并统一指纹/`now()`/`compact` 等重复工具。
8. 建立 `docs/` 沉淀领域知识库与门禁规则，补 license/repository 元数据。

## 七、结论

这是一个**领域理解深度显著高于平均水准**的垂直工具：完整商业网文方法论、严格的"人机边界"门禁、本地优先隐私设计、以及质量/提示词/容量三重自动化基准，都达到甚至超过许多商业团队的水准；3.2 万行代码配 310 个全绿用例，工程执行扎实。扣分集中在**收尾工程**：无 lint、0 tag、巨型单文件、一处真实 SSRF 弱点与一处 WIP 断点。若按上述建议补齐，项目可以稳定站上 8.5+ 分。

**综合评分：7.9 / 10**
