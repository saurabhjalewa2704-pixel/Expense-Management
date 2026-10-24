import { expect, test } from "@playwright/test";
import { resetDb, signIn, startDemo } from "./helpers";

test.describe("analytics (AN-01..08)", () => {
  test("every chart renders on the demo data with a finding title that states the insight", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await expect(page.getByTestId("period-label")).toHaveText("October 2026");

    await expect(page.getByTestId("chart-pace").getByRole("heading")).toHaveText("You're £367 under September's pace");
    await expect(page.getByTestId("pace-chart")).toBeVisible();

    const cats = page.getByTestId("chart-categories");
    await expect(cats.getByRole("heading")).toHaveText("Eating out is up 38% on your usual");
    await expect(cats.getByTestId("delta")).toHaveText("↑ 38%");
    await expect(cats.getByTestId("category-row").first()).toContainText("Groceries");           // Home is the "fixed costs" row
    await expect(cats).toContainText("Home · fixed costs");
    await expect(cats).toContainText("£1,812.40");
    await expect(cats.getByTestId("category-row")).toHaveCount(8);                                // top 8 (+ everything else)

    const wf = page.getByTestId("chart-waterfall");
    await expect(wf.getByRole("heading")).toHaveText("£4,765.55 left after £3,236.85 of spending");
    await expect(wf).toContainText("scale starts at £4,000");
    for (const step of ["Opening", "Income", "Home", "Groceries", "Eating out", "Transport", "Other", "Available"]) await expect(wf.getByRole("listitem", { name: new RegExp(`^${step} `) })).toBeVisible();
    await expect(wf.getByRole("listitem", { name: /^Other −£510\.80$/ })).toBeVisible();          // 3,236.85 − the four named categories
    await expect(wf.getByRole("listitem", { name: /^Available £4,765\.55$/ })).toBeVisible();

    await expect(page.getByTestId("chart-trend").getByRole("heading")).toHaveText("October is heading for £5,062, near your average");
    await expect(page.getByTestId("chart-trend")).toContainText("hatched = projected");
    await expect(page.getByTestId("chart-rhythm").getByRole("heading")).toHaveText(/^\w+days are your biggest day$/);
    await expect(page.getByTestId("heatmap").getByRole("button")).toHaveCount(31);
    await expect(page.getByTestId("top-payees").getByRole("link").first()).toContainText("Foxtons Lettings");
    await expect(page.getByTestId("compare-table")).toContainText("Eating out");
    await expect(page.getByTestId("compare").getByRole("heading")).toHaveText("October 2026 vs September");
  });

  test("every chart has a table alternative", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    for (const id of ["chart-pace", "chart-categories", "chart-waterfall", "chart-trend", "chart-rhythm", "compare"]) {
      const card = page.getByTestId(id);
      await card.getByRole("button", { name: "View as table" }).click();
      await expect(card.getByRole("table")).toBeVisible();
      await expect(card.getByRole("columnheader").first()).toBeVisible();
      await card.getByRole("button", { name: "View as chart" }).click();
    }
    const wf = page.getByTestId("chart-waterfall");
    await wf.getByRole("button", { name: "View as table" }).click();
    await expect(wf.getByRole("row", { name: /Opening.*£7,862\.40/ })).toBeVisible();
    await expect(wf.getByRole("row", { name: /Available.*£4,765\.55/ })).toBeVisible();
  });

  test("the period control steps, switches range and stops at the present", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await expect(page.getByRole("button", { name: "Next period" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page.getByTestId("period-label")).toHaveText("September 2026");
    await expect(page.getByTestId("chart-pace").getByRole("heading")).toHaveText(/under|over/);
    await expect(page.getByTestId("chart-pace").getByRole("heading")).toContainText("August's pace");
    await expect(page.getByTestId("chart-waterfall").getByRole("heading")).toContainText("of spending");
    await page.getByRole("button", { name: "Next period" }).click();
    await page.getByRole("tab", { name: "Quarter" }).click();
    await expect(page.getByTestId("period-label")).toHaveText("Q4 2026");
    await page.getByRole("tab", { name: "Year" }).click();
    await expect(page.getByTestId("period-label")).toHaveText("2026");
    await expect(page.getByTestId("chart-categories").getByTestId("delta")).toHaveCount(0);        // "usual" is a month-view idea
    await page.getByRole("tab", { name: "Custom" }).click();
    await page.getByLabel("From date").fill("2026-10-01");
    await page.getByLabel("To date").fill("2026-10-10");
    await page.getByRole("button", { name: "Apply range" }).click();
    await expect(page.getByTestId("period-label")).toHaveText("1 Oct – 10 Oct");
  });

  test("drill down: category → sub-category → its transactions", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("category-row").filter({ hasText: "Eating out" }).click();
    await expect(page).toHaveURL(/\/analytics\/category\/.*p=2026-10/);
    await expect(page.getByRole("heading", { name: "Eating out", level: 1 })).toBeVisible();
    await expect(page.getByTestId("avg-ticket")).toHaveText("£14.88");                              // £312.60 over 21 transactions
    const split = page.getByTestId("subcategory-split");
    await expect(split).toContainText("Restaurants");
    await expect(split).toContainText("Coffee & snacks");
    await expect(page.getByTestId("chart-monthly")).toBeVisible();
    await split.getByRole("link", { name: /Restaurants/ }).click();
    await expect(page).toHaveURL(/\/analytics\/subcategory\//);
    await expect(page.getByTestId("detail-total")).toHaveText("£142.50");
    await page.getByRole("link", { name: "All 3" }).click();
    await expect(page).toHaveURL(/\/activity\?categories=/);
    await expect(page.getByTestId("summary")).toContainText("out");
    const rows = await page.getByTestId("txn-row").count();
    expect(rows).toBe(3);
    for (const r of await page.getByTestId("txn-row").all()) await expect(r).toContainText(/Franco Manca|Honest Burgers|Dishoom/);
  });

  test("a top payee opens Activity filtered to that payee", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("top-payees").getByRole("link", { name: /Foxtons Lettings/ }).click();
    await expect(page.getByTestId("txn-row")).toHaveCount(1);
    await expect(page.getByTestId("txn-row")).toContainText("£1,600.00");
    await page.getByRole("button", { name: "Remove payee filter" }).click();
    await expect.poll(() => page.getByTestId("txn-row").count()).toBeGreaterThan(5);
  });

  test("empty and loading states: a new owner with no data sees explanations, not broken charts", async ({ page }) => {
    await resetDb({ onboarded: true });
    await signIn(page);
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-pace")).toContainText("Nothing to show for this period yet");
    await expect(page.getByTestId("chart-categories")).toContainText("Nothing to show");
    await expect(page.getByTestId("chart-rhythm")).toContainText("Nothing to show");
    await expect(page.getByText("No payees in this period.")).toBeVisible();
  });
});
