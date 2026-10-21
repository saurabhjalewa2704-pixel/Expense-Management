import { expect, test, type Page } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { amountKeys, heroPence, openAdd, startDemo } from "./helpers";

const CASH = 476555;          // £4,765.55 on the demo data
const SPENT = "£3,236.85";    // October spend so far

async function createPotViaUi(page: Page, name = "Home purchase", budget = "45000") {
  await page.goto("/pots");
  await page.getByRole("button", { name: "New pot" }).click();
  await page.getByLabel("Pot name").fill(name);
  await page.getByLabel("Budget").fill(budget);
  await page.getByRole("button", { name: "Create pot" }).click();
  await expect(page.getByTestId("pot-row").filter({ hasText: name })).toBeVisible();
}

/** A pot expense needs no category: pick the pot, and Add is available straight away. */
async function addPotExpense(page: Page, amount: string, pot = "Home purchase") {
  await openAdd(page);
  await amountKeys(page, amount);
  await expect(page.getByRole("button", { name: /^Add £/ })).toBeDisabled();       // outside a pot a category is still required
  await page.getByRole("button", { name: "One-off pot" }).click();
  await page.getByRole("button", { name: pot }).click();
  await expect(page.getByTestId("pot-note")).toContainText(`In “${pot}”. No category needed. Kept out of monthly spend.`);
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);        // and none was chosen for you
  await page.getByRole("button", { name: /^Add £/ }).click();
  await expect(page.getByTestId("quick-add")).toHaveCount(0);
}

test.describe("one-off pots", () => {
  test("a pot expense moves cash but not monthly spend, the pace card or insights", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    expect(await heroPence(page)).toBe(CASH);

    await addPotExpense(page, "12500");
    // real money: available cash drops by the full amount, and the equation gains its own "One-off" term
    await expect.poll(() => heroPence(page)).toBe(CASH - 1250000);
    await expect(page.locator(".eq-term").filter({ hasText: "One-off" })).toContainText("£12,500.00");
    await expect(page.locator(".eq-term").filter({ hasText: /^Out/ })).toContainText(SPENT.replace("£", "£"));
    // ...but it is not usual spending
    await expect(page.getByText(`${SPENT} spent`)).toBeVisible();
    await expect(page.getByText(/£367\.25 less than this point in September/)).toBeVisible();
    // the DB agrees: hero == SQL, and the equation balances
    const flow = await sqlOne<{ opening: string; income: string; spend: string; pot: string; closing: string }>(
      `select opening_pence::text opening, income_pence::text income, spend_pence::text spend, pot_pence::text pot, closing_pence::text closing from cash_flow('2026-10-01','2026-10-18')`);
    expect(Number(flow.opening) + Number(flow.income) - Number(flow.spend) + Number(flow.pot) + 0).toBe(Number(flow.closing));
    expect(Number(flow.pot)).toBe(-1250000);

    // analytics never see it
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-pace").getByRole("heading")).toHaveText("You're £367 under September's pace");
    await expect(page.getByTestId("chart-categories").getByRole("heading")).toHaveText("Eating out is up 38% on your usual");
    await expect(page.getByTestId("chart-categories")).not.toContainText("12,500");
    await expect(page.getByTestId("chart-waterfall").getByRole("listitem", { name: /^One-off −£12,500\.00$/ })).toBeVisible();     // the equation still ends on Available
    await expect(page.getByTestId("chart-waterfall").getByRole("listitem", { name: /^Available / })).toBeVisible();

    // insights never see it
    await page.goto("/insights");
    await page.getByRole("button", { name: "Refresh insights" }).click();
    await expect(page.getByTestId("insight-card").first()).toBeVisible();
    const run = await sqlOne<{ facts: { facts: { display: string }[] }; cards: unknown }>(`select facts, cards from insight_runs`);
    const text = JSON.stringify(run);
    expect(text).not.toContain("12,500");
    expect(text).not.toContain("12500");
    expect(run.facts.facts.some((f) => f.display === SPENT)).toBe(true);
  });

  test("Activity shows it with its pot, can filter it in or out, and exports it", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await addPotExpense(page, "12500");
    await page.goto("/activity");
    const row = page.getByTestId("txn-row").filter({ hasText: "£12,500.00" });
    await expect(row).toContainText("Home purchase pot");
    await expect(page.getByTestId("summary")).toContainText("£12,500.00 out in pots");
    await expect(page.getByTestId("summary")).toContainText(SPENT);                                   // usual spend is separate

    await page.getByRole("button", { name: /^One-off/ }).click();
    await page.getByRole("button", { name: "Usual spending only" }).click();
    await expect(page.getByTestId("txn-row").filter({ hasText: "£12,500.00" })).toHaveCount(0);
    await expect(page.getByTestId("summary")).not.toContainText("in pots");
    await page.getByRole("button", { name: /^One-off/ }).click();
    await page.getByRole("button", { name: "One-off pots only" }).click();
    await expect(page.getByTestId("txn-row")).toHaveCount(1);

    const csv = await (await page.request.get("/api/export?format=csv&pot=only")).text();
    expect(csv).toContain("One-off pot");
    expect(csv).toContain("Home purchase");
    expect(csv).toContain("-12500.00");
    const json = await (await page.request.get("/api/export?format=json")).json();
    expect(json.pots).toHaveLength(1);
    expect(json.transactions.filter((t: { pot_id: string | null }) => t.pot_id)).toHaveLength(1);
  });

  test("the pot screen shows net cost against its budget, by category, with gifts counted as received", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await addPotExpense(page, "12500");
    await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, pot_id)
               select p.id, gen_random_uuid(), 'income', 200000, (select id from accounts order by sort_order limit 1),
                      (select id from categories where kind = 'income' limit 1), '2026-10-17', (select id from pots limit 1) from profiles p`);
    await page.goto("/pots");
    await page.getByTestId("pot-row").click();
    await expect(page.getByRole("heading", { name: "Home purchase" })).toBeVisible();
    await expect(page.getByTestId("pot-net")).toHaveText("£10,500.00");
    await expect(page.getByTestId("pot-spent")).toHaveText("Spent £12,500.00");
    await expect(page.getByTestId("pot-received")).toHaveText("Received £2,000.00");
    await expect(page.getByTestId("pot-budget")).toHaveText("£34,500.00 left of £45,000.00");
    await expect(page.getByTestId("pot-categories")).toContainText("£12,500.00");
    await expect(page.getByTestId("txn-row")).toHaveCount(2);

    // Home lists it, and Settings leads to it
    await page.goto("/");
    await expect(page.getByTestId("pots-section")).toContainText("Home purchase");
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /One-off pots/ })).toBeVisible();

    // edit the budget
    await page.goto("/pots");
    await page.getByTestId("pot-row").click();
    await page.getByRole("button", { name: "Edit pot" }).click();
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("pot-budget")).toHaveText("£500.00 over the £10,000.00 budget");
  });

  test("closing a pot hides it from the picker; an empty pot can be deleted, a used one cannot", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page, "Home purchase");
    await createPotViaUi(page, "Spare", "");
    await page.goto("/");
    await addPotExpense(page, "100");
    await page.goto("/pots");
    await page.getByTestId("pot-row").filter({ hasText: "Home purchase" }).click();
    await expect(page.getByRole("button", { name: "Delete pot" })).toHaveCount(0);                  // it has history
    await page.getByRole("button", { name: "Close pot" }).click();
    await expect.poll(() => sqlOne<{ closed: boolean }>(`select closed_at is not null closed from pots where name = 'Home purchase'`).then((r) => r.closed)).toBe(true);

    await page.goto("/");
    await openAdd(page);
    await amountKeys(page, "5");
    await page.getByRole("button", { name: "One-off pot" }).click();
    await expect(page.getByRole("button", { name: "Spare" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Home purchase" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/pots");
    await page.getByTestId("pot-row").filter({ hasText: "Spare" }).click();
    await page.getByRole("button", { name: "Delete pot" }).click();
    await expect(page).toHaveURL(/\/pots$/);
    await expect(page.getByTestId("pot-row").filter({ hasText: "Spare" })).toHaveCount(0);
  });

  test("offline: a pot expense still leaves the pace card alone, and lands in the pot once synced", async ({ page, context }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await expect(page.getByText(`${SPENT} spent`)).toBeVisible();
    await page.waitForTimeout(800);
    await context.setOffline(true);
    await addPotExpense(page, "700");
    await expect(page.getByText(`${SPENT} spent`)).toBeVisible();                                    // pace unchanged while pending
    await expect.poll(() => heroPence(page)).toBe(CASH - 70000);
    await expect(page.locator(".eq-term").filter({ hasText: "One-off" })).toContainText("£700.00");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from transactions where amount_pence = 70000 and pot_id is not null`)).n).toBe(1);
    await expect.poll(() => heroPence(page)).toBe(CASH - 70000);
  });

  test("a transaction can be moved into a pot by editing it, and back out", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/activity");
    await page.getByTestId("txn-row").first().click();
    await page.getByRole("button", { name: "One-off pot" }).click();
    await page.getByRole("button", { name: "Home purchase" }).click();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from transactions where pot_id is not null`).then((r) => r.n)).toBe(1);
    await page.getByTestId("txn-row").filter({ hasText: "Home purchase pot" }).click();
    await page.getByRole("button", { name: /One-off pot Home purchase/ }).click();
    await page.getByRole("button", { name: "Not in a pot" }).click();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from transactions where pot_id is not null`).then((r) => r.n)).toBe(0);
  });

  test("a pot expense needs no category: it saves without one, shows as 'No category', and stays out of usual spending", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await addPotExpense(page, "850");
    const row = await sqlOne<{ category_id: string | null; pot_id: string | null }>(`select category_id, pot_id from transactions where amount_pence = 85000`);
    expect(row.category_id).toBeNull();
    expect(row.pot_id).not.toBeNull();

    await page.goto("/activity");
    const item = page.getByTestId("txn-row").filter({ hasText: "£850.00" });
    await expect(item).toContainText("Home purchase pot");                             // the pot is the title when there is no payee or category
    await expect(item).toContainText("No category");
    await page.goto("/pots");
    await page.getByTestId("pot-row").click();
    await expect(page.getByTestId("pot-categories")).toContainText("No category");
    await expect(page.getByTestId("pot-categories")).toContainText("£850.00");
    await page.goto("/");
    await expect(page.getByText(`${SPENT} spent`)).toBeVisible();                      // usual spending unchanged
    expect((await sqlOne<{ n: number }>(`select count(*)::int n from spend_by_category('2026-10-01','2026-10-18') where name is null`)).n).toBe(0);
    const csv = await (await page.request.get("/api/export?format=csv&pot=only")).text();
    expect(csv).toContain("-850.00");
  });

  test("with a pot a category is optional (tap again to clear it), and taking the pot away brings the requirement back", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await openAdd(page);
    await amountKeys(page, "40");
    await page.getByRole("button", { name: "One-off pot" }).click();
    await page.getByRole("button", { name: "Home purchase" }).click();
    await expect(page.getByText("Category (optional)")).toBeVisible();
    await page.getByTestId("qcard").first().click();
    await expect(page.getByTestId("qcard").first()).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("qcard").first().click();                                   // tap again: cleared
    await expect(page.getByTestId("qcard").first()).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: "Add £40.00" })).toBeEnabled();
    const add = (await page.getByRole("button", { name: "Add £40.00" }).boundingBox())!;
    expect(add.y + add.height).toBeLessThanOrEqual(844);                               // Add stays on screen with a pot chosen

    await page.getByRole("button", { name: /One-off pot Home purchase/ }).click();
    await page.getByRole("button", { name: "Not in a pot" }).click();
    await expect(page.getByText("Your top categories")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add £40.00" })).toBeDisabled();     // back to needing a category
  });

  test("income can go in a pot without a category too (a gift towards the deposit)", async ({ page }) => {
    await startDemo(page);
    await createPotViaUi(page);
    await page.goto("/");
    await openAdd(page);
    await page.getByRole("tab", { name: "Income" }).click();
    await amountKeys(page, "2000");
    await page.getByRole("button", { name: "One-off pot" }).click();
    await page.getByRole("button", { name: "Home purchase" }).click();
    await page.getByRole("button", { name: /^Add income/ }).click();
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from transactions where type='income' and amount_pence = 200000 and category_id is null and pot_id is not null`)).n).toBe(1);
  });
});
