import { expect, test } from "@playwright/test";
import { sqlOne } from "./db";
import { amountKeys, heroPence, openAdd, startDemo, toast } from "./helpers";

const cashAt = async (d: string) => Number((await sqlOne<{ c: string }>(`select available_cash('${d}')::text c from (select 1) x`)).c);

test.describe("available cash (CASH-01..05)", () => {
  test.beforeEach(async ({ page }) => { await startDemo(page); });

  test("CASH-02: Home shows the equation; tapping the hero opens the detail", async ({ page }) => {
    await expect(page.getByTestId("equation")).toHaveText(/Opening£7,862\.40\+In£140\.00−Out£3,236\.85/);
    await page.getByTestId("hero").click();
    await expect(page).toHaveURL(/\/cash/);
    await expect(page.getByTestId("cash-figure")).toHaveAttribute("aria-label", "Available cash £4,765.55");
  });

  test("S7: how it adds up, and the accounts behind the figure (CASH-04)", async ({ page }) => {
    await page.goto("/cash");
    const box = page.getByTestId("adds-up");
    await expect(box).toContainText("Opening cash");
    await expect(box).toContainText("£7,862.40");
    await expect(box).toContainText("+£140.00");
    await expect(box).toContainText("2 transactions");
    await expect(box).toContainText("−£3,236.85");
    await expect(box).toContainText("50 transactions");
    await expect(page.getByTestId("closing")).toHaveText("£4,765.55");
    await expect(page.getByTestId("as-at")).toContainText("As at Sunday 18 October");
    // the pool accounts sum to the hero; savings are listed apart
    const rows = page.getByTestId("cash-account");
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "Marcus" })).toContainText("Savings · set aside");
    await expect(rows.filter({ hasText: "Amex Gold" })).toContainText("−£1,184.73");
    await expect(page.getByText("Not counted")).toBeVisible();
  });

  test("CASH-03: scrubbing the line shows the figure as at that day, straight from SQL", async ({ page }) => {
    await page.goto("/cash");
    const chart = page.getByTestId("cash-chart");
    await expect(chart).toBeVisible();
    await chart.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");        // 18 Oct -> 12 Oct
    await expect(page.getByTestId("as-at")).toHaveText("As at Monday 12 October");
    const expected = await cashAt("2026-10-12");
    await expect.poll(async () => (await page.getByTestId("cash-figure").getAttribute("aria-label"))?.replace(/\D/g, "")).toBe(String(expected));
    await expect(page.getByTestId("closing")).toHaveText(new RegExp(`£${(expected / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`));
    // the equation is for that day: spend so far is less than for the whole month to date
    await expect(page.getByTestId("adds-up")).toContainText("Available Mon 12 Oct");
  });

  test("CASH-03: any past date, in another month, and back to now", async ({ page }) => {
    await page.goto("/cash");
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.locator("input[type=date]").fill("2026-09-30");
    const sep30 = await cashAt("2026-09-30");
    expect(sep30).toBe(786240);                                                   // the October opening cash
    await expect.poll(async () => (await page.getByTestId("cash-figure").getAttribute("aria-label"))?.replace(/\D/g, "")).toBe(String(sep30));
    await expect(page.getByTestId("as-at")).toHaveText("As at Wednesday 30 September");
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByRole("button", { name: "Back to now" }).click();
    await expect(page.getByTestId("cash-figure")).toHaveAttribute("aria-label", "Available cash £4,765.55");
  });

  test("the hero equals available_cash() to the penny after a run of edits", async ({ page }) => {
    // the hero (optimistic, then reconciled) and Postgres converge on exactly the same figure
    const check = async () => {
      await expect.poll(async () => (await heroPence(page)) - (await cashAt("2026-10-18")), { timeout: 15_000 }).toBe(0);
      return cashAt("2026-10-18");
    };
    expect(await check()).toBe(476555);

    // an expense
    await openAdd(page); await amountKeys(page, "23.45");
    await page.getByRole("radio", { name: /Supermarket/ }).click();
    await page.getByRole("button", { name: "Add £23.45" }).click();
    expect(await check()).toBe(476555 - 2345);

    // income
    await openAdd(page); await page.getByRole("tab", { name: "Income" }).click(); await amountKeys(page, "812.19");
    await page.getByRole("radio", { name: "Salary" }).click();
    await page.getByRole("button", { name: "Add income £812.19" }).click();
    expect(await check()).toBe(476555 - 2345 + 81219);

    // £500 to savings leaves the pool: shown as "Set aside", and not as spending
    await openAdd(page); await page.getByRole("tab", { name: "Transfer" }).click(); await amountKeys(page, "500");
    await page.getByRole("button", { name: /^To/ }).click();
    await page.getByRole("button", { name: /^Marcus/ }).click();
    await page.getByRole("button", { name: "Transfer £500.00" }).click();
    expect(await check()).toBe(476555 - 2345 + 81219 - 50000);
    await expect(page.getByTestId("equation")).toContainText("Set aside");
    await expect(page.getByTestId("equation")).toContainText("£500.00");
    await expect(page.getByTestId("pace")).toContainText("£3,260.30");            // 3,236.85 + 23.45: the transfer is not spend

    // edit a March-style old entry: change last month's rent and today's cash moves by exactly the difference
    await page.goto("/activity");
    await page.getByRole("button", { name: /^October/ }).click();
    await page.getByRole("button", { name: "All time" }).click();
    await page.getByTestId("search").fill("Foxtons");
    const rent = page.getByTestId("txn-row").nth(1);                              // an earlier month's rent
    await rent.click();
    await page.getByRole("button", { name: "Delete", exact: true }).click({ delay: 700 });
    await amountKeys(page, "1700");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Saved");
    await page.goto("/");
    const afterEdit = await check();
    expect(afterEdit).toBe(476555 - 2345 + 81219 - 50000 - 5000);                // £1,650 -> £1,700

    // delete the new expense: it comes straight back
    await page.goto("/activity");
    await page.getByTestId("txn-row").filter({ hasText: "£23.45" }).click();
    await page.getByRole("button", { name: "Delete transaction" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await page.goto("/");
    expect(await check()).toBe(afterEdit + 2345);
  });
});
