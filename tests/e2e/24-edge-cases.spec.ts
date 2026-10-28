import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { sql, sqlOne } from "./db";
import { amountKeys, fixClock, openAdd, resetDb, signIn, startDemo } from "./helpers";

// The edge-case register (PRD §18): the rows that need a browser. Each test name starts with the row's ID.
const LOG = resolve(".stack/push.log");
const pushes = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { endpoint: string; title: string }) : []);
const AUTH = { authorization: "Bearer local-cron-secret" };

test.describe("money display", () => {
  test("EC-M5 below zero the hero reads Overdrawn by, with a minus sign and a caution dot", async ({ page }) => {
    await startDemo(page);
    await sql(`update accounts set opening_balance_pence = -9000000 where counts_as_cash`);
    await page.reload();
    await expect(page.locator(".hero-label").first()).toContainText("Overdrawn by");
    await expect(page.getByTestId("hero")).toHaveAttribute("aria-label", /^Available cash −£/);
    await expect(page.getByTestId("overdrawn-dot")).toBeVisible();
  });

  test("EC-M6 a figure over a million shrinks to stay on one line, never below 44px", async ({ page }) => {
    await startDemo(page);
    await sql(`update accounts set opening_balance_pence = 1250000000 where name = 'Monzo'`);
    await page.reload();
    const fig = page.getByTestId("hero").locator(".figure");
    await expect(fig).toBeVisible();
    const size = Number(await fig.getAttribute("data-size"));
    expect(size).toBeLessThan(64);
    expect(size).toBeGreaterThanOrEqual(44);
    const box = await fig.boundingBox();
    expect(box!.height).toBeLessThan(90);                                  // one line
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test("EC-M7 a credit card in credit shows £x in credit and counts as positive cash", async ({ page }) => {
    await startDemo(page);
    await sql(`update accounts set opening_balance_pence = 5000000 where type = 'credit_card'`);
    await page.goto("/settings/accounts");
    await expect(page.getByTestId("account-amt").filter({ hasText: "in credit" }).first()).toBeVisible();
  });

  test("EC-M2 a digit past £999,999.99 is ignored, with a short shake", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "999999");
    await page.getByRole("button", { name: "9", exact: true }).click();
    await expect(page.getByTestId("amount")).toHaveText("999,999");
    await expect(page.getByTestId("amount-box")).toHaveClass(/shake/);
  });
});

test.describe("insights and analytics states", () => {
  test("EC-N8 with fewer than 10 transactions, insights are hidden with a friendly line", async ({ page }) => {
    await startDemo(page);
    await sql(`delete from transactions where id not in (select id from transactions order by created_at limit 5)`);
    await page.goto("/insights");
    await expect(page.getByTestId("insights-too-few")).toContainText("Log a few more days and insights will appear.");
  });

  test("EC-N2 with fewer than three earlier periods, the usual markers are replaced by Not enough history yet", async ({ page }) => {
    await startDemo(page);
    await sql(`delete from transactions where occurred_on < '2026-09-01'`);
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-categories")).toContainText("Not enough history yet");
    await expect(page.getByTestId("delta")).toHaveCount(0);
  });

  test("EC-N4 an empty period explains itself and links to the previous one", async ({ page }) => {
    await startDemo(page);
    await sql(`delete from transactions where occurred_on >= '2026-10-01'`);
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-categories").getByTestId("chart-empty")).toBeVisible();
    await page.getByTestId("see-previous").click();
    await expect(page.getByTestId("chart-categories").getByTestId("category-row").first()).toBeVisible();
  });

  test("EC-D4 back-dating into a period that has insights marks them out of date", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights");
    await page.getByRole("button", { name: /refresh/i }).first().click();
    await expect(page.getByTestId("insight-card").first()).toBeVisible();
    await sql(`update insight_runs set period_start = '2026-10-01', period_end = '2026-10-31'`);
    await sql(`update transactions set amount_pence = amount_pence + 1 where id = (select id from transactions where occurred_on = '2026-10-10' limit 1)`);
    await page.reload();
    await expect(page.getByTestId("insights-stale")).toBeVisible();
    await expect(page.getByTestId("insights-paused")).toBeVisible();                       // EC-N6: no model here, so the template stands in
  });
});

test.describe("dates", () => {
  test.describe("abroad", () => {
    test.use({ timezoneId: "America/New_York" });
    test("EC-D1 at 20:30 in New York the entry is dated the day lived there, with the zone stored", async ({ page, context }) => {
      await resetDb({ seed: "demo" });
      await context.clock.install({ time: new Date("2026-10-19T00:30:00Z") });             // 20:30 on 18 Oct in New York, 01:30 on 19 Oct in London
      await signIn(page);
      await page.clock.resume();
      await openAdd(page);
      await expect(page.getByRole("button", { name: "Date Today" })).toBeVisible();
      await amountKeys(page, "6");
      await page.getByLabel("Payee").fill("Shake Shack");
      await page.getByRole("radio").first().click();
      await page.getByRole("button", { name: /^Add £6\.00/ }).click();
      await expect.poll(async () => (await sql(`select 1 from transactions where amount_pence = 600`)).length).toBe(1);
      expect(await sqlOne(`select occurred_on::text d, occurred_tz z from transactions where amount_pence = 600`)).toEqual({ d: "2026-10-18", z: "America/New_York" });
    });
  });

  test("EC-D5 a future-dated expense is Scheduled: listed apart, on the Bills calendar, and not in today's cash", async ({ page }) => {
    await startDemo(page);
    const before = await sqlOne<{ b: string }>(`select available_cash('2026-10-18')::text b`);
    await openAdd(page);
    await amountKeys(page, "200");
    await page.getByLabel("Payee").fill("Venue deposit");
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /^Date / }).click();
    await page.getByRole("button", { name: "Pick a date" }).click();
    await page.getByLabel("Date", { exact: true }).fill("2026-10-25");
    await page.getByRole("button", { name: /^Add £200\.00/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where amount_pence = 20000 and occurred_on = '2026-10-25'`)).length).toBe(1);
    expect((await sqlOne<{ b: string }>(`select available_cash('2026-10-18')::text b`)).b).toBe(before.b);
    await page.goto("/activity");
    await expect(page.getByTestId("scheduled")).toContainText("Venue deposit");
    await page.goto("/bills");
    await expect(page.getByTestId("bills-scheduled")).toContainText("Venue deposit");
  });

  test("EC-D6 a device clock that is wrong changes nothing the server decides", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "3");
    await page.getByLabel("Payee").fill("Clock check");
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /^Add £3\.00/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where amount_pence = 300`)).length).toBe(1);
    const { s } = await sqlOne<{ s: number }>(`select abs(extract(epoch from now() - created_at))::int s from transactions where amount_pence = 300`);
    expect(s).toBeLessThan(120);                                                          // created_at is the server's clock (the browser's is pinned to October 2026)
  });
});

test.describe("accounts", () => {
  test("EC-A7 an account with no transactions can be deleted; one with transactions offers Archive instead", async ({ page }) => {
    await startDemo(page);
    await sql(`insert into accounts (user_id, name, type, opening_balance_pence, opening_date) select id, 'Empty', 'current', 0, '2026-10-01' from auth.users limit 1`);
    const empty = (await sqlOne<{ id: string }>(`select id from accounts where name = 'Empty'`)).id;
    const busy = (await sqlOne<{ id: string }>(`select id from accounts where name = 'Monzo'`)).id;
    await page.goto(`/accounts/${busy}`);
    await expect(page.getByRole("heading", { name: "Monzo" })).toBeVisible();
    await expect(page.getByTestId("account-delete")).toHaveCount(0);
    await page.goto(`/accounts/${empty}`);
    await page.getByTestId("account-delete").click();
    await page.getByTestId("account-delete-confirm").click();
    await expect.poll(async () => (await sqlOne<{ n: number }>(`select count(*)::int n from accounts where name = 'Empty'`)).n).toBe(0);
  });

  test("EC-A5 moving an account out of the pool recomputes history and says when", async ({ page }) => {
    await startDemo(page);
    await sql(`update accounts set counts_as_cash = false where name = 'Monzo'`);
    await page.goto("/cash");
    await expect(page.getByTestId("pool-changed")).toContainText(/Pool changed on \d+ \w+\. History uses today’s accounts\./);
  });
});

test.describe("reminders and notifications", () => {
  test("EC-P1 where Sterling is not installed (iPhone), the toggle is off with an Install card", async ({ page }) => {
    await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).PushManager; Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }); });
    await startDemo(page);
    await page.goto("/settings/reminders");
    await expect(page.getByTestId("install-card")).toContainText("Install Sterling to get reminders");
    await expect(page.getByRole("switch", { name: "Evening reminder" })).toBeDisabled();
  });

  test("EC-P2 with notifications denied, the toggle says Off in iPhone Settings and Sterling does not ask again", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(Notification, "permission", { get: () => "denied" }); });
    await startDemo(page);
    await page.goto("/settings/reminders");
    await expect(page.getByTestId("reminder-sub")).toHaveText("Off in iPhone Settings");
    await expect(page.getByTestId("denied-card")).toContainText("Settings → Notifications → Sterling");
    await expect(page.getByRole("switch", { name: "Evening reminder" })).toBeDisabled();
  });

  test("EC-P4 and EC-P5 the reminder goes to every device, and a bill logged by itself does not count as logging", async ({ page, request }) => {
    rmSync(LOG, { force: true });
    await startDemo(page);
    await sql(`update profiles set reminder_enabled = true, reminder_time = '21:00', last_reminder_on = null`);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/' || d, 'k', 'a' from profiles, unnest(array['phone', 'ipad']) d`);
    await sql(`delete from transactions where occurred_on = '2026-10-18'`);
    await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, source)
               select u.id, gen_random_uuid(), 'expense', 999, (select id from accounts where name = 'Monzo'), (select id from categories where name = 'Streaming & apps'), '2026-10-18', 'recurring' from auth.users u limit 1`);
    const res = (await (await request.get("/api/cron/nudge?now=2026-10-18T20:00:00Z", { headers: AUTH })).json()).results[0] as { result: string; sent?: number };
    expect(res).toMatchObject({ result: "sent", sent: 2 });
    expect(pushes().map((p) => p.endpoint).sort()).toEqual(["https://push.test/ipad", "https://push.test/phone"]);
  });

  test("EC-P6 the capture endpoint: a token works, a revoked one is refused at once, and the 61st in an hour is limited", async ({ page, request }) => {
    await startDemo(page);
    await page.goto("/settings/shortcuts");
    await page.getByLabel("Token name").fill("Phone");
    await page.getByTestId("token-create").click();
    const token = (await page.getByTestId("token-value").textContent())!.trim();
    expect((await request.post("/api/v1/capture", { data: { amount: 4.5, payee: "Pret", category: "Coffee & snacks" } })).status()).toBe(401);
    const ok = await request.post("/api/v1/capture", { headers: { authorization: `Bearer ${token}` }, data: { amount: 4.5, payee: "Pret", category: "Coffee & snacks" } });
    expect(ok.status()).toBe(201);
    expect(await sqlOne(`select amount_pence::int p, source::text s from transactions where payee_id = (select id from payees where name = 'Pret')`)).toEqual({ p: 450, s: "shortcut" });
    expect((await sqlOne<{ n: number }>(`select count(*)::int n from api_tokens where token_hash = '${token}'`)).n).toBe(0);     // only the hash is stored
    await page.getByRole("button", { name: "Revoke Phone" }).click();
    await expect.poll(async () => (await request.post("/api/v1/capture", { headers: { authorization: `Bearer ${token}` }, data: { amount: 1 } })).status()).toBe(401);
    await sql(`update api_tokens set revoked_at = null, window_count = 60, window_started_at = now()`);
    expect((await request.post("/api/v1/capture", { headers: { authorization: `Bearer ${token}` }, data: { amount: 1 } })).status()).toBe(429);
  });
});

test.describe("sync", () => {
  test("EC-C3 an edit made after another device changed the same entry is not applied silently", async ({ page }) => {
    await startDemo(page);
    await page.goto("/activity");
    await page.getByTestId("txn-row").first().click();
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.waitForTimeout(600);                                                        // the editor has noted when the row last changed
    await sql(`update transactions set note = 'changed elsewhere' where id = (select id from transactions order by occurred_on desc, created_at desc limit 1)`);
    await page.getByLabel("Payee").fill("Edited here");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/Updated on another device/)).toBeVisible();
    expect((await sqlOne<{ n: number }>(`select count(*)::int n from transactions where note = 'changed elsewhere'`)).n).toBe(1);
  });

  test("EC-C11 queued entries are flushed by any successful network call, not only by launch or focus", async ({ page, context }) => {
    await page.addInitScript(() => { window.addEventListener("online", (e) => e.stopImmediatePropagation(), true); });
    await startDemo(page);
    await context.setOffline(true);
    await openAdd(page);
    await amountKeys(page, "8.37");
    await page.getByLabel("Payee").fill("Queued");
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /^Add £8\.37/ }).click();
    expect((await sql(`select 1 from transactions where amount_pence = 837`)).length).toBe(0);
    await context.setOffline(false);
    await page.getByRole("link", { name: "Analytics" }).first().click();                   // an ordinary read, which succeeds
    await expect.poll(async () => (await sql(`select 1 from transactions where amount_pence = 837`)).length, { timeout: 20_000 }).toBe(1);
  });
});

test.describe("bills and history", () => {
  test("EC-B8 a recurring transfer to savings is logged as a transfer and left out of the bill totals", async ({ page, request }) => {
    await startDemo(page);
    await sql(`delete from recurring_items`);
    await sql(`insert into recurring_items (user_id, type, amount_pence, account_id, counter_account_id, frequency, day_of_month, last_day, working_day_rule, starts_on, next_due_on, auto_log)
               select u.id, 'transfer', 25000, (select id from accounts where name = 'Monzo'), (select id from accounts where name = 'Marcus'), 'monthly', 27, false, 'on_day', '2026-10-27', '2026-10-27', true from auth.users u limit 1`);
    await request.get("/api/cron/recurring?now=2026-10-27T06:30:00Z", { headers: AUTH });
    expect(await sqlOne(`select type::text t, source::text s, amount_pence::int p from transactions where source = 'recurring' and amount_pence = 25000`)).toEqual({ t: "transfer", s: "recurring", p: 25000 });
    await page.goto("/bills");
    await expect(page.getByTestId("bills-total")).toHaveText("£0.00");
  });

  test("EC-N1 months before tracking began are labelled Partial and kept out of the usual", async ({ page }) => {
    await startDemo(page);
    await sql(`update accounts set opening_date = '2026-09-15'`);
    await page.goto("/analytics");
    await expect(page.getByTestId("chart-trend")).toContainText("Partial: before tracking");
  });
});
