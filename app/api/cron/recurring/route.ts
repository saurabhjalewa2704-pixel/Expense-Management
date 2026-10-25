import { readFileSync } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { londonParts, type ISODate } from "@/lib/dates";
import { cronSecret } from "@/lib/env";
import { buildBillPushes, type LoggedBill } from "@/lib/bills-notify";
import { planDue, shouldAct, type EngineItem } from "@/lib/recurring-engine";
import { sendPush } from "@/lib/push-send";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GOV_UK = "https://www.gov.uk/bank-holidays.json";

interface ItemRow extends EngineItem {
  user_id: string; type: "expense" | "income" | "transfer"; payee_id: string | null; account_id: string; counter_account_id: string | null; amount_varies: boolean; auto_log: boolean;
}

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

  const byUser = new Map<string, LoggedBill[]>();
  const names = await nameLookup(db, (items ?? []) as ItemRow[]);
  const results: { item: string; due_on: string; status: string }[] = [];
  let finished = 0;

  for (const it of (items ?? []) as ItemRow[]) {
    const { planned, finished: done } = planDue(it, today, holidaySet);
    if (done) { await db.from("recurring_items").update({ ended_at: new Date().toISOString() }).eq("id", it.id); finished++; continue; }
    for (const p of planned) {
      const { data, error: e } = await db.rpc("recurring_log", { p_item: it.id, p_scheduled: p.scheduled_on, p_due: p.due_on, p_next: p.next });
      if (e) { console.error("[recurring] log failed", it.id, e.message); break; }
      const row = (data as { occurrence_id: string; transaction_id: string | null; status: LoggedBill["status"]; amount_pence: number }[] | null)?.[0];
      if (!row) continue;                                              // already there: nothing new to say
      results.push({ item: it.id, due_on: p.due_on, status: row.status });
      const list = byUser.get(it.user_id) ?? [];
      list.push({
        occurrenceId: row.occurrence_id, itemId: it.id, transactionId: row.transaction_id, name: names.get(it.id) ?? "Payment", type: it.type,
        amount: Number(row.amount_pence), due_on: p.due_on, status: row.status, blocked: row.status === "pending" && it.auto_log,   // meant to log itself, could not
      });
      byUser.set(it.user_id, list);
    }
  }

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
  return NextResponse.json({ london: now, acted: true, holidays, logged: results, finished, sent });
}

/** A readable name for each rule: the payee, or "To <account>" for a transfer. */
async function nameLookup(db: ReturnType<typeof supabaseService>, items: ItemRow[]) {
  const names = new Map<string, string>();
  if (!items.length) return names;
  const [{ data: payees }, { data: accts }] = await Promise.all([
    db.from("payees").select("id, name").in("id", items.map((i) => i.payee_id).filter(Boolean) as string[]),
    db.from("accounts").select("id, name").in("id", items.map((i) => i.counter_account_id).filter(Boolean) as string[]),
  ]);
  const p = new Map((payees ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  const a = new Map((accts ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  for (const i of items) names.set(i.id, i.type === "transfer" ? `To ${a.get(i.counter_account_id ?? "") ?? "savings"}` : p.get(i.payee_id ?? "") ?? "Payment");
  return names;
}
