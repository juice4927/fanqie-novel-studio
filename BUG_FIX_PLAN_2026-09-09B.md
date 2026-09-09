# 新建项目 AI 生成失败：排查与修复方案（2026-09-09 B）

> 现象：v0.6.1 新建项目时 AI 无法生成（`createProjectFromConcept` 报 400）。
> 结论：两个今天引入的问题叠加，测试全绿但真实工作区必挂。
> 状态：**方案已确认，按本文件实施**。

---

## 一、问题 1：严格 JSON Schema 含可选字段 → 模型接口 400

**证据**

- 日志 `%APPDATA%/fanqie-novel-studio/logs/application.jsonl`：
  `createProjectFromConcept` → `expand-book-concept-skeleton` → `https://api.deepseek.com/v1/responses`
  → `400: Required properties must match all properties in the object`（01:12、11:16 各一次，227ms 秒挂）。
- 对照组：同来源、同端点、同 strict 模式，`generate-book-concepts` 在 01:11:07 成功——它的 schema 无可选字段。
- 时间线：00:30 同任务成功 → `3c0fcb1`（00:53:57）给 `BookConceptSkeletonSchema` 加了 `.optional()` 的
  `genreSpecificSections` → 01:12 开始 400。
- 实测 `z.toJSONSchema(BookConceptSkeletonSchema)`：`properties` 6 个键、`required` 5 个、
  `additionalProperties: false`。而 `openai-responses.ts:136` 用 `strict: true`，
  OpenAI 系要求 `required` 覆盖 `properties` 全部键。

**影响面**：`BookConceptSkeletonSchema`、`PlanningReviewSchema`（7 个可选字段）、
`NovelRevisionSchema`（7 个可选字段）；两个来源的 `api_surface` 都是 `openai-responses`，故三类任务全挂。

**改法**

1. 新增 `src/shared/ai/strict-json-schema.ts`：纯函数 `toStrictJsonSchema(schema)`，
   递归把每个对象的 `required` 补成 `properties` 的全部键并固定 `additionalProperties: false`；
   覆盖 `items`/`anyOf`/`oneOf`/`allOf`/`prefixItems`/`$defs` 等嵌套位置。
2. `electron/ai-service.ts:260`：`z.toJSONSchema` 之后套一层归一化（该 schema 只用于 native 模式，
   即 responses 驱动的 `text.format`；chat 的 json-mode 不发 schema）。
3. 语义说明：可选字段在协议层变成必填，模型必须输出；Zod 侧仍是可选，解析不受影响。

**测试**：`tests/ai-strict-schema.test.ts`
- 单元：嵌套对象、对象数组、`anyOf`、幂等性、`additionalProperties`。
- 回归：遍历 `electron/ai-definitions.ts` 全部导出 schema，断言归一化后每个对象
  `required === Object.keys(properties)`；单独断言 `BookConceptSkeletonSchema` 的 `required` 含
  `genreSpecificSections`。

---

## 二、问题 2：迁移按数组下标记账，中间插入 → 老工作区永久跳过

**证据**

- 用户 `catalog.sqlite`：`user_version = 9`（等于当前迁移条数），但 `incubations` 表不存在、
  `projects` 无 `words_per_chapter` 列；直接跑 `SELECT genre, words_per_chapter FROM projects` 报
  `no such column: words_per_chapter`。
- 这两条正是当前迁移数组的 #3、#4，`a2fddc7`（00:45:27）把它们插在 #5 之前，而非追加到末尾。
  `migration-runner.ts` 用 `user_version` 当下标，老库当时已 ≥ 4 → 永久跳过，后续 #5–#9 照跑，
  版本号一路涨到 9。
- 日志实锤：00:30:19 AI 成功后 `createProjectFromConcept` 报
  `table projects has no column named words_per_chapter`；`listIncubations` 到 11:15 仍报
  `no such table: incubations`（12 次）。
- 只有全新工作区（e2e 临时目录）才拿到这两条迁移，所以 `npm test` / e2e 全绿。
- 附带影响：`persistChapterInTransaction`（`database.ts:989`，同提交引入）也读该列，
  保存章节与更新项目设置同样会抛错。

**改法**

1. `electron/migration-runner.ts` 改为**稳定 id 记账**：新增 `schema_migrations(id, applied_at)` 表，
   迁移声明 `{ id, run }`。历史库首次运行按 `user_version` 把前 N 条标记为已应用（一次性），
   此后新增迁移无论写在数组哪个位置，只要 id 是新的就会执行——插入不再造成跳过。
   `user_version` 保留为降级保护（版本高于程序支持则报错）。
2. 新增 `ensureStructure(db, spec)`：幂等补齐缺失的表与列，兜底修复已被跳过的历史库。
   catalog 的结构（建表 DDL + 补列清单）提取为模块级常量，迁移与自检共用同一份定义，避免漂移。
3. `initCatalog` 在 `runMigrations` 之后调用 `ensureStructure(this.catalog, CATALOG_STRUCTURE)`，
   用户工作区下次启动自动修复。

**测试**

- 新增 `tests/migration-runner.test.ts`：`ensureStructure` 补表补列且幂等；id 记账下
  「在数组中间插入的新迁移对已记账的库仍会执行」；`user_version` 播种只发生一次。
- `tests/database.test.ts` 增回归：构造「旧结构 + `user_version = 9`」的 catalog.sqlite →
  打开工作区 → 断言 `incubations` 表与 `words_per_chapter` 列存在、`createProject` 与
  `listIncubations` 可用。

---

## 三、不做的事

- 不调整 `createProjectFromConcept` 的调用顺序（AI 结果有缓存，重试命中缓存不重复计费，
  写库失败无数据损失），保持本次改动聚焦在两个真正的阻塞点。
- 不改质量规则、提示词与任何人工确认门禁。
- 不放松安全边界：新增代码只做 schema 形态归一化与本地结构自检，不涉及出站通道。

---

## 四、验证计划

| 阶段 | 命令 | 通过标准 |
|---|---|---|
| 单测 | `npm test` | 全绿（含新增用例） |
| 构建 | `npm run build` | tsc + vite + tsup 无错误 |
| 数据修复 | 备份后对真实 `catalog.sqlite` 执行同一套幂等 DDL | 表/列就位，`createProject` 可用 |
| 冒烟 | 重启应用 → 新建项目 → 生成方案并创建 | `expand-book-concept-skeleton` 不再 400 |

---

## 五、实施记录（2026-09-09）

**修复 1：strict schema 归一化**

- 新增 `src/shared/ai/strict-json-schema.ts`：`toStrictJsonSchema` 递归把每个对象的
  `required` 补成 `properties` 全部键并固定 `additionalProperties: false`，覆盖
  `properties`/`$defs`/`items`/`anyOf`/`oneOf`/`allOf`/`prefixItems` 等嵌套位置；
  record 类无 `properties` 的自由对象不受影响。
- `electron/ai-service.ts:262` 在 `z.toJSONSchema` 后套用归一化。
- 测试：`tests/ai-strict-schema.test.ts`（20 项）——单元 4 项 + 遍历 `ai-definitions.ts`
  全部导出 schema 断言严格兼容 + `BookConceptSkeletonSchema.required` 含
  `genreSpecificSections`；`tests/ai-service.test.ts` 新增集成断言：gpt-5.1 路由下实际发出的
  `text.format.schema.required` 等于 `properties` 全部键。

**修复 2：迁移按稳定 id 记账 + 结构自检**

- `electron/migration-runner.ts`：`runMigrations` 改为 `{ id, run }` 记账
  （`schema_migrations` 表），历史库按 `user_version` 播种一次；`user_version` 保留为降级保护。
  新增 `ensureStructure(db, spec)` 幂等补齐缺失的表与列。
- `electron/database.ts`：catalog 结构提取为 `CATALOG_TABLES` / `CATALOG_COLUMNS` /
  `CATALOG_STRUCTURE`，迁移与自检共用同一份定义；`initCatalog` 在迁移后调用
  `ensureStructure(this.catalog, CATALOG_STRUCTURE)`。三处迁移数组（catalog 9 / research 2 /
  project 3）全部改为稳定 id。
- 测试：`tests/migration-runner.test.ts`（7 项）——补表补列与幂等、表不存在时跳过、
  **数组中间插入的新迁移对已记账的库仍会执行**、历史库播种一次、失败回滚不记账、降级保护；
  `tests/database.test.ts` 新增回归——构造「旧结构 + `user_version = 9`」的 catalog →
  打开工作区后 `incubations` 表与 `words_per_chapter` 列就位、`listIncubations` 与
  `createProject` 可用。既有「旧章节迁移」用例同步在夹具里清掉 `schema_migrations`，
  以真实模拟只带 `user_version` 的历史库。

**验证**

- `npm test`：**111 文件 / 676 项通过、1 项跳过**（较修复前 +29 项）。
- `npm run build`：tsc + vite + tsup 全部成功。
- 真实工作区修复：备份 `长篇创作工作台数据/catalog.sqlite.bak-20260909033648`（VACUUM INTO
  快照，`integrity_check: ok`）后，用真实 `WorkspaceDatabase` 打开一次 → `incubations` 表与
  `projects.words_per_chapter` 列就位（既有 3 本书各为默认 2500），`schema_migrations` 记录 9 条
  id，`user_version` 保持 9，`listProjects` / `listIncubations` 正常。
- **真实模型调用（已执行）**：用工作区快照（`VACUUM INTO` 到临时目录，不写真实库）走生产接线
  （`WorkspaceDatabase` + `createAiRouteResolver` + Credential Manager 密钥）调用
  `expandBookConcept` → `ai.request.attempt_started → headers_received → first_content →
  attempt_completed`，**无 `attempt_failed`**，36s 返回通过 Zod 校验的骨架
  （DeepSeek `openai-responses` 原生 strict 路径）。
- **新建项目写入（已执行）**：同一快照上 `createProject` 成功，`wordsPerChapter` 2600 正确落库，
  `listIncubations` 正常——确认被跳过的 `words_per_chapter` 列修复后新建项目不再失败。

