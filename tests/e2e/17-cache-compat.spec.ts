import { expect, test, type Page } from "@playwright/test";
import { startDemo } from "./helpers";

// The query cache is persisted to IndexedDB and restored instantly on the next visit, before anything is refetched. After an
// upgrade it can hold figures shaped by the previous version; the app must cope with that rather than crash on first paint.
const KEY = "sterling-query-cache";

/** Rewrite the persisted cache as an older version would have written it: without the fields added since. */
async function ageCache(page: Page, strip: string[], buster?: string, overrides: Record<string, unknown> = {}) {
  await page.evaluate(async ({ KEY, strip, buster, overrides }) => {
    const db: IDBDatabase = await new Promise((ok, err) => { const r = indexedDB.open("keyval-store"); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
    const store = (mode: IDBTransactionMode) => db.transaction("keyval", mode).objectStore("keyval");
    const client: { buster: string } = await new Promise((ok, err) => { const r = store("readonly").get(KEY); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
    const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !strip.includes(k)).map(([k, x]) => [k, k in overrides ? overrides[k] : walk(x)])) : v;
    const aged = walk(client) as { buster: string };
    if (buster) aged.buster = buster;
    await new Promise<void>((ok, err) => { const r = store("readwrite").put(aged, KEY); r.onsuccess = () => ok(); r.onerror = () => err(r.error); });
    db.close();
  }, { KEY, strip, buster, overrides });
}

test.describe("upgrades never crash on yesterday's cached data", () => {
  test("a cache written before one-off pots existed (no pot fields) still renders Home, Activity and Cash", async ({ page }) => {
    await startDemo(page);
    await page.goto("/activity");
    await expect(page.getByTestId("summary")).toContainText("transactions");
    await page.goto("/cash");
    await expect(page.getByTestId("adds-up")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("hero")).toBeVisible();
    await page.waitForTimeout(2500);                                   // the cache is written to IndexedDB at most once a second
    await ageCache(page, ["pot_pence", "pot_id", "pot_name"]);

    await page.context().setOffline(true);                             // offline, so the old data is all there is to show
    for (const path of ["/", "/activity", "/cash"]) {
      await page.goto(path);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    }
    await page.goto("/");
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("equation")).not.toContainText("NaN");
    await page.context().setOffline(false);
  });

  test("a cache from a different app version is discarded rather than trusted", async ({ page }) => {
    await startDemo(page);
    await page.waitForTimeout(2500);
    await ageCache(page, [], "an-older-build");
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible();
    const buster = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 2500));
      const db: IDBDatabase = await new Promise((ok) => { const r = indexedDB.open("keyval-store"); r.onsuccess = () => ok(r.result); });
      return new Promise<string>((ok) => { const r = db.transaction("keyval").objectStore("keyval").get("sterling-query-cache"); r.onsuccess = () => ok(r.result?.buster); });
    });
    expect(buster).not.toBe("an-older-build");                          // it was thrown away and rewritten for this version
  });

  test("if cached data ever does crash a page, the app clears it and recovers by itself", async ({ page }) => {
    await startDemo(page);
    await page.waitForTimeout(2500);
    await ageCache(page, [], undefined, { opening_pence: "not a number" });      // data no page can render
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible({ timeout: 20_000 });      // crashed once, healed, reloaded
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByTestId("equation")).toContainText("£7,862.40");
  });
});
