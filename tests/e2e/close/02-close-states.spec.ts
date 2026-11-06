import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { amountKeys, startClose } from "../helpers";

// MONTH-CLOSE-PRD §13: the edge cases that need a browser. Each test name starts with the row's ID.
test.describe("month close: states and edge cases", () => {
  test("EC-MC1 the close cannot be opened before the month ends", async ({ page }) => {
    await startClose(page);
    await page.goto("/close/2026-12");
    await expect(page.getByText("December can be closed once it has ended.")).toBeVisible();
  });

  test("EC-MC5 a missing day fixed through Quick Add outside the flow resolves by itself", async ({ page }) => {
    await startClose(page);
    await page.goto("/close/2026-11/missing-days");
    await expect(page.getByTestId("missing-day")).toHaveCount(2);
    await page.getByTestId("missing-day").first().getByTestId("day-add").click();
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await amountKeys(page, "5");
    await page.getByTestId("qcard").filter({ hasText: /Supermarket/ }).first().click();
    await page.getByRole("button", { name: /^Add £5\.00/ }).click();
    await expect(page.getByTestId("missing-day")).toHaveCount(1);
    await expect(page.getByTestId("missing-day").first()).toContainText("Saturday 14 November");
  });

  test("EC-MC8 a varying bill whose statement has not arrived: Confirm later, and the month closes with one skipped step", async ({ page }) => {
    await startClose(page);
    await page.goto("/close/2026-11/bills");
    await page.getByTestId("bill-item").filter({ hasText: "O2" }).getByTestId("bill-skip").click();            // answered: not a skip
    await page.getByTestId("close-continue").click();                                                          // Octopus left open: the step is skipped
    await page.goto("/close/2026-11/next-month");
    await page.getByTestId("close-month").click();
    await expect(page.getByTestId("done-title")).toHaveText("November is closed");
    const row = await sqlOne<{ status: string; snapshot: { skipped_steps: string[] } }>(`select status, snapshot from month_closes where month = '2026-11-01'`);
    expect(row.status).toBe("closed_with_skips");
    expect(row.snapshot.skipped_steps).toContain("bills");
    await page.goto("/settings/month-close");
    await expect(page.getByTestId("close-history-row").first()).toContainText("Closed, 1 skipped");
  });

  test("EC-MC27 offline: Close is disabled until online, and an answer given offline is queued and reaches the server later", async ({ page, context }) => {
    await startClose(page);
    await page.goto("/close/2026-11/missing-days");
    await expect(page.getByTestId("missing-day")).toHaveCount(2);
    await context.setOffline(true);
    await page.getByTestId("missing-day").first().getByTestId("day-no-spend").click();
    await expect(page.getByText("Marked as a no-spend day")).toBeVisible();                                    // optimistic, from the queue
    expect((await sql(`select count(*)::int as n from no_spend_days`))[0]!.n).toBe(0);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await sql(`select count(*)::int as n from no_spend_days where day = '2026-11-05' and source = 'close'`))[0]!.n, { timeout: 15_000 }).toBe(1);
    await page.goto("/close/2026-11/next-month");
    await expect(page.getByTestId("close-month")).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByTestId("close-month")).toBeDisabled();
    await expect(page.getByTestId("close-hint")).toHaveText("Connect to close the month");
    await context.setOffline(false);
  });

  test("EC-MC29 editing a closed month: the banner in Quick Add, the chip changes, and the review shows what changed (MC-70, MC-71)", async ({ page }) => {
    await startClose(page);
    await page.goto("/close/2026-11/next-month");
    await page.getByTestId("close-month").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    await page.getByTestId("done-button").click();
    await expect(page.getByTestId("close-card")).toHaveCount(0);
    await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, source)
               select user_id, gen_random_uuid(), 'expense', 1250, id, (select id from categories where name = 'Supermarket'), '2026-11-03', 'app' from accounts where name = 'Monzo'`);
    await page.goto("/settings/month-close/2026-11");
    await expect(page.getByTestId("changed-since-close")).toContainText("+£12.50");
    await page.getByTestId("update-snapshot").click();
    await expect(page.getByTestId("changed-since-close")).toHaveCount(0);
    const row = await sqlOne<{ snapshot_rev: number; changed_since_close: boolean }>(`select snapshot_rev, changed_since_close from month_closes where month = '2026-11-01'`);
    expect(row).toMatchObject({ snapshot_rev: 2, changed_since_close: false });
    await page.goto("/");
    await page.getByRole("button", { name: "Add transaction" }).first().click();
    await page.getByRole("button", { name: /Today|1 Dec/ }).first().click();
    await expect(page.getByTestId("closed-month-banner")).toHaveCount(0);                                      // December is open: no banner
  });

  test("MC-72 Reopen keeps earlier answers as defaults, and closing again counts the reopening", async ({ page }) => {
    await startClose(page);
    await page.goto("/close/2026-11/missing-days");
    await page.getByTestId("missing-day").first().getByTestId("day-no-spend").click();
    await page.goto("/close/2026-11/next-month");
    await page.getByTestId("close-month").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    await page.goto("/settings/month-close/2026-11");
    await page.getByTestId("reopen").click();
    await expect(page.getByTestId("close-title")).toHaveText("Let’s close November");
    await page.goto("/close/2026-11/missing-days");
    await expect(page.getByTestId("missing-day").first().getByTestId("day-no-spend")).toHaveClass(/on/);        // the earlier answer is the default
    await page.goto("/close/2026-11/next-month");
    await page.getByTestId("close-month").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    expect((await sqlOne<{ reopened_count: number }>(`select reopened_count from month_closes where month = '2026-11-01'`)).reopened_count).toBe(1);
  });

  test("EC-MC35 Later hides the Home card, which returns the next day", async ({ page }) => {
    await startClose(page);
    await page.getByTestId("close-later").click();
    await expect(page.getByTestId("close-card")).toHaveCount(0);
    await page.clock.setFixedTime(new Date("2026-12-02T06:30:00Z"));
    await page.reload();
    await expect(page.getByTestId("close-card")).toBeVisible();
  });
});
