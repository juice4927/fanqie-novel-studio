import { expect, test } from "@playwright/test";
import path from "node:path";

const screenshotRoot = process.env.SCREENSHOT_DIR;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "多书总览" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigates through research and the complete project workflow", async ({
  page,
}, testInfo) => {
  await expect(
    page.locator(".project-row").filter({ hasText: "回声备忘录" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "市场研究" }).click();
  await expect(
    page.getByRole("heading", { name: "榜单、样本与洞察" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "商业知识" }).click();
  await expect(
    page.getByText("cn-web-fiction.2026-07.v4-adaptive-genres"),
  ).toBeVisible();
  for (const genre of [
    "都市脑洞",
    "玄幻/仙侠",
    "历史/架空",
    "现言甜宠",
    "古言宅斗",
    "年代重生",
  ])
    await expect(page.getByText(genre, { exact: true }).first()).toBeVisible();
  if (screenshotRoot)
    await page.screenshot({
      path: path.join(
        screenshotRoot,
        `${testInfo.project.name}-genre-knowledge.png`,
      ),
      fullPage: true,
    });
  await page.getByRole("button", { name: "样本拆书" }).click();
  await expect(page.getByText("结构研究样本")).toBeVisible();
  await page.getByRole("button", { name: "多书总览" }).click();
  await page.locator(".project-row").filter({ hasText: "回声备忘录" }).click();
  await expect(page.getByRole("heading", { name: "回声备忘录" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "题材节奏参考" }),
  ).toBeVisible();
  await expect(
    page.getByText("六个常见功能仅作工具；本书实际阶段由已审批宏观规划决定。"),
  ).toBeVisible();
  for (const stage of ["开篇", "追读", "扩张", "中期", "高潮", "收束"])
    await expect(
      page.getByRole("heading", { name: stage, exact: true }),
    ).toBeVisible();
  if (screenshotRoot)
    await page.screenshot({
      path: path.join(
        screenshotRoot,
        `${testInfo.project.name}-genre-stages.png`,
      ),
      fullPage: true,
    });
  await page.getByRole("button", { name: /写作台/ }).click();
  await expect(page.getByPlaceholder("检索正文")).toBeVisible();
  await expect(page.getByText("本章承诺", { exact: true })).toBeVisible();
  await expect(page.getByText("预期回报", { exact: true })).toBeVisible();
  await expect(page.getByText("当前危机", { exact: true })).toBeVisible();
  await expect(page.getByText("结尾期待", { exact: true })).toBeVisible();
  await page.locator(".chapter-scroll button").filter({ hasText: "回声的代价" }).click();
  await page.getByRole("button", { name: "预览上下文" }).click();
  await expect(page.getByText("上下文包", { exact: true })).toBeVisible();
  await expect(page.locator(".context-diagnostic").filter({ hasText: "创作契约" })).toContainText("已审批创作契约");
  await expect(page.locator(".context-diagnostic").filter({ hasText: "相关事实" })).toContainText(/\d+\/\d+ 项/);
  await expect(page.locator(".context-diagnostic-list")).toBeVisible();
  await page.getByRole("button", { name: "关闭上下文" }).click();
  const manuscript = page.getByPlaceholder("在这里写正文，或先保存章纲后使用 AI 生成草稿。");
  await manuscript.fill("自动保存回归文本：雨落在旧城的玻璃窗上。");
  await expect(page.getByRole("status")).toHaveText("已保存", { timeout: 5000 });
  await page.getByRole("button", { name: /状态账本/ }).click();
  await page.getByRole("button", { name: /写作台/ }).click();
  await page.locator(".chapter-scroll button").filter({ hasText: "回声的代价" }).click();
  await expect(page.getByPlaceholder("在这里写正文，或先保存章纲后使用 AI 生成草稿。")).toHaveValue("自动保存回归文本：雨落在旧城的玻璃窗上。");
  await page.getByPlaceholder("检索正文").fill("红伞");
  await expect(page.getByText("停电后的第七分钟").first()).toBeVisible();
  const layout = await page.evaluate(() => {
    const chapterList = document
      .querySelector(".chapter-list")!
      .getBoundingClientRect();
    const editorToolbar = document
      .querySelector(".editor-toolbar")!
      .getBoundingClientRect();
    const actions = document
      .querySelector(".writing-actions")!
      .getBoundingClientRect();
    const body = document
      .querySelector(".editor-body")!
      .getBoundingClientRect();
    return {
      chapterBottom: chapterList.bottom,
      editorTop: editorToolbar.top,
      actionsBottom: actions.bottom,
      bodyTop: body.top,
      width: window.innerWidth,
    };
  });
  if (layout.width <= 600) {
    expect(layout.chapterBottom).toBeLessThanOrEqual(layout.editorTop + 1);
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.bodyTop + 1);
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  if (screenshotRoot)
    await page.screenshot({
      path: path.join(screenshotRoot, `${testInfo.project.name}-writing.png`),
      fullPage: true,
    });
  await page.getByRole("button", { name: /状态账本/ }).click();
  await expect(
    page.getByRole("heading", { name: "都市脑洞专属账本" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /能力规则表/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "期待 / 兑现账本" }),
  ).toBeVisible();
  await expect(page.getByText("红伞女孩为何也能听见回声")).toBeVisible();
  const ledgerOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(ledgerOverflow).toBeLessThanOrEqual(1);
  if (screenshotRoot)
    await page.screenshot({
      path: path.join(
        screenshotRoot,
        `${testInfo.project.name}-expectation-ledger.png`,
      ),
      fullPage: true,
    });
});

test("keeps the dashboard readable without viewport overflow", async ({
  page,
}, testInfo) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("活跃作品")).toBeVisible();
  if (screenshotRoot)
    await page.screenshot({
      path: path.join(screenshotRoot, `${testInfo.project.name}-dashboard.png`),
      fullPage: true,
    });
});

test("shows automatic backup controls without exposing stored secrets", async ({ page }) => {
  await page.getByRole("button", { name: "系统设置" }).click();
  await expect(page.getByRole("heading", { name: "自动加密备份" })).toBeVisible();
  await expect(page.getByText("启用自动备份", { exact: true })).toBeVisible();
  await expect(page.getByLabel("自动备份专用密码")).toHaveValue("");
  await expect(page.getByRole("button", { name: "立即备份" })).toBeDisabled();
  await expect(page.getByLabel("长任务总时限")).toHaveValue("10");
  await page.getByRole("button", { name: "运行健康检查" }).click();
  await expect(page.getByRole("article").getByText("浏览器预览数据", { exact: true })).toBeVisible();
  await expect(page.getByText("localStorage 数据可读取；SQLite 完整性检查仅在桌面版可用")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("creates a book from zero through AI concept selection", async ({ page }) => {
  await page.getByRole("button", { name: "新建作品" }).first().click();
  await expect(page.getByRole("dialog", { name: "从 0 开始创建一本书" })).toBeVisible();
  await expect(page.getByText("AI 从零开书", { exact: true })).toBeVisible();
  await expect(page.getByText("平台商业基线", { exact: true })).toBeVisible();
  await expect(page.getByText(/三套方案会分别选择不同叙事主轴/)).toBeVisible();
  await page.getByRole("button", { name: "生成三套方案" }).click();
  await expect(page.getByRole("heading", { name: "她把烂账改成了金饭碗" })).toBeVisible();
  await expect(page.locator(".book-concept-grid > button")).toHaveCount(3);
  await page.getByRole("button", { name: /离婚当天，我接手了倒闭供销社/ }).click();
  await page.getByRole("button", { name: "采用此方案并创建" }).click();
  await expect(page.getByRole("heading", { name: "离婚当天，我接手了倒闭供销社" })).toBeVisible();
  await page.getByRole("button", { name: /故事圣经/ }).click();
  await expect(page.getByLabel("故事前提")).toHaveValue(/被夺走婚房的基层职员/);
  await expect(page.getByLabel("经营", { exact: true })).toBeChecked();
  await expect(page.getByLabel("群像", { exact: true })).toBeChecked();
  await expect(page.getByRole("heading", { name: "审美设定" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 优化本书审美" })).toBeVisible();
  await expect(page.getByLabel("叙事距离")).toHaveValue("适中");
  await expect(page.getByLabel("情绪温度")).toHaveValue("均衡");
  await expect(page.getByLabel("文字质地")).toBeVisible();
  await expect(page.getByLabel("对话风格")).toBeVisible();
  await expect(page.getByLabel("情绪表达")).toBeVisible();
  await expect(page.getByRole("button", { name: "审批契约" })).toBeVisible();
});

test("traps modal focus, closes with Escape, and restores focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "新建作品" }).first();
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "从 0 开始创建一本书" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("reviews chapters through the quality queue", async ({ page }) => {
  await page.locator(".project-row").filter({ hasText: "回声备忘录" }).click();
  await page.getByRole("button", { name: /质检中心/ }).click();
  await expect(page.getByRole("heading", { name: "章节审稿队列" })).toBeVisible();
  const queued = page.locator(".review-queue article").filter({ hasText: "停电后的第七分钟" });
  await expect(queued).toContainText("其他 1");
  await queued.getByRole("button", { name: /第 1 章/ }).click();
  await expect(page.getByLabel("筛选审稿章节")).toHaveValue("demo-chapter-1");
  await queued.getByRole("button", { name: "运行质检" }).click();
  await expect(page.getByText("第1章质检已更新")).toBeVisible();
});

test("records an operations experiment without changing story content", async ({ page }) => {
  await page.locator(".project-row").filter({ hasText: "回声备忘录" }).click();
  await page.getByRole("button", { name: /数据复盘/ }).click();
  await page.getByRole("button", { name: "新建实验" }).click();
  const dialog = page.getByRole("dialog", { name: "新建运营实验" });
  await dialog.getByLabel("实验标题").fill("减少重复回报机制");
  await dialog.getByLabel("可验证假设").fill("减少连续震惊桥段后，七日追读率提高两个百分点");
  await dialog.getByLabel("计划改动").fill("第10至15章改用关系与资源回报");
  await dialog.getByLabel("影响起始章").fill("10");
  await dialog.getByLabel("影响结束章").fill("15");
  await dialog.getByLabel("成功标准").fill("七日追读率提高2个百分点");
  await dialog.getByLabel("干扰因素").fill("记录同期推荐量、发布时间和断更情况");
  await dialog.getByRole("button", { name: "保存实验" }).click();
  await expect(page.getByRole("dialog", { name: "新建运营实验" })).toBeHidden();
  const experiment = page.locator(".experiment-list article").filter({ hasText: "减少重复回报机制" });
  await expect(experiment).toContainText("第10–15章");
  await expect(experiment).toContainText("追读率");
});
