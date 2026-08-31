import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const BLOCKED_IMPACTS = new Set(["critical", "serious"]);

async function expectNoBlockingAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => BLOCKED_IMPACTS.has(violation.impact as string));
  const summary = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    help: violation.help,
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

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

test("dashboard has no critical or serious accessibility violations", async ({ page }) => {
  await expectNoBlockingAxeViolations(page);
});

test("settings page has no critical or serious accessibility violations", async ({ page }) => {
  await page.getByRole("button", { name: "系统设置" }).click();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expectNoBlockingAxeViolations(page);
});

test("writing workspace has no critical or serious accessibility violations", async ({ page }) => {
  await page.locator(".project-row").filter({ hasText: "回声备忘录" }).click();
  await expect(page.getByRole("heading", { name: "回声备忘录" })).toBeVisible();
  await page.getByRole("button", { name: "写作台" }).click();
  await expect(page.locator(".chapter-scroll")).toBeVisible();
  await expectNoBlockingAxeViolations(page);
});
