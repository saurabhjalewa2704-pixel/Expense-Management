import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { fixClock, resetDb, signIn } from "./helpers";
import { expectNoSidewaysOverflow, expectNoTouchingCards } from "./spacing";

// UX: two cards stacked on a screen must never touch. This walks every screen that has data on the phone and lists any pair of cards
// (anything that paints its own rounded surface) with under 6px between them. The trip and month-close screens have their own copies
// of this check (trips/08, close/03) because they need a different "today".
const one = async (q: string) => (await sql<{ id: string }>(q).catch(() => []))[0]?.id;

test("UI-SP-01 no two cards touch on any phone screen", async ({ page }) => {
  test.setTimeout(400_000);
  await resetDb({ seed: "budget" });
  await fixClock(page.context());
  await signIn(page);
  await page.clock.resume();
  const acc = await one(`select id::text from accounts limit 1`);
  const cat = await one(`select id::text from categories where parent_id is null and kind = 'expense' limit 1`);
  const sub = await one(`select id::text from categories where parent_id is not null and kind = 'expense' limit 1`);
  const pot = await one(`select pot_id::text id from pots limit 1`);
  const bill = await one(`select id::text from recurring_items limit 1`);
  const routes = ["/", "/activity", "/analytics", "/bills", "/bills/new", "/budget", "/budget/setup", "/cash", "/insights", "/insights/ask", "/pots", "/settings", "/settings/accounts", "/settings/ai",
    "/settings/categories", "/settings/data", "/settings/month-close", "/settings/payees", "/settings/reminders", "/settings/shortcuts", "/trips", "/trips/new",
    acc && `/accounts/${acc}`, cat && `/analytics/category/${cat}`, sub && `/analytics/subcategory/${sub}`, pot && `/pots/${pot}`, bill && `/bills/${bill}`, bill && `/bills/${bill}/edit`,
    cat && `/settings/categories/${cat}`].filter((r): r is string => !!r);
  for (const route of routes) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    await expectNoTouchingCards(page, route, expect as never);
    await expectNoSidewaysOverflow(page, route, expect as never);
  }
});
