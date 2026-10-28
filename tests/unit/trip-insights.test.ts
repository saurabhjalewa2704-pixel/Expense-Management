import { describe, expect, it } from "vitest";
import { fallbackTripCards } from "@/lib/ai/fallback";
import { narrate } from "@/lib/ai/generate";
import { tripInsightsDue } from "@/lib/ai/trip-due";
import { assembleTripFacts, type TripFactsInput } from "@/lib/ai/trip-facts";
import { validateCards } from "@/lib/ai/validator";
import type { Trip, TripCategoryRow, TripDay, TripOverviewRow, TripStopTotal, TripSummary, TxnRow } from "@/lib/types";

// The USA trip on Fri 12 March 2027, day 7 of 15 (PRD Appendix A.2), reduced to the figures the facts need.
const trip: Trip = { id: "11111111-1111-4111-8111-111111111111", name: "USA", country_code: "US", currency: "USD", start_on: "2027-03-06", end_on: "2027-03-20", budget_pence: 500000, auto_tag: true, created_at: "2026-12-01T00:00:00Z" };
const summary: TripSummary = { trip_id: trip.id, name: "USA", currency: "USD", start_on: trip.start_on, end_on: trip.end_on, budget_pence: 500000, booked_pence: 246020, on_trip_pence: 110131, spent_pence: 356151, refund_pence: 0, txn_count: 24, days: 15, day_n: 7, local_minor: 139405, local_pence: 110131 };
const cat = (id: string, name: string, total: number, n: number): TripCategoryRow => ({ category_id: id, name, icon: "plane", color: "stone", parent_id: null, total_pence: total, txn_count: n, parent_name: null, is_parent_direct: true, budget_pence: null, net_refund_pence: 0 });
const byCat = [cat("a", "Travel", 242130, 6), cat("b", "Eating out", 41504, 9), cat("c", "Entertainment", 32627, 3)];
const byDay: TripDay[] = [{ day: "2027-03-11", total_pence: 38737, top_payee: "Hamilton · Broadway", top_pence: 22831, txn_count: 3 }, { day: "2027-03-10", total_pence: 25438, top_payee: "Carbone", top_pence: 16590, txn_count: 4 }];
const byStop: TripStopTotal[] = [
  { stop_id: "s1", name: "Chicago", start_on: "2027-03-06", end_on: "2027-03-08", days: 3, days_elapsed: 3, total_pence: 32257 },
  { stop_id: "s2", name: "New York", start_on: "2027-03-09", end_on: "2027-03-15", days: 7, days_elapsed: 4, total_pence: 77874 },
  { stop_id: "s3", name: "Miami", start_on: "2027-03-16", end_on: "2027-03-20", days: 5, days_elapsed: 0, total_pence: 0 },
];
const txns = [{ id: "t1", type: "expense", occurred_on: "2027-03-10", amount_pence: 16590, payee_name: "Carbone", category_name: "Restaurants", parent_category_name: "Eating out", original_amount_minor: 21000, original_currency: "USD", fx_rate: 0.79, fx_source: "auto", account_id: "acc" }] as unknown as TxnRow[];
const past: TripOverviewRow[] = [{ trip_id: "p1", name: "Goa", country_code: "IN", currency: "INR", start_on: "2026-01-10", end_on: "2026-01-17", budget_pence: null, booked_pence: 0, on_trip_pence: 240000, spent_pence: 240000, txn_count: 20 }];
const input: TripFactsInput = { today: "2027-03-12", trip, stops: [], summary, byDay, byStop, byCat, txns, past, fees: {} };

describe("trip insight facts (TRIP-08)", () => {
  const facts = assembleTripFacts(input);
  const get = (k: string) => facts.facts.find((f) => f.key === k)?.display;

  it("computes the budget figures from the trip's own numbers", () => {
    expect(get("spent")).toBe("£3,561.51");
    expect(get("left")).toBe("£1,438.49");
    expect(get("allowance")).toBe("£159.83");
    expect(get("plan_per_day")).toBe("£169.32");
    expect(get("actual_per_day")).toBe("£157.33");
    expect(get("projected_dir")).toBe("under");
  });
  it("names the biggest day, expense and category share", () => {
    expect(get("bigday_name")).toBe("Thursday");
    expect(get("bigday_payee")).toBe("Hamilton · Broadway");
    expect(get("big_payee")).toBe("Carbone");
    expect(get("big_orig")).toBe("$210.00");
    expect(get("mix:travel:pct")).toBe("77%");
  });
  it("compares one stop with another per day, and the trip with earlier trips", () => {
    expect(get("stop_hi")).toBe("New York");
    expect(get("stop_lo")).toBe("Chicago");
    expect(get("stop_cmp_pct")).toBe("81%");
    expect(get("cmp_since_name")).toBe("Goa");
  });
  it("states card fees only when an account charges one", () => {
    expect(get("fx_fee_total")).toBeUndefined();
    const charged = [{ ...txns[0]!, amount_pence: 17086 }];                      // $210.00 at 0.7900 is £165.90; with a 2.99% fee, £170.86
    const withFee = assembleTripFacts({ ...input, txns: charged, fees: { acc: 299 } });
    expect(withFee.facts.find((f) => f.key === "fx_fee_rate")?.display).toBe("2.99%");
    expect(withFee.facts.find((f) => f.key === "fx_fee_total")?.display).toBe("£4.96");
  });

  it("the template cards are grounded by construction (every figure passes the validator) and there are two to four", () => {
    const cards = fallbackTripCards(facts);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(4);
    const { valid, dropped } = validateCards(cards, facts);
    expect(dropped).toEqual([]);
    expect(valid).toHaveLength(cards.length);
    expect(cards[0]!.type).toBe("trip_pace");
    expect(cards[0]!.title).toBe("At this pace you’ll finish about £… under budget".replace("£…", get("projected_gap")!));
  });

  it("a made-up figure is dropped by the grounding validator", () => {
    const bad = { ...fallbackTripCards(facts)[0]!, body: "You are £999.99 under budget." };
    const { valid, dropped } = validateCards([bad], facts);
    expect(valid).toHaveLength(0);
    expect(dropped[0]!.reasons[0]).toContain("£999.99");
  });

  it("the narrator tops up from the template when no model is configured", async () => {
    const n = await narrate(facts, null);
    expect(n.cards.length).toBeGreaterThanOrEqual(2);
    expect(n.usedFallback).toBe(true);
    expect(validateCards(n.cards, facts).dropped).toEqual([]);
  });
});

describe("when a trip's insights are due (TRIP-08)", () => {
  const base = { trip: { start_on: "2027-03-06", end_on: "2027-03-20" }, today: "2027-03-12", now: new Date("2027-03-12T09:30:00Z"), hourLondon: 9, runsToday: 0, changedAt: null };
  it("first run", () => expect(tripInsightsDue({ ...base, latest: null }).reason).toBe("first run"));
  it("each morning from 07:00 while the trip runs", () => {
    expect(tripInsightsDue({ ...base, latest: { created_at: "2027-03-11T07:05:00Z" } })).toEqual({ due: true, reason: "morning" });
    expect(tripInsightsDue({ ...base, latest: { created_at: "2027-03-12T07:05:00Z" } }).due).toBe(false);
    expect(tripInsightsDue({ ...base, hourLondon: 5, latest: { created_at: "2027-03-11T07:05:00Z" } }).due).toBe(false);
  });
  it("after an edit, debounced by ten minutes", () => {
    const latest = { created_at: "2027-03-12T09:25:00Z" };
    expect(tripInsightsDue({ ...base, latest, changedAt: "2027-03-12T09:28:00Z" })).toEqual({ due: false, reason: "debounced" });
    expect(tripInsightsDue({ ...base, now: new Date("2027-03-12T09:40:00Z"), latest, changedAt: "2027-03-12T09:28:00Z" })).toEqual({ due: true, reason: "edited" });
  });
  it("the wrap-up comes the day after the trip ends, once", () => {
    const after = { ...base, today: "2027-03-21" };
    expect(tripInsightsDue({ ...after, latest: { created_at: "2027-03-20T07:05:00Z" } })).toEqual({ due: true, reason: "wrap-up" });
    expect(tripInsightsDue({ ...after, latest: { created_at: "2027-03-21T07:05:00Z" } }).due).toBe(false);
  });
  it("never more than ten runs a day", () => expect(tripInsightsDue({ ...base, latest: null, runsToday: 10 }).due).toBe(false));
});
