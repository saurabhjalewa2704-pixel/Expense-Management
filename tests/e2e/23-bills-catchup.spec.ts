import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// If the scheduled job is not set up (or missed a day), opening the app still logs what is due, with the original date.
test.describe("bills catch up when the app is opened", () => {
  test.beforeEach(async ({ page }) => {
    await startDemo(page);
    await sql(`delete from recurring_items`);
    await sql(`update transactions set source = 'app' where source = 'recurring'`);
  });

  test("an overdue bill is logged on opening, dated when it was due, and only once", async ({ page }) => {
    await sql(`insert into payees (user_id, name) select id, 'Late Sub' from auth.users limit 1`);
    await sql(`insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
      values ((select id from auth.users limit 1), 'expense', 1299, (select id from accounts where name = 'Amex Gold'), (select id from categories where name = 'Streaming & apps'),
              (select id from payees where name = 'Late Sub'), 'monthly', 16, '2026-10-16', '2026-10-16')`);
    await page.reload();
    await expect(page.getByText("1 bill logged: Late Sub")).toBeVisible();
    expect(await sqlOne(`select to_char(t.occurred_on, 'YYYY-MM-DD') d, t.source::text s, t.amount_pence::int a from transactions t join payees p on p.id = t.payee_id where p.name = 'Late Sub'`))
      .toEqual({ d: "2026-10-16", s: "recurring", a: 1299 });
    expect(await sqlOne(`select next_due_on::text n from recurring_items`)).toEqual({ n: "2026-11-16" });
    await page.goto("/bills");
    await expect(page.getByTestId("bills-logged-list")).toContainText("Late Sub");
    await page.reload();
    expect((await sqlOne(`select count(*)::int n from transactions t join payees p on p.id = t.payee_id where p.name = 'Late Sub'`)).n).toBe(1);
  });

  test("Bills says when the morning job has not run, and when it has", async ({ page, request }) => {
    await sql(`insert into payees (user_id, name) select id, 'Any Sub' from auth.users limit 1`);
    await sql(`insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
      values ((select id from auth.users limit 1), 'expense', 500, (select id from accounts where name = 'Amex Gold'), (select id from categories where name = 'Streaming & apps'),
              (select id from payees where name = 'Any Sub'), 'monthly', 28, '2026-10-28', '2026-10-28')`);
    await page.goto("/bills");
    await expect(page.getByTestId("scheduler-warning")).toContainText("The morning job hasn’t run");
    await expect(page.getByTestId("scheduler-warning")).toContainText("It has never run.");
    const r = await request.get("/api/cron/recurring?now=2026-10-28T07:00:00Z", { headers: { authorization: "Bearer local-cron-secret" } });
    expect((await r.json()).acted).toBe(true);
    await page.reload();
    await expect(page.getByTestId("scheduler-ok")).toContainText("Logged automatically each morning · last run");
  });
});
