import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { sql, sqlOne } from "../db";
import { startTrip } from "../helpers";

const LOG = resolve(".stack/push.log");
const pushes = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { title: string; body: string; url: string }) : []);
const AUTH = { authorization: "Bearer local-cron-secret" };

test.describe("Trip insights, wrap-up and notifications (TRIP-08)", () => {
  test.beforeEach(() => rmSync(LOG, { force: true }));

  test("the overview shows two to four grounded cards, stored against the trip and kept out of Home and Insights", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await page.goto(`/trips/${usa}`);
    const cards = page.getByTestId("trip-insights").getByTestId("insight-card");
    await expect(cards.first()).toBeVisible();
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    await expect(cards.first()).toContainText("under budget");
    await expect(page.getByTestId("trip-insights")).toContainText("Updated");
    expect(await sqlOne(`select scope, (trip_id = '${usa}') as mine, used_fallback f from insight_runs where trip_id is not null`)).toEqual({ scope: "trip", mine: true, f: true });
    await page.goto("/insights");
    await expect(page.getByText("under budget")).toHaveCount(0);                                    // trip runs never appear in the monthly Insights
  });

  test("AC8 the grounding validator holds: every figure on a trip card is one of the trip's own facts", async ({ page }) => {
    await startTrip(page);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await page.goto(`/trips/${usa}`);
    await expect(page.getByTestId("trip-insights").getByTestId("insight-card").first()).toBeVisible();
    const run = await sqlOne<{ facts: { facts: { display: string }[] }; cards: { title: string; body: string }[]; validation: { dropped: unknown[] } }>(`select facts, cards, validation from insight_runs where trip_id = '${usa}'`);
    const shown = new Set(run.facts.facts.map((f) => f.display));
    for (const c of run.cards) for (const fig of `${c.title} ${c.body}`.match(/£(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?|\d+(?:\.\d+)?%/g) ?? []) expect(shown.has(fig), `${fig} in "${c.title}"`).toBe(true);
    expect(run.validation.dropped).toEqual([]);
  });

  test("AC8 the wrap-up arrives the day after the end date, with a push, once", async ({ page, request }) => {
    await startTrip(page);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/device-1', 'p', 'a' from auth.users limit 1`);
    // the trip ended yesterday (the server's date is Fri 12 Mar)
    await sql(`update trips set end_on = '2027-03-11' where name = 'USA'`);
    const first = await (await request.get("/api/cron/digest?scope=trip", { headers: AUTH })).json() as { trips: { wrapup: string; reason: string }[] };
    expect(first.trips).toHaveLength(1);
    expect(first.trips[0]).toMatchObject({ wrapup: "sent" });
    expect(pushes().map((p) => p.title)).toEqual(["USA wrap-up ready"]);
    expect(pushes()[0]!.url).toMatch(/^\/trips\//);
    expect(pushes()[0]!.body).toContain("£3,561.51 in total");
    const again = await (await request.get("/api/cron/digest?scope=trip", { headers: AUTH })).json() as { trips: { wrapup: string }[] };
    expect(again.trips[0]!.wrapup).toBe("skipped");
    expect(pushes()).toHaveLength(1);
    const usa = (await sqlOne<{ id: string }>(`select id from trips where name = 'USA'`)).id;
    await page.goto(`/trips/${usa}`);
    await expect(page.getByTestId("trip-wrapup")).toContainText("£3,561.51");
    await expect(page.getByTestId("trip-label")).toHaveText("Wrap-up");
  });

  test("the wrap-up push can be switched off in Settings → Reminders", async ({ page, request }) => {
    await startTrip(page);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/device-1', 'p', 'a' from auth.users limit 1`);
    await sql(`update trips set end_on = '2027-03-11' where name = 'USA'; update profiles set trip_notify = false`);
    const run = await (await request.get("/api/cron/digest?scope=trip", { headers: AUTH })).json() as { trips: { wrapup: string }[] };
    expect(run.trips[0]!.wrapup).toBe("skipped");
    expect(pushes()).toHaveLength(0);
  });
});
