import { expect, test, type Page } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, openAdd, startDemo } from "./helpers";

// "Waiting": an entry that never leaves the phone while the server looks healthy. A captured entry must reach the server whatever build the
// app is on, and when it cannot be sent the app must say why.
async function add(page: Page, amount: string, payee: string) {
  await openAdd(page);
  await amountKeys(page, amount);
  await page.getByLabel("Payee").fill(payee);
  await page.getByTestId("qcard").first().click();
  await page.getByRole("button", { name: new RegExp(`^Add £${amount.replace(".", "\\.")}`) }).click();
}
const rows = async (pence: number) => (await sql(`select 1 from transactions where amount_pence = ${pence} and deleted_at is null`)).length;

test.describe("entries waiting to be sent", () => {
  test("WAIT-01 an app on an older build (its Server Action ids unknown to the server) still gets its entries through", async ({ page }) => {
    await startDemo(page);
    await page.route("**/*", (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) return route.continue({ headers: { ...r.headers(), "next-action": "00".repeat(21) } });   // an action id from another build
      return route.continue();
    });
    await add(page, "7.77", "Old Build Cafe");
    await expect.poll(() => rows(777), { timeout: 15_000 }).toBe(1);
    await page.goto("/activity");
    await expect(page.getByTestId("txn-row").filter({ hasText: "Old Build Cafe" })).toBeVisible();
    await expect(page.getByLabel("Waiting to sync")).toHaveCount(0);
  });

  test("WAIT-02 an entry the server cannot take is explained, kept on the phone, and goes through when it can", async ({ page }) => {
    await startDemo(page);
    let broken = true;
    await page.route("**/api/transactions", (route) => (broken ? route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }) : route.continue()));
    const before = await rows(888);                                                                 // the demo data already holds a £8.88
    await add(page, "8.88", "Flaky Cafe");
    const banner = page.getByTestId("stuck-entry");
    await expect(banner).toContainText("An entry hasn’t been sent yet.", { timeout: 15_000 });
    await expect(banner).toContainText("(502)");
    await expect(banner).toContainText("saved on this phone");
    expect(await rows(888)).toBe(before);                                                           // nothing reached the server
    await expect(page.getByLabel("Waiting to sync")).toHaveCount(1);

    broken = false;
    await banner.getByRole("button", { name: "Try now" }).click();
    await expect.poll(() => rows(888), { timeout: 15_000 }).toBe(before + 1);
    await expect(page.getByTestId("stuck-entry")).toHaveCount(0);
  });

  test("WAIT-03 signed out: the entry says so, and is sent after signing back in", async ({ page }) => {
    await startDemo(page);
    let out = true;
    await page.route("**/api/transactions", (route) => (out ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "You're signed out.", retry: true }) }) : route.continue()));
    await add(page, "9.99", "Signed Out Cafe");
    await expect(page.getByTestId("stuck-entry")).toContainText("signed out", { timeout: 15_000 });
    out = false;
    await page.getByTestId("stuck-entry").getByRole("button", { name: "Try now" }).click();
    await expect.poll(() => rows(999), { timeout: 15_000 }).toBe(1);
  });

  test("WAIT-04 a failed save that is really an old build (edit, delete…) switches the app to the new version instead of failing quietly", async ({ page }) => {
    await startDemo(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.goto("/activity");
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
    await page.route("**/*", (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) return route.continue({ headers: { ...r.headers(), "next-action": "00".repeat(21) } });
      return route.continue();
    });
    await page.getByTestId("txn-row").first().click();
    await page.getByRole("button", { name: "Save changes" }).click().catch(() => undefined);
    // the page reloads itself (the marker we left in the old page is gone) and the stored copy of pages is dropped
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? "gone").catch(() => "navigating"), { timeout: 30_000 }).toBe("gone");
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
  });

  test("WAIT-05 one request that never answers does not hold back the entries after it", async ({ page }) => {
    test.setTimeout(120_000);
    await startDemo(page);
    let hold = true;
    await page.route("**/api/transactions", (route) => { if (hold) return; return route.continue(); });    // the first send is never answered
    await add(page, "6.11", "Hung Cafe");
    await page.waitForTimeout(2500);
    hold = false;                                                                                         // the network is fine again from here on
    await add(page, "6.22", "After The Hang Cafe");
    // the stuck send is abandoned after its time limit and both entries go through by themselves, with no reopening of the app
    await expect.poll(async () => `${await rows(611)}/${await rows(622)}`, { timeout: 60_000, intervals: [2000] }).toBe("1/1");
    await expect(page.getByLabel("Waiting to sync")).toHaveCount(0);
  });
});
