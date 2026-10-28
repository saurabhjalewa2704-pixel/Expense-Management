import { expect, test, type Page } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { startTrip } from "../helpers";

async function pickDay(page: Page, day: string) {
  const cell = page.locator(`[data-testid="trip-calendar"] [data-day="${day}"]`);
  for (let i = 0; i < 12 && (await cell.count()) === 0; i++) await page.getByRole("button", { name: "Next month" }).click();
  await cell.click();
}
async function pickDates(page: Page, from: string, to: string) {
  await page.getByTestId("trip-dates").click();
  await pickDay(page, from);
  await pickDay(page, to);
  await page.getByTestId("trip-dates-done").click();
}

test.describe("New and edit trip (TRIP-03)", () => {
  test("AC6 / EC-T1 a trip that overlaps USA is rejected with a message naming USA", async ({ page }) => {
    await startTrip(page);
    await page.goto("/trips/new");
    await page.getByTestId("trip-name").fill("Overlap");
    await pickDates(page, "2027-03-10", "2027-03-14");
    await expect(page.getByTestId("trip-length")).toHaveText("5 days");
    await expect(page.getByTestId("trip-clash")).toContainText("These dates overlap USA (6 Mar – 20 Mar 2027). Trips can’t overlap.");
    await expect(page.getByTestId("trip-save")).toBeDisabled();
    expect((await sqlOne(`select count(*)::int n from trips`)).n).toBe(4);
  });

  test("a country sets the currency, the trip is created and earlier bookings are offered", async ({ page }) => {
    await startTrip(page);
    await page.goto("/trips/new");
    await page.getByTestId("trip-country").click();
    await page.getByLabel("Search where").fill("japan");
    await page.getByRole("button", { name: /Japan/ }).click();
    await expect(page.getByTestId("trip-currency")).toContainText("JPY");
    await expect(page.getByTestId("trip-name")).toHaveValue("Japan");
    await page.getByTestId("trip-name").fill("Japan");
    await pickDates(page, "2027-04-03", "2027-04-10");
    await page.getByTestId("trip-add-stop").click();
    await page.getByLabel("Stop 1 name").fill("Tokyo");
    await page.getByTestId("trip-budget").fill("2000");
    await page.getByTestId("trip-save").click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+/);
    await expect(page.getByTestId("bookings-sheet")).toBeVisible();                                 // TRIP-05: right after the trip is created
    await page.getByTestId("bookings-not-now").click();
    await expect(page.getByTestId("trip-title")).toHaveText("Japan");
    expect(await sqlOne(`select currency c, country_code cc, budget_pence::int b, auto_tag a from trips where name = 'Japan'`)).toEqual({ c: "JPY", cc: "JP", b: 200000, a: true });
    expect((await sqlOne(`select count(*)::int n from trip_stops s join trips t on t.id = s.trip_id where t.name = 'Japan'`)).n).toBe(1);
  });

  test("EC-T2 shortening the dates asks what to do with expenses now outside; bookings always stay", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await page.goto(`/trips/${usa}/edit`);
    await expect(page.getByTestId("trip-name")).toHaveValue("USA");
    await page.getByRole("button", { name: "Remove stop 3" }).click();                              // the stops have to sit inside the dates, so drop NY and Miami first
    await page.getByRole("button", { name: "Remove stop 2" }).click();
    await pickDates(page, "2027-03-06", "2027-03-10");
    await expect(page.getByTestId("trip-outside")).toContainText("5 expenses are now outside the trip dates.");
    await page.getByRole("radio", { name: "Remove them" }).click();
    await page.getByTestId("trip-save").click();
    await expect(page.getByTestId("trip-title")).toHaveText("USA");
    expect(await sqlOne(`select count(*) filter (where trip_origin = 'booking')::int bookings, count(*)::int total from transactions where trip_id = '${usa}'`)).toEqual({ bookings: 5, total: 19 });
  });

  test("AC9 / EC-T17 deleting a trip leaves every transaction in place with trip_id null", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    const before = (await sql<{ id: string }>(`select id from transactions where trip_id = '${usa}'`)).map((r) => r.id);
    expect(before).toHaveLength(24);
    await page.goto(`/trips/${usa}/edit`);
    await page.getByTestId("trip-delete").click();
    await page.getByTestId("trip-confirm").click();
    await expect(page).toHaveURL(/\/trips$/);
    expect((await sqlOne(`select count(*)::int n from trips where id = '${usa}'`)).n).toBe(0);
    expect(await sqlOne(`select count(*)::int n, count(*) filter (where trip_id is null and trip_origin is null)::int cleared from transactions where id = any($1::uuid[]) and deleted_at is null`, [before])).toEqual({ n: 24, cleared: 24 });
  });
});
