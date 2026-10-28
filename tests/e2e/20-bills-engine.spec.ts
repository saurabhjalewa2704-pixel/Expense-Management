import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// REC-04 / REC-05 against the real route, with a fake clock (?now=) and the push service stubbed to a file.
const LOG = resolve(".stack/push.log");
const pushes = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { title: string; body: string; actions?: { action: string }[]; data?: { occurrence?: string } }) : []);
const AUTH = { authorization: "Bearer local-cron-secret" };

/** A bill for the demo owner, dated exactly as given. */
async function bill(o: { name: string; amount?: number; day?: number; last?: boolean; starts: string; next?: string; varies?: boolean; auto?: boolean; rule?: string; freq?: string; cat?: string; account?: string }) {
  await sql(`insert into payees (user_id, name) select id, $1 from auth.users where not exists (select 1 from payees where name = $1) limit 1`, [o.name]);
  await sql(`insert into recurring_items (user_id, type, amount_pence, amount_varies, account_id, category_id, payee_id, frequency, day_of_month, last_day, working_day_rule, starts_on, next_due_on, auto_log)
    values ((select id from auth.users limit 1), 'expense', $1, $2, (select id from accounts where name = $3), (select id from categories where name = $4), (select id from payees where name = $5), $6, $7, $8, $9, $10, $11, $12)`,
    [o.amount ?? 1299, o.varies ?? false, o.account ?? "Amex Gold", o.cat ?? "Streaming & apps", o.name, o.freq ?? "monthly", o.last ? null : o.day ?? 27, o.last ?? false, o.rule ?? "on_day", o.starts, o.next ?? o.starts, o.auto ?? true]);
}
const run = async (request: import("@playwright/test").APIRequestContext, now: string, q = "") =>
  (await request.get(`/api/cron/recurring?now=${now}${q}`, { headers: AUTH })).json() as Promise<{ acted: boolean; logged: { due_on: string; status: string }[]; sent: number; finished: number }>;
const recurringTxns = (name: string) => sql<{ occurred_on: string; amount_pence: string; is_estimate: boolean }>(
  `select to_char(t.occurred_on, 'YYYY-MM-DD') occurred_on, t.amount_pence, t.is_estimate from transactions t join payees p on p.id = t.payee_id where p.name = $1 and t.source = 'recurring' and t.deleted_at is null order by 1`, [name]);

test.describe("bills engine (REC-04, REC-05)", () => {
  test.beforeEach(async ({ page }) => {
    rmSync(LOG, { force: true });
    await startDemo(page);
    await sql(`delete from recurring_items; update transactions set source = 'app' where source = 'recurring'`);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/device-1', 'p', 'a' from auth.users limit 1`);
  });

  test("EC-B1 Netflix on the 27th: one transaction at 06:00 London, nothing before it, nothing on a re-run", async ({ request }) => {
    await bill({ name: "Netflix", starts: "2026-10-27" });
    expect((await run(request, "2026-10-27T05:30:00Z")).acted).toBe(false);          // 05:30 GMT (clocks went back on 25 Oct)
    expect(await recurringTxns("Netflix")).toEqual([]);
    const r = await run(request, "2026-10-27T06:00:00Z");                            // 06:00 London
    expect(r.acted && r.logged).toEqual([expect.objectContaining({ due_on: "2026-10-27", status: "logged" })]);
    expect(await recurringTxns("Netflix")).toEqual([expect.objectContaining({ occurred_on: "2026-10-27", amount_pence: "1299" })]);
    expect((await run(request, "2026-10-27T06:30:00Z")).logged).toEqual([]);          // hourly re-run
    expect((await run(request, "2026-10-27T18:00:00Z")).logged).toEqual([]);
    expect(await recurringTxns("Netflix")).toHaveLength(1);
    expect(await sqlOne(`select next_due_on::text d from recurring_items`)).toEqual({ d: "2026-11-27" });
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]!.title).toBe("1 bill logged today · £12.99");
  });

  test("EC-D3 the 31st logs on 30 Nov, 31 Dec and 28 Feb", async ({ request }) => {
    await bill({ name: "Gym", day: 31, starts: "2026-10-31", amount: 3000 });
    for (const now of ["2026-10-31T07:00:00Z", "2026-11-30T07:00:00Z", "2026-12-31T07:00:00Z", "2027-01-31T07:00:00Z", "2027-02-28T07:00:00Z"]) await run(request, now);
    expect((await recurringTxns("Gym")).map((t) => t.occurred_on)).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  test("EC-B2 'next working day': Sunday 1 Nov logs on Monday 2 Nov; 25 Dec 2026 on Tuesday 29 Dec", async ({ request }) => {
    await bill({ name: "Landlord", day: 1, starts: "2026-11-01", next: "2026-11-02", rule: "next_working_day", amount: 100000 });
    await bill({ name: "Present", day: 25, starts: "2026-12-25", next: "2026-12-29", rule: "next_working_day", amount: 5000 });
    await run(request, "2026-11-01T07:00:00Z", "&holidays=1");
    expect(await recurringTxns("Landlord")).toEqual([]);                             // not on the Sunday
    await run(request, "2026-11-02T07:00:00Z");
    expect((await recurringTxns("Landlord")).map((t) => t.occurred_on)).toEqual(["2026-11-02"]);
    await run(request, "2026-12-25T07:00:00Z");
    await run(request, "2026-12-28T07:00:00Z");
    expect(await recurringTxns("Present")).toEqual([]);
    await run(request, "2026-12-29T07:00:00Z");
    expect((await recurringTxns("Present")).map((t) => t.occurred_on)).toEqual(["2026-12-29"]);
  });

  test("EC-B1 after a three-day outage the next run logs every missed bill with its own date and sends one summary", async ({ request }) => {
    await bill({ name: "Bill A", day: 2, starts: "2026-11-02", amount: 1000 });
    await bill({ name: "Bill B", day: 3, starts: "2026-11-03", amount: 2000 });
    await bill({ name: "Bill C", day: 4, starts: "2026-11-04", amount: 3000 });
    const r = await run(request, "2026-11-04T07:00:00Z");
    expect(r.logged.map((l) => l.due_on).sort()).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect([(await recurringTxns("Bill A"))[0]!.occurred_on, (await recurringTxns("Bill B"))[0]!.occurred_on, (await recurringTxns("Bill C"))[0]!.occurred_on]).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]!.title).toBe("3 bills logged · £60.00");
  });

  test("EC-B3 a varying bill is an estimate; 'Looks right' confirms it and the next one uses the confirmed amount", async ({ request, page }) => {
    await bill({ name: "Octopus Energy", day: 5, starts: "2026-11-05", amount: 4000, varies: true, cat: "Energy", account: "Monzo" });
    await run(request, "2026-11-05T07:00:00Z");
    expect(await recurringTxns("Octopus Energy")).toEqual([expect.objectContaining({ amount_pence: "4000", is_estimate: true })]);
    const est = pushes().find((p) => p.title.includes("(estimate)"))!;
    expect(est.title).toBe("Octopus Energy logged: £40.00 (estimate)");
    expect(est.actions?.map((a) => a.action)).toEqual(["confirm", "change"]);
    const res = await page.request.post("/api/recurring/action", { data: { occurrence: est.data!.occurrence, action: "confirm", amount_pence: 4840 } });
    expect(res.ok()).toBeTruthy();
    expect(await recurringTxns("Octopus Energy")).toEqual([expect.objectContaining({ amount_pence: "4840", is_estimate: false })]);
    await run(request, "2026-12-05T07:00:00Z");
    expect((await recurringTxns("Octopus Energy")).map((t) => [t.amount_pence, t.is_estimate])).toEqual([["4840", false], ["4840", true]]);
  });

  test("remind mode makes an occurrence and a notification, but no transaction, until you log it", async ({ request, page }) => {
    await bill({ name: "Magazine", day: 10, starts: "2026-11-10", amount: 800, auto: false });
    await run(request, "2026-11-10T07:00:00Z");
    expect(await recurringTxns("Magazine")).toEqual([]);
    const p = pushes().find((x) => x.title.includes("Magazine"))!;
    expect(p.title).toBe("Magazine £8.00 is due today");
    expect(p.actions?.map((a) => a.action)).toEqual(["log", "skip"]);
    expect((await page.request.post("/api/recurring/action", { data: { occurrence: p.data!.occurrence, action: "log" } })).ok()).toBeTruthy();
    expect((await recurringTxns("Magazine")).map((t) => t.occurred_on)).toEqual(["2026-11-10"]);
  });

  test("EC-B4 a paused rule makes nothing, and resuming does not backfill; the Bills switch silences notifications", async ({ request }) => {
    await bill({ name: "Paused", day: 15, starts: "2026-10-15", next: "2026-10-15", amount: 500 });
    await sql(`update recurring_items set paused_at = now() where true`);
    await run(request, "2026-11-20T07:00:00Z");
    expect(await recurringTxns("Paused")).toEqual([]);
    await sql(`update recurring_items set paused_at = null, next_due_on = '2026-12-15'`);          // what Resume does
    await run(request, "2026-12-15T07:00:00Z");
    expect((await recurringTxns("Paused")).map((t) => t.occurred_on)).toEqual(["2026-12-15"]);      // nothing for November
    rmSync(LOG, { force: true });
    await bill({ name: "Quiet", day: 16, starts: "2026-12-16", amount: 500 });
    await sql(`update profiles set bills_notify = false`);
    await run(request, "2026-12-16T07:00:00Z");
    expect(await recurringTxns("Quiet")).toHaveLength(1);
    expect(pushes()).toEqual([]);
  });

  test("EC-A8 an archived account turns the occurrence into a reminder instead of failing", async ({ request }) => {
    await sql(`insert into accounts (user_id, name, type, opening_balance_pence, opening_date) select id, 'Old card', 'credit_card', 0, '2026-01-01' from auth.users limit 1`);
    await bill({ name: "OldSub", day: 12, starts: "2026-11-12", amount: 700, account: "Old card" });
    await sql(`update accounts set archived_at = now() where name = 'Old card'`);
    await run(request, "2026-11-12T07:00:00Z");
    expect(await recurringTxns("OldSub")).toEqual([]);
    expect(await sqlOne(`select status::text s from recurring_occurrences`)).toEqual({ s: "pending" });
    expect(pushes().some((p) => p.body === "Account no longer active, choose another.")).toBe(true);
  });

  test("a rule that has run out ends itself", async ({ request }) => {
    await bill({ name: "Short", day: 3, starts: "2026-11-03", amount: 500 });
    await sql(`update recurring_items set max_occurrences = 1`);
    const r = await run(request, "2026-11-03T07:00:00Z");
    expect(r.logged).toHaveLength(1);
    expect(await sqlOne(`select ended_at is not null e from recurring_items`)).toEqual({ e: true });
    expect((await run(request, "2026-12-03T07:00:00Z")).logged).toEqual([]);
  });

  test("the cron refuses requests without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/recurring")).status()).toBe(401);
  });
});
