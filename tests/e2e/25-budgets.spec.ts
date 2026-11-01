import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, openAdd, startBudget, startDemo } from "./helpers";

// PRD §6.13 acceptance criteria against Appendix A.3 (Sun 18 Oct 2026).
test.describe("budgets (BUD acceptance, FC-9, CASH-06)", () => {
  test("BUD-1/2 Home: the budget card and the three limits most at risk", async ({ page }) => {
    await startBudget(page);
    const card = page.getByTestId("budget-card");
    await expect(card.getByTestId("budget-left")).toHaveText("£1,163.15");
    await expect(card).toContainText("left of £4,400");
    await expect(page.getByTestId("budget-sub")).toContainText("74% spent · 58% of the month gone · £132 under plan");
    await expect(card.getByTestId("safe-to-spend")).toContainText("£80.58");
    await expect(card.getByTestId("safe-to-spend")).toContainText("for 14 days, after bills");
    await expect(card.getByTestId("forecast-kpi")).toContainText("£4,363");
    await expect(card.getByTestId("forecast-kpi")).toContainText("£37 headroom");
    await expect(card.getByTestId("budget-status")).toHaveText("Tight");
    const rows = page.getByTestId("limits-card").getByTestId("limit-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Eating out");
    await expect(rows.nth(0)).toContainText("Forecast £142 over");
    await expect(rows.nth(1)).toContainText("Entertainment");
    await expect(rows.nth(1)).toContainText("Forecast £8 over");
    await expect(rows.nth(2)).toContainText("Groceries");
    await expect(rows.nth(2)).toContainText("Forecast £38 under");
    await page.screenshot({ path: "tests/e2e/shots/budget-home.png", fullPage: true });
  });

  test("BUD-3 Why this forecast? adds up to the forecast (BUD-05a rule 8)", async ({ page }) => {
    await startBudget(page);
    await page.getByTestId("forecast-kpi").click();
    const body = page.getByTestId("why-body");
    await expect(body).toContainText("£3,236.85");
    await expect(body).toContainText("Spotify 22nd · Disney+ 24th · Netflix 27th");
    await expect(body).toContainText("+£34.97");
    await expect(body).toContainText("£78.40/day × 14 days, less £6.40 already logged today");
    await expect(body).toContainText("+£1,091.20");
    await expect(page.getByTestId("why-forecast")).toHaveText("£4,363.02");
    await expect(body).toContainText("£1,248.03 non-bill spend ÷ 18 tracked days");
    await expect(body).toContainText("£69.34 × 60%");
    await expect(body).toContainText("£92.00 × 40%");
    await expect(body).toContainText("Likely range £4,105–£4,735");
    await expect(page.getByTestId("why-degenerate")).toHaveCount(0);
  });

  test("BUD-4..6 Budget detail: tiles, what-ifs, limits and the watch card", async ({ page }) => {
    await startBudget(page);
    await page.goto("/budget");
    await expect(page.getByTestId("budget-month")).toHaveText("October 2026");
    await expect(page.getByTestId("budget-left")).toHaveText("£1,163.15");
    await expect(page.getByTestId("forecast-title")).toHaveText("On course to finish £37 under budget");
    await expect(page.getByTestId("tile-safe")).toContainText("£80.58/day");
    await expect(page.getByTestId("tile-usual")).toContainText("£78.40/day");
    await expect(page.getByTestId("tile-plan")).toContainText("£131.70 under");
    await expect(page.getByTestId("tile-bills")).toContainText("£34.97");
    await expect(page.getByTestId("whatif-low")).toContainText("£4,105");
    await expect(page.getByTestId("whatif-safe")).toContainText("£4,394");
    await expect(page.getByTestId("whatif-usual")).toContainText("£4,363");
    await expect(page.getByTestId("limits-list").getByTestId("limit-row")).toHaveCount(6);        // five limits and Everything else
    await expect(page.getByTestId("limits-list")).toContainText("Forecast £60 under");
    await expect(page.getByTestId("watch-card")).toContainText("Eating out has £87.40 left for 14 days");
    await expect(page.getByTestId("forecast-chart")).toBeVisible();
    await page.screenshot({ path: "tests/e2e/shots/budget-detail.png", fullPage: true });
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByTestId("budget-month")).toHaveText("September 2026");
    await expect(page.getByTestId("budget-none")).toBeVisible();        // no budget existed in September
  });

  test("CASH-06 Available cash shows the projected close, ≈ £3,139", async ({ page }) => {
    await startBudget(page);
    await page.goto("/cash");
    await expect(page.getByTestId("projected-close")).toContainText("≈ £3,139");
    await expect(page.getByTestId("cash-projection")).toBeVisible();
    await page.goto("/insights");
    await expect(page.getByTestId("month-outlook")).toContainText("On track to close October at about £3,139");
  });

  test("FC-9 the trend chart, Budget card and Available cash show one forecast", async ({ page, request }) => {
    await startBudget(page);
    await page.goto("/analytics");
    await page.getByTestId("trend-why").click();
    await expect(page.getByTestId("why-forecast")).toHaveText("£4,363.02");
  });

  test("Setup: a new budget with a limit, saved from the screen", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByTestId("budget-prompt")).toBeVisible();
    await expect(page.getByTestId("pace")).toBeVisible();                 // the pace card stays until a budget exists
    await page.getByTestId("budget-prompt").click();
    await page.getByTestId("budget-amount").fill("4400");
    await page.getByTestId("setup-limit").filter({ hasText: "Groceries" }).click();
    await page.getByTestId("limit-amount").fill("750");
    await page.getByTestId("limit-save").click();
    await page.getByTestId("setup-limit").filter({ hasText: "Eating out" }).click();
    await page.getByTestId("limit-amount").fill("400");
    await page.getByTestId("limit-save").click();
    await expect(page.getByTestId("limits-total")).toHaveText("£1,150");
    await expect(page.getByTestId("left-else")).toHaveText("£3,250");
    await page.getByTestId("budget-save").click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByTestId("limits-list").getByTestId("limit-row")).toHaveCount(3);
    const rows = await sql<{ category_id: string | null; amount_pence: string }>("select category_id, amount_pence from budgets order by amount_pence desc");
    expect(rows.map((r) => r.amount_pence)).toEqual(["440000", "75000", "40000"]);
    await page.goto("/");
    await expect(page.getByTestId("budget-card")).toBeVisible();
    await expect(page.getByTestId("pace")).toHaveCount(0);                // the budget card replaces the pace card
  });

  test("EC-G3 limits adding to more than the budget warn, and still save", async ({ page }) => {
    await startDemo(page);
    await page.goto("/budget/setup");
    await page.getByTestId("budget-amount").fill("500");
    await page.getByTestId("setup-limit").filter({ hasText: "Groceries" }).click();
    await page.getByTestId("limit-amount").fill("750");
    await page.getByTestId("limit-save").click();
    await expect(page.getByTestId("limits-warning")).toContainText("£250.00 more than your monthly budget");
    await expect(page.getByTestId("left-else")).toHaveText("£0");
    await page.getByTestId("budget-save").click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByTestId("limits-warning")).toBeVisible();
  });

  test("BUD-11 Analytics › Budgets: variance, table, history and health", async ({ page }) => {
    await startBudget(page);
    await page.goto("/analytics");
    await page.getByTestId("tab-budgets").click();
    await expect(page.getByTestId("abudget-month")).toHaveText("October 2026");
    const rows = page.getByTestId("var-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText("Eating out");
    await expect(rows.nth(0)).toContainText("+£142");
    await expect(rows.nth(1)).toContainText("Entertainment");
    await expect(rows.nth(5)).toContainText("Everything else");
    await expect(rows.nth(5)).toContainText("−£60");
    await expect(page.getByTestId("variance-net")).toContainText("Net −£37");
    const table = page.getByTestId("budget-table");
    await expect(table).toContainText("£3,237 spent, £4,363 forecast");
    await expect(table).toContainText("£2,300");
    await expect(table).toContainText("£2,240");
    await expect(page.getByTestId("budget-history")).toContainText("of the last 5 months within budget");
    await expect(page.getByTestId("health-track")).toHaveText("3 of 5");
    await page.screenshot({ path: "tests/e2e/shots/analytics-budgets.png", fullPage: true });
  });

  test("BUD-12 Category detail shows the limit and the forecast", async ({ page }) => {
    await startBudget(page);
    const id = (await sql<{ id: string }>("select id from categories where name = 'Eating out' and parent_id is null"))[0]!.id;
    await page.goto(`/analytics/category/${id}`);
    await expect(page.getByTestId("detail-limit")).toContainText("£312.60 of £400 · forecast £542");
    await expect(page.getByTestId("limit-line")).toHaveCount(1);
  });

  test("EC-G8 a refund linked to a category reduces its spend", async ({ page }) => {
    await startBudget(page);
    await page.goto("/");
    await openAdd(page);
    await page.getByRole("tab", { name: "Income" }).click();
    await page.getByText("Refunds", { exact: true }).first().click();
    await page.getByTestId("refund-for").locator("select").selectOption({ label: "Eating out" });
    await amountKeys(page, "20");
    await page.getByRole("button", { name: /^Add income/ }).click();
    await expect.poll(async () => (await sql("select 1 from transactions where refund_category_id is not null")).length).toBe(1);
    await page.goto("/budget");
    await expect(page.getByTestId("limits-list").getByTestId("limit-row").filter({ hasText: "Eating out" })).toContainText("£292.60");
  });

  test("BUD-10 the alert check records one forecast alert per limit, and not a second", async ({ page, request }) => {
    await startBudget(page);
    const first = await page.request.post("/api/budget/check");
    expect(first.ok()).toBe(true);
    const sent = (await first.json()).sent as { kind: string; name: string }[];
    expect(sent).toEqual([{ kind: "forecast_over", name: "Eating out" }]);
    const again = await (await page.request.post("/api/budget/check")).json();
    expect(again.sent).toEqual([]);
    expect((await sql("select 1 from budget_alerts_sent")).length).toBe(1);
  });
});
