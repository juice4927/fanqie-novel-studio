# 从 0 开书 2.0：立项孵化台方案（2026-09-08，v3）

> **目标**：把"从 0 开始创建一本书"从一次性弹窗（填 6 个字段 → AI 出 3 案 → 选 1 案 → 落库）升级为**选项够多、有证据、有体检、可保存、有人工门禁**的立项孵化流程。
>
> **v3 变更**（本次）：新增第五章「从 0 开书的输入面扩充」——把可选面从 4 个维度扩到 14 个；主题材从 6 提到 13（新增继承/覆盖机制，让加题材从 ~130 行降到 ~60 行）；新增二级流派层（60 条）与标签层（榜单驱动）；元素层 21 → 60；新增开局形态、篇幅形态、视角、单章字数等立项维度；分期重排为 8 个阶段。
>
> **v2 内容**（保留）：第四章分类体系扩充；`baselineDelta`；确定性体检卡；孵化台七步。
>
> **不变量**：AGENTS.md 六条规则全部保持。AI 仍只产候选与草稿；契约审批、结构批准、章节定稿仍由人确认；研究数据与创作数据继续物理隔离；所有外呼仍走 `electron/netguard.ts`；`src/shared/` 保持纯净；提示词改动必须带基准证据。
>
> **本文件是方案，不是实施记录。** 确认后再动代码。

---

## 实施进展（2026-09-08 落地，含第二轮补齐与审计修复）

已按本方案实施并全部通过验证：`npm run lint` ✅、`tsc --noEmit` ✅、`npm test` 587 通过 ✅、`npm run test:quality` 16 通过 ✅、`npm run test:e2e` 22 通过 ✅、`npm run test:electron` 2 通过 ✅、`npm run test:scale` 通过 ✅、`npm run build` ✅。

| 阶段 | 状态 | 落地内容 |
|---|---|---|
| 0 分类地基 | 完成 | `src/shared/fanqie-taxonomy/` 拆为 `types/male/female/subgenres/index`；`FanqieCategoryProfile` 扩到 18 手写字段 + `baselineDelta` + `profileVersion`；删除 `categoryComposition()` 模板派生；`FANQIE_CATEGORIES` 改为派生（消除页面重复常量）；`COMMERCIAL_KNOWLEDGE_VERSION` 升 v8 并合并 `baselineDelta`；新增同题材两两不同的防模板测试 |
| 1 分类内容 | 完成 | 37 个分类画像全部手写（男 19 / 女 18，含 8 个 `baselineDelta`）；60 条二级流派（男 32 / 女 28）；元素层 21 → 60（5 组，新增「主角身份」）；叙事类型 10 → 18；`EXPANSION_ROUTES` 覆盖全部 18 项 |
| 2 主题材扩充 | 完成 | 6 → 13：新增科幻末世、悬疑推理、游戏竞技、快穿衍生、青春校园、军事谍战、现实职场；`genre-plugins.ts` 引入 `BASE_GENRE_PLUGINS + GENRE_OVERRIDES` 继承机制；`uniqueMechanisms` 与独有机制断言覆盖 13 个题材 |
| 3 输入面扩充 | 完成 | `NewProjectModal` 改为分组折叠的定位面板：番茄分类、二级流派、开局形态、篇幅形态、视角、叙事类型、题材元素、主角身份、情绪基调、目标字数、单章字数、更新节奏、安全存稿线；新增项目级 `wordsPerChapter`（默认 2500，DB 迁移 v9）并替换 `planning.ts`/`summaries.ts` 的硬编码 |
| 4 概念质量与体检 | 完成 | `IncubationCandidate`（书名候选、开局设计、升级阶梯、可持续性、差异化、建议标签）；6 维差异门禁；`src/shared/incubation-review.ts` 18 项确定性体检（阻断/警告/提示，可人工确认留痕）；创建弹窗内联体检卡 |
| 5 孵化台 | 完成 | `incubations` 表 + 6 个 IPC；多书总览「立项草稿」列表 + 续做；弹窗内「保存为立项草稿 / 更新立项草稿」；`promoteIncubation` 走 AI 骨架 + 建项目 + 回填 `project_id`；**新增独立「立项台」页面**（`src/pages/IncubationWorkspace.tsx`）：草稿列表、6 步步骤条、三案并排对比表（差异行高亮）、体检结论与人工确认、一键采用并创建 |
| 6 证据桥接 | 完成 | `src/shared/category-tags.ts` 聚合本地榜单标签；`getCategoryTags` IPC；弹窗「证据」组展示标签云（占比 + 样本量）；**脱敏洞察包已接入**：`BookConceptInput.evidenceInsightIds` → 主进程按 id 读取洞察包（不碰研究原文）→ 进入三案生成提示词 |
| 7 开书包与引导 | 完成 | 驾驶舱「开书清单」5 步（复核契约 → 审批契约 → 确认全书结构 → 确认前 10 章章纲 → 写第一章）；**新增 `generateLaunchPack`**：契约审批后一键生成 4–8 个宏观阶段、3–6 个分卷骨架与前 10 章章纲，全部为草稿状态（`saveChapter(..., "autosave")` 不产生版本噪声），仍需人工逐项批准 |

### 第二轮审计修复（"接了但没生效"的四项）

| 问题 | 修复 |
|---|---|
| 体检第 16 项「兄弟分类混淆」实际恒为通过：原实现拿 `existingContracts` 的**书名**去比对分类 key，永远匹配不上 | 改为直接用 `getFanqieCategoryProfile` 取兄弟分类画像，比较 `openingMechanism` 与兄弟 `openingFocus`、或子类型+回报与兄弟画像的相似度 |
| 体检第 12 项「同质化」没有调用方传 `existingContracts`，等于空转 | 新增 `listProjectSignatures()` IPC（只返回书名、前提、开局机制的最小指纹），创建弹窗与立项台都传入 |
| 定位卡漏掉 `readerPersona` / `readerPromise` / `commercialBoundary`，这三个字段收集了但进不了提示词 | 补进 `compilePositioningCard`（各自截断），并经 `positioningToConceptInput` 进入三案提示词 |
| `evidence.marketOpportunityKeys` 从未被填充 | 弹窗「证据」组新增「榜单机会」（按所选分类过滤 `getRankingAnalytics` 的机会），勾选后作为 `evidenceNotes` 进入提示词并写入草稿 |

另外把 `PROMPT_VERSION` 升到 `v12-category-profiles`（概念提示词与商业知识库都变了，旧缓存不应复用）。

### 与方案的取舍

1. **开书包放在契约审批之后**，而不是创建瞬间。方案原文写的是"立项时原子写入"，但 `generatePlanning` 现有门禁要求契约已审批（AGENTS.md 规则 1），因此改为驾驶舱里的一键按钮：审批契约 → 生成开书包 → 逐项确认。门禁没有被放松。
2. **孵化台是"草稿管理 + 对比"页而非逐步向导**：定位/证据的编辑仍在创建弹窗内完成（复用同一套表单与校验），立项台负责总览、对比、体检与立项。两处共用 `reviewIncubationCandidate` 与 `positioningToConceptInput`，不会出现两套规则。
3. **洞察包只传脱敏洞察包**：主进程按 id 从研究库读取 `InsightPack`，不读取样本书名、原文或章节，研究隔离边界不变。

### 新增测试

`tests/incubation-review.test.ts`（15 例，覆盖体检 18 项、兄弟分类混淆与同质化两条原本空转的规则、草稿状态机）、`tests/category-tags.test.ts`（3 例）、`tests/creation-options.test.ts`（4 例，含定位卡新增字段与单章字数驱动卷章数）、`tests/browser-incubation-workflow.test.ts`（3 例：候选字段完整性、草稿持久化与 promote 幂等、开书包审批门禁）；`tests/project-handlers.test.ts` 增补洞察透传与开书包门禁；`tests/commercial-knowledge.test.ts` 增补同题材防模板、二级流派完整性、榜单分类单源化断言；`tests/e2e/workbench.spec.ts` 增补「草稿保存 → 立项台三案对比 → 继续编辑」；`quality-benchmark-corpus.ts` 增补科幻末世与悬疑推理两条基准。

---

## 一、结论先行

"选择太少"是准确的，而且比想象的更靠前：**现在从 0 开书能点的选项，一共只有 4 个维度、约 39 个可选项，其中番茄分类在立项时根本不可选。**

| 可选项 | 现状 | 问题 |
|---|---|---|
| 平台主题材 | 6 个下拉 | 科幻末世、悬疑灵异、游戏体育、快穿、谍战全被塞进"都市脑洞" |
| 复合叙事类型 | 10 个复选框，最多选 3 | 缺职场、家庭、养成、探案、建设等现代主轴 |
| 题材元素 | 21 个复选框，最多选 8 | 世界/机制混编，无关系层、情绪层、身份层 |
| 目标字数 / 更新节奏 | 2 个输入框 | 可用 |
| 番茄榜单分类 | **立项时不可选** | 只在故事圣经里出现，还按主题材过滤（`src/pages/StoryBibleWorkspace.tsx:95-97`） |
| 单章字数 | **不可选** | 硬编码 2500（`src/shared/planning.ts:9`、`src/shared/summaries.ts:145`） |
| 安全存稿线 | **不可选** | 有字段，UI 不暴露 |
| 开局形态 / 篇幅形态 / 视角 / 主角身份 | **不存在** | 开局是番茄追读的第一杠杆，现在完全没有维度 |

所以这一版做两件事：

1. **把可选面从 4 个维度扩到 14 个**（第五章），每个维度的选项数量提升 2–3 倍，并保证"选项多、必填少"——只有主题材/分类/字数是必填，其余都有画像默认值或可跳过。
2. **把分类从"37 个榜单分类"扩成"37 个官方分类 + 60 个二级流派 + 200+ 标签"三层**（第四章），同时把主题材从 6 提到 13，并引入继承机制让以后继续加题材的成本降下来。

配套的 37 个分类画像内容底稿已就绪（`FANQIE_CATEGORY_EXPANSION_DRAFT.md`）。

---

## 二、现状链路（代码实测）

### 2.1 入口与两条并行路径

```
多书总览「新建作品」(src/pages/DashboardPage.tsx:50)
└─ NewProjectModal (src/components/NewProjectModal.tsx)
   ├─「AI 从零开书」: genre/targetWords/updateCadence/复合类型/题材元素/自定义方向/seed
   │   ├─ api.generateBookConcepts(input)          electron/ai-service.ts:925
   │   └─ api.createProjectFromConcept(input, 选中案) electron/handlers/project-handlers.ts:65
   │       ├─ ai.expandBookConcept(...)            electron/ai-service.ts:972（人物与世界骨架）
   │       └─ database.createProjectFromConcept    electron/database.ts:455
   └─「手动创建」: 书名 → 空契约（绝大多数字段为空，approved:false）
```

另一条路径藏在**项目内部**：`ProjectDashboard` 的「立项洞察」区（`src/pages/ProjectDashboard.tsx:243-343`），要求先关联脱敏洞察包，才可 `generateConcepts`（`electron/handlers/ai-handlers.ts:322`）。它产出的是**更薄的** `CandidateSchema`（`electron/ai-definitions.ts:59-73`），"采用此方向"只把 3 个字段写回契约并改名。两条路径互不联通，schema 也不一致。

### 2.2 从零开书实际产出了什么

| 产物 | 来源 | 状态 |
|---|---|---|
| 项目摘要（标题/题材/目标字数/更新节奏/安全存稿线） | 输入 | 状态固定为"候选立项"（`src/shared/project-service.ts:51`） |
| 契约草案（premise、开局机制、成长载体、核心回报、长篇发动机、结局、读者承诺、禁写清单…） | `BookConceptSchema`（`electron/ai-definitions.ts:75-99`） | `approved:false` |
| 人物与世界骨架 | `BookConceptSkeletonSchema`（`:108-114`） | 写入同一契约草案 |
| 番茄目标分类 | — | **空字符串**（`src/shared/project-service.ts:64`） |
| 单章字数 | — | **硬编码 2500** |
| 阶段/分卷/章纲 | — | **无**，需用户自己到规划台点「AI 生成规划草稿」 |
| 第一章/黄金三章 | — | **无** |

契约可审批的最低要求见 `src/shared/contract-service.ts:62-81`。由于概念 + 骨架已覆盖这些字段，**AI 一次生成的契约通常立刻就能通过审批**——这恰恰是问题：没有任何环节检验它值不值得被批准。

### 2.3 现有的质量门禁只有两条

- `conceptDiversityIssues`（`electron/ai-definitions.ts:193-240`）：子类型/开局机制/成长载体/主要回报四维中至少三维完全去重，且两两 ngram 相似度 < 0.68。
- `conceptDefaultMotifIssues`（`:130-174`）：作者没提债务时，禁止欠债/讨债/账目母题。

---

## 三、诊断：为什么"过于简单"

按对成书质量的影响排序：

1. **可选面太窄（v3 强化）**。4 个维度、约 39 个选项，且番茄分类、单章字数、安全存稿线在立项时都拿不到。作者能表达的创作意图被压在"题材 + 元素 + 一句话灵感"里。
2. **开局设计缺席**。番茄的追读由前三章决定，而 schema 里只有一个 120 字以内的 `openingMechanism`；没有首章钩子、前三章承诺、首个回报落点，也没有开局形态这个维度。
3. **长篇发动机不可检验**。`longFormEngine` 是自由文本，没有结构化升级阶梯，无法判断它撑不撑得住目标字数。
4. **研究证据接不进来**。榜单已经能算出 `MarketOpportunity`、洞察包已脱敏，但从零开书路径一个都不用。
5. **番茄分类在立项时是空的**。`fanqieCategoryKey: ""` 导致 `compileCommercialGuidance` 走"尚未选择"降级分支（`src/shared/commercial-knowledge.ts:120-125`），分类级知识不参与概念生成。
6. **书名与标签没有设计**。`title` 只有一个候选，没有候选集、没有理由、没有标签建议。
7. **没有商业可行性体检**。主角欲望、回报变现、结局兑现、元素过量、平台禁忌、同质化全无检查。
8. **三案不可对比、不可回退、不可局部重写**。弹窗一关三案就没了。
9. **落库即壳**。没有结构、没有章纲、没有首章；驾驶舱里程碑从"关联洞察"开始。
10. **手动模式是死胡同**。
11. **立项过程不可留存**。
12. **分类画像雷同**。37 个分类中 6 个关键字段由模板生成（`src/shared/fanqie-taxonomy.ts:462-471`），同题材分类建议几乎相同。
13. **分类数据有两个源**。`FANQIE_CATEGORIES`（`src/pages/ResearchRankingModals.tsx:7-49`）与 taxonomy 种子重复，且由 UI 页面导出。
14. **单章字数写死**。`planning.ts:9` 与 `summaries.ts:145` 都按 2500 估算；写 1800 字/章的女频书，卷章数会被算错。

---

## 四、分类体系扩充

### 4.1 四层盘点

| 层 | 常量 / 文件 | 规模 | 谁在用 | 现状问题 |
|---|---|---|---|---|
| L1 平台主题材 | `GENRES`（`src/shared/types.ts:14`）+ `GENRE_PLUGINS`（`src/shared/genre-plugins.ts`） | 6 插件 / 18 子类型 | 项目摘要、契约、全部提示词 | 粒度太粗：37 个分类里约 15 个落在"都市脑洞"；科幻末世、悬疑灵异、游戏体育共享同一套"高概念进入现实"基线 |
| L2 番茄榜单分类 | `FANQIE_CATEGORY_PROFILES`（`src/shared/fanqie-taxonomy.ts`） | 37（19 男 + 18 女） | 榜单抓取、故事圣经下拉、`compileCommercialGuidance`、语义质检 | 8 个手写字段 + 6 个模板派生字段；`categoryComposition()` 按名字猜类型；UI 有重复常量 |
| L2.5 二级流派 | **不存在** | 0 | — | 读者实际按流派/标签找书，这一层完全缺失 |
| L3 复合叙事类型 | `NARRATIVE_GENRES`（`src/shared/genre-composition.ts:1`） | 10 | 概念 schema 枚举、契约、规划 | 缺职场、家庭、养成、探案、建设等主轴 |
| L4 题材元素 | `GENRE_ELEMENT_GROUPS`（`genre-composition.ts:16`） | 21（2 组） | 概念生成、契约 | 数量少、维度混编、无关系/情绪/身份层 |

**核对结论**：线上 `https://fanqienovel.com/rank` 的 37 个分类（含 categoryId）与仓库种子**完全一致，无缺漏**。所以"分类少"不是榜单分类缺，而是：①主题材太粗；②没有二级流派层；③分类画像内容雷同；④立项时根本选不到分类。

### 4.2 三个具体缺陷（附证据）

1. **同题材分类画像高度雷同**。`fanqie-taxonomy.ts:462-471` 的 `conflictEngine`/`payoffPattern`/`expansionAxis`/`fatigueSignal`/`qualityChecks` 是模板字符串；`expansionRoutes` 由 `categoryComposition(name)`（`:420-438`）猜出。女频"种田"与"年代"的扩张建议完全一样。
2. **按名字猜分类会误判**。带"悬疑/灵异"→"悬疑+冒险"，带"科幻/末世"→"生存+冒险"；`男频:718 动漫衍生` 被归为"宗门升级 + 玄幻/仙侠"。
3. **两个数据源**。`FANQIE_CATEGORIES` 与 taxonomy 种子重复。

### 4.3 动作 A：分类成为立项主键

- 孵化台第一步选**番茄分类**（37 全量可选，不按主题材过滤），`Genre` 由 `profile.genre` 派生。
- 快速开书 / 手动创建保留"只选主题材"的旧路径，行为不变。
- 好处：37 个分类直接成为立项入口；不需要为每个分类写 Genre 插件。

### 4.4 动作 B：画像从"8 手写 + 6 模板"补全为"18 手写"

```ts
interface FanqieCategoryProfile {
  // 保留（8 个手写字段）
  key; channel; categoryId; name; genre;
  recommendedSubtype; coreFantasy; audience; openingFocus; taboo;

  // 现有字段改为手写（原为模板派生）
  conflictEngine; payoffPattern; expansionAxis; fatigueSignal;
  qualityChecks; narrativeGenres; genreElements; expansionRoutes;

  // 新增（10 个手写字段）
  tags: string[];
  siblingCategories: string[];
  readerAgeBand: string;
  chapterHookStyle: string;
  firstPayoffWindow: [number, number];
  payoffCadence: string;
  typicalChapterWords: [number, number];
  commonOpenings: string[];
  clicheTraps: string[];
  differentiationAngles: string[];
  baselineDelta?: CategoryBaselineDelta;
  profileVersion: string;
}
```

删除 `categoryComposition()` 与全部模板生成。**完整示例与 37 类内容见 `FANQIE_CATEGORY_EXPANSION_DRAFT.md`**（已补全，含 8 个 `baselineDelta`）。

### 4.5 动作 C：分类基线覆盖 `baselineDelta`

```ts
interface CategoryBaselineDelta {
  readerPromise?: string;
  coreFantasies?: string[];
  tabooBoundaries?: string[];
  conflictEngines?: string[];
  rewardLadder?: string[];
  fatigueRules?: string[];
}
```

合并规则（在 `compileCommercialGuidance` 与 `compileChapterGuidance` 内统一实现）：主题材基线先渲染 → 分类覆盖字段以"本书分类优先"追加；同名字段以分类为准。用于解决"科幻末世被都市脑洞基线带偏"。

### 4.6 动作 D：标签层（榜单驱动，不编造）

- `RankingEntry.tags`（`src/shared/types.ts:77`）已从公开榜单页采集（`electron/ranking-service.ts:224`），只是从未被聚合。
- 新增 `src/shared/category-tags.ts`：`aggregateCategoryTags(snapshots, categoryKey) → CategoryTagStat[]`（tag / count / share / newEntrantShare / avgRank）。
- 孵化台「证据」步展示标签云（样本量 + 日期 + 置信度），可勾选；无数据时回退人工标签并标注来源。

### 4.7 动作 E：主题材 6 → 13（v3 新增，从可选升为核心）

**先解决架构成本**：新增 `extends` 继承机制，让新主题材只写差异。

```ts
type GenrePluginOverride = {
  id: string;
  genre: Genre;
  extends: Genre;
  overrides: Partial<Omit<GenrePluginDefinition, "id" | "genre">>;
};
// GENRE_PLUGINS 仍在模块加载时构建完成（BASE + OVERRIDES 合并），
// 所有现有调用点（ai-service / StoryBibleWorkspace / tests）无需改动。
```

新增 7 个主题材：

| 新主题材 | 吸收分类 | 继承基线 | 必须覆盖的重点 |
|---|---|---|---|
| 科幻末世 | 男频:8、女频:8 | 都市脑洞 | 灾变生存、资源账、规则揭秘、群体秩序 |
| 悬疑推理 | 男频:539、751、女频:539、747 | 都市脑洞 | 证据链、禁忌规则、真相节奏 |
| 游戏竞技 | 男频:746、女频:746 | 都市脑洞 | 训练、赛制、团队位置 |
| 快穿衍生 | 女频:24、1015、男频:1016、718 | 都市脑洞 | 单元剧结构、同人边界、主线谜团 |
| 青春校园 | 女频:749 | 现言甜宠 | 校园关系、成长目标、家庭背景 |
| 军事谍战 | 男频:504 | 历史/架空 | 情报成本、潜伏身份、组织纪律 |
| 现实职场 | 女频:750、745 | 现言甜宠 | 行业逻辑、权责边界、职业成长 |

成本：继承后每个新题材约 60–80 行（子类型、母题、禁忌、冲突引擎、回报阶梯、扩张轴、疲劳规则、账本模板、规划检查、质检点需显式覆盖；`stages` 可继承或按阶段覆盖），而不是现在的约 130 行。配套测试：

- 新增题材的 `id` 含版本号、字段数量满足 `tests/commercial-knowledge.test.ts:14-30` 的下限；
- 新增题材与父题材的解析结果必须在 ≥6 个字段上不同（防止空覆盖）；
- 更新 `tests/commercial-knowledge.test.ts:41-59` 的 `uniqueMechanisms` 映射（每个题材一条独有机制断言）。

### 4.8 动作 F：新增二级流派层（37 → 37 + 60，v3 新增）

读者在番茄是按**流派/标签**找书的，榜单分类只是统计口径。新增一层：

```ts
interface FanqieSubGenreProfile {
  id: string;
  name: string;
  channel: FanqieChannel;
  parentCategoryKeys: string[];   // 归属的榜单分类（可多个）
  genre: Genre;                   // 通常继承父分类
  coreFantasy: string;
  openingFocus: string;
  commonOpenings: string[];
  clicheTraps: string[];
  differentiationAngles: string[];
  typicalTags: string[];
  typicalChapterWords: [number, number];
  firstPayoffWindow: [number, number];
  source: "人工维护" | "榜单聚合";
  updatedAt: string;
}
```

首批 60 条（男 32 / 女 28），清单与定位见 `FANQIE_CATEGORY_EXPANSION_DRAFT.md` 附二：

- **男频 32**：东方玄幻、异世大陆、王朝争霸、高武世界、洪荒封神、神话修真、剑修、丹修、都市异能、都市生活、异术超能、娱乐明星、商战职场、神豪、星际文明、时空穿梭、未来世界、末世危机、超级科技、赛博朋克、穿越争霸、权谋朝堂、边关军旅、技术兴国、电子竞技、虚拟网游、体育竞技、侦探推理、诡秘悬疑、探险生存、规则怪谈、民俗怪谈
- **女频 28**：宫斗、宅斗、权谋、医妃、田园、重生复仇、替嫁、女强、豪门总裁、先婚后爱、破镜重圆、职场婚恋、青春甜宠、娱乐圈、婚恋家庭、追妻火葬场、玄幻言情、仙侠奇缘、穿越奇情、异能超能、星际言情、校园、成长、治愈、暗恋、女性悬疑、民国悬疑、推理言情

用法：立项定位面板里作为**二级下拉/多选**（最多选 2 个），进入提示词与体检；标签云仍来自榜单数据，两者互补（流派是"写什么"，标签是"怎么卖"）。

### 4.9 动作 G：元素层与叙事类型扩充

**G1 元素层 21 → 60**，分 5 组（新增"主角身份"组）：

| 组 | 数量 | 元素 |
|---|---|---|
| 世界与时代 | 14 | 现代都市、古代、民国、年代、校园、职场、娱乐圈、乡村、末世、星际、架空王朝、江湖、修仙界、异世界 |
| 故事机制 | 18 | 重生、穿越、系统、签到、直播、模拟器、回收站、神豪、探案、规则怪谈、无限流、种田、经商、无CP、先婚后爱、多主角、单元剧、群像 |
| 人物关系 | 10 | 师徒、兄弟、家族、群像、双强、契约关系、破镜重圆、养成、宿敌、搭档 |
| 情绪基调 | 8 | 热血、轻松、甜宠、虐恋、悬疑紧张、治愈、沙雕、冷峻 |
| 主角身份（新） | 10 | 学生、职场新人、店主/创业者、医生、教师、军人、警察/调查员、艺人/主播、匠人、继承人 |

旧值 21 项全部保留。

**G2 叙事类型 10 → 18**：新增 职场、家庭、养成、探案、建设、争霸、救赎、日常。每个新增类型要在 `EXPANSION_ROUTES`（`fanqie-taxonomy.ts:407-418`）补一条扩张路线。影响 `BookConceptSchema` enum（`electron/ai-definitions.ts:82`）与 IPC 校验（`electron/ipc-validation.ts:17`），新增枚举值向后兼容。

### 4.10 数据源与合规

| 数据 | 来源 | UI 标注 |
|---|---|---|
| 榜单分类名与 categoryId | 线上公开榜单页（已核对） | 平台官方 |
| 二级流派 | 本项目维护 | 人工维护，非平台官方 |
| 标签 | 用户已采集的公开榜单页 | 标注样本量与日期 |
| 读者画像、字数区间、回报窗口 | 经验参考 | 经验参考 |

不新增网络请求；不抓取未公开接口；不伪造平台官方标签。

### 4.11 迁移与兼容

- 榜单分类 `key` 保持不变 → 已有项目 `fanqieCategoryKey` 全部继续有效，无需数据迁移。
- 新增字段可选/有默认 → 旧数据读取不受影响。
- **单源化**：删除 `FANQIE_CATEGORIES`，由 taxonomy 派生；更新 `ResearchPage.tsx` 与 `ResearchRankingModals.tsx`。
- 新增 `Genre` 值：`GENRES` 数组是唯一枚举源（`electron/ipc-validation.ts:16` 用 `z.enum(GENRES)`），新增值自动生效；旧版本应用无法读取新题材数据，需在发布说明中提示。
- `COMMERCIAL_KNOWLEDGE_VERSION` 升 v8，画像与流派加 `profileVersion`。

### 4.12 校验与测试

1. 37 个分类 key 唯一；`categoryId` 频道内唯一；`key === channel:categoryId`；
2. 18 个字段非空；`qualityChecks` 恰好 4 条；`tags`/`commonOpenings`/`clicheTraps`/`differentiationAngles` 各 ≥3 条；
3. `narrativeGenres ⊆ NARRATIVE_GENRES`；`recommendedSubtype ∈ GENRE_PLUGINS[genre].subtypes`；
4. **同一 `genre` 下分类的 `conflictEngine`/`payoffPattern`/`expansionRoutes` 两两不同**（防模板退化）；
5. `siblingCategories` 指向存在的 key；`firstPayoffWindow`/`typicalChapterWords` 区间合法；
6. `FANQIE_CATEGORIES` 派生结果与 taxonomy 一致；
7. **60 条二级流派**：id 唯一、`parentCategoryKeys` 有效、`source` 标注、五字段非空；
8. **13 个主题材**：每个解析结果字段满足下限，且与其父题材在 ≥6 个字段上不同。

回归语料：12 个代表分类 + 4 个新主题材 + 4 个二级流派，加入 `src/shared/quality-benchmark-corpus.ts`，跑 `npm run test:quality` 对比基线。

### 4.13 提示词注入预算与优先级

- 单次注入分类画像上限 **1500 字符**；二级流派 ≤400 字符；标签 ≤200 字符。
- 超出按优先级裁剪：定位 > 开局 > 回报与阶梯 > 边界 > 标签/读者画像。
- 概念/规划/质检用全量；正文任务只注入定位 + 开局 + 边界（保持 `compileChapterGuidance` 按需原则）。

---

## 五、从 0 开书的输入面扩充（v3 新增）

### 5.1 设计原则

1. **选项多，必填少**：只有主题材/分类/目标字数是必填；其余有画像默认值，可一键"用分类推荐"。
2. **每一层都有默认来源**：二级流派、开局形态、情绪基调等默认取所选分类画像的值。
3. **不增加操作负担**：定位面板分组折叠，快速开书只展开 3 组（题材 / 定位 / 规模），孵化台逐步展开。
4. **勾选项压缩成一句定位卡**（≤400 字符）注入提示词，原始结构化 JSON 附后，避免提示词随选项数线性膨胀。

### 5.2 维度扩充表

| # | 维度 | 现状 | 目标 | 默认值来源 | 进提示词 |
|---|---|---|---|---|---|
| 1 | 频道 | 隐含 | 男频 / 女频 / 不限 | 分类 | 是 |
| 2 | 番茄榜单分类 | 立项不可选 | **37 全量**，必选 | — | 是 |
| 3 | 二级流派 | 无 | **60**，最多选 2 | 分类画像 | 是 |
| 4 | 平台主题材 | 6 | **13** | 分类派生 | 是 |
| 5 | 复合叙事类型 | 10（选 3） | **18**（选 3） | 分类画像 | 是 |
| 6 | 题材元素 | 21（选 8） | **60**（选 8） | 分类画像 | 是 |
| 7 | 开局形态 | 无 | **12**，单选 | 分类画像 | 是 |
| 8 | 篇幅形态 | 无 | **4**，单选 | 分类画像 | 是 |
| 9 | 视角 | 无 | **3**，单选 | 第三人称限知 | 是 |
| 10 | 主角身份 | 无 | **10**，选 1–2 | 分类画像 | 是 |
| 11 | 情绪基调 | 部分（元素里） | **8**，选 1–2 | 分类画像 | 是 |
| 12 | 目标字数 | 有 | 保留 + 100 万 / 150 万 / 300 万快捷档 | — | 是 |
| 13 | 单章字数 | 硬编码 2500 | **1800–4000，默认 2500** | 分类画像 | 是 |
| 14 | 更新节奏 + 安全存稿线 | 有 / 未暴露 | 保留 + 常用档位 | — | 是 |

### 5.3 各维度选项

**开局形态（12）**：重生、穿越、系统降临、能力觉醒、继承/获得、契约绑定、日常切入、灾变爆发、悬案介入、被逐/退婚、回归/重逢、失忆/身份未知

**篇幅形态（4）**：长线连续（单主线 300 万字）、单元剧（快穿/无限流）、多卷史诗（群像/争霸）、日常经营（低强度长线）

**视角（3）**：第三人称限知（默认）、第一人称、多视角切换

**情绪基调（8）**：热血、轻松、甜宠、虐恋、悬疑紧张、治愈、沙雕、冷峻

**主角身份（10）**：学生、职场新人、店主/创业者、医生、教师、军人、警察/调查员、艺人/主播、匠人、继承人

其余维度的完整选项见 `FANQIE_CATEGORY_EXPANSION_DRAFT.md`。

### 5.4 新增项目级字段：单章字数

- `ProjectSummary.wordsPerChapter: number`（默认 2500，范围 1800–4000）。
- 替换硬编码：`src/shared/planning.ts:9`（`approvedVolumeRanges` 默认值）、`src/shared/summaries.ts:145`（卷章数估算）。
- 立项定位面板可选；故事圣经可改（改动会重置契约审批，走现有版本机制）。
- 兼容：旧项目读取时缺省 2500，行为与现在一致。

### 5.5 定位面板形态

```
┌ 题材定位 ─────────────────────────────┐
│ 频道 [男频▾]  番茄分类 [科幻末世▾]      │
│ 二级流派 [末世危机▾] [废土求生▾]        │
│ 主题材（自动：都市脑洞）                 │
├ 故事定位 ─────────────────────────────┤
│ 开局形态 [灾变爆发▾]  篇幅 [长线连续▾]   │
│ 视角 [第三人称限知▾]                    │
│ 叙事类型 ☑生存 ☑群像 ☐冒险 …（最多3）   │
│ 题材元素 ☑末世 ☑系统 …（最多8）         │
│ 主角身份 [学生▾] [职场新人▾]            │
│ 情绪基调 ☑热血 ☐治愈 …（最多2）         │
├ 规模与节奏 ───────────────────────────┤
│ 目标字数 [300万▾]  单章字数 [2500]       │
│ 更新节奏 [每日2章]  安全存稿线 [10]      │
├ 你的灵感（可不填）────────────────────┤
│ …                                      │
└────────────────────────────────────────┘
        [ 生成三套方案 ]  [ 用分类推荐值重置 ]
```

---

## 六、方案总览：立项孵化台

把"新建作品"拆成两条路：**快速开书**（保留现有弹窗，一步出 3 案）和**立项孵化台**（新，推荐）。两者**共用同一套候选 schema 与体检规则**。

```
① 定位  →  ② 证据(可跳过)  →  ③ 候选三案  →  ④ 对比与体检
                                                      ↓
⑦ 引导开书  ←  ⑥ 开书包  ←  ⑤ 骨架（字段可锁定/重生成）
```

| 步骤 | 用户做什么 | AI 做什么 | 门禁 |
|---|---|---|---|
| ① 定位 | 第五章的 14 个维度（分组折叠） | 无 | 分类 + 字数必填 |
| ② 证据 | 勾选榜单机会 / 标签云 / 洞察包，或明确跳过 | 无 | 只读引用；跳过留痕 |
| ③ 候选 | 补充灵感（可选），生成 3 案 | 出 3 个完整候选 | 差异门禁扩到 6 维 |
| ④ 对比与体检 | 并排看差异，处理阻断项 | 只给字段级重写建议 | **阻断项未处理不能立项** |
| ⑤ 骨架 | 确认人物/世界骨架，可锁定字段单独重生成 | 只重写被要求的字段 | 契约必填仍按现有规则校验 |
| ⑥ 开书包 | 勾选结构骨架、前 10 章章纲、黄金三章卡 | 生成草稿 | 全部**草稿**状态 |
| ⑦ 引导 | 按开书清单逐项确认 | 无 | 契约审批、结构批准走现有门禁 |

### 6.1 统一两条概念生成路径

- 废弃 `CandidateSchema`，项目内的 `generateConcepts` 改用与孵化台相同的候选 schema；
- `ProjectDashboard` 的「生成三个原创方向」改为「重开立项」，跳转孵化台并带上已有项目上下文。

---

## 七、孵化台逐步设计

### ① 定位（Positioning）

```ts
interface IncubationPositioning extends GenreComposition {
  fanqieCategoryKey: string;
  subGenreIds: string[];          // ≤2
  openingArchetype: string;       // 开局形态
  lengthShape: string;            // 篇幅形态
  narrativePerson: string;        // 视角
  protagonistRoles: string[];     // ≤2 主角身份
  toneTags: string[];             // ≤2 情绪基调
  targetWords: number;
  wordsPerChapter: number;        // 新
  updateCadence: string;
  safeStockLine: number;
  readerPersona: string;
  readerPromise: string;
  commercialBoundary: string;
}
```

选定分类后立即展示：开篇抓手、首章钩子形态、首个回报窗口、回报节奏、单章字数区间、常见开局与毒点、易混淆兄弟分类。这一步不调用 AI。

### ② 证据（Evidence，可跳过）

- 数据源仅限本地：`MarketOpportunity`、分类标签统计、`InsightPack`。
- 未勾选任何证据时必须显式"跳过证据并继续"，并留 `无市场证据` 记录。
- **隔离约束**：只接收洞察包与榜单统计，不读取 `research.sqlite` 的样本原文。

### ③ 候选（Candidates）

```ts
interface IncubationCandidate extends BookConceptCandidate {
  fanqieCategoryKey: string;
  subGenreIds: string[];
  titleOptions: Array<{ title: string; rationale: string; tags: string[] }>;
  openingDesign: {
    chapter1Hook: string;
    firstThreeChaptersPromise: string;
    firstPayoffChapter: number;
    retentionAnchors: string[];
  };
  escalationLadder: Array<{
    stage: string;
    conflict: string;
    expansionAxis: "资源" | "关系" | "地图" | "规则" | "身份" | "技艺" | "势力";
    payoff: string;
    cost: string;
  }>;
  sustainability: { fatiguePoint: string; shiftPlan: string };
  differentiation: { against: string[]; originalityRisk: "低" | "中" | "高"; riskNotes: string };
  evidenceRefs: string[];
  suggestedTags: string[];
}
```

提示词调整：注入定位卡（≤400 字符）+ 分类画像（≤1500）+ 二级流派（≤400）+ 证据卡；差异门禁扩到 6 维；**两段式生成**（先精简候选，选定后生成骨架与细节）。

### ④ 对比与体检

三案并排对比，默认只展示差异维度；运行确定性体检（第八节）；阻断项必须修改或显式人工确认留痕。

### ⑤ 骨架

复用 `expandBookConcept`，支持字段级锁定/重生成；新增 `regenerateConceptField(draftId, candidateId, field)`。

### ⑥ 开书包

| 产物 | 说明 | 默认 |
|---|---|---|
| 项目摘要 + 契约草案 | 含分类、二级流派、开局形态等新字段 | 必选 |
| 4–8 宏观阶段 + 3–6 分卷骨架 | 复用"全书结构"模式（`electron/ai-service.ts:1006-1048`），`草稿` | 可选，默认勾选 |
| 前 10 章章纲 + 细纲 + 场景卡 | 复用章纲模式 | 可选，默认勾选 |
| 黄金三章设计卡 | 从 `openingDesign` 派生 | 可选，默认勾选 |

### ⑦ 引导开书

驾驶舱顶部"开书清单"：复核契约 → 审批契约 → 确认全书结构 → 确认前 10 章章纲 → 写第一章。

---

## 八、数据与代码落点

### 8.1 持久化：立项草稿

```sql
CREATE TABLE IF NOT EXISTS incubations (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,        -- 孵化中 | 已立项 | 已放弃
  step TEXT NOT NULL,          -- 定位 | 证据 | 候选 | 体检 | 骨架 | 开书包
  payload TEXT NOT NULL,       -- IncubationDraft JSON
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

迁移走 `runMigrations`；写入统一 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`。`promoteIncubation`：先写项目库，成功后在一个 catalog 事务里标记状态并回填 `project_id`；失败复用 `deleteProject` 的目录搬迁逻辑补偿。

### 8.2 新增/改动清单

| 层 | 文件 | 动作 |
|---|---|---|
| shared | `src/shared/fanqie-taxonomy.ts` | 拆为 `fanqie-taxonomy/{types,男频,女频,subgenres,index}.ts`；新增 10 字段；删除模板派生 |
| shared | `src/shared/genre-plugins.ts` | 拆出 `BASE_PLUGINS` + `OVERRIDES`，`GENRE_PLUGINS` 仍整体导出 |
| shared | `src/shared/category-tags.ts` | 新增：榜单标签聚合 |
| shared | `src/shared/incubation.ts` | 新增：类型、步骤机、`missingIncubationFields`、定位卡编译 |
| shared | `src/shared/incubation-review.ts` | 新增：确定性体检规则 |
| shared | `src/shared/incubation-evidence.ts` | 新增：洞察/机会/标签 → 只读证据卡 |
| shared | `src/shared/genre-composition.ts` | 元素 21 → 60；叙事类型 10 → 18 |
| shared | `src/shared/commercial-knowledge.ts` | 合并 `baselineDelta`；版本升 v8 |
| shared | `src/shared/project-service.ts` | 新增 `wordsPerChapter` 校验与默认值 |
| shared | `src/shared/planning.ts` / `summaries.ts` | 用项目级单章字数替换硬编码 2500 |
| shared | `src/shared/types.ts` | `GENRES` 6 → 13；新增 `IncubationDraft`/`IncubationCandidate`/`IncubationFinding`；`ProjectSummary.wordsPerChapter` |
| main | `electron/database.ts` | `incubations` 表与 CRUD、`promoteIncubation`、`words_per_chapter` 列 |
| main | `electron/handlers/project-handlers.ts` | 新增 IPC 注册 |
| main | `electron/ipc-validation.ts` | 每个新通道加 Zod schema |
| main | `electron/ai-service.ts` | `generateIncubationCandidates` / `regenerateConceptField`；扩展 `expandBookConcept` |
| main | `electron/ai-definitions.ts` | `IncubationCandidateSchema`；扩展 `conceptDiversityIssues`；废弃 `CandidateSchema` |
| preload / renderer | `electron/preload.ts`、`src/lib/browser-api.ts` | 暴露新 API + 浏览器回退 |
| renderer | `src/pages/IncubationWorkspace.tsx` | 新增：7 步向导 |
| renderer | `src/components/NewProjectModal.tsx` | 改为入口选择器 + 定位面板（第五章） |
| renderer | `src/pages/ProjectDashboard.tsx` | 开书清单；「重开立项」 |
| renderer | `src/pages/ResearchRankingModals.tsx`、`ResearchPage.tsx` | `FANQIE_CATEGORIES` 改为派生 |

### 8.3 提示词与回归语料

新增任务类型：`generate-incubation-candidates`、`regenerate-concept-field`。按 AGENTS.md 规则 6 补 `quality-benchmark-corpus.ts` 与 `prompt-regression-corpus.ts`，以 `npm run test:quality` 对比基线。

---

## 九、体检评分卡（确定性规则）

规则全部放在 `src/shared/incubation-review.ts`，纯函数、可解释、不调用 AI。

| # | 检查项 | 判据 | 等级 |
|---|---|---|---|
| 1 | 分类匹配 | `genreSubtype` / 叙事主轴落在所选分类的 `narrativeGenres` 内 | 警告 |
| 2 | 分类禁忌 | 命中 `fanqieCategory.taboo` 或 `clicheTraps` | **阻断** |
| 3 | 元素过量 | `genreElements > 8`，或包含互斥元素 | **阻断** |
| 4 | 开局可执行 | `chapter1Hook` 含具体事件与主角选择；命中空泛词库告警 | 警告 |
| 5 | 首个回报 | 落在 `firstPayoffWindow` 内通过；晚 1–3 章警告；更晚阻断 | 混合 |
| 6 | 升级阶梯 | ≥3 级；`expansionAxis` 覆盖 ≥2 种；每级有代价 | **阻断** / 警告 |
| 7 | 发动机容量 | 阶梯级数 × 每级章节量 ≥ 目标字数（按单章字数估算） | 警告 |
| 8 | 承诺一致 | `readerPromise`/`audience`/`coreEmotion` 方向冲突 | 警告 |
| 9 | 结局兑现 | `ending` 与 `readerPromise` 关键词有交集 | 警告 |
| 10 | 主角欲望 | `protagonistDesire` 含可执行目标动词 | 警告 |
| 11 | 原创风险 | `originalityRisk === "高"` | **阻断** |
| 12 | 同质化 | 与已有项目契约的 ngram 相似度 ≥ 0.68 | 警告 |
| 13 | 契约完整 | `missingContractApprovalFields` 非空 | **阻断** |
| 14 | 开局同质 | 与分类 `commonOpenings` 相似度 ≥ 0.68 且无差异说明 | 警告 |
| 15 | 标签偏离 | `suggestedTags` 与分类标签统计重合度 < 0.3 | 提示 |
| 16 | 兄弟分类混淆 | 与 `siblingCategories` 核心幻想相似度 ≥ 0.68 | 警告 |
| 17 | 流派一致（v3 新增） | 候选定位与所选二级流派的 `coreFantasy` 冲突 | 警告 |
| 18 | 单章字数匹配（v3 新增） | `wordsPerChapter` 落在分类/流派 `typicalChapterWords` 内 | 提示 |

阻断项只保留"会被平台判罚、会导致故事无法成立、或违反现有硬门禁"三类（2/3/6/11/13），其余一律警告；所有阻断项可人工覆盖并留痕。

---

## 十、门禁与合规对照

| AGENTS.md 规则 | 本方案如何遵守 |
|---|---|
| 1 人审门禁 | 体检阻断项必须人工处理或显式确认；契约审批、结构批准、章节定稿流程不变；开书包产物全为草稿 |
| 2 本地优先隐私 | 只读脱敏洞察包、本地榜单统计与已采集标签；不读取研究原文；不新增上传 |
| 3 安全边界 | 不新增网络请求；分类名/ID 来自已核对的公开榜单页 |
| 4 shared 纯净 | 新增逻辑全放 `src/shared/`；`FANQIE_CATEGORIES` 从页面移出 |
| 5 事务性 | `incubations` 写入与 `promoteIncubation` 均包事务；失败补偿不留半成品 |
| 6 提示词证据 | 分类画像、流派、概念提示词改动必须补回归语料并跑 `npm run test:quality` |
| 7 提示词引导化 | 概念/规划/质检用全量但受预算裁剪；正文只用定位 + 开局 + 边界 |

---

## 十一、分期落地与验收

| 阶段 | 内容 | 规模 | 依赖 |
|---|---|---|---|
| 0 | **分类地基**：字段与类型、拆文件、单源化、`baselineDelta` 合并、`extends` 继承机制、校验测试 | 1 PR，M | — |
| 1 | **分类内容**：37 画像补全（男频/女频两 PR）+ 60 条二级流派 + 元素 60 + 叙事类型 18 | 3 PR，L（内容为主） | 阶段 0 |
| 2 | **主题材扩充**：6 → 13，7 个继承式插件 + 独有机制断言 | 1–2 PR，M–L | 阶段 0 |
| 3 | **输入面扩充**：定位面板 14 维度、`wordsPerChapter` 项目级字段与硬编码替换 | 1–2 PR，M | 阶段 0（`wordsPerChapter` 可独立先做） |
| 4 | **概念质量与体检卡**：候选 schema、两段式生成、6 维差异门禁、18 项体检 | 1–2 PR，M–L | 阶段 1–3 |
| 5 | **孵化台持久化 + UI**：`incubations` 表、7 步向导、草稿列表与恢复 | 1–2 PR，L | 阶段 4 |
| 6 | **证据桥接 + 标签云**：`category-tags.ts`、只读证据卡 | 1 PR，M | 阶段 5 |
| 7 | **开书包 + 引导**：创建时写入结构/章纲/黄金三章；驾驶舱开书清单 | 1 PR，M | 阶段 5 |

### 各阶段验收

**阶段 0**
- 4.12 的 1–6 条测试全绿；同 `genre` 内分类三字段两两不同；
- `FANQIE_CATEGORIES` 派生一致，页面不再持有领域常量；
- `GENRE_PLUGINS` 经 BASE+OVERRIDES 构建后与现有 6 个插件逐字段等价（快照测试）；
- `npm run build` + `npm test` 全绿；版本号升 v8。

**阶段 1**
- 37 分类 18 字段全手写、无占位符；60 条二级流派字段完整；
- 元素层 60 项、叙事类型 18 项，`EXPANSION_ROUTES` 覆盖全部 18 项；
- 抽查 3 组同题材分类与 3 组流派，差异可被人工辨认；
- 12 条代表分类回归语料通过 `npm run test:quality`。

**阶段 2**
- 13 个主题材解析结果满足字段下限；每个新题材与其父在 ≥6 个字段上不同；
- `uniqueMechanisms` 断言覆盖 13 个题材，`compileCommercialGuidance` 输出两两不同；
- 旧 6 个题材的输出与改造前逐字符一致（防止继承机制改变既有行为）。

**阶段 3**
- 定位面板 14 个维度全部可用，且"用分类推荐值重置"能一键回填；
- `wordsPerChapter` 写入项目库并参与卷章数估算；旧项目缺省 2500 行为不变；
- 快速开书只展开 3 组，首次可选项从 39 增至 100+。

**阶段 4**
- 候选 schema 校验通过；6 维差异门禁覆盖重复/相似两种失败；
- 18 项体检 corpus 覆盖，阻断项 0 漏报；
- 快速开书与孵化台共用同一 schema（单测断言）。

**阶段 5**
- 关闭窗口后草稿仍在；步骤回退不丢数据；
- `promoteIncubation` 状态与 `project_id` 正确；项目库写入失败时补偿生效；
- 所有新 IPC 有 Zod schema，未注册通道默认拒绝。

**阶段 6**
- 隔离测试：不读取 `research.sqlite` 原文；
- 标签统计含样本量与日期；无数据时回退并标注来源。

**阶段 7**
- 创建后结构节点与章纲均为 `草稿`；开书清单 5 步状态正确；
- 不勾选开书包时行为与现状一致。

---

## 十二、风险与取舍

| 风险 | 应对 |
|---|---|
| 选项变多导致决策疲劳 | 分组折叠 + "用分类推荐值重置"；必填只 3 项 |
| 提示词随选项数膨胀 | 勾选项压缩成 ≤400 字定位卡；分类/流派/标签各有预算 |
| 13 个主题材维护成本 | `extends` 继承 + "与父题材 ≥6 字段不同"测试；不要求重写 stages |
| 60 条流派内容量大 | 分批 PR；先上线清单与定位，画像按同一模板补齐 |
| 新增 Genre 影响旧版本 | 发布说明提示；阶段 2 单独 PR，不动已有 6 个题材的输出 |
| 分类画像写成模板 | 校验测试强制同题材两两不同 |
| 体检变成清单压迫 | 阻断项最小化到 5 条；每条警告配正向替代 |
| 开书包失败留半成品 | 分步写入 + 补偿；失败保留草稿重试 |

---

## 十三、明确不做

- 不登录番茄账号、不抓取非公开数据、不自动发布。
- 不做 AI 自动批准契约或自动批准规划。
- 不把研究原文/样本书名送进孵化台。
- 不为孵化台新增任何网络请求。
- 不伪造平台官方标签或分类 ID；分类 ID 以已核对的公开榜单页为准。
- 不改动 `src/shared/` 的纯函数约束，不引入 React 依赖。

---

## 十四、如果只做一件事

按依赖顺序做 **阶段 0 → 1 → 2 → 3**：分类地基、分类内容（37 + 60 + 元素 60）、主题材 6 → 13、输入面 14 维度。

理由：这四步直接解决"选择太少"和"分类太少"，且不新增表、不动事务；它们同时是后面概念质量与孵化台的前置。阶段 4 的体检卡让选择变成可检验的方案，阶段 5–7 才是留存与闭环。

---

**下一步**：确认推进范围。若要尽快看到效果，建议先做阶段 0 + 阶段 3 的 `wordsPerChapter`（两个独立小 PR），再并行推进阶段 1 的内容与阶段 2 的题材扩充。
