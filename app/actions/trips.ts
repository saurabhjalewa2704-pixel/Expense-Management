"use server";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { formatDayMonth } from "@/lib/dates";
import { TripInput } from "@/lib/schemas/trip";
import { supabaseServer } from "@/lib/supabase/server";
import type { Trip } from "@/lib/types";

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/** The trip whose dates clash with these, for the message "overlaps USA" (EC-T1). */
async function clash(db: Db, start: string, end: string, ignore?: string | null): Promise<Trip | null> {
  let q = db.from("trips").select("*").lte("start_on", end).gte("end_on", start).limit(1);
  if (ignore) q = q.neq("id", ignore);
  const { data } = await q;
  return ((data ?? [])[0] as Trip | undefined) ?? null;
}
const clashMessage = (t: Trip) => `These dates overlap ${t.name} (${formatDayMonth(t.start_on)} – ${formatDayMonth(t.end_on)} ${t.end_on.slice(0, 4)}). Trips can't overlap.`;

/** TRIP-03: what changing the dates would do, so the form can ask before saving (EC-T2). */
export async function previewTripDates(id: string, start: string, end: string): Promise<ActionResult<{ outside: number; inRange: number; firstInRange: string | null; lastInRange: string | null }>> {
  const db = await supabaseServer();
  const { data: out, error } = await db.from("transactions").select("id").eq("trip_id", id).is("deleted_at", null).neq("trip_origin", "booking").or(`occurred_on.lt.${start},occurred_on.gt.${end}`);
  if (error) return fail(friendlyDbError(error));
  const { data: inside } = await db.from("transactions").select("occurred_on").eq("type", "expense").is("trip_id", null).is("deleted_at", null).is("pot_id", null).neq("source", "recurring")
    .gte("occurred_on", start).lte("occurred_on", end).order("occurred_on");
  const days = ((inside ?? []) as { occurred_on: string }[]).map((r) => r.occurred_on);
  return ok({ outside: (out ?? []).length, inRange: days.length, firstInRange: days[0] ?? null, lastInRange: days.at(-1) ?? null });
}

/** Create (id null) or edit a trip, with its stops and category budgets. */
export async function saveTrip(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = TripInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the trip.");
  const v = p.data;
  const db = await supabaseServer();
  const c = await clash(db, v.start_on, v.end_on, id);
  if (c) return fail(clashMessage(c));
  const sum = v.category_budgets.reduce((a, b) => a + b.amount_pence, 0);
  const row = {
    name: v.name, country_code: v.country_code ?? null, currency: v.currency, start_on: v.start_on, end_on: v.end_on,
    budget_pence: v.budget_pence ?? (sum > 0 ? sum : null), auto_tag: v.auto_tag,
  };
  let tripId = id;
  if (id) {
    const { error } = await db.from("trips").update(row).eq("id", id);
    if (error) return fail(error.code === "23P01" ? "These dates overlap another trip." : friendlyDbError(error));
    // tagged expenses that now fall outside the dates: keep (the default) or remove; bookings are always kept (EC-T2)
    if (v.outside === "remove") {
      await db.from("transactions").update({ trip_id: null }).eq("trip_id", id).neq("trip_origin", "booking").or(`occurred_on.lt.${v.start_on},occurred_on.gt.${v.end_on}`);
    }
    await db.from("trip_stops").delete().eq("trip_id", id);
    await db.from("trip_category_budgets").delete().eq("trip_id", id);
  } else {
    const { data, error } = await db.from("trips").insert(row).select("id").single();
    if (error) return fail(error.code === "23P01" ? "These dates overlap another trip." : friendlyDbError(error));
    tripId = (data as { id: string }).id;
  }
  if (v.stops.length) {
    const { error } = await db.from("trip_stops").insert(v.stops.map((s, i) => ({ trip_id: tripId, name: s.name, start_on: s.start_on, end_on: s.end_on, sort: i + 1, currency: s.currency ?? null })));
    if (error) return fail(friendlyDbError(error));
  }
  if (v.category_budgets.length) {
    const { error } = await db.from("trip_category_budgets").insert(v.category_budgets.map((b) => ({ trip_id: tripId, category_id: b.category_id, amount_pence: b.amount_pence })));
    if (error) return fail(friendlyDbError(error));
  }
  if (id && v.add_in_range) {
    await db.from("transactions").update({ trip_id: tripId, trip_origin: "auto" }).eq("type", "expense").is("trip_id", null).is("deleted_at", null).is("pot_id", null).neq("source", "recurring")
      .gte("occurred_on", v.start_on).lte("occurred_on", v.end_on);
  }
  return ok({ id: tripId! });
}

/** Deleting a trip keeps every expense; only the link goes (EC-T17). */
export async function deleteTrip(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("trips").delete().eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** TRIP-05: attach earlier bookings. Dates before the trip start are bookings; anything else is a manual tag. */
export async function attachToTrip(tripId: string, txnIds: string[]): Promise<ActionResult<{ attached: number }>> {
  if (txnIds.length === 0) return ok({ attached: 0 });
  const db = await supabaseServer();
  const { data: t } = await db.from("trips").select("start_on").eq("id", tripId).maybeSingle();
  if (!t) return fail("That trip no longer exists.");
  const start = (t as { start_on: string }).start_on;
  const { data: rows, error } = await db.from("transactions").select("id, occurred_on").in("id", txnIds).is("trip_id", null).is("deleted_at", null);
  if (error) return fail(friendlyDbError(error));
  const list = (rows ?? []) as { id: string; occurred_on: string }[];
  const early = list.filter((r) => r.occurred_on < start).map((r) => r.id), rest = list.filter((r) => r.occurred_on >= start).map((r) => r.id);
  if (early.length) { const e = await db.from("transactions").update({ trip_id: tripId, trip_origin: "booking" }).in("id", early); if (e.error) return fail(friendlyDbError(e.error)); }
  if (rest.length) { const e = await db.from("transactions").update({ trip_id: tripId, trip_origin: "manual" }).in("id", rest); if (e.error) return fail(friendlyDbError(e.error)); }
  return ok({ attached: list.length });
}

/** "Remove from trip" (not delete): only the link goes. */
export async function detachFromTrip(txnId: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("transactions").update({ trip_id: null }).eq("id", txnId);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
