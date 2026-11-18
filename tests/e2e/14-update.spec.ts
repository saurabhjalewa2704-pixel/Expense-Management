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

  test("UPD-02 a second update arrives while the banner is showing the first (and the app missed it): Refresh still switches to the newest", async ({ page }) => {
    test.setTimeout(120_000);
    // the page can be told to miss later "updatefound" events, as a phone does when it is frozen in the background while a build installs
    await page.addInitScript(() => {
      const add = ServiceWorkerRegistration.prototype.addEventListener;
      ServiceWorkerRegistration.prototype.addEventListener = function (this: ServiceWorkerRegistration, type: string, h: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) {
        if (type !== "updatefound") return add.call(this, type, h, o);
        return add.call(this, type, (e: Event) => { if (!(window as unknown as { __miss?: boolean }).__miss) (typeof h === "function" ? h : h.handleEvent.bind(h))(e); }, o);
      } as typeof add;
    });
    await startDemo(page);
    await controlled(page);
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
    proxy.setBuild("build 2");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByTestId("update-banner")).toBeVisible({ timeout: 20_000 });

    // build 3 is published and installs; the page never hears of it, so the banner still holds build 2's worker, which is now redundant
    await page.evaluate(async () => {
      const reg = (await navigator.serviceWorker.getRegistration())!;
      (window as unknown as { __b: ServiceWorker; __miss: boolean }).__b = reg.waiting!;
      (window as unknown as { __miss: boolean }).__miss = true;
    });
    proxy.setBuild("build 3");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => {
      const reg = (await navigator.serviceWorker.getRegistration())!;
      const old = (window as unknown as { __b: ServiceWorker }).__b;
      return old.state === "redundant" && !!reg.waiting && reg.waiting !== old;
    }), { timeout: 20_000 }).toBe(true);

    await page.getByTestId("update-banner").getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? "gone").catch(() => "navigating"), { timeout: 20_000 }).toBe("gone");   // reloaded, not "Updating…" for ever
    await expect(page.getByTestId("hero")).toBeVisible();
    const active = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.active!.scriptURL));
    expect(active).toContain("/serwist/sw.js");
  });
});
