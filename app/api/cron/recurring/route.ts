import { readFileSync } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { londonParts, type ISODate } from "@/lib/dates";
import { cronSecret } from "@/lib/env";
import { buildBillPushes, type LoggedBill } from "@/lib/bills-notify";
import { runDue, nameLookup, type RunItem } from "@/lib/recurring-run";
import { shouldAct } from "@/lib/recurring-engine";
import { sendPush } from "@/lib/push-send";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GOV_UK = "https://www.gov.uk/bank-holidays.json";


/** England & Wales bank holidays, cached in `bank_holidays` and refreshed on the 1st of each month (or when empty). A failed fetch keeps the cache. */
async function refreshHolidays(db: ReturnType<typeof supabaseService>, today: ISODate, force: boolean) {
  const { count } = await db.from("bank_holidays").select("day", { count: "exact", head: true });
  if (!force && (count ?? 0) > 0 && today.slice(8) !== "01") return "cached";
  try {
    const file = process.env.STERLING_HOLIDAYS_FILE;                       // tests only: no network
    const json = file ? JSON.parse(readFileSync(file, "utf8")) : await (await fetch(GOV_UK, { cache: "no-store" })).json();
    const events = (json["england-and-wales"]?.events ?? []) as { date: string; title: string }[];
    if (!events.length) return "empty";
    await db.from("bank_holidays").upsert(events.map((e) => ({ day: e.date, title: e.title })), { onConflict: "day" });
    return "refreshed";
  } catch (e) {
    console.error("[recurring] bank holiday refresh failed, using the cache", e);
    return "failed";
  }
}

/**
 * REC-04. Call hourly (pg_cron + pg_net) or daily (Vercel): it acts from 06:00 London time, creates every occurrence due
 * on or before today that does not exist yet (catch-up), and is safe to run again. Then it sends the notifications for what it just created.
 * In test mode (STERLING_TEST_TODAY set) `?now=<ISO instant>` replaces the clock.
 */
export async function GET(req: NextRequest) {
  // say what is missing instead of crashing: Vercel only sends the bearer header when CRON_SECRET exists in the project's environment
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set in this deployment's environment variables." }, { status: 500 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in this deployment's environment variables." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const override = process.env.STERLING_TEST_TODAY ? req.nextUrl.searchParams.get("now") : null;
  const now = londonParts(override ? new Date(override) : Date.now());
  const today = now.date as ISODate;
  if (!shouldAct(now.hour)) return NextResponse.json({ london: now, acted: false, reason: "before 06:00 London" });

  const db = supabaseService();
  const holidays = await refreshHolidays(db, today, req.nextUrl.searchParams.get("holidays") === "1");
  const { data: hol } = await db.from("bank_holidays").select("day");
  const holidaySet = new Set((hol ?? []).map((h: { day: string }) => h.day));

  const { data: items, error } = await db.from("recurring_items").select("*").is("ended_at", null).is("paused_at", null).lte("next_due_on", today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = (items ?? []) as RunItem[];
  const run = await runDue(db, "recurring_log", due, today, holidaySet, await nameLookup(db, due));
  const results = run.logged.map((l) => ({ item: l.bill.itemId, due_on: l.bill.due_on, status: l.bill.status }));
  const finished = run.finished;
  const byUser = new Map<string, LoggedBill[]>();
  for (const l of run.logged) byUser.set(l.user, [...(byUser.get(l.user) ?? []), l.bill]);
  // note that the scheduled job is alive, so the app can tell the owner (Bills shows "last ran …")
  await db.from("profiles").update({ bills_cron_at: new Date().toISOString() }).not("id", "is", null);

  let sent = 0;
  for (const [user, rows] of byUser) {
    const { data: prof } = await db.from("profiles").select("bills_notify").eq("id", user).single();
    if (prof && prof.bills_notify === false) continue;
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user);
    if (!subs?.length) continue;
    for (const push of buildBillPushes(rows, today)) {
      for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
        const r = await sendPush(s, push);
        if (r.ok) sent++;
        else if (r.gone) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("[recurring] push failed", r.status);
      }
    }
  }
  return NextResponse.json({ london: now, acted: true, holidays, logged: results, finished, sent, errors: run.errors });
}
