import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { startTrip } from "../helpers";

test.describe("Trips across the app (TRIP-01, TRIP-05, TRIP-09)", () => {
  test("TRIP-01 Home shows the trip card between the hero and the pace card", async ({ page }) => {
    await startTrip(page);
    const card = page.getByTestId("home-trip-card");
    await expect(card).toHaveAttribute("data-kind", "now");
    await expect(card).toContainText("On a trip · day 7 of 15");
    await expect(card).toContainText("USA");
    await expect(card).toContainText("New York");
    await expect(card.getByTestId("home-trip-allowance")).toHaveText("£159.83 a day");
    await expect(card.getByTestId("home-trip-spent")).toHaveText("£3,561.51");
    await card.click();
    await expect(page.getByTestId("trip-title")).toHaveText("USA");
  });

  test("TRIP-01 Settings opens Trips, and the Activity Trip filter narrows to a trip", async ({ page }) => {
    await startTrip(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Trips/ }).click();
    await expect(page.getByTestId("trips")).toBeVisible();
    await page.goto("/activity");
    await page.getByTestId("trip-chip-filter").click();
    await page.getByTestId("trip-filter-option").filter({ hasText: "On any trip" }).click();
    await page.getByRole("button", { name: "March" }).click();
    await page.getByRole("button", { name: "All time" }).click();
    await expect(page.getByTestId("summary")).toContainText("27 transactions");        // USA's 24 and the three past trips' ones
  });

  test("AC3 / TRIP-05 earlier bookings are offered, pre-checked by destination, and attached as bookings", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await sql(`update transactions set trip_id = null, trip_origin = null where trip_origin = 'booking'`);
    await sql(`insert into payees (user_id, name) select id, 'easyJet' from auth.users limit 1`);
    await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, note, occurred_on)
               select u.id, gen_random_uuid(), 'expense', 8640, (select id from accounts limit 1),
                      (select c.id from categories c join categories p on p.id = c.parent_id where p.name = 'Travel' and c.name = 'Flights'),
                      (select id from payees where name = 'easyJet'), 'LGW–EDI', '2026-11-18' from auth.users u limit 1`);
    await page.goto(`/trips/${usa}?bookings=1`);
    const rows = page.getByTestId("booking-row");
    await expect(rows).toHaveCount(6);
    await expect(page.locator('[data-testid="booking-row"][data-picked="1"]')).toHaveCount(5);
    await expect(rows.filter({ hasText: "easyJet" })).toHaveAttribute("data-picked", "0");            // Edinburgh is not on this trip
    await expect(page.getByTestId("bookings-count")).toHaveText("5 selected");
    await expect(page.getByTestId("bookings-sheet")).toContainText("£2,460.20");
    await page.getByTestId("bookings-add").click();
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from transactions where trip_origin = 'booking' and trip_id = '${usa}'`)).n).toBe(5);
    expect((await sqlOne(`select count(*)::int n from transactions where payee_id = (select id from payees where name = 'easyJet') and trip_id is null`)).n).toBe(1);
  });

  test("AC7 / TRIP-09 'Exclude trips' in Analytics names the trip and its spending", async ({ page }) => {
    await startTrip(page);
    await page.goto("/analytics");
    await page.getByRole("switch", { name: "Exclude trips" }).click();
    await expect(page.getByTestId("trips-banner")).toContainText("Excluding USA (£1,101.31)");
  });

  test("Remove from trip keeps the expense in Activity (swipe action)", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await page.goto(`/trips/${usa}?tab=expenses`);
    await page.getByTestId("trip-search").fill("Blue Bottle");
    const row = page.getByTestId("swipe-row").first();
    await row.getByTestId("remove-from-trip").evaluate((el) => (el as HTMLButtonElement).click());
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from transactions where trip_id = '${usa}'`)).n).toBe(23);
    expect((await sqlOne(`select count(*)::int n from transactions where deleted_at is null and payee_id = (select id from payees where name = 'Blue Bottle')`)).n).toBe(1);
  });
});
