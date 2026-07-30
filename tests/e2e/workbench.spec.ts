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
    page.getByText("cn-web-fiction.2026-07.v2-structured-genres"),
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
    page.getByRole("heading", { name: "六阶段商业模型" }),
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
