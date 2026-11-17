import { expect, test } from "@playwright/test";
import { sql } from "../db";
import { startTrip } from "../helpers";
import { expectNoTouchingCards } from "../spacing";

// UX: no two cards touch on the trip screens, in every phase of a trip (coming up, on now, over) and with and without a budget.
// the guard that keeps a stop inside its trip checks one row at a time, so both tables are moved with it switched off
const shift = (days: number) => sql(`begin; set local session_replication_role = replica;
  update trip_stops set start_on = start_on + ${days}, end_on = end_on + ${days}; update trips set start_on = start_on + ${days}, end_on = end_on + ${days}; commit;`);

for (const [phase, days] of [["on now", 0], ["coming up", 20], ["over", -40]] as const) {
  test(`UI-SP-03 no two cards touch on the trip screens while the trip is ${phase}`, async ({ page }) => {
    test.setTimeout(200_000);
    await startTrip(page);
    if (days) await shift(days);
    const id = (await sql<{ id: string }>(`select id::text from trips order by start_on limit 1`))[0]!.id;
    for (const route of ["/trips", `/trips/${id}`, `/trips/${id}?tab=expenses`, `/trips/${id}/edit`, "/trips/new", "/"]) {
      await page.goto(route);
      await page.waitForTimeout(1800);
      await expectNoTouchingCards(page, `${route} (${phase})`, expect as never);
    }
    await sql(`update trips set budget_pence = null`);
    await page.goto(`/trips/${id}`);
    await page.waitForTimeout(1800);
    await expectNoTouchingCards(page, `/trips/${id} without a budget (${phase})`, expect as never);
  });
}
