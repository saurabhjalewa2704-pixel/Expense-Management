import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startBudget } from "./helpers";

// FORECASTING-ENGINE-PRD mock-ups F5 (one-off) and F6 (planned item match), on the budget demo day (Sun 18 Oct 2026).
async function addExpense(amount: number, cat: string, _payee: string, on = "2026-10-18") {
  await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source)
             select a.user_id, gen_random_uuid(), 'expense', $1, a.id, (select id from categories where name = $2 and user_id = a.user_id), null, $3, 'app'
               from accounts a where a.name = 'Monzo'`, [amount, cat, on]);
}

test.describe("forecast UI (F5, F6)", () => {
  test("F5 an unusually large expense is flagged as a one-off: chip in Activity, switch in the editor, the owner's choice sticks", async ({ page }) => {
    await startBudget(page);
    await addExpense(89900, "Homeware", "Sofa");
    expect(await sqlOne(`select is_one_off, one_off_source from transactions where amount_pence = 89900`)).toEqual({ is_one_off: true, one_off_source: "auto" });
    await page.goto("/activity");
    const row = page.getByTestId("txn-row").filter({ hasText: "£899.00" });
    await expect(row.getByTestId("one-off-chip")).toBeVisible();
    await row.click();
    const block = page.getByTestId("one-off-block");
    await expect(block).toBeVisible();
    await expect(page.getByTestId("one-off-why")).toContainText("Sterling flagged this");
    await block.getByRole("switch", { name: "One-off" }).click();
    await expect.poll(async () => (await sqlOne(`select one_off_source s from transactions where amount_pence = 89900`)).s).toBe("user");
    expect(await sqlOne(`select is_one_off from transactions where amount_pence = 89900`)).toEqual({ is_one_off: false });
    await page.screenshot({ path: "tests/e2e/shots/forecast-one-off.png" });
  });

  test("F6 / EC-F30 an expense that matches a planned extra asks once, and only the answer changes the extra", async ({ page }) => {
    await startBudget(page);
    await page.getByTestId("forecast-kpi").click();
    await page.getByTestId("add-extra").click();
    await page.getByTestId("extra-amount").fill("300");
    await page.getByTestId("extra-label").fill("Christmas presents");
    await page.getByTestId("extra-category").selectOption({ label: "Family & giving" });
    await page.getByTestId("extra-save").click();
    await expect(page.getByTestId("why-extras")).toContainText("Christmas presents");
    await page.getByRole("button", { name: "Done" }).first().click();

    await addExpense(12000, "Family & giving", "Hamleys");
    await page.goto("/activity");
    await page.getByTestId("txn-row").filter({ hasText: "£120.00" }).click();
    const q = page.getByTestId("planned-match");
    await expect(q).toContainText("Was this part of “Christmas presents”?");
    await expect(q.getByTestId("match-still")).toContainText("Yes, £180.00 still to spend");
    // nothing has changed yet
    expect(await sqlOne(`select amount_pence::int a from planned_extras`)).toEqual({ a: 30000 });
    await q.getByTestId("match-still").click();
    await expect.poll(async () => (await sqlOne(`select amount_pence::int a from planned_extras`)).a).toBe(18000);
    expect(await sqlOne(`select answer from planned_extra_answers`)).toEqual({ answer: "still_to_spend" });
    await expect(page.getByTestId("planned-match")).toHaveCount(0);                   // asked once
    await page.screenshot({ path: "tests/e2e/shots/forecast-planned-match.png" });
  });
});
