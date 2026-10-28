import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// Web Push cannot be delivered to a test browser, so the push service is stubbed twice: the page's PushManager hands back a
// fake subscription, and the cron writes to a file instead of the network (STERLING_PUSH_STUB). Real iOS delivery needs a device.
const LOG = resolve(".stack/push.log");
const sent = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { endpoint: string; body: string; url: string }) : []);
const AUTH = { authorization: "Bearer local-cron-secret" };
const at = (hhmmBst: string) => `2026-10-18T${String(Number(hhmmBst.slice(0, 2)) - 1).padStart(2, "0")}:${hhmmBst.slice(3)}:00Z`;   // 18 Oct is BST (UTC+1)

async function fakePush(page: Page, endpoint = "https://push.test/device-1") {
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript((ep) => {
    let current: unknown = null;
    const sub = { endpoint: ep, toJSON: () => ({ endpoint: ep, keys: { p256dh: "BPtestkey", auth: "authkey" } }), unsubscribe: async () => { current = null; return true; } };
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async () => (current = sub) as unknown as PushSubscription;
  }, endpoint);
}

test.describe("evening reminder (M4b, NOT-01)", () => {
  test.beforeEach(() => { rmSync(LOG, { force: true }); });

  test("after the third logged transaction Home asks once; Turn on registers this device", async ({ page }) => {
    await fakePush(page);
    await startDemo(page);
    await sql(`update profiles set reminder_prompted = false`);
    await page.reload();
    const card = page.getByTestId("reminder-prompt");
    await expect(card).toContainText("Get a gentle reminder at 21:00 if you haven’t logged anything?");
    await card.getByRole("button", { name: "Turn on" }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => sqlOne(`select reminder_enabled, reminder_prompted, (select count(*)::int from push_subscriptions) subs, (select endpoint from push_subscriptions limit 1) ep from profiles`))
      .toEqual({ reminder_enabled: true, reminder_prompted: true, subs: 1, ep: "https://push.test/device-1" });
    await page.reload();
    await expect(page.getByTestId("reminder-prompt")).toHaveCount(0);
  });

  test("'Not now' dismisses the card for good and nothing is registered", async ({ page }) => {
    await fakePush(page);
    await startDemo(page);
    await sql(`update profiles set reminder_prompted = false`);
    await page.reload();
    await page.getByTestId("reminder-prompt").getByRole("button", { name: "Not now" }).click();
    await expect(page.getByTestId("reminder-prompt")).toHaveCount(0);
    expect(await sqlOne(`select reminder_enabled, (select count(*)::int from push_subscriptions) subs from profiles`)).toEqual({ reminder_enabled: false, subs: 0 });
  });

  test("it is not offered before the third transaction", async ({ page }) => {
    await fakePush(page);
    await startDemo(page);
    await sql(`update profiles set reminder_prompted = false`);
    await sql(`delete from transactions where id not in (select id from transactions order by occurred_on desc limit 2)`);
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("reminder-prompt")).toHaveCount(0);
  });

  test("Settings → Reminders: toggle, time in 15-minute steps, and the week view", async ({ page }) => {
    await fakePush(page);
    await startDemo(page);
    await sql(`insert into no_spend_days (user_id, day) select id, '2026-10-15' from profiles`);   // Thursday
    await sql(`delete from transactions where occurred_on = '2026-10-15'`);
    await page.goto("/settings/reminders");
    await expect(page.getByRole("switch", { name: "Evening reminder" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("radiogroup", { name: "Reminder time" })).toHaveCount(0);

    await page.getByRole("switch", { name: "Evening reminder" }).click();
    await expect(page.getByRole("switch", { name: "Evening reminder" })).toHaveAttribute("aria-checked", "true");
    const times = page.getByRole("radiogroup", { name: "Reminder time" }).getByRole("radio");
    await expect(times).toHaveCount(21);
    await expect(times.first()).toHaveText("18:00");
    await expect(times.last()).toHaveText("23:00");
    await expect(page.getByRole("radio", { name: "21:00" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "20:30", exact: true }).click();
    await expect(page.getByTestId("reminder-time")).toHaveText("20:30");
    await expect.poll(() => sqlOne<{ t: string }>(`select reminder_time::text t from profiles`).then((r) => r.t)).toBe("20:30:00");

    const week = page.getByTestId("week");
    await expect(week.locator("[data-state]")).toHaveCount(7);
    await expect(week.getByLabel("Thursday: nothing to log")).toHaveText("0");
    await expect(week.getByLabel("Sunday: today, nothing yet").or(week.getByLabel("Sunday: logged"))).toBeVisible();
    await expect(page.getByTestId("week-summary")).toContainText("Thursday was marked “Nothing to log”, so it counts as a genuine no-spend day.");

    await page.getByRole("switch", { name: "Evening reminder" }).click();                  // off: forgets this device
    await expect.poll(() => sqlOne(`select reminder_enabled, (select count(*)::int from push_subscriptions) subs from profiles`)).toEqual({ reminder_enabled: false, subs: 0 });
  });

  test.describe("the nudge cron", () => {
    test.beforeEach(async ({ page }) => {
      await startDemo(page);
      await sql(`update profiles set reminder_enabled = true, reminder_time = '21:00', last_reminder_on = null`);
      await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/device-1', 'k', 'a' from profiles`);
    });
    const run = async (page: Page, now: string) => (await (await page.request.get(`/api/cron/nudge?now=${now}`, { headers: AUTH })).json()).results[0] as { result: string; sent?: number };
    const clearToday = () => sql(`delete from transactions where occurred_on = '2026-10-18'`);

    test("silent when something was logged today", async ({ page }) => {
      await sql(`select 1`);
      expect((await sqlOne<{ n: number }>(`select count(*)::int n from transactions where occurred_on = '2026-10-18'`)).n).toBeGreaterThan(0);
      expect((await run(page, at("21:00"))).result).toBe("logged-today");
      expect(sent()).toHaveLength(0);
    });

    test("exactly one push when nothing is logged, tapping opens Quick Add at /?add=1", async ({ page }) => {
      await clearToday();
      expect(await run(page, at("21:00"))).toMatchObject({ result: "sent", sent: 1 });
      expect(sent()).toEqual([{ endpoint: "https://push.test/device-1", title: "Sterling", body: "Anything to log from today?", url: "/?add=1" }]);
      expect((await run(page, at("21:05"))).result).toBe("already-sent");                      // at most one a day
      expect(sent()).toHaveLength(1);
      expect((await sqlOne<{ d: string }>(`select last_reminder_on::text d from profiles`)).d).toBe("2026-10-18");

      await page.goto("/?add=1");
      await expect(page.getByTestId("quick-add")).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    });

    test("only in the user's slot, in London time", async ({ page }) => {
      await clearToday();
      expect((await run(page, at("20:59"))).result).toBe("outside-slot");
      expect((await run(page, at("21:15"))).result).toBe("outside-slot");
      await sql(`update profiles set reminder_time = '19:45'`);
      expect((await run(page, at("21:00"))).result).toBe("outside-slot");
      expect((await run(page, at("19:50"))).result).toBe("sent");
      // winter (GMT): 21:00 London is 21:00 UTC
      await sql(`update profiles set reminder_time = '21:00', last_reminder_on = null`);
      expect((await run(page, "2026-11-02T21:00:00Z")).result).toBe("sent");
    });

    test("the copy changes after three quiet days", async ({ page }) => {
      await sql(`delete from transactions where occurred_on > '2026-10-14'`);
      await run(page, at("21:00"));
      expect(sent()[0]?.body).toBe("It's been a few days. Two minutes to catch up?");
    });

    test("'Nothing to log' counts as a no-spend day and silences the reminder", async ({ page }) => {
      await clearToday();
      const r = await page.request.post("/api/no-spend");
      expect(r.status()).toBe(200);
      expect((await page.request.post("/api/no-spend")).status()).toBe(200);                    // idempotent
      expect((await sqlOne<{ n: number }>(`select count(*)::int n from no_spend_days where day = '2026-10-18'`)).n).toBe(1);
      expect((await run(page, at("21:00"))).result).toBe("no-spend-marked");
      expect(sent()).toHaveLength(0);
    });

    test("EC-P3 turning the reminder off stops it; an expired subscription is deleted", async ({ page }) => {
      await clearToday();
      await sql(`update profiles set reminder_enabled = false`);
      const off = await (await page.request.get(`/api/cron/nudge?now=${at("21:00")}`, { headers: AUTH })).json();
      expect(off.results).toEqual([]);
      expect(sent()).toHaveLength(0);

      await sql(`update profiles set reminder_enabled = true`);
      await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/gone-device', 'k', 'a' from profiles`);
      expect(await run(page, at("21:00"))).toMatchObject({ result: "sent", sent: 1 });
      expect((await sqlOne<{ n: number }>(`select count(*)::int n from push_subscriptions where endpoint like '%gone%'`)).n).toBe(0);   // 410 → removed
    });

    test("the route needs its secret", async ({ request }) => {
      expect((await request.get("/api/cron/nudge")).status()).toBe(401);
    });
  });

  test("the service worker carries the push and notificationclick handlers", async ({ request }) => {
    const js = await (await request.get("/serwist/sw.js")).text();
    for (const needle of ["evening-reminder", "notificationclick", "/api/no-spend", "Nothing to log"]) expect(js).toContain(needle);
    writeFileSync(LOG, "");                                                                     // keep the log tidy for the next run
  });
});
