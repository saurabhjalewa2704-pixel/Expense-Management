// Trip insights (PRD §6.12 TRIP-08): the same compute-then-narrate pipeline, with a `trip` scope. Everything a card may say is a fact
// built here from the trip's own SQL figures; the model (or the template fallback) only words them.
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffDays, formatLong, type ISODate } from "@/lib/dates";
import { convertToPence, formatMinor } from "@/lib/fx";
import { formatGBP, type Pence } from "@/lib/money";
import { fetchAccounts, fetchTripByCategory, fetchTripByDay, fetchTripByStop, fetchTripStops, fetchTripSummary, fetchTripTxns, fetchTrips, fetchTripsOverview } from "@/lib/queries/fetchers";
import { roundDiv, tripClock, tripFigures, type TripFigures } from "@/lib/tripMath";
import type { Trip, TripCategoryRow, TripDay, TripOverviewRow, TripStop, TripStopTotal, TripSummary, TxnRow } from "@/lib/types";
import { slug } from "./facts";
import type { Entity, Fact, Facts } from "./types";

export interface TripFactsInput {
  today: ISODate;
  trip: Trip;
  stops: TripStop[];
  summary: TripSummary;
  byDay: TripDay[];
  byStop: TripStopTotal[];
  /** Parent-level categories for the whole trip. */
  byCat: TripCategoryRow[];
  txns: TxnRow[];
  /** The owner's other finished trips. */
  past: TripOverviewRow[];
  /** Card fee per account, in basis points. */
  fees: Record<string, number>;
}

const money = (p: Pence) => formatGBP(p);
const whole = (p: Pence) => formatGBP(p, { whole: true });
const weekday = (d: ISODate) => formatLong(d).split(" ")[0]!;

export function assembleTripFacts(i: TripFactsInput): Facts {
  const { trip, today } = i;
  const facts: Fact[] = [], entities: Entity[] = [];
  const add = (f: Fact) => facts.push(f);
  const c = tripClock(trip, today);
  const figs: TripFigures = tripFigures(trip, trip.budget_pence, i.summary.booked_pence, i.summary.on_trip_pence, today);

  add({ key: "trip_name", label: "The trip", display: trip.name });
  add({ key: "trip_phase", label: "Where the trip is now", display: c.phase });
  add({ key: "day_n", label: "Day of the trip", value: c.day, display: String(c.day) });
  add({ key: "days_total", label: "Length of the trip in days", value: c.length, display: String(c.length) });
  if (c.phase === "during") add({ key: "days_left", label: "Days left including today", value: c.daysLeftInclToday, display: String(c.daysLeftInclToday) });
  add({ key: "spent", label: "Spent on the trip in total (booked before plus on the trip)", value_pence: figs.spent, display: money(figs.spent) });
  add({ key: "booked", label: "Booked before the trip", value_pence: figs.booked, display: money(figs.booked) });
  add({ key: "on_trip", label: "Spent during the trip", value_pence: figs.onTrip, display: money(figs.onTrip) });
  if (figs.actualPerDay > 0) add({ key: "actual_per_day", label: "Spent a day during the trip so far", value_pence: figs.actualPerDay, display: money(figs.actualPerDay) });

  if (figs.budget !== null) {
    add({ key: "budget", label: "Trip budget", value_pence: figs.budget, display: money(figs.budget) });
    const left = Math.abs(figs.left ?? 0);
    add({ key: "left", label: figs.over ? "Over the trip budget by" : "Left of the trip budget", value_pence: left, display: money(left) });
    add({ key: "left_dir", label: "Whether the trip is under or over budget", display: figs.over ? "over" : "under" });
    if (figs.planPerDay !== null && figs.planPerDay > 0) add({ key: "plan_per_day", label: "Planned a day: (budget − booked before) ÷ trip days", value_pence: figs.planPerDay, display: money(figs.planPerDay) });
    if (figs.allowance !== null && figs.allowance > 0) add({ key: "allowance", label: "Can spend a day for the rest of the trip and stay on budget", value_pence: figs.allowance, display: money(figs.allowance) });
    if (c.phase === "during") {
      const gap = Math.abs(figs.budget - figs.projected);
      add({ key: "projected", label: "About what the whole trip will reach at this pace", value_pence: figs.projected, display: whole(figs.projected) });
      add({ key: "projected_gap", label: "How far the projection is from the budget", value_pence: gap, display: whole(gap) });
      add({ key: "projected_dir", label: "Whether the projection finishes under or over budget", display: figs.projected > figs.budget ? "over" : "under" });
    }
  }

  // ---- where it went (parent categories, the whole trip) ----
  const total = i.byCat.reduce((a, r) => a + r.total_pence, 0);
  const mix = [...i.byCat].filter((r) => r.total_pence > 0).sort((a, b) => b.total_pence - a.total_pence).slice(0, 3);
  for (const r of mix) {
    const s = slug(r.name);
    entities.push({ id: r.category_id, kind: "category", name: r.name });
    add({ key: `mix:${s}:name`, label: "Category", display: r.name });
    add({ key: `mix:${s}:total`, label: `${r.name} on the trip`, value_pence: r.total_pence, display: money(r.total_pence) });
    add({ key: `mix:${s}:pct`, label: `${r.name} as a share of the trip`, value: Math.round((r.total_pence * 100) / total), display: `${Math.round((r.total_pence * 100) / total)}%` });
    add({ key: `mix:${s}:count`, label: `${r.name} expenses`, value: r.txn_count, display: String(r.txn_count) });
    if (r.budget_pence && r.total_pence > r.budget_pence) add({ key: `mix:${s}:over_budget`, label: `${r.name} is over its trip budget of`, value_pence: r.budget_pence, display: money(r.budget_pence) });
  }

  // ---- stops: per day, the dearest against the cheapest ----
  const stops = i.byStop.filter((s) => s.stop_id && s.days_elapsed > 0 && s.total_pence > 0).map((s) => ({ ...s, perDay: roundDiv(s.total_pence, s.days_elapsed) }));
  for (const s of stops) {
    const k = slug(s.name);
    add({ key: `stop:${k}:name`, label: "Stop", display: s.name });
    add({ key: `stop:${k}:total`, label: `${s.name} on the trip`, value_pence: s.total_pence, display: money(s.total_pence) });
    add({ key: `stop:${k}:perday`, label: `${s.name} a day`, value_pence: s.perDay, display: money(s.perDay) });
  }
  if (stops.length >= 2) {
    const sorted = [...stops].sort((a, b) => b.perDay - a.perDay);
    const hi = sorted[0]!, lo = sorted.at(-1)!;
    const pct = lo.perDay > 0 ? Math.round(((hi.perDay - lo.perDay) * 100) / lo.perDay) : 0;
    if (pct >= 20) {
      add({ key: "stop_hi", label: "The dearest stop a day", display: hi.name });
      add({ key: "stop_lo", label: "The cheapest stop a day", display: lo.name });
      add({ key: "stop_cmp_pct", label: `${hi.name} costs this much more a day than ${lo.name}`, value: pct, display: `${pct}%` });
      // "With no hotel to pay for…": a computed fact, because the stop's own expenses contain no lodging
      const lodging = (name: string) => i.txns.some((t) => t.type === "expense" && t.occurred_on >= trip.start_on && (t.parent_category_name === "Travel" && /hotel|stay|lodg/i.test(t.category_name ?? "")) && i.stops.find((x) => x.name === name && x.start_on <= t.occurred_on && t.occurred_on <= x.end_on));
      add({ key: "stop_lo_nohotel", label: `Whether ${lo.name} had a hotel paid during its days`, display: lodging(lo.name) ? "had a hotel" : "no hotel" });
    }
  }

  // ---- the biggest day and expense ----
  const days = i.byDay.filter((d) => d.day <= today && d.total_pence > 0).sort((a, b) => b.total_pence - a.total_pence);
  if (days[0]) {
    add({ key: "bigday_name", label: "The biggest day of the trip", display: weekday(days[0].day) });
    add({ key: "bigday_total", label: "Spent on the biggest day", value_pence: days[0].total_pence, display: money(days[0].total_pence) });
    if (days[0].top_payee) add({ key: "bigday_payee", label: "The largest expense that day", display: days[0].top_payee });
  }
  const big = [...i.txns].filter((t) => t.type === "expense" && t.occurred_on >= trip.start_on).sort((a, b) => b.amount_pence - a.amount_pence)[0];
  if (big) {
    add({ key: "big_payee", label: "The biggest single expense on the trip", display: big.payee_name ?? big.category_name ?? "an expense" });
    add({ key: "big_total", label: "That expense in pounds", value_pence: big.amount_pence, display: money(big.amount_pence) });
    add({ key: "big_day", label: "The day of that expense", display: weekday(big.occurred_on) });
    if (big.original_amount_minor && big.original_currency) add({ key: "big_orig", label: "That expense as paid", display: formatMinor(big.original_amount_minor, big.original_currency) });
  }

  // ---- against the owner's other trips, by spending a day on the trip ----
  const perDayNow = c.phase === "before" ? 0 : roundDiv(i.summary.on_trip_pence, Math.max(1, c.phase === "after" ? c.length : c.day));
  const past = i.past.filter((p) => p.trip_id !== trip.id && p.on_trip_pence > 0).map((p) => ({ ...p, perDay: roundDiv(p.on_trip_pence, diffDays(p.end_on, p.start_on) + 1) }))
    .sort((a, b) => b.end_on.localeCompare(a.end_on));
  if (perDayNow > 0 && past.length > 0) {
    add({ key: "cmp_perday", label: "This trip's spending a day", value_pence: perDayNow, display: money(perDayNow) });
    const dearer = past.find((p) => p.perDay >= perDayNow);
    if (dearer) {
      add({ key: "cmp_since_name", label: "The most recent earlier trip that cost more a day", display: dearer.name });
      add({ key: "cmp_since_perday", label: `${dearer.name} a day`, value_pence: dearer.perDay, display: money(dearer.perDay) });
    } else {
      add({ key: "cmp_priciest", label: "This is the owner's priciest trip a day so far", display: "yes" });
      add({ key: "cmp_prev_name", label: "The next dearest trip a day", display: [...past].sort((a, b) => b.perDay - a.perDay)[0]!.name });
      add({ key: "cmp_prev_perday", label: "The next dearest trip's spending a day", value_pence: [...past].sort((a, b) => b.perDay - a.perDay)[0]!.perDay, display: money([...past].sort((a, b) => b.perDay - a.perDay)[0]!.perDay) });
    }
  }

  // ---- card fees on foreign spending (only where an account charges one) ----
  let fee = 0, feeBps = 0;
  for (const t of i.txns) {
    const bps = i.fees[t.account_id] ?? 0;
    if (bps > 0 && t.original_amount_minor && t.original_currency && t.fx_rate != null && t.fx_source !== "manual") {
      fee += Math.max(0, t.amount_pence - convertToPence(t.original_amount_minor, t.original_currency, String(t.fx_rate), 0));
      feeBps = Math.max(feeBps, bps);
    }
  }
  if (fee > 0) {
    add({ key: "fx_fee_total", label: "Card fees paid on foreign spending", value_pence: fee, display: money(fee) });
    add({ key: "fx_fee_rate", label: "The card's foreign fee", value: feeBps / 100, display: `${(feeBps / 100).toFixed(2)}%` });
  }

  return {
    generated_on: today, scope: "trip", trip_id: trip.id,
    period: { from: trip.start_on, to: trip.end_on, label: trip.name, compare_label: "Earlier trips" },
    facts, entities, preferences: [],
  };
}

/** Gather one trip's figures through the same SQL functions the screens use, then assemble the facts. */
export async function buildTripFacts(db: SupabaseClient, tripId: string, today: ISODate): Promise<Facts> {
  const trips = await fetchTrips(db);
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) throw new Error("That trip no longer exists.");
  const [stops, summary, byDay, byStop, byCat, txns, overview, accounts] = await Promise.all([
    fetchTripStops(db, tripId), fetchTripSummary(db, tripId, today), fetchTripByDay(db, tripId), fetchTripByStop(db, tripId, today),
    fetchTripByCategory(db, tripId, "parent"), fetchTripTxns(db, tripId), fetchTripsOverview(db, today), fetchAccounts(db),
  ]);
  if (!summary) throw new Error("That trip has no summary yet.");
  return assembleTripFacts({
    today, trip, stops, summary, byDay, byStop, byCat, txns,
    past: overview.filter((o) => o.trip_id !== tripId && o.end_on < today),
    fees: Object.fromEntries(accounts.map((a) => [a.id, a.fx_fee_bps ?? 0])),
  });
}
