"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { serverToday } from "@/lib/ai/server";
import { asRule } from "@/lib/bills";
import { addDays, type ISODate } from "@/lib/dates";
import { nextOccurrences, type Occurrence } from "@/lib/recurrence";
import { RecurringInput } from "@/lib/schemas/recurring";
import { londonParts } from "@/lib/dates";
import { shouldAct } from "@/lib/recurring-engine";
import { nameLookup, runDue, type RunItem } from "@/lib/recurring-run";
import { supabaseServer } from "@/lib/supabase/server";
import type { RecurringItem } from "@/lib/types";

type Db = Awaited<ReturnType<typeof supabaseServer>>;

async function holidays(db: Db): Promise<Set<ISODate>> {
  const { data } = await db.from("bank_holidays").select("day");
  return new Set(((data ?? []) as { day: ISODate }[]).map((h) => h.day));
}
async function recordedScheduled(db: Db, itemId: string): Promise<Set<ISODate>> {
  const { data } = await db.from("recurring_occurrences").select("scheduled_on").eq("item_id", itemId);
  return new Set(((data ?? []) as { scheduled_on: ISODate }[]).map((o) => o.scheduled_on));
}
/** The next payment from `from` that has no record yet (nothing already logged or skipped is offered again). */
const upcoming = (item: RecurringItem, from: ISODate, hol: Set<ISODate>, recorded: Set<ISODate>): Occurrence[] =>
  nextOccurrences(asRule(item), from, addDays(from, 800), hol).filter((o) => !recorded.has(o.scheduled_on));

async function payeeId(db: Db, name: string | null | undefined): Promise<string | null> {
  const n = name?.trim().replace(/\s+/g, " ");
  if (!n) return null;
  const norm = n.toLowerCase();
  const { data: found } = await db.from("payees").select("id").eq("name_norm", norm).maybeSingle();
  if (found) return (found as { id: string }).id;
  const { data, error } = await db.from("payees").insert({ name: n }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** REC-03: create (id null) or edit a recurring payment. An edit only changes what happens from today on. */
export async function saveRecurring(id: string | null, input: unknown): Promise<ActionResult<{ id: string; logged: boolean }>> {
  const p = RecurringInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the details.");
  const v = p.data;
  const db = await supabaseServer();
  const today = serverToday();
  try {
    if (!id && v.starts_on < today && v.catch_up !== "log") return fail("The first payment must be today or later.");
    const row = {
      type: v.type, amount_pence: v.amount_pence, amount_varies: v.amount_varies, account_id: v.account_id,
      counter_account_id: v.type === "transfer" ? v.counter_account_id ?? null : null,
      category_id: v.type === "transfer" ? null : v.category_id ?? null,
      payee_id: v.type === "transfer" ? null : await payeeId(db, v.payee), note: v.note || null,
      frequency: v.frequency, day_of_month: v.frequency === "weekly" || v.last_day ? null : v.day_of_month ?? null, last_day: v.frequency === "weekly" ? false : v.last_day,
      weekday: v.frequency === "weekly" ? v.weekday ?? null : null, month_of_year: v.frequency === "yearly" ? v.month_of_year ?? null : null,
      working_day_rule: v.working_day_rule, starts_on: v.starts_on, ends_on: v.ends_on ?? null, max_occurrences: v.max_occurrences ?? null, auto_log: v.auto_log,
    };
    const hol = await holidays(db);
    const draft = { ...row, id: id ?? "new" } as unknown as RecurringItem;

    if (id) {
      const recorded = await recordedScheduled(db, id);
      const next = upcoming(draft, row.starts_on > today ? row.starts_on : today, hol, recorded)[0];
      if (!next) return fail("With those dates there is nothing left to pay. Check the end date.");
      const { error } = await db.from("recurring_items").update({ ...row, next_due_on: next.due_on }).eq("id", id);
      return error ? fail(friendlyDbError(error)) : ok({ id, logged: false });
    }

    // a new rule: the first payment, or (catch-up) this month's one that is already past
    const all = nextOccurrences(asRule(draft), row.starts_on, addDays(row.starts_on, 800), hol);
    const first = all[0];
    if (!first) return fail("With those dates there is nothing to pay. Check the end date.");
    const logNow = v.catch_up === "log" && first.due_on <= today;
    const { data, error } = await db.from("recurring_items").insert({ ...row, next_due_on: first.due_on }).select("id").single();
    if (error) return fail(friendlyDbError(error));
    const newId = (data as { id: string }).id;
    if (logNow) {
      const { error: e2 } = await db.rpc("recurring_log_now", { p_item: newId, p_scheduled: first.scheduled_on, p_due: first.due_on, p_next: all[1]?.due_on ?? null });
      if (e2) return fail(friendlyDbError(e2));
    }
    return ok({ id: newId, logged: logNow });
  } catch (e) {
    return fail(friendlyDbError(e as { message?: string; code?: string }));
  }
}

async function load(db: Db, id: string) {
  const { data } = await db.from("recurring_items").select("*").eq("id", id).maybeSingle();
  return (data as RecurringItem | null) ?? null;
}

export async function pauseRecurring(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("recurring_items").update({ paused_at: new Date().toISOString() }).eq("id", id).is("ended_at", null);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Resume from today: nothing is backfilled for the time it was paused. */
export async function resumeRecurring(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const item = await load(db, id);
  if (!item) return fail("That payment no longer exists.");
  const next = upcoming(item, serverToday(), await holidays(db), await recordedScheduled(db, id))[0];
  if (!next) return fail("It has no payments left. Edit it to extend the end date.");
  const { error } = await db.from("recurring_items").update({ paused_at: null, next_due_on: next.due_on }).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Stop: every logged transaction stays, nothing new is made. */
export async function stopRecurring(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("recurring_items").update({ ended_at: new Date().toISOString() }).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Only an ended rule can be removed completely; its transactions stay (they just stop being linked). */
export async function deleteRecurring(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const item = await load(db, id);
  if (!item?.ended_at) return fail("Stop it first, then you can delete it.");
  const { error } = await db.from("recurring_items").delete().eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Skip the next payment (REC-06). It can be undone until the due date. */
export async function skipNext(id: string): Promise<ActionResult<{ occurrence: string | null }>> {
  const db = await supabaseServer();
  const item = await load(db, id);
  if (!item || item.ended_at) return fail("That payment is not active.");
  const [a, b] = upcoming(item, item.next_due_on, await holidays(db), await recordedScheduled(db, id));
  if (!a) return fail("There is no next payment to skip.");
  const { data, error } = await db.rpc("recurring_skip", { p_item: id, p_scheduled: a.scheduled_on, p_due: a.due_on, p_next: b?.due_on ?? null });
  return error ? fail(friendlyDbError(error)) : ok({ occurrence: (data as { id: string } | null)?.id ?? null });
}

export async function unskip(occurrence: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.rpc("recurring_unskip", { p_occurrence: occurrence });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

const Resolve = z.object({ occurrence: z.string().uuid(), action: z.enum(["confirm", "log", "skip"]), amount_pence: z.number().int().positive().optional() });
/** "Looks right", "Log it" and "Skip" from the Bills screen (the notification buttons use the API route). */
export async function resolveOccurrence(input: unknown): Promise<ActionResult> {
  const p = Resolve.safeParse(input);
  if (!p.success) return fail("Check the amount.");
  const db = await supabaseServer();
  const { error } = await db.rpc("recurring_resolve", { p_occurrence: p.data.occurrence, p_action: p.data.action, p_amount: p.data.amount_pence ?? null });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** A suggestion turned down never comes back for that payee (REC-07). */
export async function dismissSuggestion(payee: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("recurring_dismissed").upsert({ payee_id: payee }, { onConflict: "user_id,payee_id", ignoreDuplicates: true });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/**
 * Catch up on whatever is due, from the app itself. The scheduled job is the main way bills log (and the only one that can send a
 * notification), but it needs set-up on the host. This runs the same loop as the signed-in owner whenever the app is opened, so a bill
 * dated 27 Oct appears with its own date the next time the app is used, whether or not the scheduled job ever ran.
 * Like the job, it waits for 06:00 London time (the test clock skips that).
 */
export async function catchUpBills(): Promise<ActionResult<{ logged: number; names: string[] }>> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.", true);
  if (!process.env.STERLING_TEST_TODAY && !shouldAct(londonParts(Date.now()).hour)) return ok({ logged: 0, names: [] });
  const today = serverToday();
  const { data: items, error } = await db.from("recurring_items").select("*").is("ended_at", null).is("paused_at", null).lte("next_due_on", today);
  if (error) return fail(friendlyDbError(error));
  const due = (items ?? []) as RunItem[];
  let logged: { bill: { name: string } }[] = [];
  if (due.length) {
    const run = await runDue(db, "recurring_log_now", due, today, await holidays(db), await nameLookup(db, due));
    logged = run.logged;
    if (run.errors.length) console.error("[bills] catch-up", run.errors);
  }
  await db.from("profiles").update({ bills_checked_at: new Date().toISOString() }).eq("id", u.user.id);
  return ok({ logged: logged.length, names: logged.map((l) => l.bill.name) });
}

/** What the Bills screen needs to tell the owner whether the scheduled job is set up (booleans only, never the secrets). */
export async function schedulerStatus(): Promise<ActionResult<{ cronSecret: boolean; serviceKey: boolean; cronAt: string | null; cronAlive: boolean; checkedAt: string | null }>> {
  const db = await supabaseServer();
  const { data, error } = await db.from("profiles").select("bills_cron_at, bills_checked_at").single();
  if (error) return fail(friendlyDbError(error));
  const p = data as { bills_cron_at: string | null; bills_checked_at: string | null };
  const alive = !!p.bills_cron_at && Date.now() - new Date(p.bills_cron_at).getTime() < 36 * 3600_000;    // a daily job that missed a day is not yet "broken"
  return ok({ cronSecret: !!process.env.CRON_SECRET, serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY, cronAt: p.bills_cron_at, cronAlive: alive, checkedAt: p.bills_checked_at });
}
