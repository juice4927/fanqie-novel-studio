import { expect, test } from "@playwright/test";
import path from "node:path";

const screenshotRoot = process.env.SCREENSHOT_DIR;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "多书总览" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigates through research and the complete project workflow", async ({ page }, testInfo) => {
  await expect(page.locator(".project-row").filter({ hasText: "回声备忘录" })).toBeVisible();
  await page.getByRole("button", { name: "市场研究" }).click();
  await expect(page.getByRole("heading", { name: "榜单、样本与洞察" })).toBeVisible();
  await page.getByRole("button", { name: "样本拆书" }).click();
  await expect(page.getByText("结构研究样本")).toBeVisible();
  await page.getByRole("button", { name: "多书总览" }).click();
  await page.locator(".project-row").filter({ hasText: "回声备忘录" }).click();
  await expect(page.getByRole("heading", { name: "回声备忘录" })).toBeVisible();
  await page.getByRole("button", { name: /写作台/ }).click();
  await expect(page.getByPlaceholder("检索正文")).toBeVisible();
  await page.getByPlaceholder("检索正文").fill("红伞");
  await expect(page.getByText("停电后的第七分钟").first()).toBeVisible();
  const layout = await page.evaluate(() => {
    const chapterList = document.querySelector(".chapter-list")!.getBoundingClientRect();
    const editorToolbar = document.querySelector(".editor-toolbar")!.getBoundingClientRect();
    const actions = document.querySelector(".writing-actions")!.getBoundingClientRect();
    const body = document.querySelector(".editor-body")!.getBoundingClientRect();
    return { chapterBottom: chapterList.bottom, editorTop: editorToolbar.top, actionsBottom: actions.bottom, bodyTop: body.top, width: window.innerWidth };
  });
  if (layout.width <= 600) {
    expect(layout.chapterBottom).toBeLessThanOrEqual(layout.editorTop + 1);
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.bodyTop + 1);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, `${testInfo.project.name}-writing.png`), fullPage: true });
});

test("keeps the dashboard readable without viewport overflow", async ({ page }, testInfo) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("活跃作品")).toBeVisible();
  if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, `${testInfo.project.name}-dashboard.png`), fullPage: true });
});
