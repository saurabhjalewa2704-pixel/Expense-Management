import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, heroPence, openAdd, startDemo, toast } from "./helpers";

const COFFEE_BEFORE = 476555; // £4,765.55

test.describe("capture (CAP-01..05)", () => {
  test("CAP-01: a known payee logs in three taps, and the hero updates without a reload", async ({ page }) => {
    await startDemo(page);
    expect(await heroPence(page)).toBe(COFFEE_BEFORE);

    await openAdd(page);                                   // tap 1: ＋
    await amountKeys(page, "12.80");                        // the amount
    await page.getByLabel("Payee").fill("Gail");
    await page.getByRole("option", { name: /Gail's Bakery/ }).click();   // payee memory fills category + account
    await expect(page.getByRole("radio", { name: "Coffee & snacks" })).toBeChecked();
    await expect(page.getByRole("button", { name: /Account Amex Gold/ })).toBeVisible();
    await page.getByRole("radio", { name: "Coffee & snacks" }).click(); // tap 3: the category IS the save (tap to save)

    await expect(toast(page)).toContainText("Added £12.80 · Coffee & snacks");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE - 1280);
    await expect(page.getByTestId("txn-row").first()).toContainText("£12.80");

    // it reached Postgres once, with the learned account and category
    await expect.poll(async () => (await sql(`select count(*)::int n from transactions where amount_pence = 1280 and deleted_at is null`))[0]!.n).toBe(1);
    const [row] = await sql<{ category: string; account: string; payee: string; occurred_on: string }>(
      `select c.name category, a.name account, p.name payee, t.occurred_on::text from transactions t join categories c on c.id=t.category_id join accounts a on a.id=t.account_id join payees p on p.id=t.payee_id where t.amount_pence=1280`);
    expect(row).toMatchObject({ category: "Coffee & snacks", account: "Amex Gold", payee: "Gail's Bakery", occurred_on: "2026-10-18" });
    // payee memory counted the visit
    expect((await sql<{ use_count: number }>(`select use_count from payees where name = 'Gail''s Bakery'`))[0]!.use_count).toBeGreaterThan(1);
  });

  test("CAP-01: Quick Add opens in under 100 ms (production build)", async ({ page }) => {
    test.skip(!process.env.E2E_PROD && !process.env.E2E_PORT?.startsWith("32"), "timing is only meaningful on a production build");
    await startDemo(page);
    await page.waitForTimeout(1500);
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      times.push(await page.evaluate(() => new Promise<number>((res) => {
        const t0 = performance.now();
        const obs = new MutationObserver(() => { if (document.querySelector("[data-testid=quick-add]")) { obs.disconnect(); requestAnimationFrame(() => res(performance.now() - t0)); } });
        obs.observe(document.body, { childList: true, subtree: true });
        (document.querySelector(".tab-add") as HTMLElement).click();
      })));
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("quick-add")).toHaveCount(0);
    }
    expect(Math.min(...times)).toBeLessThan(100);
    expect(times.sort((a, b) => a - b)[1]).toBeLessThan(100);
  });

  test("EC-C6 Undo removes it completely and the hero goes back", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "9.99");
    await page.getByRole("radio", { name: /Supermarket/ }).click();
    await page.getByRole("button", { name: "Add £9.99" }).click();
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE - 999);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE);
    await expect.poll(async () => (await sql(`select count(*)::int n from transactions where amount_pence = 999 and deleted_at is null`))[0]!.n).toBe(0);
    await page.goto("/activity");
    await expect(page.getByText("£9.99")).toHaveCount(0);
  });

  test("manual path: pick a sub-category through More, then Add", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "5");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Transport", exact: true }).click();
    await expect(page.getByTestId("cat-list")).toContainText("Transport (general)");     // the parent's own list slides in
    await page.getByRole("button", { name: "Taxis" }).click();
    await expect(page.getByRole("radio", { name: "Taxis" })).toBeChecked();   // the chosen sub-category leads the chips
    await page.getByRole("button", { name: "Add £5.00" }).click();
    await expect(toast(page)).toContainText("Added £5.00 · Taxis");
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int n from transactions t join categories c on c.id=t.category_id where c.name='Taxis' and t.amount_pence=500`))[0]!.n).toBe(1);
  });

  test("the keypad: two decimals, a leading dot becomes 0., long-press backspace clears", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, ".5");
    await expect(page.getByTestId("amount")).toHaveText("0.5");
    await amountKeys(page, "67");
    await expect(page.getByTestId("amount")).toHaveText("0.56");   // third digit ignored
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("amount")).toHaveText("0.5");
    await amountKeys(page, "0");
    await page.getByRole("button", { name: "Delete" }).click({ delay: 700 });   // long press clears
    await expect(page.getByTestId("amount")).toHaveText("0");
    await amountKeys(page, "1234567");
    await expect(page.getByTestId("amount")).toHaveText("123,456");            // capped at £999,999.99
  });

  test("EC-C9 the primary button waits for an amount and a category; swipe-down asks before discarding", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await expect(page.getByRole("button", { name: /^Add £/ })).toBeDisabled();
    await amountKeys(page, "3");
    await expect(page.getByRole("button", { name: /^Add £/ })).toBeDisabled();           // still no category
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "Discard this entry?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
  });

  test("CAP-02 income and CAP-03 transfer", async ({ page }) => {
    await startDemo(page);
    // income raises available cash
    await openAdd(page);
    await page.getByRole("tab", { name: "Income" }).click();
    await amountKeys(page, "100");
    await expect(page.getByRole("radio", { name: "Salary" })).toBeVisible();
    await page.getByRole("radio", { name: "Salary" }).click();
    await page.getByRole("button", { name: "Add income £100.00" }).click();
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE + 10000);

    // a transfer inside the pool changes no figure but moves both balances (Monzo -> Amex £500)
    await openAdd(page);
    await page.getByRole("tab", { name: "Transfer" }).click();
    await amountKeys(page, "500");
    await page.getByRole("button", { name: /^From/ }).click();
    await page.getByRole("button", { name: /^Monzo/ }).click();
    await page.getByRole("button", { name: /^To/ }).click();
    await page.getByRole("button", { name: /^Amex Gold/ }).click();
    await page.getByRole("button", { name: "Transfer £500.00" }).click();
    await expect(toast(page)).toContainText("Moved £500.00 · Monzo → Amex Gold");
    await page.waitForTimeout(800);
    expect(await heroPence(page)).toBe(COFFEE_BEFORE + 10000);
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int n from transactions where type='transfer' and amount_pence=50000 and occurred_on='2026-10-18'`))[0]!.n).toBe(1);
  });

  test("CAP-04: edit an entry, then delete it with Undo", async ({ page }) => {
    await startDemo(page);
    await page.getByTestId("txn-row").filter({ hasText: "Gail's Bakery" }).click();
    await expect(page.getByTestId("amount")).toHaveText("6.40");
    await expect(page.getByLabel("Payee")).toHaveValue("Gail's Bakery");
    await page.getByRole("button", { name: "Delete", exact: true }).click({ delay: 700 });   // long-press backspace clears
    await amountKeys(page, "7.40");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Saved");
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE - 100);                     // 6.40 -> 7.40
    expect((await sql<{ amount_pence: string }>(`select amount_pence::text from transactions where payee_id = (select id from payees where name='Gail''s Bakery') and occurred_on='2026-10-18'`))[0]!.amount_pence).toBe("740");

    // delete (with a confirmation), then Undo brings it back
    await page.getByTestId("txn-row").filter({ hasText: "Gail's Bakery" }).click();
    await page.getByRole("button", { name: "Delete transaction" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Transaction deleted");
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE + 640);                     // gone entirely
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE - 100);                     // back at £7.40
  });

  test("EC-C2 CAP-05: offline capture survives killing the app and syncs exactly once", async ({ page, context }) => {
    await startDemo(page);
    await page.waitForTimeout(1500);                       // let the queries settle into the cache
    await context.setOffline(true);

    for (const amt of ["1.00", "2.00", "3.00"]) {
      await openAdd(page);
      await amountKeys(page, amt);
      await page.getByRole("radio", { name: /Supermarket/ }).click();
      await page.getByRole("button", { name: `Add £${amt}` }).click();
      await expect(toast(page)).toContainText(`Added £${amt}`);
      await expect(page.getByTestId("quick-add")).toHaveCount(0);
    }
    // shown optimistically everywhere, with a "waiting to sync" marker; nothing has reached the server
    await expect.poll(() => heroPence(page)).toBe(COFFEE_BEFORE - 600);
    await expect(page.locator('[data-testid="txn-row"][data-pending]')).toHaveCount(3);
    await expect(page.getByLabel("Waiting to sync").first()).toBeVisible();
    expect((await sql(`select count(*)::int n from transactions where amount_pence in (100,200,300) and occurred_on='2026-10-18'`))[0]!.n).toBe(0);

    await page.close();                                    // kill the app
    await context.setOffline(false);
    const reopened = await context.newPage();
    await reopened.goto("/");                              // relaunch online: the outbox flushes on launch
    await expect.poll(async () => (await sql(`select count(*)::int n from transactions where amount_pence in (100,200,300) and occurred_on='2026-10-18' and deleted_at is null`))[0]!.n, { timeout: 20_000 }).toBe(3);
    await expect.poll(() => heroPence(reopened)).toBe(COFFEE_BEFORE - 600);
    await expect(reopened.locator('[data-testid="txn-row"][data-pending]')).toHaveCount(0);
    await reopened.waitForTimeout(1500);                   // and nothing is sent twice
    expect((await sql(`select count(distinct client_id)::int n from transactions where amount_pence in (100,200,300) and occurred_on='2026-10-18'`))[0]!.n).toBe(3);
    expect((await sql(`select count(*)::int n from transactions where amount_pence in (100,200,300) and occurred_on='2026-10-18'`))[0]!.n).toBe(3);
  });
});
