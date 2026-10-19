import { expect, test } from "@playwright/test";
import { amountKeys, heroPence, startDemo, toast } from "./helpers";

test.describe("desktop (WEB-01..03)", () => {
  test.beforeEach(async ({ page }) => { await startDemo(page); });

  test("S10: sidebar, hero and equation, pace chart, categories, recent table", async ({ page }) => {
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await expect(page.locator(".tabbar")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening), Saurabh/);
    expect(await heroPence(page)).toBe(476555);
    await expect(page.getByTestId("equation")).toHaveText(/Opening£7,862\.40\+In£140\.00−Out£3,236\.85/);
    await expect(page.getByText("You're £367 under September's pace")).toBeVisible();
    await expect(page.getByTestId("pace-chart")).toBeVisible();
    await expect(page.getByText("Eating out is up 38% on your usual")).toBeVisible();
    const rows = page.getByTestId("recent-table").getByTestId("txn-row");
    await expect(rows.first()).toContainText("Gail's Bakery");
    await expect(rows.first()).toContainText("Coffee & snacks");
    await expect(rows.first()).toContainText("£6.40");
    await expect(page.getByTestId("recent-table").getByRole("columnheader")).toHaveText(["Payee", "Category", "Amount"]);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(noScroll).toBe(true);
  });

  test("Quick Add is a centred 480px modal, opened by the button or N, closed by Esc", async ({ page }) => {
    await page.getByRole("button", { name: /Add transaction/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // the modal scales in over ~220 ms, so wait for it to settle before measuring
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(480);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 1440 / 2)).toBeLessThan(2);          // centred
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("n");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("capture with the keyboard alone: digits go to the amount, Enter saves", async ({ page }) => {
    await page.keyboard.press("n");
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.type("15.25");
    await expect(page.getByTestId("amount")).toHaveText("15.25");
    await page.getByRole("radio", { name: /Supermarket/ }).click();
    await page.keyboard.press("Enter");
    await expect(toast(page)).toContainText("Added £15.25");
    await expect.poll(() => heroPence(page)).toBe(476555 - 1525);
  });

  test("G then A/N/I/H navigate, and / focuses search", async ({ page }) => {
    await page.keyboard.press("g"); await page.keyboard.press("a");
    await expect(page).toHaveURL(/\/activity/);
    await page.keyboard.press("g"); await page.keyboard.press("n");
    await expect(page).toHaveURL(/\/analytics/);
    await page.keyboard.press("g"); await page.keyboard.press("h");
    await expect(page).toHaveURL(/\/$/);
    await page.keyboard.press("/");
    await expect(page.locator("#global-search")).toBeFocused();
    await page.keyboard.type("dishoom");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/activity\?q=dishoom/);
    await expect(page.getByTestId("search")).toHaveValue("dishoom");
  });

  test("analytics and cash screens use the width and do not overflow", async ({ page }) => {
    for (const path of ["/analytics", "/cash", "/activity", "/settings/accounts", "/settings/categories"]) {
      await page.goto(path);
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), path).toBe(true);
    }
  });
});
