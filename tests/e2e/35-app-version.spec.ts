import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";
import { startUpdateProxy } from "./proxy";

// Needs the production build: the service worker (and so "is a newer version waiting?") only exists there.
test.skip(!process.env.E2E_PROD && !process.env.E2E_PORT?.startsWith("32"), "the service worker only runs on a production build");

const proxy = startUpdateProxy();
test.use({ baseURL: proxy.url });
test.beforeAll(async () => { await proxy.listen(); });
test.afterAll(async () => { await proxy.close(); });
test.beforeEach(() => proxy.setBuild(""));
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test("VER-01 Settings shows the release and build, says when it is the latest, and offers the newer version when there is one", async ({ page }) => {
  await startDemo(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await page.goto("/settings");

  // the release number from package.json, and the build it came from
  await expect(page.getByTestId("version-number")).toHaveText(`Sterling ${version}`);
  await expect(page.getByTestId("version-build")).toContainText(/^Build \S{3,7}( · \d{1,2} \w{3} \d{4})?$/);
  await expect(page.getByTestId("version-status")).toHaveText("You’re on the latest version", { timeout: 20_000 });

  // a newer build is published: checking finds it, and Refresh switches to it
  proxy.setBuild("build 2");
  await page.getByTestId("version-check").click();
  await expect(page.getByTestId("version-status")).toHaveText("A newer version is ready", { timeout: 20_000 });
  await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
  await page.getByTestId("version-refresh").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? "gone").catch(() => "navigating"), { timeout: 20_000 }).toBe("gone");
  await expect(page.getByTestId("version-status")).toHaveText("You’re on the latest version", { timeout: 25_000 });
});
