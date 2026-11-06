import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { startClose } from "../helpers";

// MONTH-CLOSE-PRD §14.4 and §15: closing November 2026 on Tue 1 Dec 2026, from the Home card to Done, at 390×844.
test.describe("month close: the §15 scenario", () => {
  test("from the Home card to Done: £4,178.12 spent, £221.88 under budget, Cash £160.00, the snapshot of §10.1", async ({ page }) => {
    await startClose(page);

    // MC-01 the Home card
    const card = page.getByTestId("close-card");
    await expect(card).toContainText("November is ready to close");
    await expect(page.getByTestId("close-card-time")).toHaveText("About 2 min");
    await expect(page.getByTestId("close-card-line")).toContainText("2 days with nothing logged, 2 bills to confirm, 4 balances");
    await expect(page.getByTestId("hero")).toHaveAttribute("aria-label", "Available cash £5,691.87");
    await page.getByTestId("close-start-card").click();

    // MC-05 the overview
    await expect(page.getByTestId("close-title")).toHaveText("Let’s close November");
    await expect(page.getByTestId("close-step-missing-days")).toContainText("2 to check");
    await expect(page.getByTestId("close-step-bills")).toContainText("2 to confirm");
    await expect(page.getByTestId("close-step-balances")).toContainText("4 accounts");
    await expect(page.getByTestId("close-step-tidy-up")).toContainText("2 to look at");
    await expect(page.getByTestId("close-estimate")).toContainText("About 2 minutes");
    await page.getByTestId("close-start").click();

    // step 1: both days are "Nothing to log"
    await expect(page.getByTestId("close-title")).toHaveText("2 days with nothing logged");
    await expect(page.getByTestId("missing-day")).toHaveCount(2);
    await expect(page.getByTestId("missing-day").first()).toContainText("Thursday 5 November");
    await expect(page.getByTestId("missing-day").nth(1)).toContainText("Saturday 14 November");
    for (const d of [0, 1]) await page.getByTestId("missing-day").nth(d).getByTestId("day-no-spend").click();
    await expect(page.getByTestId("close-hint")).toHaveText("2 of 2 answered");
    await expect(page.getByText("Marked as a no-spend day")).toHaveCount(2);
    await page.getByTestId("close-continue").click();

    // step 2: Octopus is confirmed at £71.36, O2 was paid
    await expect(page.getByTestId("close-title")).toHaveText("Confirm 2 bills");
    const octopus = page.getByTestId("bill-item").filter({ hasText: "Octopus Energy" });
    await expect(octopus.getByTestId("bill-input")).toHaveValue("68.00");
    await octopus.getByTestId("bill-input").fill("71.36");
    await octopus.getByTestId("bill-confirm").click();
    await expect(octopus).toContainText("Confirmed at £71.36");
    await page.getByTestId("bill-item").filter({ hasText: "O2" }).getByTestId("bill-paid").click();
    await expect(page.getByTestId("close-hint")).toHaveText("2 of 2 confirmed");
    await page.getByTestId("close-continue").click();

    // step 3: Monzo, HSBC and Amex match; Cash is £20.00 short and is logged as spending on 30 Nov
    await expect(page.getByTestId("close-title")).toHaveText("Do your balances match?");
    await expect(page.getByTestId("balance-item")).toHaveCount(4);                     // Marcus is savings: behind the toggle
    for (const name of ["Monzo", "HSBC Premier"]) await page.getByTestId("balance-item").filter({ hasText: name }).getByTestId("balance-matches").click();
    const cash = page.getByTestId("balance-item").filter({ hasText: "Cash" });
    await expect(cash.getByTestId("sterling-says")).toHaveText("£180.00");
    await cash.getByTestId("balance-input").fill("160");
    await expect(cash.getByTestId("balance-gap")).toContainText("−£20.00");
    await cash.getByTestId("balance-sort").click();
    await expect(page.getByTestId("difference-title")).toHaveText("Cash is £20.00 short");
    await expect(page.getByTestId("difference-category")).toContainText("Other › Untracked cash");
    await expect(page.getByTestId("difference-note")).toContainText("£160.00");
    await page.getByTestId("difference-save").click();
    await expect(cash).toHaveAttribute("data-answer", "untracked_spend");
    const amex = page.getByTestId("balance-item").filter({ hasText: "Amex Gold" });
    await expect(amex.getByTestId("sterling-says")).toHaveText("£1,436.80 owed");
    await amex.getByTestId("balance-matches").click();
    await expect(page.getByTestId("balance-item").filter({ hasText: "Monzo" })).toHaveAttribute("data-answer", "match");
    await page.getByTestId("close-continue").click();

    // step 4: the two Pret coffees are both real; John Lewis is normal spending
    await expect(page.getByTestId("close-title")).toHaveText("2 things to look at");
    await page.getByTestId("tidy-duplicate").getByTestId("dup-both").click();
    await page.getByTestId("tidy-large").getByTestId("normal-spending").click();
    await expect(page.getByTestId("close-hint")).toHaveText("2 of 2 answered");
    await page.getByTestId("close-continue").click();

    // step 5: the review
    await expect(page.getByTestId("close-title")).toHaveText("November in review");
    await expect(page.getByTestId("review-spent-amount")).toHaveText("£4,178.12");
    await expect(page.getByTestId("review-status")).toContainText("Within budget");
    await expect(page.getByTestId("review-pct")).toHaveText("95% of £4,400");
    await expect(page.getByTestId("review-diff")).toHaveText("£221.88 under");
    await expect(page.getByTestId("tile-in")).toContainText("£5,412");
    await expect(page.getByTestId("tile-kept")).toContainText("£1,234");
    await expect(page.getByTestId("tile-kept")).toContainText("23% of money in");
    await expect(page.getByTestId("tile-everyday")).toContainText("£1,870");
    await expect(page.getByTestId("tile-everyday")).toContainText("+2% vs usual");
    await expect(page.getByTestId("bills-regular")).toHaveText("Bills & regular £2,308");
    const cats = page.getByTestId("review-category");
    await expect(cats.first()).toContainText("Home");
    await expect(cats.first()).toContainText("£2,224.35");
    await expect(page.getByTestId("review-category").filter({ hasText: "Eating out" })).toContainText("£98.75 over its £400 limit");
    await expect(page.getByTestId("review-category").filter({ hasText: "Groceries" })).toContainText("£237.60 left of £750");
    await expect(page.getByTestId("forecast-error")).toHaveText(["−0.9%", "−3.6%", "−3.6%", "−1.3%"]);
    await page.getByTestId("close-continue").click();

    // step 6: December
    await expect(page.getByTestId("close-title")).toHaveText("Ready for December?");
    await expect(page.getByTestId("next-budget-amount")).toHaveText("£4,400");
    await expect(page.getByTestId("bills-known")).toHaveText("£2,307.87");
    await expect(page.getByTestId("left-else")).toHaveText("£2,092.13");
    await expect(page.getByTestId("next-limit")).toContainText("Eating out limit");
    await expect(page.getByTestId("next-limit")).toContainText("Over by £98.75 in November · first time");
    await page.getByTestId("close-month").click();

    // MC-64 done
    await expect(page.getByTestId("done-title")).toHaveText("November is closed");
    await expect(page.getByTestId("done-line")).toHaveText("£4,178.12 spent · £221.88 under budget");
    await expect(page.getByTestId("done-fixes")).toContainText("2 days confirmed as no-spend");
    await expect(page.getByTestId("done-fixes")).toContainText("2 bills confirmed");
    await expect(page.getByTestId("done-fixes")).toContainText("4 balances checked, £20.00 of cash spending added");
    await expect(page.getByTestId("done-fixes")).toContainText("2 items reviewed");
    await expect(page.getByTestId("done-count")).toHaveText("1");
    await expect(page.getByTestId("done-next")).toHaveText("Fri 1 Jan");
    await page.getByTestId("done-button").click();
    await expect(page.getByTestId("close-card")).toHaveCount(0);                      // the card disappears once closed

    // Cash ends at £160.00 and the snapshot matches §10.1
    await page.goto("/settings/accounts");
    await expect(page.getByText("£160.00").first()).toBeVisible();
    const row = await sqlOne<{ status: string; snapshot: Record<string, unknown>; duration_s: number }>(`select status, snapshot, duration_s from month_closes where month = '2026-11-01'`);
    expect(row.status).toBe("closed");
    const sn = row.snapshot as {
      v: number; month: string; spent: number; income: number; kept: number; budget: number; budget_status: string; everyday: number; usual_estimate: number;
      by_l1: Record<string, number>; limits: { category_id: string; limit: number; actual: number }[]; forecasts: { date: string; point: number }[];
      balances: { difference: number; resolution: string; transaction_id: string }[]; fixes: Record<string, number>; skipped_steps: string[];
    };
    expect(sn).toMatchObject({ v: 1, month: "2026-11-01", spent: 417812, income: 541240, kept: 123428, budget: 440000, budget_status: "within", everyday: 187025, usual_estimate: 183420, skipped_steps: [] });
    expect(sn.forecasts.map((f) => f.point)).toEqual([413871, 402978, 402601, 412425]);
    expect(sn.balances).toHaveLength(4);
    expect(sn.balances.find((b) => b.resolution === "untracked_spend")).toMatchObject({ difference: -2000 });
    expect(sn.fixes).toMatchObject({ days_no_spend: 2, days_not_tracked: 0, bills_confirmed: 2, duplicates_removed: 0 });
    expect(Object.values(sn.by_l1).reduce((a, b) => a + b, 0)).toBe(417812);
    expect(sn.limits.find((l) => l.limit === 40000)).toMatchObject({ actual: 49875 });
    expect(row.duration_s).toBeGreaterThan(0);
    const cashTxn = await sqlOne<{ amount_pence: string; occurred_on: string; source: string; counts_in_balance: boolean }>(`select amount_pence, occurred_on::text, source, counts_in_balance from transactions where source = 'close'`);
    expect(cashTxn).toMatchObject({ amount_pence: "2000", occurred_on: "2026-11-30", source: "close", counts_in_balance: true });
    const rec = await sql(`select count(*)::int as n from account_reconciliations`);
    expect(rec[0]!.n).toBe(4);
  });
});
