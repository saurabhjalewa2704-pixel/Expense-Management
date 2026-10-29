import { expect, test, type Page } from "@playwright/test";
import { startDemo } from "./helpers";
import { startUpdateProxy } from "./proxy";

const proxy = startUpdateProxy();
test.use({ baseURL: proxy.url });
test.beforeAll(async () => { await proxy.listen(); });
test.afterAll(async () => { await proxy.close(); });
test.beforeEach(() => proxy.setBuild(""));

// A real update, end to end: the page is controlled by one service worker, the server then serves a changed worker script, the
// browser installs it, it waits, and the app offers a Refresh. (Production build only: the worker is not registered in dev.)
/** Wait until the first service worker is active, then reload so this page is controlled by it. */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
}

test.describe("new version banner (PWA)", () => {
  test("a new build waits, the banner offers Refresh, and refreshing switches to it", async ({ page }) => {
    await startDemo(page);
    await controlled(page);
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
    await expect(page.getByTestId("update-banner")).toHaveCount(0);

    proxy.setBuild("build 2");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });

    const banner = page.getByTestId("update-banner");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText("A new version of Sterling is ready.");
    // the banner pushes the page down instead of covering its header
    const h = (await banner.boundingBox())!.height;
    expect(await page.locator(".scroll").first().evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(h);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);        // the page was not reloaded behind the user's back

    await banner.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? "gone").catch(() => "navigating"), { timeout: 20_000 }).toBe("gone");   // reloaded
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
    const active = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.active!.scriptURL));
    expect(active).toContain("/serwist/sw.js");
  });

  test("the banner can be dismissed for now", async ({ page }) => {
    await startDemo(page);
    await controlled(page);
    proxy.setBuild("build 3");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByTestId("update-banner")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Dismiss update banner" }).click();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });
});
