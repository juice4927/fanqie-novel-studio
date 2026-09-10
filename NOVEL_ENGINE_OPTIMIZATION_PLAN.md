# 长篇写作引擎优化方案（按需注入 · 记忆检索 · 可信评测）

状态：已实施（2026-09-09）。日期：2026-09-09。
依据：2026-09 生态调研（SillyTavern / Novelcrafter / AI Dungeon / Sudowrite / webnovel-writer / tianming / Narrative World Model / WebNovelBench / EQ-Bench 等，见附录 A）。

---

## 1. 背景

### 1.1 调研结论

小说写作 AI 已从"一句话生成一本"转向三件工程化的事：

1. **按需注入**：设定不是全量塞进上下文，而是"被正文提到才注入，并按生效区间与揭示进度过滤"（SillyTavern World Info、Novelcrafter Codex、AI Dungeon Memory System）。
2. **状态优先于上下文**：正文之外维护机器可校验的状态，模型读状态而不是读"记忆"（tianming 15 维快照、webnovel-writer 合同/提交 + 派生投影、NWM 因果发布流）。
3. **可信评测**：绝对分不可比，改用"与人类网文分位对照 + 成对比较 + 频率校准"（WebNovelBench、EQ-Bench 长文基准、LLM-judge 偏差研究）。

本项目三者都有雏形（预算化上下文、事实账本、质量基准），差距在"按位置取"而非"按查询取"，以及评测不可比。

### 1.2 现状与差距

| 能力 | 现状（代码事实） | 业界成熟做法 | 差距 |
| --- | --- | --- | --- |
| 设定注入 | `context-compiler.ts:178` 契约长列表按预算截断并标注省略；`CONTEXT_WINDOW_PLAN.md:219` 记录"专名命中/常驻标记"未实现 | Novelcrafter Codex：别名提及检测 + 四档 AI 策略 + Progressions；SillyTavern World Info：触发键 + 生效计时 | 未提及的长列表条目与本章关键条目等价处理，关键设定可能被截掉 |
| 上下文顺序 | `renderContextForPrompt`（`context-compiler.ts:391`）按 `CONTEXT_SECTION_TITLES` 输出：`chapterIntent` 最前、`contract` 第三；`ai-service.ts:1758` 的 user 里【本章】在【写作上下文】之前 | 稳定前缀在前、动态在后、任务贴近生成点；稳定块独立成 system 块 | 契约（实测约 3.4 万字符）每章重新 prefill，供应商前缀缓存全失效 |
| 记忆检索 | `buildLongTermMemory`（`summaries.ts:180`）固定取 全书 + 当前卷 + 最近 3 个阶段；`relevantFacts` 按调用方顺序 `slice(0, factLimit)` | Generative Agents：相关性 × 重要性 × 时间衰减；RAPTOR：摘要树统一打分 | 按位置取，非按查询取 |
| 状态回写 | `LedgerFact` 已有 `validFromChapter/validToChapter/knowledgeScope/confidence`（`types.ts:323`），`fact-service.ts` 有冲突裁决 | tianming：机器可读 CHANGES + 引用 ID 校验 + 新增实体阈值；Mem0：ADD/UPDATE/DELETE/NOOP | 缺"每章变更声明的结构化校验" |
| 评测 | 12 个固定 fixture + 绝对分门槛 90（`quality-benchmark-corpus.ts:12`）；`compareQualityBenchmarkVersions` 做阈值比较 | EQ-Bench 长文基准按章评"剧情/人物一致/遵循章纲"；WebNovelBench 映射人类分位；成对比较 + 长度控制 | 绝对分跨模型/跨版本不可比，无分位、无成对、无置信区间 |
| AI 味 | `prose-temperature.ts` 只有具身情绪/感官密度 | 频率比校准的有效特征集；blocking/advisory 分级 + 白名单 | 无句式级检测，且流行词表部分统计上反向 |

---

## 2. 目标与非目标

### 目标

1. 设定从"按预算截断"升级为"按提及 + 生效区间 + 揭示进度注入"，关键设定不再因预算丢失。
2. 上下文布局缓存友好，降低单章输入成本与首字延迟。
3. 记忆检索按查询打分，长篇召回质量提升。
4. 质量评测可比、可回归、与人类网文分位对齐。
5. 全部改动不触碰人工门禁与硬门禁边界（AGENTS.md 规则 1/5/7）。

### 非目标（本次不做）

- 不做全自动多智能体写作；AI 仍只产出草稿，定稿/改纲/发布仍由作者确认。
- 不引入云端向量或云端评测服务；检索与裁判全部走现有路由。
- 不把统计指标变成硬门禁；新增指标默认只作观察。
- 不重构现有契约/账本数据模型：新增表与字段，不改旧字段语义。

---

## 3. 设计

### 3.1 阶段一（P0）：上下文分层与稳定前缀

**问题**：契约是最大且最稳定的段（实测约 3.4 万字符），却排在 `chapterIntent`、`rollingOutline` 之后。供应商前缀缓存要求从第一个 token 起完全一致（Bedrock/OpenAI 文档：tools → system → messages 顺序检查，改动靠前段会失效靠后段），因此当前顺序下契约每章都要重新 prefill。

**设计**：

1. 新增 `src/shared/context-layout.ts`：

```ts
export type ContextBand = "stable" | "slow" | "fast" | "task";
export const CONTEXT_LAYOUT: ReadonlyArray<{ key: ContextContentKey; band: ContextBand }> = [
  { key: "contract", band: "stable" },
  { key: "volumeGoal", band: "slow" },
  { key: "longTermMemory", band: "slow" },
  { key: "commercialGuidance", band: "fast" },
  { key: "expectationLedger", band: "fast" },
  { key: "recentSummary", band: "fast" },
  { key: "relevantFacts", band: "fast" },
  { key: "rollingOutline", band: "fast" },
  { key: "authorStyle", band: "fast" },
  { key: "forbiddenKnowledge", band: "fast" },
  { key: "chapterIntent", band: "task" },
];
```

2. `renderContextForPrompt` 改为按 `CONTEXT_LAYOUT` 渲染，标签仍取 `CONTEXT_SECTION_TITLES`。裁剪优先级（业务重要性）与渲染顺序解耦，`TRIM_ORDER` 不动。

3. **书级稳定块进 system**：`electron/ai-service.ts` 新增 `compileStableBookContext(context)`，把 `contract` 段拼进 system 提示末尾（在任务角色说明之后）；user 消息里该段置空。三个调用点（`ai-service.ts:1767 / 1901 / 1974`）统一走同一函数。
   - 契约未审批时稳定块只写"创作契约未审批"，不注入正文，保持现有门禁语义。
   - system 参与本地响应缓存哈希（`ai-service.ts:234` 的 `hashInput(system + user)`），改动会让旧缓存一次性失效，属预期。
   - 小窗口（本地 32k）下稳定块同样受预算约束，沿用现有截断规则。

4. 诊断：`context-diagnostics.ts` 的 `ContextSectionDiagnostic` 增加 `band` 字段，`ContextDiagnostics` 增加 `stablePrefixCharacters`；上下文面板显示"稳定前缀 X 字符 / 本次动态 Y 字符"。

**验收**：

- 单测：`renderContextForPrompt` 顺序等于 `CONTEXT_LAYOUT`；同一项目连续两章的稳定带文本逐字节相同；契约未审批时 system 不含契约正文。
- `tests/prompt-guidance.test.ts:168` 现有顺序断言同步更新。
- 若阶段四已落地：用成对比较验证"稳定块进 system"前后同章质量无显著下降；下降则回退到"稳定块置于 user 最前"（保留 1、2 两小步，风险为零）。

### 3.2 阶段二（P1）：故事条目引擎

对标 Novelcrafter Codex（别名提及检测 + 条目级 AI 策略 + Progressions）与 SillyTavern World Info（触发与生效计时）的成熟部分，做成确定性、可审计、可人工覆盖的注入层。

#### 3.2.1 数据模型

项目库新增迁移 `project-0004-story-entries`（追加在 `electron/database.ts:414` 的迁移数组末尾，沿用稳定 id 约定）：

```sql
CREATE TABLE story_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 人物/地点/物品/势力/设定/伏笔
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',      -- JSON 数组：别名、称呼、绰号
  summary TEXT NOT NULL DEFAULT '',        -- 一行摘要（默认注入）
  detail TEXT NOT NULL DEFAULT '',         -- 详述（预算充足时注入）
  ai_context TEXT NOT NULL DEFAULT 'detected',
    -- always | detected | detected_excluded | never
  effective_from INTEGER NOT NULL DEFAULT 1,
  effective_to INTEGER,                    -- NULL = 开放
  reveal_chapter INTEGER,                  -- 读者可见章（区别于事件发生章）
  known_by TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：知情角色名
  exclusion_terms TEXT NOT NULL DEFAULT '[]',
  source_contract_item TEXT,               -- 溯源，如 keyRelationships:3
  pinned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_story_entries_project ON story_entries(project_id, kind);
```

新仓库 `electron/repositories/story-entry-repository.ts`。

**种子迁移**（幂等）：旧项目首次打开时，从 `keyRelationships / worldRules / majorForces / timelineAnchors / genreSpecificSections[].items` 生成 `ai_context=detected` 条目，`source_contract_item` 记录来源；按 source 键去重，UI 可一键撤销。契约原字段保持不变，仍是作者主视图。

#### 3.2.2 提及检测（确定性，无 AI 调用）

新增 `src/shared/mention-detection.ts`：

```ts
export interface MentionScanInput {
  entries: readonly StoryEntry[];
  chapterNumber: number;
  scanText: string;
  exclusionOverride?: ReadonlySet<string>;
}
export interface MentionHit {
  entryId: string;
  matchedTerm: string;
  matchedIn: "章纲" | "上章末尾" | "草稿";
  position: number;
}
export function detectMentions(input: MentionScanInput): MentionHit[];
```

规则：

1. 扫描文本 = 章纲 + 本章承诺 + 预期回报 + 危机 + 结尾期待 + 上一章正文末 300 字（+ 重新生成时的当前草稿）。
2. 归一化：去空白、全角转半角、英文名大小写不敏感。
3. 命中条件：主名或任一别名以子串出现；`term.length >= 2`；命中 `exclusion_terms` 的整次命中丢弃。
4. 中文无词边界，不做整词匹配（SillyTavern 文档明确建议 CJK 关闭整词匹配）。
5. 用 `includes` 而非构造正则，避免正则注入与回溯。
6. 同一条目多次命中只保留首次位置（用于 UI 高亮），并记录命中次数供预算排序。

#### 3.2.3 注入规则

`context-compiler.ts` 新增 `compileStoryEntries(entries, chapter, scanText, budget)`：

- 生效区间：`effective_from <= chapter.number && (effective_to === null || chapter.number <= effective_to)`。
- `always` / `pinned`：无条件注入。
- `detected`：命中才注入。
- `detected_excluded` / `never`：不注入。
- 揭示控制：`reveal_chapter > chapter.number` 时只注入 `summary`（不注入 `detail`），并在诊断标注"未到揭示章"。
- 知识边界联动：`known_by` 不含本章 POV/主角时，额外注入一行"该角色尚不知情"，并并入 `forbiddenKnowledge` 段。
- 预算：条目段独立配额，排在 `contract` 之后、`relevantFacts` 之前；超预算按 `pinned > always > 命中次数 > updated_at` 保留，省略条数写入诊断。
- 去重：带 `source_contract_item` 的条目与契约段对应条目不同时展开（v1 先不做去重，避免行为叠加）。

#### 3.2.4 UI

- 故事圣经新增"条目"分区：列表 + 编辑（名称/别名/摘要/详述/AI 策略/生效区间/揭示章/知情范围/排除词/常驻）。
- 上下文面板新增"本章激活条目"：命中/未命中、命中位置、注入字数、单次开关（只覆盖本次请求，不改条目）。
- 条目详情显示"全书出现章节"（对正文与章纲做同一次扫描，结果缓存）。

#### 3.2.5 验收

- 单测：别名命中、排除词、最短长度、生效区间、揭示章、`always`/`never`、预算优先级、中文子串。
- 集成：1200 章项目第 600 章，本章提及的条目 100% 注入；未提及且非 `always` 的条目 0 注入。
- `npm run test:scale` 通过；1200 条目规模下扫描 < 50ms/章。

### 3.3 阶段三（P1）：记忆检索按查询打分

新增 `src/shared/memory-retrieval.ts`：

```ts
export interface MemoryBrief {
  chapterNumber: number;
  text: string;               // 章纲 + 承诺 + 回报 + 危机 + 结尾期待
  properNouns: readonly string[];  // 复用阶段二的别名表与专名提取
}
export function rankSummaryNodes(nodes: readonly StorySummary[], brief: MemoryBrief): StorySummary[];
export function rankFacts(facts: readonly LedgerFact[], brief: MemoryBrief): LedgerFact[];
```

- 打分：`score = 0.5 * relevance + 0.3 * importance + 0.2 * recency`（Generative Agents 思路）。
  - relevance：专名命中 + 关键词重叠（TF 简版），不引入向量。
  - importance：`isKeyChapter`、伏笔到期、`major-state-change.ts` 标记加权；缺省 0.5。
  - recency：`exp(-(chapterNumber - node.toChapter) / halfLife)`，halfLife 默认 40 章，可配。
- 摘要树统一打分：对 场景 / 章节 / 十章阶段 / 分卷 / 全书 五层做 collapsed-tree 检索，按分数选节点直到预算（替换 `buildLongTermMemory` 的固定三层）。
- `buildLongTermMemory(summaries, chapterNumber, maxCharacters, selection?)` 新增可选参数；不传时行为与现状完全一致（防回归）。
- `relevantFacts` 改为 `rankFacts(activeFacts, brief).slice(0, factLimit)`；已确认/有冲突的过滤逻辑不变。
- 性能：纯字符串匹配，千级节点 < 10ms；必要时先用章号窗口预筛。
- 接口预留：`relevance` 后续可接本地向量（BGE-zh ONNX + sqlite-vec），本阶段不引入。

**验收**：单测给定 brief 与摘要集合，断言最相关节点入选、无关节点落选；`npm run test:scale` 耗时增幅 < 20%。

### 3.4 阶段四（P2）：可信评测

1. **章节类型 rubric**：`QualityBenchmarkFixture` 增加 `chapterKind?: "开篇" | "蓄势" | "高潮" | "过渡" | "揭秘"`；`evaluateQualityBenchmark` 按类型取权重；新增 `advisoryIssues`（紫辞藻、强行比喻、万能过渡句）只统计不判失败。
2. **成对比较**：新增 `src/shared/pairwise-review.ts`：
   - `compareDrafts({ baseline, candidate, rubric, judge })`：A/B 与 B/A 各判一次；一致则采用；不一致标记"高分歧"交人工裁定（Fair Evaluators 的 Balanced Position Calibration）。
   - 输出：胜者、分歧标记、两次判定原文、两侧字数。
3. **长度控制**：`lengthControlledWinRate(pairs)` 按字数做线性回归残差校正，避免"更长 = 更好"（AlpacaEval-LC 思路，不引入新依赖）。
4. **裁判独立性**：`route-resolver.ts` 增加 `judge` 任务类型；默认与写作模型不同；设置页提示"裁判模型建议与写作模型不同"。
5. **人类分位**：新增 `quality-benchmark-report.ts` 输出分位区间。首版只做 3 维（连贯 / 人物一致 / 文笔），明确标注为观察值、不参与通过判定。
6. **置信区间**：`compareQualityBenchmarkVersions` 增加 bootstrap（重采样 1000 次，95% CI）；差异落在 CI 内不判回归。

**验收**：`npm run test:quality` 通过；新增成对/换序/长度控制/CI 单测；报告含分位与 CI。

### 3.5 阶段五（P2）：AI 味频率比检测

新增 `src/shared/ai-flavor.ts` + `src/shared/ai-flavor-lexicon.ts`（数据文件）：

- 计算"每千字 / 每段频率比"，阈值用人稿语料校准（2026 语料研究，R 值为人稿 vs 模型稿频率比）。
- 纳入的有效特征：段首零回指评论 R=4.4、拟人化喻体 R=7.3、对举结构 R=3.4、顿号并列过密 R=1.8、相邻句结构同构 R=2.0、破折号 R=3.0、冒号滥用 R=3.8、序数词小标题 R=3.1、起首语 R=3.2、译文句式 R=2.6–5.3。
- **明确排除**（统计上无区分或反向，硬禁会让文字更不像人）：正文设问（人类多用 17 倍）、句长均匀度、比喻标记、设问自答、动词名词化。
- 分级：`advisory` 默认；`blocking` 仅限一级禁用词与禁用句式（如"不是 A，而是 B"）。
- 白名单：本书有意的风格片段（按区间或正则）不报。
- 词表来源：社区维护的网文禁用词表 + 替换表，落盘为带 `source` 与校准说明的数据文件，不写死在逻辑里。
- 接入质检面板单独分区；**不进硬门禁**（AGENTS.md 规则 7）。`prose-temperature.ts` 保持不变，两者互补。

**验收**：单测覆盖阈值边界、白名单、排除项；用 10 章人稿 + 10 章模型稿跑一次校准，结果落盘为基线（`tests/fixtures/ai-flavor-baseline.json`）。

### 3.6 后续可选（不在本次范围）

- 发布前预检 + 番茄规则包（每条带 `source` 与 `lastVerified`，作者可改）。
- 投影日志：摘要 / 检索索引 / 向量同步失败可见 + 一键重建（webnovel-writer 做法）。
- 作者改动 diff → few-shot 改写对照（`paragraph-diff.ts` 已有基础），同时作为未来本地模型的偏好数据。
- 爽点/断章类型轮换校验（七类爽点不连续重复、四类合法断章、3 章一小爽 5 章一大爽）。
- 本地向量检索栈（BGE-zh ONNX + sqlite-vec + MMR + BM25 兜底）。
- 每章 token/成本账（`ai_jobs` 已有 `estimated_cost` 字段，只差汇总展示）。

---

## 4. 实施顺序

| 步骤 | 阶段 | 改动 | 内容 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | 一 | `context-layout.ts`、`context-compiler.ts`、`context-diagnostics.ts` | 分带渲染 + 诊断 | 无 |
| 2 | 一 | `ai-service.ts` | 书级稳定块进 system（三处调用点统一） | 1 |
| 3 | 二 | `database.ts`、`story-entry-repository.ts` | `story_entries` 表与仓库 | 无 |
| 4 | 二 | `mention-detection.ts` | 确定性提及扫描 | 3 |
| 5 | 二 | `context-compiler.ts` | 按条目注入替换契约截断 | 3,4 |
| 6 | 二 | 故事圣经 / 上下文面板 | 条目编辑与激活审计 | 5 |
| 7 | 三 | `memory-retrieval.ts`、`summaries.ts` | 打分与摘要树选节点 | 无（可并行） |
| 8 | 四 | `quality-benchmark*.ts`、`pairwise-review.ts` | rubric / 成对 / 分位 / CI | 无（可并行） |
| 9 | 五 | `ai-flavor.ts`、`ai-flavor-lexicon.ts` | AI 味检测与校准 | 无（可并行） |
| 10 | 全部 | `tests/`、文档 | 单测 / scale / quality + 文档同步 | 1–9 |

建议节奏：步骤 1–2 先落地并观测一周（零行为风险、纯收益）；步骤 3–6 为一个完整迭代；7–9 按精力插入。

---

## 5. 验收标准

1. `npm test` 全绿，新增用例覆盖步骤 1–9。
2. `npm run test:quality` 不回归（AGENTS.md 规则 6）。
3. `npm run test:scale`：1200 章项目第 600 章上下文仍在预算内，且本章提及条目 100% 注入。
4. 同一项目连续两章的稳定前缀文本逐字节一致（缓存友好断言）。
5. 人工门禁、硬门禁、隐私边界零改动（diff 审查确认，见附录 B）。

---

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 别名误命中导致上下文膨胀 | 排除词 + 最短长度 + 每章注入条目数上限 + 诊断可见 + 单次开关 |
| 旧项目迁移后条目重复 | 种子迁移幂等（按 source 键去重）+ `source_contract_item` 溯源 + 一键撤销 |
| 稳定块进 system 影响生成质量 | 先做纯渲染重排（零风险）；system 迁移用阶段四的成对比较验证，不通过则回退 |
| 提示词缓存未命中 | 缓存是收益不是依赖；顺序改动无行为风险，先落地再观测命中率 |
| 频率阈值误报 | 阈值来自人稿语料校准并落盘为基线；默认 advisory，不阻断 |
| 评测改动让基准变松 | 硬性召回仍要求 100%；新维度只作观察，不参与通过判定 |
| 打分排序引入抖动 | 打分函数纯确定性（无随机、无时间依赖），单测固定输入输出 |

---

## 7. 实施结果（2026-09-09）

### 已落地

| 阶段 | 实现 | 关键文件 |
| --- | --- | --- |
| 一 | 新增 `CONTEXT_LAYOUT` 分带（stable → slow → fast → task）；`renderContextForPrompt` 按分带渲染并支持 `excludeStable`；新增 `renderStableBookContext`，在写作、质检、修订三个任务的 system 提示尾部注入书级稳定块；诊断新增 `band` 与 `stablePrefixCharacters`，上下文面板显示稳定前缀字数与分段层级 | `src/shared/context-layout.ts`、`context-compiler.ts`、`context-diagnostics.ts`、`types.ts`、`electron/ai-service.ts`、`src/pages/ContextPanel.tsx` |
| 二 | 新增 `StoryEntry`（类型/别名/摘要/详述/AI 策略/生效区间/揭示章/知情范围/排除词/常驻/来源）；确定性提及检测（扫描章纲、上章末尾，重新生成时加扫当前草稿）；按提及与生效区间注入；被条目接管的契约长列表不再平铺；新页面「设定条目」支持增删改与「从契约生成条目」 | `src/shared/story-entry-service.ts`、`mention-detection.ts`、`context-compiler.ts`、`electron/database.ts`、`ipc-validation.ts`、`preload.ts`、`handlers/project-handlers.ts`、`src/lib/browser-api.ts`、`src/pages/StoryEntriesWorkspace.tsx` |
| 三 | 新增 `memory-retrieval.ts`（相关性 × 重要性 × 时间衰减，摘要树 collapsed-tree 选节点，facts 排序）；`buildLongTermMemory` 增加可选 selection 参数（缺省逐字节不变）；编译器改用按查询打分选记忆与事实 | `src/shared/memory-retrieval.ts`、`summaries.ts`、`context-compiler.ts` |
| 四 | 章节类型 rubric（默认权重不变，opt-in 覆盖）、advisory 问题不参与通过判定、bootstrap 置信区间、成对比较（换序 + 高分歧标记）、长度控制胜率、三维分位报告（仅观察）；`judge` 任务类型映射到 review 角色，默认与写作模型分离 | `src/shared/quality-benchmark.ts`、`pairwise-review.ts`、`quality-benchmark-report.ts`、`quality-benchmark-corpus.ts`、`electron/ai/route-resolver.ts` |
| 五 | 新增 AI 味频率比检测（25 条特征，含 blocking/advisory 分级、白名单区间、风险分级）与排除项清单（设问、句长均匀度、比喻标记等统计上反向的特征不检测）；接入桌面端与浏览器端质检观察区，不进入硬门禁 | `src/shared/ai-flavor.ts`、`ai-flavor-lexicon.ts`、`electron/worker.ts`、`src/lib/browser-api.ts` |

### 与方案的偏差（已确认）

1. **设定条目用通用 `records` 集合，不新建表**：项目库现有实体（facts / expectations）都走 `records(collection, id, payload)`，条目沿用同一模式，因此不需要 `project-0004` 迁移，也不需要新仓库文件；写入仍走 `BEGIN IMMEDIATE`。
2. **种子迁移改为作者显式触发**：方案写的是"旧项目首次打开时"自动生成，实施改为在「设定条目」页点「从契约生成条目」。理由是自动改写生成上下文属于隐式行为变更；显式触发幂等、可撤销、可预期。
3. **`known_by` 不做 POV 交集判断**：仓库没有章节 POV 字段，知情范围只作为条目行上的提示渲染，不做自动排除；知识边界仍由事实账本的 `knowledgeScope` 与 `forbiddenKnowledge` 硬约束。
4. **阶段四的裁判设置页提示未做**：`judge` 已映射到与写作分离的 review 角色，但设置页文案涉及设置页改造，留待后续。
5. **阶段一的 system 稳定块未做线上 A/B**：需要真实模型调用。改动本身可用一行回退（去掉 `renderStableBookContext(context)`），建议在下次跑真实生成时用阶段四的 `compareDrafts` 做一次同章成对比较。

### 验证

- `npm test`：119 文件 / 779 通过 / 1 跳过。
- `npm run test:quality`：6 文件 / 25 通过，无回归。
- `npm run test:scale`：1 通过（约 100 秒）；断言 1200 章项目第 600 章"章纲命中的条目 + 常驻条目均注入，且上下文仍在预算内"。
- `npm run build`：通过（typecheck + vite + tsup）。
- `npx biome check`：改动文件无告警。
- 新增用例：分带与稳定前缀、诊断分层、提及检测（别名/排除词/归一化/最短长度）、条目规则与种子、注入选择（always/pinned/detected/detected_excluded/never/揭示章/预算）、条目持久化与编译器端到端、记忆检索打分与选节点、评测 rubric/成对/长度控制/置信区间/分位、AI 味检测与校准基线。

### 后续可选

- 用真实模型跑一次「稳定块进 system」的成对比较（阶段四的 `compareDrafts`）。
- 设置页补充"裁判模型建议与写作模型不同"的提示。
- 条目级「本书出现章节」审计视图（把提及检测结果缓存成列表）。
- 发布前预检（番茄规则包）、投影日志、作者改动 diff → few-shot 改写对照。

---

## 8. 第二轮补完（2026-09-09）

第一轮落地后补齐了"功能写好但用户够不到"和可靠性边界：

| 项 | 实现 |
| --- | --- |
| 条目预算 | `selectStoryEntriesForChapter` 增加字符预算（默认 6000 字，小窗口降到 1200），单条详述超过 600 字截断；按 pinned > always > 命中次数优先保留，至少保留一条 |
| 模型窗口覆盖 | 设置页新增「模型上下文窗口」区，按来源与模型逐条填写；写入能力行 `source=user`，远端清单与探测回写不再用 null 冲掉作者填写的值；浏览器默认窗口同步改为 1M（本地 32k），缩放基准固定 128k |
| 版本对比 | `AiService.judgeChapterDrafts` + `judgeChapterDrafts` IPC + 质检中心「版本对比」视图：选章节与历史版本，换序各判一次，双持平视为一致，结论相反标记高分歧；`judge` 任务类型在设置页显示为「版本对比」 |
| 条目可用性 | 设定条目页新增搜索、类型与 AI 策略筛选、「全书出现章节」审计（章纲与正文合并扫描） |
| AI 味白名单 | 项目级词表（`aiFlavorWhitelist`）随项目详情读写；质检时把词条展开成区间传给 `analyzeAiFlavor`，命中与字数分母都排除；质检中心新增白名单编辑区 |

验证：`npm test` 121 文件 / 794 通过，`npm run test:quality` 25 通过，`npm run test:scale` 通过（约 101 秒），`npm run build` 通过，`npx biome check` 无告警。

仍未做：真实模型 A/B（需要可用端点）、发布前预检、投影日志、作者改动 diff → few-shot 对照、爽点/断章类型轮换、本地向量检索栈、每章成本账。

---

## 附录 A：参考来源

**产品与工程**
- SillyTavern World Info：https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- Novelcrafter Codex：https://www.novelcrafter.com/help/docs/codex/the-codex
- Novelcrafter Progressions：https://www.novelcrafter.com/help/docs/codex/progressions-additions
- AI Dungeon Memory System：https://help.aidungeon.com/faq/the-memory-system
- Sudowrite Story Bible：https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC
- Sudowrite Saliency Engine：https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/saliency-engine/4KL8gFeLZNvk8CEeXpfwB2
- KoboldAI World Info 说明：https://github.com/KoboldAI/KoboldAI-Client/wiki/Memory,-Author's-Note-and-World-Info
- webnovel-writer（合同/提交 + 派生投影）：https://github.com/lingfengQAQ/webnovel-writer
- tianming-novel-ai-writer（状态快照 + CHANGES 门禁）：https://github.com/zy-zmc/tianming-novel-ai-writer
- show-me-the-story（大纲先审 + 伏笔回收 + 定点重写）：https://github.com/Nigh/show-me-the-story
- goink（本地向量 + Diff 确认）：https://github.com/sigpanic/goink
- oh-story（AI 味检测器与词表）：https://github.com/zenstory-ai/oh-story-claudecode
- fanqie-novel-skill（番茄规则与替换表）：https://github.com/304769384-png/fanqie-novel-skill

**论文与基准**
- AgentWrite / LongWriter：https://arxiv.org/abs/2408.07055
- DOC：https://arxiv.org/abs/2212.10077
- Re3：https://arxiv.org/abs/2210.06774
- Dramatron：https://arxiv.org/abs/2209.14958
- WriteHERE：https://arxiv.org/abs/2503.08275
- RecurrentGPT：https://arxiv.org/abs/2305.13304
- MemGPT / Letta：https://arxiv.org/abs/2310.08560
- Generative Agents：https://arxiv.org/abs/2304.03442
- RAPTOR：https://arxiv.org/abs/2401.18059
- Mem0：https://arxiv.org/abs/2504.19413
- Zep（时间知识图谱）：https://arxiv.org/abs/2501.13956
- Narrative World Model：https://arxiv.org/abs/2607.05577
- SCORE（道具状态机）：https://arxiv.org/abs/2503.23512
- WebNovelBench：https://arxiv.org/abs/2505.14818
- WritingBench：https://arxiv.org/abs/2503.05244
- EQ-Bench 长文基准：https://github.com/EQ-bench/longform-writing-bench
- MT-Bench / LLM-as-judge 偏差：https://arxiv.org/abs/2306.05685
- Fair Evaluators：https://arxiv.org/abs/2305.17926
- AlpacaEval 长度控制：https://arxiv.org/abs/2404.04475
- Let Me Speak Freely?（结构化输出损害推理）：https://arxiv.org/abs/2408.02442
- Bedrock 提示词缓存：https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
- Azure OpenAI 提示词缓存：https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/prompt-caching

**未核实项（不要当事实引用）**
- NovelAI Lorebook / Context Settings：官方文档在调研环境不可达。
- 番茄官方上传格式、字数、敏感词、首秀规则：官方帮助页为 JS SPA，无法抓取正文；本轮引用均为社区二手来源。
- "NovelBench" / "NovelCritic"：未能检索到对应论文，最接近的可靠工作是 WebNovelBench。

## 附录 B：与 AGENTS.md 红线的对应

| 红线 | 本方案如何保持 |
| --- | --- |
| 规则 1：人工门禁 | 条目注入只影响上下文装配；条目编辑、揭示章、AI 策略均由作者确认；种子迁移可撤销 |
| 规则 2：本地优先 | 提及检测、打分、AI 味检测全部本地确定性计算；不新增云端上传 |
| 规则 3：安全边界 | 不新增网络请求；裁判走现有 `ai-service` 路由与 netguard |
| 规则 4：shared 保持纯净 | 新模块 `context-layout / mention-detection / memory-retrieval / ai-flavor` 全部放 `src/shared/`，不引入 electron 或 React 依赖 |
| 规则 5：事务性 | `story_entries` 写入走 `BEGIN IMMEDIATE`；种子迁移幂等 |
| 规则 6：Prompt/质量改动需证据 | 阶段四先升级基准与置信区间，阶段一/二的提示词改动用成对比较验证 |
| 规则 7：提示词引导不设闸 | 新指标默认 advisory；硬门禁仍只有契约规则、事实冲突、知识边界、原创性、隐私 |
