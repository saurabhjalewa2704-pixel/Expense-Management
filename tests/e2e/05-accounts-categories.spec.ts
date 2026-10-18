import { expect, test, type Page } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { amountKeys, heroPence, openAdd, startDemo, toast } from "./helpers";

const BEFORE = 476555;

test.describe("accounts (ACC-01..05)", () => {
  test.beforeEach(async ({ page }) => { await startDemo(page); });

  test("the accounts screen groups the pool and the rest, as in the mock-up", async ({ page }) => {
    await page.goto("/settings/accounts");
    await expect(page.getByText("In available cash · 4")).toBeVisible();
    await expect(page.getByText("Not counted · 1")).toBeVisible();
    await expect(page.getByTestId("accounts-cash")).toHaveText("£4,765.55");
    const row = (n: string) => page.getByTestId("account-row").filter({ hasText: n });
    await expect(row("Monzo")).toContainText("£3,214.08");
    await expect(row("HSBC Premier")).toContainText("£2,486.20");
    await expect(row("Cash")).toContainText("£250.00");
    await expect(row("Amex Gold")).toContainText("−£1,184.73");
    await expect(row("Marcus")).toContainText("£12,400.00");
    await expect(row("Monzo")).toContainText("Default");
  });

  test("ACC-04: account detail shows balance, a 90-day sparkline and its own transactions", async ({ page }) => {
    await page.goto("/settings/accounts");
    await page.getByTestId("account-row").filter({ hasText: "Monzo" }).click();
    await expect(page.getByTestId("account-balance").locator(".figure")).toHaveAttribute("aria-label", "£3,214.08");
    await expect(page.getByRole("img", { name: /balance over the last 90 days/ })).toBeVisible();
    await expect(page.getByTestId("txn-row").first()).toContainText("Waitrose");
    await expect(page.getByTestId("txn-row").filter({ hasText: "Dishoom" })).toHaveCount(0);   // an Amex payment is not on Monzo
  });

  test("ACC-05: reconcile makes the balance equal the bank's to the penny, and is not spend", async ({ page }) => {
    await page.goto("/settings/accounts");
    await page.getByTestId("account-row").filter({ hasText: "Monzo" }).click();
    await page.getByRole("button", { name: "Reconcile" }).first().click();
    await page.getByLabel("Balance in your bank app").fill("3200.00");
    await expect(page.getByTestId("reconcile-diff")).toHaveText("−£14.08");
    await page.getByRole("button", { name: "Adjust balance" }).click();
    await expect(toast(page)).toContainText("adjusted by −£14.08");
    await expect(page.getByTestId("account-balance").locator(".figure")).toHaveAttribute("aria-label", "£3,200.00");
    // listed in Activity with its own label
    await expect(page.getByTestId("txn-row").filter({ hasText: "Balance adjustment" })).toBeVisible();

    await page.goto("/");
    await expect.poll(() => heroPence(page)).toBe(BEFORE - 1408);                              // it moves available cash...
    await expect(page.getByTestId("equation")).toContainText("£3,236.85");                       // ...but not spend
    await expect(page.getByTestId("equation")).toContainText("Adjusted");
    await expect(page.getByTestId("pace")).toContainText("£3,236.85");
    // and it never shows up as income or spend in the analytics functions
    const { spend } = await sqlOne<{ spend: string }>(`select coalesce(sum(total_pence),0)::text spend from spend_by_category('2026-10-01','2026-10-18')`);
    expect(spend).toBe("323685");
  });

  test("a credit card reconciles on the amount owed", async ({ page }) => {
    await page.goto("/settings/accounts");
    await page.getByTestId("account-row").filter({ hasText: "Amex Gold" }).click();
    await page.getByRole("button", { name: "Reconcile" }).first().click();
    await page.getByLabel("Balance in your bank app").fill("1000");
    await expect(page.getByTestId("reconcile-diff")).toHaveText("+£184.73");
    await page.getByRole("button", { name: "Adjust balance" }).click();
    await expect(page.getByTestId("account-balance").locator(".figure")).toHaveAttribute("aria-label", "−£1,000.00");
  });

  test("ACC-03: archive an empty account; a non-zero one needs a write-off; archived accounts leave the pickers", async ({ page }) => {
    await page.goto("/settings/accounts");
    await page.getByRole("button", { name: "Add account" }).click();
    await page.getByLabel("Account name").fill("Joint");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("account-row").filter({ hasText: "Joint" })).toBeVisible();
    await page.getByTestId("account-row").filter({ hasText: "Joint" }).click();
    await page.getByRole("button", { name: "Edit account" }).click();
    await page.getByRole("button", { name: "Archive account" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByTestId("account-row").filter({ hasText: "Joint" })).toHaveCount(0);

    // Cash holds £250: archiving needs the write-off, which is recorded as an adjustment
    await page.goto("/settings/accounts");
    await page.getByTestId("account-row").filter({ hasText: "Cash" }).click();
    await page.getByRole("button", { name: "Edit account" }).click();
    await page.getByRole("button", { name: "Archive account" }).click();
    await expect(page.getByText(/still holds £250\.00/)).toBeVisible();
    await page.getByRole("button", { name: "Write off and archive" }).click();
    await page.goto("/");
    await expect.poll(() => heroPence(page)).toBe(BEFORE - 25000);
    await openAdd(page);
    await page.getByRole("button", { name: /^Account / }).click();
    await expect(page.getByRole("button", { name: /^Cash/ })).toHaveCount(0);                   // gone from the picker
    await expect(page.getByRole("button", { name: /^Monzo/ })).toBeVisible();
    const { n } = await sqlOne<{ n: number }>(`select count(*)::int n from transactions where type='adjustment' and note='Balance written off'`);
    expect(n).toBe(1);
  });
});

async function openCategories(page: Page) {
  await page.goto("/settings/categories");
  await expect(page.getByTestId("category-list")).toBeVisible();
}

test.describe("categories (CAT-01..04)", () => {
  test.beforeEach(async ({ page }) => { await startDemo(page); });

  test("CAT-02: twelve expense and seven income categories are seeded", async ({ page }) => {
    await openCategories(page);
    await expect(page.getByRole("tab", { name: "Expense · 12" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Income · 7" })).toBeVisible();
    await expect(page.getByTestId("category-list").getByRole("link", { name: /Eating out/ })).toContainText("5 sub-categories");
    await expect(page.getByTestId("category-list").getByRole("link", { name: /^.*Home/ })).toContainText("7 sub-categories");
  });

  test("CAT-03: a new category appears in the picker straight away and is two levels at most", async ({ page }) => {
    await openCategories(page);
    await page.getByRole("button", { name: "New category" }).click();
    await page.getByLabel("Category name").fill("Pilates");
    await page.getByRole("button", { name: "Choose parent category" }).click();
    await page.getByRole("button", { name: "Health", exact: true }).click();
    await page.getByRole("radio", { name: "dumbbell" }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(toast(page)).toContainText("Created Pilates");

    // the parent picker only offers parents (never a sub-category), which enforces two levels
    await page.getByRole("button", { name: "New category" }).click();
    await page.getByRole("button", { name: "Choose parent category" }).click();
    await expect(page.getByRole("button", { name: "Pilates", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Health", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

    // it is in the Quick Add picker immediately
    await page.goto("/");
    await openAdd(page);
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Health", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pilates" })).toBeVisible();
    const { parent } = await sqlOne<{ parent: string }>(`select p.name parent from categories c join categories p on p.id=c.parent_id where c.name='Pilates'`);
    expect(parent).toBe("Health");
  });

  test("CAT-03: create inline from the picker with + New, and it is selected", async ({ page }) => {
    await openAdd(page);
    await amountKeys(page, "30");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByLabel("Category name").fill("Dog walker");
    await page.getByRole("radio", { name: "paw print" }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("radio", { name: "Dog walker" })).toBeChecked();
    await page.getByRole("button", { name: "Add £30.00" }).click();
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int n from transactions t join categories c on c.id=t.category_id where c.name='Dog walker'`))[0]!.n).toBe(1);
  });

  test("CAT-04: archive hides from pickers but keeps history; delete only with no transactions; merge re-points everything", async ({ page }) => {
    // merge "Takeaway & delivery" (it has history) into Restaurants
    const { takeaway } = await sqlOne<{ takeaway: number }>(`select count(*)::int takeaway from transactions t join categories c on c.id=t.category_id where c.name='Takeaway & delivery' and t.deleted_at is null`);
    const { rest } = await sqlOne<{ rest: number }>(`select count(*)::int rest from transactions t join categories c on c.id=t.category_id where c.name='Restaurants' and t.deleted_at is null`);
    expect(takeaway).toBeGreaterThan(0);
    await openCategories(page);
    await page.getByRole("link", { name: /Eating out/ }).click();
    await page.getByRole("link", { name: /Takeaway & delivery/ }).click();
    await expect(page.getByTestId("usage")).toContainText(`${takeaway} transaction`);
    await expect(page.getByRole("button", { name: "Delete category" })).toHaveCount(0);        // it has history
    await page.getByRole("button", { name: "Merge into another category" }).click();
    await page.getByRole("button", { name: "Restaurants", exact: true }).click();
    await page.getByRole("button", { name: "Merge into Restaurants" }).click();
    await expect(page.getByTestId("category-list")).toBeVisible();
    const { after } = await sqlOne<{ after: number }>(`select count(*)::int after from transactions t join categories c on c.id=t.category_id where c.name='Restaurants' and t.deleted_at is null`);
    expect(after).toBe(rest + takeaway);
    expect((await sql<{ archived: boolean }>(`select archived_at is not null archived from categories where name='Takeaway & delivery'`))[0]!.archived).toBe(true);

    // an unused category can be deleted
    await page.getByRole("button", { name: "New category" }).click();
    await page.getByLabel("Category name").fill("Temp");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: /^.*Temp/ }).click();
    await expect(page.getByTestId("usage")).toContainText("0 transactions");
    await page.getByRole("button", { name: "Delete category" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("category-list")).toBeVisible();
    expect((await sql(`select count(*)::int n from categories where name='Temp'`))[0]!.n).toBe(0);

    // archive hides it from the picker, keeps it in the archive list, and history stays
    await page.getByRole("link", { name: /Learning/ }).click();
    await page.getByRole("button", { name: /Archive \(hide from pickers\)/ }).click();
    await expect(toast(page)).toContainText("Learning archived");                                // wait for the action to finish
    await page.goto("/");
    await openAdd(page);
    await page.getByRole("button", { name: "More categories" }).click();
    await expect(page.getByRole("button", { name: "Learning", exact: true })).toHaveCount(0);
  });

  test("CAT-04: reorder parents; the order is saved", async ({ page }) => {
    await openCategories(page);
    await page.getByRole("button", { name: "Reorder categories" }).click();
    await page.getByRole("button", { name: "Move Groceries up" }).click();
    await expect(page.getByTestId("reorder-row").first()).toContainText("Groceries");
    await expect.poll(async () => (await sql<{ first: string }>(`select name first from categories where parent_id is null and kind='expense' order by sort_order limit 1`))[0]!.first).toBe("Groceries");
    await page.reload();
    await expect(page.getByTestId("category-list").getByRole("link").first()).toContainText("Groceries");
  });
});
