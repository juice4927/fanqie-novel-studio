# 架构说明

## 分层与依赖方向

- `src/shared/`：纯领域逻辑，禁止依赖 electron 或 React。章节生命周期、契约/规划/期待/事实/质检等确定性规则都在这里，渲染进程与主进程双端复用。
- `src/pages|components|lib/`：渲染层。`lib/browser-api.ts` 提供浏览器预览用的 `AppApi` 实现（localStorage demo），与 `electron/preload.ts` 的 IPC 实现共享同一 `AppApi` 类型契约。
- `electron/`：主进程。`handlers/` 注册 IPC（ai/project/research/system 四组），`repositories/` 封装数据访问（项目/研究/修订/搜索/AI 审计），`ai-service.ts` 负责模型请求，`worker.ts` 承载文档解析、质检与健康检查。

## 数据层

- 三库隔离：catalog（多书总览）、research（研究样本与榜单）、每项目独立 `project.sqlite`。
- 每项目含 `chapters`/`chapter_contents` 两套 FTS 索引（unicode61 与 trigram），trigram 只收录 ≥3 字符，2 字查询自动回退 LIKE。
- 多语句写操作统一 `BEGIN IMMEDIATE` + `COMMIT`/`ROLLBACK`；涉及项目库与 catalog 的操作用双事务。

## 网络边界

- 所有出站 HTTP 必须走 `electron/netguard.ts`（地址分类、DNS 解析、手动重定向、拒绝私网/本机/带凭据 URL），模型端点与榜单采集同策略。

