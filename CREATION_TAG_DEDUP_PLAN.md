# 开书标签去重方案

> 状态：已实施（2026-09-09）。A/B/D 三类与主题材派生化一次性落地；下列"待确认"按推荐项执行。
> 起因：用户反馈"开书有些标签是不是重复了"。
> 审计范围：`NewProjectModal` 从 0 开书面板全部可选标签（L1 主题材、L2 番茄分类、L2.5 二级流派、L3 复合叙事类型、L4 题材元素、开局形态、篇幅形态、视角、主角身份、情绪基调），以及这些标签进入定位卡与提示词的路径。

## 一、结论

确实有重复，分四类，其中第一类是必须修的"同一批标签在同一面板渲染两次"：

| 类别 | 数量 | 严重度 |
| --- | --- | --- |
| A. 同面板同一批标签渲染两次（含两套状态、两套上限） | 2 组共 18 个词 | 高 |
| B. 跨层重名（不同层可选同一个词） | 17 个词 | 中 |
| C. 数据层同名词（跨频道同名分类，非 bug） | 3 个词 | 低 |
| D. 顺带发现：互斥规则里的负向标签不在任何可选项里 | 4 条死规则 | 中 |

## 二、发现明细（含证据）

### A. 同一面板渲染两次（真重复）

`GENRE_ELEMENT_GROUPS` 的 5 个组里有 2 组与专属字段完全同名同内容，而 `NewProjectModal` 既渲染 5 个元素组，又单独渲染了这两个专属字段：

| 标签 | 元素组 | 专属字段 | 状态字段 | 上限 |
| --- | --- | --- | --- | --- |
| 情绪基调 | `GENRE_ELEMENT_GROUPS`「情绪基调」8 项 | `TONE_TAGS` 8 项 | `genreElements` / `toneTags` | 8 / 2 |
| 主角身份 | `GENRE_ELEMENT_GROUPS`「主角身份」10 项 | `PROTAGONIST_ROLES` 10 项 | `genreElements` / `protagonistRoles` | 8 / 2 |

后果：

1. 视觉上同一批词出现两次，且两处勾选互不联动。
2. 身份/基调占用了题材元素 8 个名额（`NewProjectModal.tsx:549`）：选 2 个身份 + 2 个基调后只剩 4 个元素额度，体检的"元素过量"（`incubation-review.ts:163`，>8 阻断）容易被误触发。
3. 定位卡同时输出「主角身份」和「题材元素」两行，同一个词进提示词两次（`creation-options.ts:81-84`）。
4. 互斥规则只检查 `genreElements`（`incubation-review.ts:151`），从专属字段选的不参与判断，两条路径行为不一致。
5. 默认值就会踩中：`defaultPositioning()` 用 `category.genreElements` 预填元素（`NewProjectModal.tsx:48`），而分类默认元素里常含「群像」等词，同时 `secondaryGenres` 又预填了分类主轴，打开面板即见同一词在两个面板勾选。

### B. 跨层重名

| 重叠 | 词 | 说明 |
| --- | --- | --- |
| L3 复合叙事类型 ∩ L4 题材元素 | 职场、探案、日常、群像、养成 | 5 个词两层都能选 |
| L4 ∩ 开局形态 | 重生、穿越 | 完全同名；另有系统降临/系统、契约绑定/契约关系、日常切入/日常、悬案介入/探案 近义 |
| L4 ∩ 篇幅形态 | 单元剧 | 完全同名；日常经营 vs 日常/经营 近义 |
| L2.5 二级流派 ∩ (L3 ∪ L4) | 成长、权谋、校园、娱乐圈、神豪、规则怪谈、先婚后爱、破镜重圆、治愈 | 60 个二级流派里 9 个重名，影响 14 个分类（详见附录） |
| L1 平台主题材 ∩ L2 番茄分类 | 都市脑洞、科幻末世 | 主题材提示"由分类自动推导"但下拉可改，可造出分类与基线矛盾，视觉上也像同一个词选两次 |

### C. 数据层同名词（非 bug，但需知悉）

`FANQIE_CATEGORY_PROFILES` 里 `科幻末世`、`悬疑脑洞`、`游戏体育` 在男频/女频各有一份（如 `男频:8` / `女频:8`），选择器按 `<optgroup>` 分频道显示，不构成重复。当前代码一律按 `key` 索引，安全；后续不要改成按 `name` 索引。

### D. 顺带发现：失效的互斥规则

`MUTUALLY_EXCLUSIVE_ELEMENTS`（`incubation-review.ts:42`）中的 `无金手指`、`无系统`、`无重生`、`无穿越` 既不在 `GENRE_ELEMENTS`，也不在任何分类的默认元素里，这 4 条互斥永远不会触发。只有 `无CP` 是真实可选项。

## 三、修复方案

设计原则：**单一数据源 + 渲染去重 + 提示词去重**。分层语义保持不变（L1 写作基线、L2 官方分类、L2.5 读者找书口径、L3 叙事主轴、L4 题材元素），只是同一个词不再在多个控件里重复出现。

1. **单一数据源**：`GENRE_ELEMENT_GROUPS` 的「情绪基调」「主角身份」两组直接引用 `TONE_TAGS` / `PROTAGONIST_ROLES`，删除字面量副本（`genre-composition.ts` 从 `creation-options.ts` 引入，注意不要形成反向依赖：`creation-options.ts` 已依赖 `fanqie-taxonomy`，两者都属 `src/shared/`，无循环即可）。
2. **开书面板去重渲染**：`NewProjectModal` 渲染元素组时跳过「情绪基调」「主角身份」两组，这两组只由专属字段呈现（保留 2 项上限的语义）；`StoryBibleWorkspace` 保持不变（没有专属字段，继续用 5 组）。
3. **额度与体检解耦**：题材元素额度只统计「世界与时代 / 故事机制 / 人物关系」三类；`incubation-review` 的元素过量与互斥检查改为同时覆盖三类元素 + 身份 + 基调（或明确限定为元素并同步修正文案）。
4. **跨层去重（渲染层）**：元素网格中，凡已被上层选中的词（主题材、二级流派、复合叙事类型、开局形态、篇幅形态）置灰并提示来源；二级流派中与已选元素/主轴重名的项同样处理。优先级：二级流派 > 复合叙事类型 > 开局形态 > 题材元素。
5. **提示词去重**：`compilePositioningCard` 与 `compileGenreComposition` 拼装前对全部分层做一次按优先级 union 去重，同一个词只出现一次。这样旧草稿即使状态里仍有重叠，进 AI 的文本也不会重复。
6. **平台主题材派生化**：改为只读派生展示（跟随番茄分类），消除与 L2 同名的视觉重复和分类/基线矛盾。若希望保留跨类实验能力，则保留下拉但增加"已偏离分类基线"提示（见待确认项）。
7. **修复死规则**：要么给 `无系统/无重生/无穿越/无金手指` 补上可选项，要么从互斥表删除。推荐删除并改为在自定义创作方向里表达。

## 四、改动清单

| 文件 | 改动 |
| --- | --- |
| `src/shared/genre-composition.ts` | 两个元素组改为引用 `TONE_TAGS` / `PROTAGONIST_ROLES` |
| `src/components/NewProjectModal.tsx` | 跳过两个专属元素组；元素/二级流派网格做跨层去重与来源提示；主题材派生化 |
| `src/shared/creation-options.ts` | `compilePositioningCard` 分层 union 去重 |
| `src/shared/genre-composition.ts` | `compileGenreComposition` 跨层去重 |
| `src/shared/incubation-review.ts` | 元素统计口径 + 互斥表修正 |
| `src/pages/StoryBibleWorkspace.tsx` | 仅确认不受影响（如主题材派生化波及） |
| `src/styles.css` | 置灰/来源提示样式 |

## 五、测试

1. `tests/creation-tag-dedup.test.ts`（新增）：
   - 开书面板各层标签在同一分类下无同名项（用与面板相同的过滤逻辑枚举 37 个分类断言）；
   - `compilePositioningCard` 输出按「；」和「、」切分后无重复 token；
   - `TONE_TAGS` / `PROTAGONIST_ROLES` 与元素组同组为同一引用或派生关系；
   - `MUTUALLY_EXCLUSIVE_ELEMENTS` 的每个词都必须是可选项（防止死规则回归）。
2. `tests/creation-options.test.ts`：更新元素组数量断言（5 组不变，但内容改为引用）。
3. `npm run test:quality`：定位卡属于生成输入，按 AGENTS.md 规则 6，改动后需跑基准对比；必要时在 `quality-benchmark-corpus.ts` 补一条"含重复标签的定位"用例。
4. `npm run build` + `npm test` 后提交。

## 六、待确认（已按推荐项执行）

1. **平台主题材**：已改为只读派生（跟随番茄分类），`positioning.genre` 在每次变更时同步为分类推导值。
2. **跨层重名处理方式**：已置灰并提示来源（`title` 提示"已在「XX」中选择"），并在面板加了一行说明；同名标签在状态层也会被 `dedupePositioningTags` 自动收敛到最高优先级层。
3. **互斥死规则**：已删除失效条目，改为真实互斥对 `无CP + 先婚后爱`、`无CP + 破镜重圆`，并由 `tests/positioning-tags.test.ts` 断言表内每个词都可选。

## 实施结果

| 项 | 落地位置 |
| --- | --- |
| 情绪基调/主角身份单一数据源 | `genre-composition.ts` 两组引用 `TONE_TAGS`/`PROTAGONIST_ROLES`，并标记 `dedicated` |
| 开书面板去重渲染 | `NewProjectModal` 只渲染 `PRIMARY_GENRE_ELEMENT_GROUPS`，两个专属字段保留 |
| 跨层优先级去重 | `creation-options.ts` 的 `positioningTagOwners` / `dedupePositioningTags`（分类 > 主题材 > 二级流派 > 复合叙事类型 > 开局/篇幅 > 身份/基调 > 题材元素） |
| 提示词去重 | `compilePositioningCard` 按层过滤；`compileGenreComposition`、`context-compiler` 用 `dedupeLabels` 过滤与主轴重名的元素 |
| 体检口径 | 元素额度不再计入身份/基调；互斥表修正 |
| 提示词缓存 | `PROMPT_VERSION` → `2026-09-09.v13-positioning-tag-dedupe` |
| 测试 | 新增 `tests/positioning-tags.test.ts`（6 例），e2e 断言两个重复组各只渲染一次 |

验证：`npm test` 593 passed / 1 skipped；`npm run test:quality` 16 passed；`npm run build` 通过；创建流程 e2e 桌面与移动端通过。

## 附录：受二级流派重名影响的分类

都市日常（神豪）、悬疑灵异（规则怪谈）、女频衍生（破镜重圆）、现言脑洞（先婚后爱）、青春甜宠（校园、治愈）、星光璀璨（娱乐圈）、古风世情（权谋）、青春甜宠/其他（成长）；另有 6 个分类的默认主轴与元素同时含「群像」（都市高武、都市种田、动漫衍生、男频衍生、年代、宫斗宅斗、快穿）。

## 实施顺序

1. A 类（单一数据源 + 去重渲染 + 体检口径）——独立提交。
2. B 类（跨层渲染去重 + 提示词去重）——独立提交。
3. 主题材派生化——按待确认项决定后单独提交。
4. D 类死规则 + 测试补齐——独立提交。
