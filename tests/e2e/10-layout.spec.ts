import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";

// MOB-10: no horizontal scroll anywhere at 375, 390 and 430 px
for (const width of [375, 390, 430]) {
  test(`no horizontal scroll at ${width}px on any main screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await startDemo(page);
    for (const path of ["/", "/activity", "/analytics", "/insights", "/cash", "/settings", "/settings/accounts", "/settings/categories", "/settings/data", "/settings/reminders"]) {
      await page.goto(path);
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

test("MOB-04: primary touch targets are at least 44×44 (keypad keys 64×52)", async ({ page }) => {
  await startDemo(page);
  const tab = (await page.locator(".tab-add").boundingBox())!;
  expect(tab.width).toBeGreaterThanOrEqual(44); expect(tab.height).toBeGreaterThanOrEqual(44);
  for (const t of await page.locator(".tab").all()) { const b = (await t.boundingBox())!; expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); }
  await page.getByRole("button", { name: "Add transaction" }).click();
  for (const k of await page.locator(".key").all()) { const b = (await k.boundingBox())!; expect(b.width).toBeGreaterThanOrEqual(64); expect(b.height).toBeGreaterThanOrEqual(52); }
});
