import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";

// PRD §6.7.1: sub-category analytics, against the seeded October 2026 (day 18).
test.describe("sub-category analytics (AN-02a/c, AN-07, AN-07b)", () => {
  test("the Sub-categories view ranks every sub-category, flags Restaurants and folds fixed costs", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    const card = page.getByTestId("chart-categories");
    await expect(card.getByRole("tab", { name: "Categories", exact: true })).toHaveAttribute("aria-selected", "true");   // the default
    await card.getByRole("tab", { name: "Sub-categories" }).click();
    await expect(card.getByRole("heading")).toHaveText("Restaurants are up 36% on your usual");
    const rows = card.getByTestId("subcategory-row");
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText("Supermarket");
    await expect(rows.first()).toContainText("Groceries");                 // the parent as the caption
    await expect(rows.first()).toContainText("£314.70");
    await expect(rows.filter({ hasText: "Restaurants" }).getByTestId("delta")).toHaveText("↑ 36%");
    await expect(card.getByTestId("delta")).toHaveCount(1);
    await expect(card.getByTestId("fixed-costs")).toContainText("Fixed costs · 6");
    await expect(card.getByTestId("fixed-costs")).toContainText("£1,910.83");
    await expect(card.getByTestId("fixed-costs")).toContainText("Rent & mortgage, Council tax, Energy and 3 more");
    await card.getByTestId("show-all").click();
    await expect(rows).toHaveCount(20);
    await expect(card.getByTestId("show-all")).toHaveText("Show fewer");
    await card.getByTestId("fixed-costs").click();
    await expect(rows).toHaveCount(26);
  });

  test("the choice is remembered, and switching leaves the rest of the page alone", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-trend").getByRole("heading")).toContainText("October is heading for");
    const trend = await page.getByTestId("chart-trend").getByRole("heading").textContent();
    await page.getByTestId("chart-categories").getByRole("tab", { name: "Sub-categories" }).click();
    await expect(page.getByTestId("chart-trend").getByRole("heading")).toHaveText(trend!);
    await expect(page.getByTestId("period-label")).toHaveText("October 2026");
    await page.reload();
    await expect(page.getByTestId("chart-categories").getByRole("tab", { name: "Sub-categories" })).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("chart-categories").getByRole("tab", { name: "Categories", exact: true }).click();
    await page.reload();
    await expect(page.getByTestId("chart-categories").getByRole("tab", { name: "Categories", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("any sub-category is two taps away", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("chart-categories").getByRole("tab", { name: "Sub-categories" }).click();
    await page.getByTestId("subcategory-row").filter({ hasText: "Restaurants" }).click();
    await expect(page).toHaveURL(/\/analytics\/subcategory\/.*p=2026-10/);
    await expect(page.getByTestId("subcategory-detail")).toContainText("Restaurants · Eating out");
    await expect(page.getByTestId("detail-total")).toHaveText("£142.50");
    await expect(page.getByTestId("detail-cmp")).toHaveText("36% above your usual £105 by this point");
    await expect(page.getByTestId("detail-stats")).toContainText("3");
    await expect(page.getByTestId("chart-split")).toHaveCount(0);                                  // no split card
    await expect(page.getByTestId("trend-chips")).toHaveCount(0);                                  // no chips
    await expect(page.getByTestId("top-places").getByRole("link")).toHaveCount(3);                 // up to five payees
    await expect(page.getByTestId("top-places")).toContainText("Dishoom Kensington");
    await page.getByRole("link", { name: "Analytics" }).first().click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test("Category detail for Eating out matches the mock-up", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("category-row").filter({ hasText: "Eating out" }).click();
    const d = page.getByTestId("category-detail");
    await expect(page.getByTestId("detail-total")).toHaveText("£312.60");
    await expect(page.getByTestId("detail-cmp")).toHaveText("38% above your usual £226 by this point");
    const stats = page.getByTestId("detail-stats");
    await expect(stats).toContainText("21");
    await expect(stats).toContainText("£14.88");
    await expect(stats).toContainText("10%");
    await expect(d.getByTestId("chart-split").getByRole("heading")).toHaveText("Restaurants are almost half of it");
    const bar = d.getByTestId("share-bar");
    const widths = await bar.locator("i").evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.width)));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    await expect(d.getByTestId("subcategory-split").getByTestId("subcategory-row").first()).toContainText("3 visits · avg £47.50");
    await expect(d.getByTestId("chart-monthly").getByRole("heading")).toHaveText("On course for your biggest month in six");
    await expect(d.getByTestId("monthly-bars")).toContainText("≈ £538");
    await expect(d.getByTestId("top-places").getByRole("link").first()).toContainText("Dishoom Kensington");
    await expect(d.getByRole("link", { name: "All 21" })).toBeVisible();
  });

  test("a trend chip redraws the bars for one sub-category; the period follows the URL both ways", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("category-row").filter({ hasText: "Eating out" }).click();
    const bars = page.getByTestId("monthly-bars");
    await expect(bars).toContainText("≈ £538");
    await page.getByTestId("trend-chips").getByRole("button", { name: "Restaurants" }).click();
    await expect(bars).not.toContainText("≈ £538");
    await page.getByTestId("trend-chips").getByRole("button", { name: "All" }).click();
    await expect(bars).toContainText("≈ £538");
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page).toHaveURL(/p=2026-09/);
    await expect(page.getByTestId("period-label")).toHaveText("September 2026");
    await page.getByRole("link", { name: "Analytics" }).first().click();
    await expect(page.getByTestId("period-label")).toHaveText("September 2026");                 // changing it here changed it there
  });

  test("a period with no spending in the category explains itself", async ({ page }) => {
    await startDemo(page);
    await page.goto("/analytics");
    await page.getByTestId("category-row").filter({ hasText: "Eating out" }).click();
    await expect(page).toHaveURL(/p=2026-10/);
    await page.goto(page.url().replace(/p=2026-10/, "p=2020-01"));
    await expect(page.getByTestId("detail-empty")).toContainText("No Eating out spending in January 2020");
  });
});
