import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// An entry dated before its account's start used to be refused by the server after the app had already said "Added",
// then vanished (no row, no balance change, no message). Now the app asks first, and a refused entry never disappears silently.
test.describe("entries from before an account's start date", () => {
  test("Quick Add offers to move the start back, and then the entry counts", async ({ page }) => {
    await startDemo(page);
    await sql(`insert into accounts (user_id, name, type, opening_balance_pence, opening_date) select id, 'Fresh', 'current', 100000, '2026-10-17' from auth.users limit 1`);
    await page.reload();
    await page.getByRole("button", { name: "Add transaction" }).click();
    for (const k of ["1", "2"]) await page.getByRole("button", { name: k, exact: true }).click();
    await page.getByLabel("Payee").fill("Corner Shop");
    await page.getByRole("radio").first().click();            // a new payee is not remembered, so choosing a category does not save yet
    await page.getByRole("button", { name: /^Account / }).click();
    await page.getByRole("button", { name: /^Fresh/ }).click();
    await expect(page.getByRole("button", { name: /^Account Fresh/ })).toBeVisible();
    await page.getByRole("button", { name: /^Date / }).click();
    await expect(page.getByRole("dialog", { name: "Choose a date" })).toBeVisible();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2026-10-15");
    await page.getByRole("button", { name: /^Add £12\.00/ }).click();
    await expect(page.getByTestId("start-title")).toHaveText("Fresh starts on Sat 17 Oct.");
    await page.getByTestId("start-move").click();
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from transactions where occurred_on = '2026-10-15' and amount_pence = 1200`)).n).toBe(1);
    expect(await sqlOne(`select opening_date::text d from accounts where name = 'Fresh'`)).toEqual({ d: "2026-10-15" });
    expect(await sqlOne(`select balance_pence::int b from account_balances('2026-10-18') where name = 'Fresh'`)).toEqual({ b: 100000 - 1200 });   // today's balance changed by the entry
    await page.goto("/activity");
    await page.getByTestId("search").fill("Corner Shop");
    await expect(page.getByTestId("txn-row")).toHaveCount(1);
  });

  test("an entry the server refused stays visible with its reason, and can be discarded", async ({ page }) => {
    await startDemo(page);
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("sterling");
        open.onupgradeneeded = () => { open.result.createObjectStore("outbox", { keyPath: "client_id" }); };
        open.onsuccess = () => {
          const tx = open.result.transaction("outbox", "readwrite");
          tx.objectStore("outbox").put({
            client_id: "00000000-0000-7000-8000-000000000001", created_at: Date.now(), status: "failed", attempts: 1, error: "This account starts on 19 Oct 2026; it cannot hold earlier transactions",
            payload: { client_id: "00000000-0000-7000-8000-000000000001", type: "expense", amount_pence: 1200, account_id: "00000000-0000-0000-0000-000000000000", category_id: null, payee: "Corner Shop", note: null, tags: [], occurred_on: "2026-10-15", occurred_at: null, account_manual: false, source: "app", pot_id: null },
          });
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();
    const banner = page.getByTestId("failed-entry");
    await expect(banner).toContainText("An entry wasn’t saved.");
    await expect(banner).toContainText("£12.00 · Corner Shop (15/10/2026)");
    await expect(banner).toContainText("This account starts on 19 Oct 2026");
    await banner.getByRole("button", { name: "Discard this entry" }).click();
    await expect(banner).toHaveCount(0);
  });
});
