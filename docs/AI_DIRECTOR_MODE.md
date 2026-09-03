# AI 导演模式改造方案（AI 主力写作 · 人做导演/审稿）

> 目标：把「AI 生成 → 人肉细读全文 → 手动质检/定稿/扫账本」的线性重流程，改成「AI 批量产出 → 人只扫摘要与风险 → 采纳/打回」的导演式轻流程。不改数据模型与门禁链（契约审批、变更单、定稿门禁照旧）。

## 现状基线（已核实）

- 写作台「AI 生成草稿」把内容**直接流式写入并保存**为章节正文，完成后仅 toast「AI 草稿已生成，尚未定稿」；无审阅/采纳/打回步骤（`WritingWorkspace.tsx` 约 570-607 行）。
- 运行质检、待定稿、确认定稿是三个手动按钮；账本状态扫描在**定稿后**后台跑，候选以 `confidence=待确认` 落入状态账本，作者事后在账本页确认（`WritingWorkspace.tsx` 定稿处 + `LedgerWorkspace.tsx`）。
- 已具备可复用资产：`buildChapterSummary`/`prepareFinalizedChapterSummaries`（摘要）、`runQualityCheck`（本地+语义质检）、`extractChapterFacts` 与定稿扫描候选（账本）、`diffParagraphs` 与修订段落 diff UI（对比）、`previewChapterBatch`/`generateChapterBatch`（批次）。

## P0-1 生成后「审阅产出」面板（核心闭环）

**行为**：AI 生成结束后，写作台打开「本次产出审阅」面板（非覆盖式弹层或内嵌区），包含：
1. 产出摘要：沿用 `buildChapterSummary`（或轻量段落统计）生成 1 段话摘要；
2. 风险标记：非阻塞调用 `runQualityCheck`，列出硬性/警告/建议计数与需人判断的问题；无硬性问题则显示「未发现硬性问题」；
3. 段落级 diff：AI 产出 vs 生成前正文（复用 paragraph-diff 渲染，与历史版本对比同款）；
4. 动作：**采纳**（保持已保存结果，按钮旁给「采纳并质检」快捷下一步）/ **打回重写**（恢复生成前正文，可选填原因）/ **放弃**（仅关闭面板，正文保持生成结果但作者可自行处理）。

**实现**：
- `src/shared/generated-review.ts`（新，纯函数）：`summarizeDraftChange(prev, next)`（字数变化、段落增删、空正文判断）+ `summarizeQualityOverview(issues)`（按严重级计数 + `needsHumanJudgment` 标记），配单测；
- `WritingWorkspace.tsx`：生成成功回调里快照 `beforeGeneration.content`，置 `reviewState={ prevContent, next }`，渲染审阅面板；打回调用现有 `api.saveChapter` 恢复 prev（草稿态无门禁），原因进 `reviewState.notes`；
- 复用现有 `runQualityCheck`/`diffParagraphs`，不新增 IPC；
- 「采纳并质检」= 现有「运行质检 → 待定稿」两个按钮动作的串联。

## P0-2 五章批次「审阅总览」

**行为**：`generateChapterBatch` 完成后打开总览页——每章一行：章号/标题/摘要/质检计数（硬性·警告）/「展开 diff」「采纳」「打回」；支持整批采纳（逐章确认后一起过渡到待质检）。复用并扩展现有 `previewChapterBatch` 结果结构（追加每章摘要与质检概览字段，字段可空则前端降级）。

## P1-1 采纳即报账本变化

**行为**：采纳某章产出时（或在确认定稿时）把「本次产出带来的状态变化」提前到审阅面板内展示为「状态变化」小节——候选来自现有定稿扫描/`extractChapterFacts` 机制，作者逐条确认或忽略后写入账本；扫描失败或未配置 AI 时降级为现有定稿后扫描，不阻塞采纳。

**实现**：复用定稿扫描返回的候选数据结构（`confidence: 待确认`）与 `LedgerWorkspace` 的确认交互；把触发点从「定稿」提前/复制到「采纳后」，并让审阅面板与账本页共享同一套候选确认逻辑（抽成可复用组件/函数，避免双实现）。

## P1-2 打回原因沉淀为导演偏好

**行为**：打回时可选填原因（如「开头节奏太慢」「别用‘旋即’」），确认后写入本书「导演备注」列表；后续生成/修订的上下文注入最近 N 条，作为作者风格约束。

**实现**：
- 存储：用既有 per-project `setSetting`（如 `project.<id>.directorNotes`，JSON 数组，上限 50 条、去重）——**不改 StoryContract**（有门禁）；
- 注入：`context-compiler` 组装上下文时把导演备注并入「作者风格/禁止项」区块（`authorStyle` 或 `forbiddenKnowledge`），超长截断；
- UI：写作台审阅面板打回弹层输入 + 故事圣经或写作台一处「导演备注」查看/编辑入口。

## P2-1 「待我处理」导演清单

**行为**：多书总览新增/强化「今日导演清单」：每本书显示 待审产出数（待质检章数 + 含 AI 产出未审标记）、待确认账本数、硬性问题数、今日待发布；行点击直达对应页签。

**实现**：`dashboard-policy`/`getDashboardActivity` 增加 per-project 待质检章计数与待确认账本计数（聚合查询，沿用「不为统计加载正文」约束）；Dashboard 行内加动作入口。

## 测试计划

- `generated-review` 纯函数单测：字数/段落变化、空正文、质检计数与 `needsHumanJudgment`；
- 浏览器工作流测试：生成后出现审阅面板 → 采纳保留 / 打回恢复旧稿；批次总览逐章采纳；
- context-compiler 注入导演备注测试（含截断）；
- 回归：`npm test`、`npm run test:quality`、`npm run test:e2e`、`npm run lint`、`npx tsc --noEmit`。

## 假设与边界

- 章节正文仍为纯文本，不引入富文本/Markdown；
- **不自动采纳**：AI 产出永远需人工点「采纳」，自动发布不在范围内；
- 不改变章节状态机、契约审批与变更单门禁；
- v1 尽量不新增 IPC 面，复用 `generateChapterDraft`/`generateChapterBatch`/`runQualityCheck`/`saveChapter`/`diffParagraphs` 与定稿扫描候选；
- 导演备注是非门禁辅助数据，不参与契约审批，不进入发布包。

