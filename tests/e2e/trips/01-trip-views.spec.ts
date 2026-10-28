import { expect, test } from "@playwright/test";
import { startTrip } from "../helpers";

// PRD v1.6 Appendix A.2: USA, Sat 6 – Sat 20 Mar 2027, viewed on Fri 12 Mar (day 7 of 15), £5,000 budget.
test.describe("Trips: list, overview and expenses (TRIP-02, TRIP-07, TRIP-10)", () => {
  test("the Trips list leads with the current trip and lists past trips", async ({ page }) => {
    await startTrip(page);
    await page.goto("/trips");
    const hero = page.getByTestId("trip-hero");
    await expect(hero).toContainText("Now · day 7 of 15");
    await expect(hero).toContainText("USA");
    await expect(hero).toContainText("Chicago · New York · Miami");
    await expect(hero.getByTestId("trip-hero-spent")).toHaveText("£3,561.51");
    await expect(hero).toContainText("spent of £5,000 budget");
    await expect(page.getByTestId("trips-past").getByTestId("trip-row")).toHaveCount(3);
    await expect(page.getByTestId("trips-past")).toContainText("Lisbon");
  });

  test("AC4 the overview shows spent, left, the daily allowance and the chart", async ({ page }) => {
    await startTrip(page);
    await page.goto("/trips");
    await page.getByTestId("trip-hero").click();
    await expect(page.getByTestId("trip-label")).toHaveText("Day 7 of 15 · New York");
    await expect(page.getByTestId("trip-title")).toHaveText("USA");
    await expect(page.getByTestId("trip-spent")).toHaveText("£3,561.51");
    await expect(page.getByTestId("trip-left")).toHaveText("£1,438.49");
    await expect(page.getByTestId("trip-budget-card")).toContainText("Booked before · £2,460.20");
    await expect(page.getByTestId("trip-budget-card")).toContainText("On the trip · £1,101.31");
    await expect(page.getByTestId("trip-allowance")).toContainText("You can spend £159.83 a day for the next 9 days and stay on budget.");
    await expect(page.getByTestId("trip-bar")).toHaveCount(15);
    await expect(page.locator('[data-testid="trip-bar"].fut')).toHaveCount(8);                      // 7 filled, 8 empty
    await expect(page.getByTestId("trip-daily")).toContainText("planned £169.32 a day");
    await expect(page.getByTestId("trip-daily")).toContainText("Thursday was your biggest day: Hamilton");
  });

  test("AC5 by stop: Chicago, New York and Miami upcoming", async ({ page }) => {
    await startTrip(page);
    await page.goto(`/trips`);
    await page.getByTestId("trip-hero").click();
    const rows = page.getByTestId("trip-stop-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Chicago");
    await expect(rows.nth(0)).toContainText("3 days");
    await expect(rows.nth(0)).toContainText("£322.57");
    await expect(rows.nth(1)).toContainText("New York");
    await expect(rows.nth(1)).toContainText("4 days so far");
    await expect(rows.nth(1)).toContainText("£778.74");
    await expect(rows.nth(2)).toContainText("Miami");
    await expect(rows.nth(2)).toContainText("Upcoming");
    await expect(page.getByTestId("trip-by-stop")).toContainText("New York is your priciest stop so far");
  });

  test("where it went defaults to sub-categories and covers bookings too", async ({ page }) => {
    await startTrip(page);
    await page.goto(`/trips`);
    await page.getByTestId("trip-hero").click();
    const where = page.getByTestId("trip-where");
    await expect(where).toContainText("Flights and hotels are 68% of the trip");
    const first = where.getByTestId("trip-cat-row").first();
    await expect(first).toContainText("Flights");
    await expect(first).toContainText("£1,360.80");
    await expect(where.getByTestId("trip-cat-row")).toHaveCount(7);
    await where.getByTestId("trip-cat-more").click();
    await expect(where.getByTestId("trip-cat-row")).toHaveCount(10);
    await page.getByTestId("trip-explainer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("trip-explainer")).toContainText("£1,101.31 counts in March");
    await expect(page.getByTestId("trip-explainer")).toContainText("£2,460.20 of bookings counted in");
  });

  test("TRIP-10 expenses tab: summary, days newest first and Booked before the trip", async ({ page }) => {
    await startTrip(page);
    await page.goto(`/trips`);
    await page.getByTestId("trip-hero").click();
    await expect(page.getByTestId("tab-expenses")).toHaveText("Expenses · 24");
    await page.getByTestId("tab-expenses").click();
    const sum = page.getByTestId("trip-summary");
    await expect(sum).toContainText("24 expenses");
    await expect(sum).toContainText("£3,561.51");
    await expect(sum).toContainText("$1,394.05");
    await expect(sum).toContainText("average 0.7900 £/$");
    const days = page.getByTestId("trip-day");
    await expect(days.first()).toContainText("Today");
    await expect(days.first()).toContainText("New York · £26.23");
    await expect(days.first().getByTestId("txn-row").first().getByTestId("original-amount")).toBeVisible();
    await expect(days).toHaveCount(7);
    const before = page.getByTestId("trip-booked-before");
    await expect(before).toContainText("£2,460.20");
    await expect(before.getByTestId("txn-row")).toHaveCount(5);
    await expect(before.getByTestId("txn-row").first()).toContainText("United");
    await expect(before.getByTestId("txn-row").first().getByTestId("not-in-balance")).toHaveText("Not in balance");     // EC-T3: July is before tracking began
    await page.getByTestId("trip-search").fill("carbone");
    await expect(page.getByTestId("txn-row")).toHaveCount(1);
  });
});
