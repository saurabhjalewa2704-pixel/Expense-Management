import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { amountKeys, openAdd, startTrip } from "../helpers";

test.describe("Trip currencies (TRIP-06)", () => {
  test("EC-T6 a domestic trip has no conversion UI: the currency chip is hidden", async ({ page }) => {
    await startTrip(page);
    await sql(`update trips set currency = 'GBP' where name = 'USA'`);
    await page.reload();
    await openAdd(page);
    await expect(page.getByTestId("trip-chip")).toContainText("USA");
    await expect(page.getByTestId("currency-chip")).toHaveCount(0);
    await expect(page.getByTestId("amount-box")).toContainText("£");
  });

  test("EC-T7 a stop can set its own currency, and any expense can pick another", async ({ page }) => {
    await startTrip(page);
    await sql(`update trip_stops set currency = 'EUR' where name = 'New York'`);              // today (12 Mar) is in the New York stop
    await page.reload();
    await openAdd(page);
    await expect(page.getByTestId("currency-chip")).toContainText("EUR");
    await amountKeys(page, "10");
    await expect(page.getByTestId("fx-conversion")).toContainText("1 EUR = 0.8600 GBP");
    await page.getByTestId("currency-chip").click();
    await page.getByTestId("cur-USD").click();                                                // the trip's own currency is offered too
    await expect(page.getByTestId("fx-conversion")).toContainText("1 USD = 0.7900 GBP");
  });

  test("EC-T10 a past-dated foreign expense uses the rate for its own date", async ({ page }) => {
    await startTrip(page);
    await openAdd(page);
    await page.getByRole("button", { name: /^Date / }).click();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2027-03-08");
    await amountKeys(page, "31");
    await expect(page.getByTestId("fx-conversion")).toContainText("£24.49");
    await page.getByLabel("Payee").fill("Old taxi");
    await page.getByTestId("qcard").first().click();
    await page.getByRole("button", { name: /^Add \$31\.00/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where original_amount_minor = 3100`)).length).toBe(1);
    expect(await sqlOne(`select fx_rate_on::text d, amount_pence::int p, occurred_on::text o, fx_source s from transactions where original_amount_minor = 3100`)).toEqual({ d: "2027-03-08", o: "2027-03-08", s: "auto", p: 2449 });
  });
});
