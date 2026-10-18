import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, heroPence, openAdd, startDemo, toast } from "./helpers";

// Needs the production build: the service worker is only registered there.
test.skip(!process.env.E2E_PROD && !process.env.E2E_PORT?.startsWith("32"), "the service worker only runs on a production build");

test("MOB-08 / CAP-05: the installed app cold-starts with no signal, shows cached figures, and still captures", async ({ page, context }) => {
  await startDemo(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();                                        // now controlled by the service worker: Home is cached
  await expect(page.getByTestId("hero")).toBeVisible();
  await page.goto("/activity");
  await expect(page.getByTestId("summary")).toContainText("52 transactions");
  await page.goto("/");
  await expect.poll(() => heroPence(page)).toBe(476555);
  await page.waitForTimeout(2000);                            // let the query cache persist to IndexedDB

  await context.setOffline(true);
  await page.reload();                                        // a cold start with no network
  await expect.poll(() => heroPence(page), { timeout: 15_000 }).toBe(476555);   // cached figure, no skeleton forever
  await expect(page.getByTestId("txn-row").first()).toContainText("Gail's Bakery");

  await openAdd(page);
  await amountKeys(page, "4.50");
  await page.getByRole("radio", { name: /Supermarket/ }).click();
  await page.getByRole("button", { name: "Add £4.50" }).click();
  await expect(toast(page)).toContainText("Added £4.50");
  await expect.poll(() => heroPence(page)).toBe(476555 - 450);
  expect((await sql(`select count(*)::int n from transactions where amount_pence = 450 and occurred_on = '2026-10-18'`))[0]!.n).toBe(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await sql(`select count(*)::int n from transactions where amount_pence = 450 and occurred_on = '2026-10-18' and deleted_at is null`))[0]!.n, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => heroPence(page)).toBe(476555 - 450);
});

test("the offline page explains itself for a page that was never opened", async ({ page, context }) => {
  await startDemo(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await context.setOffline(true);
  await page.goto("/settings/data").catch(() => {});
  await expect(page.getByRole("heading", { name: /offline|Your data/ })).toBeVisible({ timeout: 15_000 });
});
