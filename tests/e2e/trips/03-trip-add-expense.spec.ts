import { expect, test, type Page } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { amountKeys, openAdd, startTrip } from "../helpers";

const poundsKeys = async (page: Page, amount: string) => {
  for (const ch of amount) await page.getByTestId("pounds-sheet").getByRole("button", { name: ch === "." ? "Decimal point" : ch, exact: true }).click();
};

test.describe("Add expense on a trip, in dollars (TRIP-04, TRIP-06)", () => {
  test("AC1 / AC2 a $ expense during the trip is tagged, converted, stored in both currencies, and the £ can be corrected", async ({ page }) => {
    await startTrip(page);
    await openAdd(page);
    await expect(page.getByTestId("trip-chip")).toContainText("USA");
    await expect(page.getByTestId("trip-chip")).toHaveAttribute("data-origin", "auto");
    await expect(page.getByTestId("currency-chip")).toContainText("USD");
    await expect(page.getByText("Top on this trip")).toBeVisible();
    await amountKeys(page, "48.60");
    await expect(page.getByTestId("fx-conversion")).toContainText("≈ £38.39");
    await expect(page.getByTestId("fx-conversion")).toContainText("1 USD = 0.7900 GBP");
    await page.getByLabel("Payee").fill("Shake Shack");
    await page.getByTestId("qcard").first().click();
    await page.getByRole("button", { name: "Add $48.60 · £38.39" }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where original_amount_minor = 4860`)).length).toBe(1);
    expect(await sqlOne(`select amount_pence::int p, original_currency c, fx_rate::text r, fx_source s, trip_origin o, (trip_id = (select id from trips where name = 'USA')) in_usa from transactions where original_amount_minor = 4860`))
      .toEqual({ p: 3839, c: "USD", r: "0.79000000", s: "auto", o: "auto", in_usa: true });

    // correct the £ to match the statement: manual, effective rate 0.8045
    await page.goto("/activity?trip=any");
    await page.getByTestId("search").fill("Shake Shack");
    await page.getByTestId("txn-row").first().click();
    await expect(page.getByTestId("fx-conversion")).toContainText("£38.39");
    await page.getByTestId("fx-pounds").click();
    await poundsKeys(page, "39.10");
    await page.getByTestId("pounds-sheet").getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("fx-conversion")).toContainText("£39.10");
    await expect(page.getByTestId("fx-conversion")).toContainText("effective 0.8045");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(async () => (await sqlOne<{ p: number }>(`select amount_pence::int p from transactions where original_amount_minor = 4860`)).p).toBe(3910);
    expect(await sqlOne(`select fx_source s, original_amount_minor::int m, fx_rate::text r from transactions where original_amount_minor = 4860`)).toEqual({ s: "manual", m: 4860, r: "0.80450000" });
  });

  test("AC1 untagging with the chip saves the expense with no trip, in pounds", async ({ page }) => {
    await startTrip(page);
    await openAdd(page);
    await page.getByTestId("trip-chip-x").click();
    await expect(page.getByTestId("trip-chip")).toHaveCount(0);
    await expect(page.getByTestId("currency-chip")).toHaveCount(0);                                    // back to pounds: nothing to convert
    await amountKeys(page, "7");
    await page.getByLabel("Payee").fill("Pret");
    await page.getByTestId("qcard").first().click();
    await page.getByRole("button", { name: "Add £7.00" }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where amount_pence = 700 and original_currency is null and trip_id is null and occurred_on = '2027-03-12'`)).length).toBe(1);
  });

  test("EC-T4 the chip follows the date while it is auto, and is locked when chosen by hand", async ({ page }) => {
    await startTrip(page);
    await openAdd(page);
    await expect(page.getByTestId("trip-chip")).toBeVisible();
    await page.getByRole("button", { name: /^Date / }).click();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2027-03-01");
    await expect(page.getByTestId("trip-chip")).toHaveCount(0);                                        // moved outside the trip: gone
    await page.getByRole("button", { name: /^Date / }).click();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2027-03-09");
    await expect(page.getByTestId("trip-chip")).toBeVisible();                                         // and back inside: restored
    // choosing it by hand locks it on for any date, as a booking when earlier than the trip
    await page.getByTestId("trip-chip").getByRole("button").first().click();
    await page.getByTestId("trip-pick-row").first().click();
    await page.getByRole("button", { name: /^Date / }).click();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2027-02-01");
    await expect(page.getByTestId("trip-chip")).toHaveAttribute("data-origin", "booking");
  });

  test("EC-T8 yen have no decimal point and are stored in whole units", async ({ page }) => {
    await startTrip(page);
    await openAdd(page);
    await page.getByTestId("currency-chip").click();
    await page.getByLabel("Search currencies").fill("JPY");
    await page.getByRole("button", { name: /JPY/ }).click();
    await expect(page.getByRole("button", { name: "Decimal point" })).toHaveCount(0);
    await amountKeys(page, "1200");
    await expect(page.getByTestId("fx-conversion")).toContainText("£6.24");                           // ¥1,200 × 0.0052
    await page.getByLabel("Payee").fill("Ramen");
    await page.getByTestId("qcard").first().click();
    await page.getByRole("button", { name: /^Add ¥1,200 · £6\.24/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where original_currency = 'JPY' and original_amount_minor = 1200`)).length).toBe(1);
  });

  test("EC-T9 with no rate at all, Sterling asks for the £ amount or a rate before saving", async ({ page }) => {
    await startTrip(page);
    await page.route("**/api/fx**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "No rate available" }) }));
    await openAdd(page);
    await page.getByTestId("currency-chip").click();
    await page.getByLabel("Search currencies").fill("ISK");
    await page.getByRole("button", { name: /ISK/ }).click();
    await amountKeys(page, "5000");
    await expect(page.getByTestId("fx-missing")).toBeVisible();
    await page.getByLabel("Payee").fill("Bakery");
    await page.getByTestId("qcard").first().click();
    await expect(page.getByRole("button", { name: /^Add / }).last()).toBeDisabled();
    await page.getByTestId("fx-manual-rate").fill("0.0058");
    await expect(page.getByTestId("fx-conversion")).toContainText("£29.00");
    await page.getByRole("button", { name: /^Add ISK/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where original_currency = 'ISK' and fx_source = 'manual' and amount_pence = 2900`)).length).toBe(1);
  });

  test("AC10 offline, a $ expense uses the last cached rate; after reconnecting it is recalculated with the day's rate", async ({ page, context }) => {
    await startTrip(page);
    await page.evaluate(() => localStorage.setItem("sterling.fx.USD", JSON.stringify({ "2027-03-10": "0.70000000" })));
    await context.setOffline(true);
    await openAdd(page);
    await page.getByTestId("currency-chip").waitFor();
    await amountKeys(page, "48.60");
    await expect(page.getByTestId("fx-conversion")).toContainText("1 USD = 0.7000 GBP");
    await page.getByLabel("Payee").fill("Subway");
    await page.getByTestId("qcard").first().click();
    await page.getByRole("button", { name: /^Add \$48\.60/ }).click();
    expect((await sql(`select 1 from transactions where original_currency = 'USD' and original_amount_minor = 4860`)).length).toBe(0);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await sql(`select 1 from transactions where original_currency = 'USD' and original_amount_minor = 4860`)).length, { timeout: 20_000 }).toBe(1);
    expect(await sqlOne(`select amount_pence::int p, fx_rate::text r, fx_rate_on::text d from transactions where original_amount_minor = 4860`)).toMatchObject({ p: 3839, r: "0.79000000" });
  });

  test("Add to ‹trip› from a past trip opens with the chip locked on and the trip's last day as the date", async ({ page }) => {
    await startTrip(page);
    const lisbon = (await sqlOne<{ id: string; end_on: string }>(`select id, end_on::text from trips where name = 'Lisbon'`));
    await page.goto(`/trips/${lisbon.id}?tab=expenses`);
    await page.getByTestId("trip-add-expense").click();
    await expect(page.getByTestId("trip-chip")).toContainText("Lisbon");
    await expect(page.getByTestId("trip-chip")).toHaveAttribute("data-origin", "manual");
  });
});
