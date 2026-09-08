# 开书去模板化方案（2026-09-09）

> 状态：A/B/C/D 已实施并通过全量验证；C4 按方案砍掉。

## 实施进展（2026-09-09）

**A 分类创作预设 —— 完成。**

| 改动 | 落点 |
| --- | --- |
| 37 个分类的开书推荐值（篇幅形态、视角、目标字数档、推荐开局/基调/身份） | `src/shared/fanqie-taxonomy/creation-presets.ts` |
| 预设类型与画像可选字段 | `src/shared/fanqie-taxonomy/types.ts` |
| 模块加载时合并进画像（沿用 `FANQIE_SUBGENRE_SEEDS` 模式） | `src/shared/fanqie-taxonomy/index.ts` |
| 派生：结构区间由篇幅形态驱动；单章字数、首回报窗口取自画像；二级流派做区间窄化 | `src/shared/creation-presets.ts` |
| 面板：默认值跟随分类、推荐项置顶并打标、新增"用分类推荐值重置" | `src/components/NewProjectModal.tsx`、`src/styles.css` |
| 测试 7 例 | `tests/creation-presets.test.ts` |

**B 开书路径分层 —— 完成。**

| 改动 | 落点 |
| --- | --- |
| 路径状态机：探索 3 案 / 定向 2 案 / 直达 1 案，`stepsForPath` 决定步骤条 | `src/shared/incubation.ts` |
| `BookConceptInput.candidateCount` | `src/shared/types.ts` |
| 候选数量与差异门禁：两案放宽到两维、三案仍要求四维；提示词按数量与 seed 动态生成 | `electron/ai-definitions.ts`、`electron/ai-service.ts` |
| IPC 校验：`candidateCount` 1–3、草稿 `path` | `electron/ipc-validation.ts` |
| 浏览器回退按数量返回 | `src/lib/browser-api.ts` |
| 面板三路径选择、直达要求先写想法、按钮与文案随路径变化 | `src/components/NewProjectModal.tsx` |
| 立项台步骤条按草稿路径显示 | `src/pages/IncubationWorkspace.tsx` |
| 测试 6 例 | `tests/creation-path.test.ts` |

**C 结构参数化 —— 完成（C4 按方案砍掉）。**

| 改动 | 落点 |
| --- | --- |
| `resolveStructurePreset` / `chapterPlanningRange` / `CHAPTERS_PER_LADDER_LEVEL`：篇幅形态决定阶段与卷区间，单章目标 ±30% 决定章纲字数 | `src/shared/creation-presets.ts` |
| 契约新增 `lengthShape` 并全链路持久化（建项目、概念转契约、手动创建、IPC 校验） | `types.ts`、`project-service.ts`、`project-handlers.ts`、`ipc-validation.ts` |
| 故事圣经可改篇幅形态，改分类时跟随分类推荐 | `src/pages/StoryBibleWorkspace.tsx` |
| 规划提示词注入结构参数（阶段/卷数量、单章字数、首回报窗口）；全书结构按区间校验并重试一次，仍超界则接受 | `electron/ai-service.ts` |
| 分卷 schema 上限 3–6 → 3–8（多卷史诗区间需要） | `electron/ai-definitions.ts` |
| 每个题材 1 个骨架附加栏目（悬疑→案件与线索、军事→阵营与情报等），生成与故事圣经共用一份数据 | `src/shared/genre-skeleton-sections.ts`、`ai-definitions.ts`、`ai-service.ts`、`StoryBibleWorkspace.tsx` |
| 测试 5 例 | `tests/structure-preset.test.ts` |

**D 体检阈值分类化 —— 完成。** 首个回报窗口与单章字数区间取预设；发动机容量按篇幅形态给每级章节量（长线连续 60 / 单元剧 45 / 多卷史诗 70 / 日常经营 50）。落点：`src/shared/incubation-review.ts` 与两个调用方。

验证（A+B+C+D 合并后全量）：`tsc --noEmit` ✅、`npm test` 611 通过 ✅、`npm run test:quality` 16 通过 ✅、`npm run build` ✅、`npm run test:e2e` 22 通过 ✅。

六点实施偏差/发现：

1. 预设值放在 `fanqie-taxonomy/creation-presets.ts` 并在模块加载时合并进画像（与 `FANQIE_SUBGENRE_SEEDS → FANQIE_SUBGENRE_PROFILES` 同一模式），而不是写进 37 个画像字面量；运行时仍是单源（`profile.creationPreset`），完整性由测试守住。
2. 60 条二级流派的 `typicalChapterWords` / `firstPayoffWindow` 目前与父分类完全相同，窄化逻辑暂时是空操作；逻辑已按前向兼容写好，等流派级数据补齐后自动生效。
3. "直达"实现为"只生成一套候选"，而不是另开一个跳过候选的任务：复用同一份候选 schema 与 `expandBookConcept`，作者拿到的仍是完整契约草稿，落地成本最低。
4. 顺带修复一个既有 bug：`createProject` 的 IPC schema 缺 `wordsPerChapter`（面板手动创建一直在传它，strict 校验会直接拒绝），手动创建在桌面端实际会失败；已补上 `wordsPerChapter` 与 `lengthShape`。
5. 没有往 `quality-benchmark-corpus.ts` 加"单元剧/多卷史诗"语料：现有两份 corpus 都是质量检查器的 fixture（知识边界、资源守恒），不是生成结构的 fixture。结构改动改由 `tests/structure-preset.test.ts` 的确定性断言锁定，`npm run test:quality` 无回归。`PROMPT_VERSION` 升到 v14、`FANQIE_PROFILE_VERSION` 升到 v2。
6. C 章节里那个"结构卡对照实验"**没有执行**（需要真实模型配置）。所以 C 的保证只到"区间正确、校验生效"这一层；结构卡对模型输出的实际约束力仍待作者抽检：同一分类只换篇幅形态各开一本，对比阶段与分卷的差异。

## 一、结论

"同一个模板"不是单一问题，是三层叠加，且互相放大：

| 层 | 症状 | 根因 | 证据 |
| --- | --- | --- | --- |
| L1 输入层 | 37 个分类共用一张面板、一套默认值；100+ 个可选项不分分类全量铺开 | 默认值来自全局常量，选分类只回填 5 个字段 | `NewProjectModal.tsx:38-60`、`:212-224` |
| L2 生成层 | 不管什么题材，都是 3 案 / 5 栏骨架 / 4–8 阶段 / 3–6 卷 / 10 章 / 1–5 场景 / 1400–3500 字 | schema 与数量全局写死；分类已有的结构参数只当提示词文字，不做约束、不参与校验 | `ai-definitions.ts:140,153-159,380-393,403,424-425`；`ai-service.ts:1029,1065,1085` |
| L3 流程层 | 不管作者带多少信息，都走同一条 6 步；已有完整想法只能塞进一个 seed 框，或掉进空壳"手动创建" | 步骤机写死；候选数量写死 | `incubation.ts:4`；`NewProjectModal.tsx:246-282`；`ai-definitions.ts:140` |

一句话：**现在的"开书"把"最佳实践的默认值"当成了"唯一允许的取值"。** 方案目标是把这些常量改回默认值——分类给默认、形态给区间、作者可覆盖，门禁不变。

## 二、逐层证据（代码实测）

### 2.1 输入层：分类只回填 5 个字段，其余全是全局常量

`defaultPositioning()`（`NewProjectModal.tsx:38-60`）在打开面板时就固定了：第一个分类、开局形态 `OPENING_ARCHETYPES[0]`（=重生）、篇幅 `LENGTH_SHAPES[0]`（=长线连续）、视角 `NARRATIVE_PERSONS[0]`、目标字数 100 万、单章 2500、更新节奏"每日 2 章"、安全存稿线 10。

选分类后只有 `selectCategory()`（`:212-224`）回填 5 个字段：二级流派清空、叙事主轴、题材元素、单章字数、读者画像/读者承诺。**开局形态、篇幅形态、视角、目标字数、更新节奏、安全存稿线对所有 37 个分类完全相同。**

面板对所有分类渲染同一批选项：12 个开局形态、4 个篇幅形态、3 个视角、18 个叙事类型、42 个题材元素、10 个主角身份、8 个情绪基调（`:498-629`），不排序、不推荐、不按分类裁剪。

### 2.2 生成层：一套 schema 打天下

- 候选：`BookConceptSchema` 固定字段清单 + `.length(3)`（`ai-definitions.ts:77-141`）；差异门禁固定 6 维（`:256-272`）。
- 骨架：固定 5 栏（`protagonistArc / keyRelationships / worldRules / majorForces / timelineAnchors`，`:153-159`），system prompt 无题材分支（`ai-service.ts:995-1003`）。
- 全书结构：stages 4–8、volumes 3–6（`ai-definitions.ts:380-393`），提示词同样写死"4至8项 / 3至6项"（`ai-service.ts:1029`）。
- 章纲：默认 10 章一批（`ai-service.ts:1065`，`CHAPTER_PLANNING_BATCH_SIZE = 10`），字数固定 1400–3500、场景 1–5（`ai-definitions.ts:403,424-425`），提示词也写死（`ai-service.ts:1085`）。
- 落库格式写死：粗纲标题 `第X–Y章滚动粗纲`、章纲 `功能：…；目标：…；张力：…；结果：…`（`ai-service.ts:1095,1110`）。

分类画像里其实**已经有**结构参数：`typicalChapterWords`、`firstPayoffWindow`、`payoffCadence`、`chapterHookStyle`、`commonOpenings`（`fanqie-taxonomy/types.ts:42-48`），也**已经进提示词**（`commercial-knowledge.ts:148-151`），但：

1. 不进 schema、不做校验——`firstPayoffChapter` 只在体检事后检查（`incubation-review.ts:196-224`），生成时不受约束；
2. 章纲任务的 `shared` 没有单章字数——`StoryContract` 无 `wordsPerChapter`（`types.ts:223-253`），`ai-service.ts:1020` 的上下文里也没有，单章只受全局 1400–3500 约束；
3. 面板勾选的榜单标签 `evidenceTags` 被丢弃，从未进提示词（`incubation.ts:70-98` 只透传 `insightIds` 与 `opportunityKeys`）。

### 2.3 流程层：一条路走到黑

`INCUBATION_STEPS` 写死 6 步（`incubation.ts:4`），弹窗与立项台都按它渲染。创建只有两条分支（`NewProjectModal.tsx:246-282`）：

- AI 路径：必须先出 3 案 → 选 1 案 → 阻断项清零或人工确认 → 才可创建；
- 手动路径：只写书名，契约全空（`project-service.ts:64-93`），而后续规划又要求先审批契约，等于先造空壳再回头补。

没有"我已经想清楚了，直接出骨架和契约"的路径，也没有"先给我几个切口，我再决定方向"的路径。

### 2.4 体检层：阈值也是全局的

18 项体检的阈值全部是全局常量：元素上限 8、阶梯至少 3 级且至少 2 种扩张轴、容量按"阶梯级数 × 60 章 × 单章字数"估算（`incubation-review.ts:169,232,267`）。100 万字单元剧和 300 万字多卷史诗用同一把尺子。

## 三、设计原则

1. **默认值不是规定值**：分类给默认，形态给区间，作者可覆盖。
2. **分类画像升级为创作预设**：现在画像只有"知识 + 体检参数"，补上"生成预设"（推荐开局/篇幅/视角/字数/节奏 + 结构区间），面板默认值、schema 区间、体检阈值同源。
3. **路径按作者信息量分层**：有完整想法直达、有方向定向、没想法探索；步骤条按实际路径显示。
4. **结构由形态驱动**：篇幅形态 + 分类预设决定阶段/卷/场景/字长的区间与字段，而不是全局常量。
5. **知识按需注入**（AGENTS.md 规则 7）：只把确定性的结构参数接进生成约束，不因此给每个分类塞更多知识。
6. **门禁不放松**：候选仍是候选、阻断项仍需人工确认、契约审批与结构批准不变。

## 四、方案总览

| 工作流 | 解决 | 规模 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| A 分类创作预设（面板自适应） | L1 输入同质 | M | — | 低 |
| B 开书路径分层（三入口） | L3 流程同质 | M | — | 中 |
| C 结构参数化（生成 + 骨架分类栏目） | L2 输出同质 | L | A | 高（动提示词，需基准） |
| D 体检阈值分类化 | 配套 C | S | A | 低 |

推荐顺序：**A → D → B → C**。A/D 独立且低风险，先让"分类不同、默认不同"可见；B 改流程；C 动提示词与 schema，最后做并配基准。

### 工作流 A：分类创作预设

新增 `src/shared/creation-presets.ts`（纯函数），**能从现有画像字段派生就不新增手写字段**：

```ts
export interface CreationPreset {
  openingArchetypes: string[];   // 推荐 2–3 个：由 commonOpenings 映射到 12 形态
  lengthShape: string;           // 新增：每分类 1 个推荐
  narrativePerson: string;       // 新增：每分类 1 个推荐
  toneTags: string[];            // 派生：由 coreFantasy / narrativeGenres 推导
  protagonistRoles: string[];    // 派生：由 coreFantasy / openingFocus 推导
  targetWords: number;           // 新增：100 / 150 / 300 万
  updateCadence: string;         // 新增：每日 1 / 2 / 3 章
  structure: {
    stages: [number, number];
    volumes: [number, number];
    scenesPerChapter: [number, number];
    chapterWords: [number, number];   // 直接取 typicalChapterWords
    firstPayoffWindow: [number, number];
  };
}
```

新增手写字段只有 3 个：推荐篇幅形态、推荐视角、目标字数档，放进 `FanqieCategoryProfile.creationPreset`（可选字段，旧数据无感）。其余从 `commonOpenings` / `typicalChapterWords` / `firstPayoffWindow` / `narrativeGenres` / `coreFantasy` 派生。

派生入口是纯函数 `resolveCreationPreset({ categoryKey, subGenreIds })`。二级流派自带 `typicalChapterWords` 与 `firstPayoffWindow`（`fanqie-taxonomy/types.ts:64-66`），选中后必须对区间做窄化——否则"选了末世危机"和"什么都没选"会拿到同一套结构参数，等于白选。

面板改动：

- `defaultPositioning()` 改为接受分类预设，打开面板即用当前分类的推荐值；
- 推荐项在网格内置顶并加"推荐"角标；其余保留在同一网格、用弱分隔区分，不做默认折叠——上一版方案刚把可选项从 39 扩到 100+，"选项太少"的教训不能反过来变成"藏起来"；实测仍疲劳再对最冷门分组做一键展开的折叠；
- 目标字数、更新节奏、安全存稿线改为分类预设档位；
- 增加"用分类推荐值重置"按钮（`BOOK_INCUBATION_PLAN.md` 第五章已设计但未实现）；
- 顺带修复：面板勾选的榜单标签 `evidenceTags` 目前被丢弃（`incubation.ts:70-98` 只透传洞察与机会，`BookConceptInput` 里也没有该字段），接入后作为"读者搜索词证据"进提示词（只作证据，不机械追热点）。

验收：切换分类时，开局/篇幅/视角/目标字数/更新节奏这 5–6 项跟着变；37 个分类都有预设；同题材分类的预设组合至少 2 个字段不同（防模板退化，与现有知识字段防模板测试同思路）。

### 工作流 B：开书路径分层

把弹窗顶部的两段式 `Segmented(["AI 从零开书","手动创建"])` 改为三入口：

| 入口 | 作者状态 | 流程 | 门禁 |
| --- | --- | --- | --- |
| 直达 | 已有完整想法 | 定位 + 设定文本 → 骨架 + 契约草稿 → 体检 | 契约仍需审批 |
| 定向 | 有方向、要备选 | 定位 + seed → 2 案（seed 为硬约束）→ 选 1 → 体检 | 差异门禁不变 |
| 探索 | 没想法 | 定位 → 切口选择（分类 `differentiationAngles` 3 条）→ 3 案 → 选 1 → 体检 | 差异门禁不变 |

- `IncubationDraft` 增加 `path: "直达" | "定向" | "探索"`（可选，旧草稿缺省"探索"）；
- `INCUBATION_STEPS` 改为 `stepsForPath(path)`，步骤条只显示实际路径（`IncubationWorkspace.tsx:190-196` 同步）；
- 候选数量：`BookConceptSchema.candidates` 从 `.length(3)` 改为 `.min(2).max(3)`，由 `generateBookConcepts(input, insights, { count })` 控制；定向路径的 prompt 追加"每个方案必须体现作者灵感中的核心设定"；
- 差异门禁按路径重述语义（比数量更重要）：定向路径从"6 维至少 4 维完全不同"改为"每案都包含 seed 核心设定 + 至少 2 维不同"，否则模型只能靠换皮凑差异，反而更像同一个模板；探索路径保持现有 6 维门禁；
- 直达路径复用 `expandBookConcept`，跳过候选生成；seed 为空时不允许选直达（提示先写设定）；
- 需确认 `conceptDiversityIssues`（`ai-definitions.ts:256-272`）在 2 案下仍成立；若规则隐含 3 案假设，改为按候选数取两两比较。

验收：三条路径都能创建成功；直达不调用候选生成；定向的 2 案都包含 seed 核心设定（单测断言 prompt 内容）；步骤条与草稿 `path` 一致。

### 工作流 C：结构参数化

**C1 结构区间参数化。** 两个 schema 只有 2 个调用点（`ai-service.ts:1030,1086`），改成 `structurePlanningSchema(preset)` 工厂并不贵；但更稳的做法是**放宽 schema 静态边界 + 生成后确定性校验**：长任务一旦被 schema 拒绝就要整批重来，而生成后校验可以"警告并接受"或带问题重试一次，与 `generateBookConcepts` 现有的差异重试模式一致（`ai-service.ts:964-975`）。建议 schema 保留最宽合法区间，预设区间由提示词注入 + `structureRangeIssues(result, preset)` 校验。数量与区间来自工作流 A 的 `preset.structure`：

- stages/volumes 按篇幅形态给默认区间：长线连续 5–8 阶段/3–5 卷、单元剧 4–6/4–6、多卷史诗 5–8/5–8、日常经营 4–6/3–5（作者仍可在规划台改）；
- 章纲 `targetWords` 以 `wordsPerChapter` 为中心 ±30%，替换全局 1400–3500；`scenes` 按单章字数推导（≤2000 字 1–3 场、≥3000 字 2–5 场）；
- `firstPayoffChapter` 用分类 `firstPayoffWindow` 做生成时约束（现在只在体检事后检查）；
- `escalationLadder` 级数与扩张轴按形态给区间（单元剧更看重"换挡"而非线性升级）。

区间解析按优先级：分类显式覆盖 → 篇幅形态预设 → 全局兜底（纯函数 `resolveStructurePlan(preset)`）。v1 只实现后两级，第一级留槽位，等某个分类真的需要单独覆盖时再填——不预先写 37×4 矩阵，写了也没人验证。

动工前先做一个半天的对照实验：同一分类、只换结构卡，手工跑两次全书结构，确认输出真的会变。结构类指令对模型的约束力是 C 最大的未知数，也是整个方案唯一无法靠单测证明的假设。

**C2 章纲提示词补齐参数。** `shared`（`ai-service.ts:1020`）增加 `wordsPerChapter` 与结构卡；`firstPayoffWindow` / `chapterHookStyle` / `payoffCadence` 已在 `compileCommercialGuidance` 中，补单章字数与场景区间即可。

**C3 骨架与故事圣经按题材加栏目。** `BookConceptSkeletonSchema` 保留基础 5 栏，增加可选 `genreSpecificSections: Array<{ label: string; items: string[] }>`（1–2 栏）。栏目定义放 `GenrePluginDefinition.skeletonSections`（可选字段，`GENRE_OVERRIDES` 的继承机制自动生效，不新开映射表），能从 `expansionAxes` / `ledgerTemplates` 派生的就派生，剩下约 13 个题材各写 1–2 栏，例如悬疑→「案件与线索」、军事→「阵营与战役」、种田→「经营循环」、快穿→「单元任务」。`StoryBibleWorkspace.tsx:391-425` 按同一来源渲染（现在固定 5 栏）。新栏目必须可选，不得进 `missingContractApprovalFields`（`contract-service.ts:62-81`），否则会改变审批门槛。

**C4（降级）结构化只做附加。** `Chapter.outline` 这个拼接串被 `context-compiler.ts:171,182,210,242` 与多处生成/审核提示词直接消费（`ai-service.ts:1020,1189,1483` 等），改存储格式是回归风险大于收益。改为：`outline` 字符串保持不变，结构化字段写进 `metadata` 供 UI 按题材渲染；粗纲标题改为可配置。排期紧的话，C4 可以整个砍掉。

验收：

- 同一分类下，单元剧与多卷史诗生成的结构数量落在各自区间；
- 章纲单章字数落在 `wordsPerChapter` ±30%，场景数落在推导区间；
- 骨架附加栏目在对应题材出现、在其他题材不出现；
- `npm run test:quality` 基准对比通过。

### 工作流 D：体检阈值分类化

- `reviewIncubationCandidate` 输入增加 `preset`，元素上限、阶梯级数、容量估算、首个回报窗口、单章字数区间全部取预设；
- 容量估算按形态：单元剧 = 单元数 × 每单元章节、多卷史诗 = 卷数 × 每卷章节，不再一律"阶梯 × 60 章"；
- 体检项按分类启停：无 CP / 非情感分类跳过恋爱互斥与承诺一致检查；
- 保持"统计是观察不是判罚"（AGENTS.md 规则 7）：字数、密度类不升级为阻断；阻断项集合不新增。

验收：现有 18 项体检用例全绿；新增"同一候选在不同分类/形态下阈值不同"用例。

## 五、改动清单

| 文件 | 工作流 | 改动 |
| --- | --- | --- |
| `src/shared/creation-presets.ts` | A/D | 新增：预设类型、派生、区间查询 |
| `src/shared/fanqie-taxonomy/types.ts` | A | `FanqieCategoryProfile` 增加可选 `creationPreset` |
| `src/shared/fanqie-taxonomy/male.ts` / `female.ts` | A | 37 个分类补 3 个手写字段 |
| `src/shared/genre-plugins.ts` | C | `GenrePluginDefinition` 增加可选 `skeletonSections` |
| `src/components/NewProjectModal.tsx` | A/B | 默认值改预设、推荐项置顶与折叠、三入口 |
| `src/shared/incubation.ts` | B | `path` 字段、`stepsForPath`、候选数量入参 |
| `src/shared/types.ts` | B/C | `IncubationDraft.path`、骨架 `genreSpecificSections` |
| `electron/ai-definitions.ts` | B/C | 候选 `.min(2).max(3)`；结构/章纲 schema 工厂；骨架附加栏目 |
| `electron/ai-service.ts` | B/C | 路径分支 prompt；结构卡注入；`wordsPerChapter` 进 `shared`；结构化落库 |
| `electron/ipc-validation.ts` | B | `generateBookConcepts` 新增 `count` 入参的 Zod 校验 |
| `electron/preload.ts`、`src/lib/browser-api.ts`、`src/lib/browser-demo.ts` | B | 新入参的通道与浏览器回退实现 |
| `src/shared/incubation-review.ts` | D | 阈值取预设；按分类启停检查项 |
| `src/pages/StoryBibleWorkspace.tsx` | C | 动态附加栏目 |
| `src/pages/IncubationWorkspace.tsx` | B | 步骤条按路径显示 |
| `src/shared/prompt-version.ts` | A/C | 提示词或默认定位卡内容变更后升版本 |

## 六、测试与基准

1. `tests/creation-presets.test.ts`（新增）：37 分类预设完整、区间合法、同题材两两不同、派生幂等。
2. `tests/creation-path.test.ts`（新增）：三入口步骤序列、直达不调用候选生成、定向候选含 seed 核心设定。
3. `tests/structure-preset.test.ts`（新增）：schema 工厂在各形态下接受/拒绝的边界；断言 4 种篇幅形态编译出的 schema 与提示词上下文两两不同（确定性断言，不依赖模型输出）。
4. `tests/incubation-review.test.ts`：补"阈值随分类/形态变化"用例。
5. `src/shared/quality-benchmark-corpus.ts`：A 改变生成输入、C 改提示词与 schema，两者都要补语料——单元剧、多卷史诗、日常经营各一条；跑 `npm run test:quality` 对比基线（AGENTS.md 规则 6）。
6. `tests/browser-incubation-workflow.test.ts`：浏览器回退路径支持新入参；三入口在无主进程时行为一致。
7. **差异化验收（人工，不能只靠单测）**：用 2 个不同分类 × 2 种篇幅形态各开一本，把三案、卷纲、前 10 章纲并排看，能说清"这是两种书"。确定性测试只能证明提示词与 schema 不同，证明不了输出不同。
8. `npm run build` + `npm test` + `npm run test:e2e`。

## 七、门禁与合规对照

| AGENTS.md 规则 | 本方案如何遵守 |
| --- | --- |
| 1 人审门禁 | 三入口都不改门禁：候选仍为草稿，阻断项仍需人工确认，契约审批、结构批准、章节定稿不变 |
| 2 本地优先 | 不新增数据源；证据仍只用本地脱敏洞察包与榜单统计 |
| 3 安全边界 | 不新增网络请求 |
| 4 shared 纯净 | 预设与阈值全在 `src/shared/`，纯函数、无 React/electron 依赖 |
| 5 事务性 | 不改写入路径；`path` / `genreSpecificSections` 为可选字段，旧数据无迁移 |
| 6 提示词证据 | C 补 3 条基准语料并跑 `npm run test:quality` |
| 7 提示词引导化 | 只把结构参数接进约束，不新增禁令；题材知识仍按需注入 |

## 八、不做的事

- 不做"AI 自动选方案 / 自动批准"；三入口仍由人选择与确认。
- 不为每个分类写一套独立面板；只做推荐与折叠，不隐藏任何能力。
- 不改已有分类画像的知识字段，不新增体检阻断项。
- 不动正文写作链路（`compileChapterGuidance` 的按需原则不变）。

## 九、待确认

1. **预设字段放哪**：写进 `FanqieCategoryProfile.creationPreset`（推荐，单源，避免第二份会漂移的 37 键映射表），还是单独一张映射表？
2. **候选数量**：定向 2 案、探索 3 案（推荐）。但数量是次要的，真正要定的是差异门禁的语义——定向路径改为"含 seed 核心设定 + 至少 2 维不同"，探索路径保持 6 维门禁。
3. **骨架附加栏目**：按题材（13 个 Genre）映射（推荐，维护成本低，且可复用 `GENRE_OVERRIDES` 继承），还是按分类（37 个）映射？
4. **结构区间**：先只做"篇幅形态驱动 + 分类的两个硬参数（回报窗口、单章字数）"（推荐），解析按"分类覆盖 → 形态预设 → 全局兜底"三级优先级，不预先写 37×4 矩阵。
5. **优先级校准**：本方案的优先级来自代码证据，不是你的实际体验。你最近开的那本书里，最"像同一个模板"的是面板默认值、三案内容、还是流程步骤？这一条决定 A/B/C 的投入比例。

## 实施顺序

0. 校准：用两个不同分类各跑一遍开书，确认"最像模板"的是哪一层（不改代码，决定后面投入比例）。
1. A 分类创作预设——已完成。
2. B 开书路径分层——已完成。
3. C1/C2 结构参数化 + D 体检阈值分类化——已完成。
4. C3 骨架分类栏目——已完成（C4 按方案砍掉）。
5. 升 `prompt-version.ts` / `FANQIE_PROFILE_VERSION` + 全量回归——已完成（v14 / v2）。

## 如果只做一件事

先做 **A + D**。它们不碰提示词主体，却能让"换个分类就换一套默认值、换一把体检尺子"立刻可见，直接消掉"所有书都从重生+长线连续+100 万字开始"的观感；C 是让生成结果真正分化的那一步，但必须带基准语料，放在后面单独做。
