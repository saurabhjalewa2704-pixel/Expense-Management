import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// REC-01..REC-09 through the screens, on the demo data (Sun 18 Oct 2026).
test.describe("bills (REC-01..REC-09)", () => {
  test("Bills overview: summary, calendar, coming up and logged lists", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills");
    await expect(page.getByRole("heading", { name: "Bills", level: 1 })).toBeVisible();
    const sum = page.getByTestId("bills-summary");
    await expect(sum).toContainText("October bills");
    await expect(page.getByTestId("bills-tocome")).toHaveText("£34.97");
    await expect(sum).toContainText("to come · 3");
    const coming = page.getByTestId("bills-coming");
    await expect(coming.getByTestId("bill-row")).toHaveCount(4);                       // Spotify, Disney+, the transfer, YouTube Premium
    await expect(coming).toContainText("Spotify");
    await expect(coming).toContainText("To Marcus");
    await expect(coming).toContainText("£34.97 + £500.00 transfer");
    await page.screenshot({ path: "tests/e2e/shots/bills.png", fullPage: true });
    await expect(page.getByTestId("bills-logged-list").getByTestId("bill-row").first()).toContainText("Foxtons Lettings");
    const cal = page.getByTestId("bills-calendar");
    await expect(cal.getByTestId("cal-month")).toHaveText("October 2026");
    await expect(cal.locator('[data-day="2026-10-18"]')).toHaveClass(/today/);
    await cal.getByRole("button", { name: "Next month" }).click();
    await expect(cal.getByTestId("cal-month")).toHaveText("November 2026");
    await expect(page.getByTestId("bills-coming").getByTestId("bill-row").first()).toContainText("Foxtons Lettings");     // projected rent on 1 Nov
  });

  test("Home shows the Bills card, and it opens Bills", async ({ page }) => {
    await startDemo(page);
    const card = page.getByTestId("bills-card");
    await expect(card).toContainText("£34.97 to come this month");
    await expect(card).toContainText("Next: Spotify, Thu 22 Oct");
    await card.click();
    await expect(page).toHaveURL(/\/bills$/);
  });

  test("with no bills Home offers a one-time prompt, and Bills explains itself", async ({ page }) => {
    await startDemo(page);
    await sql(`delete from recurring_items`);
    await page.reload();
    const prompt = page.getByTestId("bills-prompt");
    await expect(prompt).toContainText("Set up your regular bills so they log themselves");
    await prompt.getByRole("button", { name: "Dismiss" }).click();
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("bills-prompt")).toHaveCount(0);
    await page.goto("/bills");
    await expect(page.getByTestId("bills-empty")).toContainText("No bills yet");
  });

  test("New recurring payment: the summary follows the form, and Save adds it to Coming up", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills/new");
    await expect(page.getByTestId("bill-save")).toBeDisabled();
    await page.getByTestId("bill-amount").click();
    for (const k of ["5", ".", "9", "9"]) await page.getByRole("button", { name: k === "." ? "Decimal point" : k, exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByLabel("Payee").fill("Hulu");
    await page.getByTestId("bill-category").click();
    await page.getByLabel("Search categories").fill("Streaming");
    await page.getByRole("button", { name: /Streaming & apps/ }).first().click();
    await page.getByTestId("bill-account").click();
    await page.getByRole("button", { name: /Amex Gold/ }).click();
    await page.getByRole("group", { name: "Day of the month" }).getByRole("button", { name: "27", exact: true }).click();
    await expect(page.getByTestId("bill-onday")).toHaveText("27th of each month");
    await expect(page.getByTestId("bill-summary")).toHaveText("Sterling will log £5.99 to Hulu at 6am on the 27th of every month, starting Tue 27 Oct.");
    await page.screenshot({ path: "tests/e2e/shots/bill-form.png", fullPage: true });
    await page.getByTestId("bill-save").click();
    await expect(page).toHaveURL(/\/bills$/);
    await expect(page.getByTestId("bills-coming")).toContainText("Hulu");
    expect(await sqlOne(`select amount_pence::int a, next_due_on::text d, auto_log from recurring_items where payee_id = (select id from payees where name = 'Hulu')`)).toEqual({ a: 599, d: "2026-10-27", auto_log: true });
  });

  test("a day already gone this month offers to log this month's now", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills/new");
    await page.getByTestId("bill-amount").click();
    for (const k of ["7", "5"]) await page.getByRole("button", { name: k, exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByLabel("Payee").fill("Storage Co");
    await page.getByTestId("bill-category").click();
    await page.getByLabel("Search categories").fill("Streaming");
    await page.getByRole("button", { name: /Streaming & apps/ }).first().click();
    await page.getByRole("group", { name: "Day of the month" }).getByRole("button", { name: "1", exact: true }).click();
    const prompt = page.getByTestId("bill-catchup");
    await expect(prompt).toContainText("Storage Co was due on the 1st.");
    await prompt.getByRole("button", { name: "Log it now" }).click();
    await page.getByTestId("bill-save").click();
    await expect(page).toHaveURL(/\/bills$/);
    expect(await sqlOne(`select to_char(t.occurred_on, 'YYYY-MM-DD') d, t.source::text s, t.amount_pence::int a, i.next_due_on::text n from transactions t join recurring_items i on i.id = t.recurring_id where i.payee_id = (select id from payees where name = 'Storage Co')`))
      .toEqual({ d: "2026-10-01", s: "recurring", a: 7500, n: "2026-11-01" });
  });

  test("Bill detail: next payment, history chart, Skip next (and undo), Pause / Resume, Stop, Delete", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills");
    await page.getByTestId("bills-logged-list").getByRole("link", { name: /Octopus Energy/ }).click();
    const d = page.getByTestId("bill-detail");
    await expect(d.getByRole("heading", { name: "Octopus Energy" })).toBeVisible();
    await expect(d.getByTestId("bill-next-amount")).toHaveText("≈ £48.40");
    await expect(d.getByTestId("bill-next-date")).toContainText("Tuesday 3 November · logged at 6am");
    await expect(d).toContainText("Monthly on the 3rd");
    await expect(d.getByTestId("bill-chart")).toBeVisible();
    await expect(d.getByTestId("bill-history-row").first()).toContainText("Logged Sat 3 Oct");
    await page.screenshot({ path: "tests/e2e/shots/bill-detail.png", fullPage: true });

    await d.getByTestId("bill-skip").click();                                       // REC-06 / criterion 6
    await expect(d.getByTestId("bill-unskip")).toBeVisible();
    expect(await sqlOne(`select o.status::text s, i.next_due_on::text n from recurring_occurrences o join recurring_items i on i.id = o.item_id where o.due_on = '2026-11-03' and i.payee_id = (select id from payees where name = 'Octopus Energy')`)).toEqual({ s: "skipped", n: "2026-12-03" });
    await expect(d.getByTestId("bill-next-date")).toContainText("Thursday 3 December");
    await d.getByTestId("bill-unskip").click();
    await expect(d.getByTestId("bill-skip")).toBeVisible();
    await expect(d.getByTestId("bill-next-date")).toContainText("Tuesday 3 November");

    await d.getByTestId("bill-pause").click();
    await expect(d.getByTestId("bill-resume")).toBeVisible();
    await expect(d.getByTestId("bill-next")).toContainText("Paused");
    await d.getByTestId("bill-resume").click();
    await expect(d.getByTestId("bill-pause")).toBeVisible();

    await d.getByTestId("bill-stop").click();                                       // criterion 9: stopping keeps the past
    await page.getByTestId("bill-confirm").click();
    await expect(d.getByTestId("bill-delete")).toBeVisible();
    expect(await sqlOne(`select count(*)::int n from transactions where source = 'recurring' and payee_id = (select id from payees where name = 'Octopus Energy') and deleted_at is null`)).toEqual({ n: 7 });
    await page.goto("/bills");
    await expect(page.getByTestId("bills-ended")).toContainText("Octopus Energy");
    await page.getByTestId("bills-ended").getByRole("link", { name: /Octopus Energy/ }).click();
    await page.getByTestId("bill-delete").click();
    await page.getByTestId("bill-confirm").click();
    await expect(page).toHaveURL(/\/bills$/);
    await expect(page.getByTestId("bills-ended")).toHaveCount(0);
    expect(await sqlOne(`select count(*)::int n from transactions where payee_id = (select id from payees where name = 'Octopus Energy') and deleted_at is null`)).toEqual({ n: 7 });   // the payments stay in Activity
  });

  test("editing the amount changes the next payment, never one already logged (criterion 8)", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills");
    await page.getByTestId("bills-logged-list").getByRole("link", { name: /Netflix/ }).click();
    await page.getByRole("link", { name: "Edit" }).first().click();
    await expect(page.getByTestId("bill-form")).toBeVisible();
    await expect(page.getByTestId("bill-amount")).toContainText("12.99");
    await page.getByTestId("bill-amount").click();
    for (const _ of [0, 1, 2, 3, 4]) await page.getByRole("button", { name: "Delete" }).click();
    for (const k of ["1", "4", ".", "9", "9"]) await page.getByRole("button", { name: k === "." ? "Decimal point" : k, exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("bill-save").click();
    await expect(page.getByTestId("bill-detail")).toBeVisible();
    await expect(page.getByTestId("bill-next-amount")).toHaveText("£14.99");
    expect(await sqlOne(`select (select amount_pence::int from transactions where payee_id = (select id from payees where name = 'Netflix') and occurred_on = '2026-10-02') old, (select amount_pence::int from recurring_items where payee_id = (select id from payees where name = 'Netflix')) next`)).toEqual({ old: 1299, next: 1499 });
  });

  test("Activity: a repeat glyph on logged payments, an EST tag on estimates, and a Recurring filter", async ({ page }) => {
    await startDemo(page);
    await sql(`update transactions set is_estimate = true where payee_id = (select id from payees where name = 'Octopus Energy') and occurred_on = '2026-10-03'`);
    await page.goto("/activity");
    await page.getByTestId("search").fill("Octopus");
    await expect(page.getByTestId("txn-row").first().getByTestId("est")).toHaveText("EST");
    await expect(page.getByTestId("txn-row").first().getByTestId("recurring-glyph")).toBeVisible();
    await page.getByTestId("search").fill("");
    await page.getByTestId("recurring-chip").click();
    await expect.poll(() => page.getByTestId("txn-row").count()).toBeGreaterThan(3);
    for (const r of await page.getByTestId("txn-row").all()) await expect(r.getByTestId("recurring-glyph")).toBeVisible();
  });

  test("adding by hand what a bill logs around now asks first (REC-08)", async ({ page }) => {
    await startDemo(page);
    await sql(`update recurring_items set next_due_on = '2026-10-20' where payee_id = (select id from payees where name = 'Spotify')`);
    await page.getByRole("button", { name: "Add transaction" }).click();
    for (const k of ["1", "2", ".", "9", "9"]) await page.getByRole("button", { name: k === "." ? "Decimal point" : k, exact: true }).click();
    await page.getByLabel("Payee").fill("Spotify");
    await page.getByRole("button", { name: /^Add £12\.99/ }).click();         // the remembered payee already chose its category
    await expect(page.getByTestId("dup-title")).toHaveText("Spotify is logged automatically on the 20th.");
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await sqlOne(`select count(*)::int n from transactions t join payees p on p.id = t.payee_id where p.name = 'Spotify' and t.occurred_on = '2026-10-18'`)).toEqual({ n: 0 });
    await page.getByRole("button", { name: /^Add £12\.99/ }).click();
    await page.getByRole("button", { name: "Add anyway" }).click();
    await expect.poll(async () => (await sqlOne(`select count(*)::int n from transactions t join payees p on p.id = t.payee_id where p.name = 'Spotify' and t.occurred_on = '2026-10-18'`)).n).toBe(1);
  });

  test("suggestions: a repeating payee is offered, one tap adds it; 'Not now' never returns", async ({ page }) => {
    await startDemo(page);
    await page.goto("/bills");
    const s = page.getByTestId("suggestions");
    await expect(s).toContainText("Looks like Thames Water is monthly");
    await s.getByTestId("suggestion").filter({ hasText: "Thames Water" }).getByRole("button", { name: "Add to Bills" }).click();
    await expect(page.getByTestId("bills-coming").or(page.getByTestId("bills-logged-list")).first()).toBeVisible();
    await expect.poll(async () => (await sqlOne(`select count(*)::int n from recurring_items where payee_id = (select id from payees where name = 'Thames Water')`)).n).toBe(1);
    await expect(page.getByTestId("suggestions").getByText("Thames Water")).toHaveCount(0);
    await sql(`insert into recurring_dismissed (user_id, payee_id) select user_id, id from payees where name = 'Disney+' `);
    await page.reload();
    await expect(page.getByText("Looks like Disney+")).toHaveCount(0);
  });

  test("Settings → Bills opens Bills, and Reminders has the Bills switch", async ({ page }) => {
    await startDemo(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Bills/ }).click();
    await expect(page).toHaveURL(/\/bills$/);
    await page.goto("/settings/reminders");
    const sw = page.getByRole("switch", { name: "Bills logged and due" });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect.poll(async () => (await sqlOne(`select bills_notify b from profiles`)).b).toBe(false);
  });
});
