import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

const summary = (page: import("@playwright/test").Page) => page.getByTestId("summary");

test.describe("Activity (ACT-01..03)", () => {
  test.beforeEach(async ({ page }) => { await startDemo(page); await page.goto("/activity"); await expect(summary(page)).toContainText("transaction"); });

  test("ACT-01: grouped by day with each day's net, as in the mock-up", async ({ page }) => {
    await expect(summary(page)).toHaveText("52 transactions · £3,236.85 out · £140.00 in");
    const heads = page.locator(".day-h");
    await expect(heads.nth(0)).toContainText("Today");
    await expect(heads.nth(0).getByTestId("day-net")).toHaveText("−£6.40");
    await expect(heads.nth(1)).toContainText("Yesterday");
    await expect(heads.nth(1).getByTestId("day-net")).toHaveText("−£165.92");
    await expect(heads.nth(2)).toContainText("Fri 16 Oct");
    await expect(heads.nth(2).getByTestId("day-net")).toHaveText("+£60.36");
    await expect(heads.nth(2).getByTestId("day-net")).toHaveClass(/pos/);          // income days are green, spend stays in ink
    const first = page.getByTestId("txn-row").first();
    await expect(first).toContainText("Gail's Bakery");
    await expect(first).toContainText("Coffee & snacks · Amex Gold");
    await expect(first).toContainText("£6.40");
    // income rows carry a + and the positive colour
    const asos = page.getByTestId("txn-row").filter({ hasText: "ASOS" });
    await expect(asos).toContainText("+£121.60");
    await expect(asos.locator(".amt")).toHaveClass(/pos/);
  });

  test("ACT-02: search by payee, category and amount", async ({ page }) => {
    const search = page.getByTestId("search");
    await search.fill("dishoom");
    await expect(summary(page)).toContainText("1 transaction");
    await expect(page.getByTestId("txn-row")).toHaveCount(1);

    await search.fill("86.50");                                   // a lone number is an exact amount
    await expect(page.getByTestId("txn-row")).toHaveCount(1);
    await expect(page.getByTestId("txn-row")).toContainText("Dishoom Kensington");

    await search.fill(">1000");                                   // comparisons filter by amount
    await expect(page.getByTestId("txn-row")).toHaveCount(1);
    await expect(page.getByTestId("txn-row")).toContainText("Foxtons Lettings");

    await search.fill("eating");                                  // category name, parents and sub-categories
    await expect(summary(page)).toContainText("21 transactions");
    await expect(summary(page)).toContainText("£312.60 out");

    await search.fill("waitros");                                 // typo-tolerant (trigram) payee match
    await expect(page.getByTestId("txn-row").first()).toContainText("Waitrose");

    await search.fill("zzzzqqq");
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("ACT-03: type, category (a parent selects its children), account and period filters", async ({ page }) => {
    await page.getByRole("button", { name: /^Type/ }).click();
    await page.getByRole("button", { name: "Income", exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(summary(page)).toHaveText("2 transactions · £0.00 out · £140.00 in");
    await page.getByRole("button", { name: /^Type/ }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: /^Category/ }).click();
    await page.getByRole("button", { name: /^Eating out/ }).first().click();     // the parent row selects all five sub-categories
    await page.getByRole("button", { name: "Done" }).click();
    await expect(summary(page)).toContainText("21 transactions");
    await expect(summary(page)).toContainText("£312.60 out");
    await page.getByRole("button", { name: /^Category/ }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: /^Accounts/ }).click();
    await page.getByRole("button", { name: "Amex Gold" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    const { n, spend } = await sqlOne<{ n: number; spend: string }>(
      `select count(*)::int n, coalesce(sum(amount_pence) filter (where type='expense'),0)::text spend from transactions t
        where occurred_on between '2026-10-01' and '2026-10-18' and deleted_at is null and (account_id = (select id from accounts where name='Amex Gold') or counter_account_id = (select id from accounts where name='Amex Gold'))`);
    await expect(summary(page)).toContainText(`${n} transactions`);
    expect(Number(spend)).toBeGreaterThan(0);

    await page.getByRole("button", { name: /^Accounts/ }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: /^October/ }).click();
    await page.getByRole("button", { name: "Last month" }).click();
    const { sep } = await sqlOne<{ sep: number }>(`select count(*)::int sep from transactions where occurred_on between '2026-09-01' and '2026-09-30' and deleted_at is null`);
    await expect(summary(page)).toContainText(`${sep} transactions`);
  });

  test("infinite scroll pages in every transaction exactly once, keeping day totals whole", async ({ page }) => {
    await page.getByRole("button", { name: /^October/ }).click();
    await page.getByRole("button", { name: "All time" }).click();
    const { total } = await sqlOne<{ total: number }>(`select count(*)::int total from transactions where deleted_at is null`);
    await expect(summary(page)).toContainText(`${total.toLocaleString("en-GB")} transactions`);
    for (let i = 0; i < 40; i++) {
      if ((await page.getByTestId("txn-row").count()) >= total) break;
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(250);
    }
    await expect(page.getByTestId("txn-row")).toHaveCount(total);
    // each day appears once, and each header total equals the database's day net
    const headers = await page.locator(".day-h").evaluateAll((els) => els.map((e) => e.querySelector("b")?.textContent));
    expect(new Set(headers).size).toBe(headers.length);
    const { net } = await sqlOne<{ net: string }>(`select coalesce(sum(case type when 'income' then amount_pence when 'expense' then -amount_pence else 0 end),0)::text net from transactions where occurred_on='2026-09-25' and deleted_at is null`);
    const sep25 = page.locator("section", { has: page.locator(".day-h b", { hasText: "Fri 25 Sep" }) }).getByTestId("day-net");
    const cents = Number(net);
    await expect(sep25).toHaveText(`${cents < 0 ? "−" : "+"}£${(Math.abs(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  });
});
