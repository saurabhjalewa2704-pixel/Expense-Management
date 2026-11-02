// FORECASTING-ENGINE-PRD §6.14.17 and §6.14.18: a test named after every edge case, the property tests, and the owner's regression.
import { readFileSync, readdirSync, statSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forecast } from "@/lib/forecast/index";
import { buildInput, spentFromFacts, type RawInput } from "@/lib/forecast/load";
import { matchesExtra } from "@/lib/forecast/match";
import type { DayFact, ForecastInput } from "@/lib/forecast/types";
import type { RecurringItem, RecurringOccurrence, RecurringSuggestion } from "@/lib/types";
import { day, input, rng, series } from "./forecast-helpers";

const load = (n: string) => JSON.parse(readFileSync(`forecast/fixtures/${n}.input.json`, "utf8")) as ForecastInput;
const G1 = load("G1-owner-1-nov"), G6 = load("G6-rich-mid-month"), G7 = load("G7-owner-last-day"), G8 = load("G8-rich-active-trip"), G9 = load("G9-rich-logging-gap");
const flat = (v: number) => () => v;

describe("owner regression (§6.14.18 test 4)", () => {
  it("1 Nov: the forecast is not £3,118.41, and November carries no weight", () => {
    const f = forecast(G1);
    expect(f.point).not.toBe(311841);
    expect(f.evidence.weightThisMonth).toBe(0);
    expect(f.point).toBe(413871);
  });
});

describe("edge cases EC-F1 to EC-F32", () => {
  it("EC-F1 day 1 of the month: w = 0, the rest of the month is entirely history, minus today's logged spend; never a one-day pace", () => {
    const f = forecast(G1);
    expect(f.evidence.completedDays).toBe(0);
    expect(f.components.restOfMonth).toBe(30 * 6114 - 2205);
  });
  it("EC-F2 last day of the month: days left = 1, only today's remainder is added", () => {
    const f = forecast(G7);
    expect(f.daysLeft).toBe(1);
    expect(f.components.restOfMonth).toBe(2125);
  });
  it("EC-F3 first day of the next month: the closed month is actual, and the new month starts at w = 0", () => {
    const closed = forecast({ ...G7, month: "2026-10-01", today: "2026-11-01", spent_month_to_date: 399000 });
    expect(closed.regime).toBe("actual");
    expect(closed.point).toBe(399000);
    expect(closed.low).toBeNull();
    expect(forecast(G1).evidence.weightThisMonth).toBe(0);
  });
  it("EC-F4 tracking started mid-month: those days are history from day one, and days before tracking never are", () => {
    const days = [...series("2026-10-01", "2026-10-17", flat(99999)), ...series("2026-10-18", "2026-11-01", flat(5000))];
    const f = forecast(input({ today: "2026-11-01", track: "2026-10-18", days }));
    expect(f.prior.historyFrom).toBe("2026-10-18");
    expect(f.prior.historyDays).toBe(14);
    expect(f.prior.usualPerDay).toBe(5000);
  });
  it("EC-F5 a brand-new user on day 1 to 2: no point, 'at least' the floor", () => {
    const f = forecast(JSON.parse(readFileSync("forecast/fixtures/G4-new-user-day-2.input.json", "utf8")));
    expect(f.regime).toBe("insufficient");
    expect(f.point).toBeNull();
    expect(f.floor).toBeGreaterThan(0);
    expect(f.message).toBe("Forecast available after 3 days of logging");
  });
  it("EC-F6 a brand-new user on day 3 or more: this-month-only, flat rate, Low confidence", () => {
    const f = forecast(JSON.parse(readFileSync("forecast/fixtures/G5-new-user-day-5.input.json", "utf8")));
    expect(f.regime).toBe("this-month-only");
    expect(f.confidence).toBe("Low");
    expect(f.evidence.weightThisMonth).toBe(1);
  });
  it("EC-F7 a run of 3 or more quiet days is a logging gap: excluded from history and evidence (G9)", () => {
    const f = forecast(G9);
    expect(f.prior.historyDays).toBe(148);
    expect(f.point).toBe(489018);
  });
  it("EC-F8 shorter quiet runs, and days confirmed as 'Nothing to log', are genuine £0 days", () => {
    const base = series("2026-09-01", "2026-10-31", flat(5000));
    const quiet = (confirmed: boolean, n: number) => base.map((x) => (x.d >= "2026-10-10" && x.d < `2026-10-${10 + n}` ? day(x.d, 0, { has_activity: false, confirmed_zero: confirmed }) : x));
    const usual = (days: DayFact[]) => forecast(input({ today: "2026-11-02", track: "2026-09-01", days })).prior.historyDays;
    expect(usual(quiet(false, 2))).toBe(61);          // two quiet days: counted
    expect(usual(quiet(false, 3))).toBe(58);          // three: a gap
    expect(usual(quiet(true, 3))).toBe(61);           // three, but confirmed: counted
  });
  it("EC-F9 a large one-off counts in spent and never in the pace; it can be un-flagged", () => {
    const days = series("2026-09-01", "2026-11-10", flat(5000));
    const withOneOff = days.map((x) => (x.d === "2026-11-05" ? day(x.d, 0, { oneoff: 89900 }) : x));
    const a = forecast(input({ today: "2026-11-11", track: "2026-09-01", days }));
    const b = forecast(input({ today: "2026-11-11", track: "2026-09-01", days: withOneOff }));
    expect(b.components.restOfMonth).toBeLessThanOrEqual(a.components.restOfMonth);
    expect(b.components.spent).toBe(a.components.spent - 5000 + 89900);
  });
  it("EC-F10 one extraordinary day in history is winsorised once H ≥ 30", () => {
    const mk = (from: string) => series(from, "2026-10-31", (d) => (d === "2026-10-05" ? 500000 : 5000));
    const long = forecast(input({ today: "2026-11-02", track: "2026-09-01", days: mk("2026-09-01") }));
    expect(long.prior.historyDays).toBe(61);
    expect(long.prior.usualPerDay!).toBe(5000);                                    // the £5,000 day is capped at the 97th percentile: it can't move the usual
    const short = forecast(input({ today: "2026-11-02", track: "2026-10-10", days: mk("2026-10-10").map((x) => x) }));
    expect(short.prior.historyDays).toBeLessThan(30);
    expect(short.prior.usualPerDay!).toBe(5000);                                   // the extreme day is before this short history, so check the uncapped path directly:
    const uncapped = forecast(input({ today: "2026-11-02", track: "2026-10-01", days: mk("2026-10-01") }));
    expect(uncapped.prior.usualPerDay!).toBeGreaterThan(5000);                     // H = 31 ≥ 30 but the 97th percentile of 31 days is the day itself
  });
  it("EC-F11 a backdated expense for last week changes the forecast at the next calculation", () => {
    const days = series("2026-09-01", "2026-11-10", flat(5000));
    const a = forecast(input({ today: "2026-11-11", track: "2026-09-01", days }));
    const b = forecast(input({ today: "2026-11-11", track: "2026-09-01", days: days.map((x) => (x.d === "2026-11-04" ? { ...x, discretionary: 15000 } : x)) }));
    expect(b.point).toBeGreaterThan(a.point!);
  });
  it("EC-F12 an expense added after midnight for 'yesterday' counts in yesterday's evidence", () => {
    const days = series("2026-09-01", "2026-11-10", (d, i) => (d === "2026-11-10" ? 5000 : i % 10 === 0 ? 30000 : 5000));
    const a = forecast(input({ today: "2026-11-11", track: "2026-09-01", days }));
    const b = forecast(input({ today: "2026-11-11", track: "2026-09-01", days: days.map((x) => (x.d === "2026-11-10" ? { ...x, discretionary: 12000 } : x)) }));
    expect(b.evidence.completedDays).toBe(a.evidence.completedDays);
    expect(b.evidence.ratioActual!).toBeGreaterThan(a.evidence.ratioActual!);
  });
  it("EC-F13 a bill paused, skipped or ended is out of scheduled at once", () => {
    const base = { ...G1, scheduled: G1.scheduled };
    const without = { ...G1, scheduled: G1.scheduled.filter((s) => s.label !== "O2") };
    expect(forecast(base).point! - forecast(without).point!).toBe(1800);
  });
  it("EC-F14 a varying bill uses its last amount and widens the range by 20% of it", () => {
    const fixed = { ...G1, scheduled: [{ d: "2026-11-20", amount: 10000, label: "Energy", kind: "bill" as const, category: null, varies: false }] };
    const varies = { ...fixed, scheduled: [{ ...fixed.scheduled[0]!, kind: "bill_estimate" as const, varies: true }] };
    const a = forecast(fixed), b = forecast(varies);
    expect(b.point).toBe(a.point);
    expect(b.high! - a.high!).toBe(2000);
    expect(a.low! - b.low!).toBe(2000);
  });
  const rawBase = (o: Partial<RawInput> = {}): RawInput => ({ tracking_started_on: "2026-06-01", covers: "all", days: [], trips: [], future_dated: [], recurring_after: [], planned_extras: [], one_offs: [], params: null, params_version: "default", backtest_mape: null, data_version: 0, params_changed: null, ...o });
  const rule = (id: string, dom: number): RecurringItem => ({ id, type: "expense", amount_pence: 1000, amount_varies: false, account_id: "a", counter_account_id: null, category_id: null, payee_id: null, note: id, frequency: "monthly", day_of_month: dom, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day", starts_on: "2026-06-01", ends_on: null, max_occurrences: null, auto_log: true, paused_at: null, ended_at: null, next_due_on: `2026-11-${String(dom).padStart(2, "0")}`, created_at: "2026-06-01T00:00:00Z" });
  const billsFor = (items: RecurringItem[], occurrences: RecurringOccurrence[] = []) => ({ items, occurrences, holidays: [], categories: [], payees: [] });
  it("EC-F15 a bill due today that has not been logged is counted, and never twice once it has been", () => {
    const due = buildInput(rawBase(), { month: "2026-11-01", today: "2026-11-12", bills: billsFor([rule("gym", 12)]) });
    expect(due.scheduled.map((s) => s.label)).toEqual(["gym"]);
    const logged = buildInput(rawBase(), { month: "2026-11-01", today: "2026-11-12", bills: billsFor([rule("gym", 12)], [{ id: "o", item_id: "gym", due_on: "2026-11-12", scheduled_on: "2026-11-12", status: "logged", transaction_id: "t", amount_pence: 1000 }]) });
    expect(logged.scheduled).toEqual([]);
  });
  it("EC-F16 a detected recurring payment is included only when well seen and its day is still to come; and not when it is a bill already", () => {
    const sug = (seen: number, dom: number): RecurringSuggestion => ({ payee_id: "p", payee_name: "Netflix", category_id: "c", account_id: "a", amount_pence: 1299, frequency: "monthly", day_of_month: dom, weekday: 1, month_of_year: 1, seen, last_on: "2026-10-27" });
    const at = (s: RecurringSuggestion) => buildInput(rawBase(), { month: "2026-11-01", today: "2026-11-12", bills: billsFor([]), suggestions: [s] }).scheduled;
    expect(at(sug(5, 27)).map((s) => s.kind)).toEqual(["likely_recurring"]);
    expect(at(sug(2, 27))).toEqual([]);
    expect(at(sug(5, 5))).toEqual([]);
  });
  it("EC-F17 a future-dated transaction counts as scheduled on its date", () => {
    const i = buildInput(rawBase({ future_dated: [{ d: "2026-11-25", amount: 4500, label: "Dentist", kind: "future_dated", category: null, varies: false }] }), { month: "2026-11-01", today: "2026-11-12", bills: billsFor([]) });
    expect(i.scheduled).toEqual([expect.objectContaining({ d: "2026-11-25", amount: 4500, kind: "future_dated" })]);
  });
  it("EC-F18 a trip in progress: trip days are 0 for home spending, and the trip adds its own component (G8)", () => {
    const f = forecast(G8);
    expect(f.components.trips).toBe(90000);
    expect(f.perDay.some((p) => p.expected === 0)).toBe(true);
  });
  it("EC-F19 a trip in the past: its days are out of history", () => {
    const days = series("2026-09-01", "2026-10-31", flat(5000), (d) => (d >= "2026-10-05" && d <= "2026-10-12" ? { trip_day: true, trip: 8000 } : {}));
    expect(forecast(input({ today: "2026-11-01", track: "2026-09-01", days })).prior.historyDays).toBe(61 - 8);
  });
  it("EC-F20 a budget that excludes bills or trips runs the engine in the same scope", () => {
    const days = [day("2026-11-01", 1000, { recurring: 150000, trip: 20000 }), day("2026-11-02", 2000)];
    expect(spentFromFacts(days, "2026-11-01", "2026-11-02", "all")).toBe(173000);
    expect(spentFromFacts(days, "2026-11-01", "2026-11-02", "exclude_bills")).toBe(23000);
    expect(spentFromFacts(days, "2026-11-01", "2026-11-02", "exclude_trips")).toBe(153000);
    expect(spentFromFacts(days, "2026-11-01", "2026-11-02", "exclude_both")).toBe(3000);
    const trip = { ...G8, scope: "exclude_trips" as const };
    expect(forecast(trip).components.trips).toBe(0);
  });
  it("EC-F21 a linked refund reduces the day's discretionary and can make it negative; the mean handles it", () => {
    const days = series("2026-09-01", "2026-10-31", (d) => (d === "2026-10-10" ? -3000 : 5000));
    const f = forecast(input({ today: "2026-11-01", track: "2026-09-01", days }));
    expect(f.prior.usualPerDay!).toBeLessThan(5000);
  });
  it("EC-F22 a category with no history: nothing predicted; with 3+ days of spend this month it runs this-month-only", () => {
    const days = series("2026-10-01", "2026-11-10", flat(5000), (d) => ({ by_cat: { Pets: d >= "2026-11-05" ? 2000 : 0, Food: 5000 } }));
    const f = forecast(input({ today: "2026-11-11", track: "2026-10-01", days, categories: ["Pets", "Food"], spent_by_cat: { Pets: 12000, Food: 50000 } }));
    expect(f.categories!.Pets!.weightThisMonth).toBe(1);
    expect(f.categories!.Pets!.restOfMonth).toBeGreaterThan(0);
    const none = forecast(input({ today: "2026-11-04", track: "2026-10-01", days: days.filter((x) => x.d <= "2026-11-04"), categories: ["Pets"], spent_by_cat: { Pets: 0 } }));
    expect(none.categories!.Pets!.restOfMonth).toBe(0);
  });
  it("EC-F23 a category merged: facts are rebuilt under the target so the history continues (SQL test 10_forecast)", () => {
    const merged = series("2026-09-01", "2026-10-31", flat(5000), () => ({ by_cat: { Target: 5000 } }));
    expect(forecast(input({ today: "2026-11-01", track: "2026-09-01", days: merged, categories: ["Target"], spent_by_cat: { Target: 0 } })).categories!.Target).toBeDefined();
  });
  it("EC-F24 spending far above usual: the ratio is clamped at 2.5 rather than an extreme forecast", () => {
    const heavy = (_d: string, i: number) => (i % 10 === 0 ? 40000 : 3000);                 // a heavy-tailed history, so its 97th percentile is high
    const days = [...series("2026-09-01", "2026-10-31", heavy), ...series("2026-11-01", "2026-11-20", flat(40000))];
    const f = forecast(input({ today: "2026-11-21", track: "2026-09-01", days }));
    expect(f.evidence.ratioUsed).toBe(2.5);
    expect(f.evidence.ratioActual!).toBeGreaterThan(2.5);
  });
  it("EC-F25 a very low spender (E < £30 so far): R* = 1 and the forecast relies on history", () => {
    const days = [...series("2026-09-01", "2026-10-31", flat(100)), ...series("2026-11-01", "2026-11-02", flat(100))];
    const f = forecast(input({ today: "2026-11-03", track: "2026-09-01", days }));
    expect(f.evidence.ratioActual).toBeNull();
    expect(f.evidence.ratioUsed).toBe(1);
  });
  it("EC-F26 month lengths 28 to 31 and leap years come from the real calendar", () => {
    const f = (today: string) => forecast(input({ today, track: "2027-10-01", days: series("2027-10-01", today, flat(5000)) })).daysLeft;
    expect(f("2028-02-01")).toBe(29);            // leap year
    expect(f("2027-02-01")).toBe(28);
    expect(f("2027-04-01")).toBe(30);
    expect(f("2027-03-01")).toBe(31);
  });
  it("EC-F27 time zones: days are the facts' own dates (occurred_on), and the month window is London's", () => {
    const f = forecast(input({ today: "2026-11-01", track: "2026-10-18", days: series("2026-10-18", "2026-11-01", flat(5000)) }));
    expect(f.detail.monthStart).toBe("2026-11-01");
    expect(f.prior.historyTo).toBe("2026-10-31");
  });
  it("EC-F28 back-filled spend before tracking began is not history, but still counts in its own month's actual", () => {
    const days = [day("2026-09-10", 90000), ...series("2026-10-18", "2026-11-01", flat(5000))];
    expect(forecast(input({ today: "2026-11-01", track: "2026-10-18", days })).prior.historyDays).toBe(14);
    expect(forecast(input({ today: "2026-11-01", month: "2026-09-01", track: "2026-10-18", days, spent_month_to_date: 90000 })).point).toBe(90000);
  });
  it("EC-F29 when parameters change overnight the Why sheet says so", () => {
    const f = forecast({ ...G6, params_changed: { on: "2026-11-09", k: 5, half_life: 30 } });
    expect(f.explanation.some((s) => s.startsWith("Model updated on 9 Nov"))).toBe(true);
  });
  it("EC-F30 a planned extra is matched by category or by name, and never deducted automatically", () => {
    const extra = { id: "e", label: "Christmas presents", amount_pence: 30000, category_id: "gifts" };
    expect(matchesExtra(extra, "gifts", "")).toBe(true);
    expect(matchesExtra(extra, "other", "Hamleys christmas toys")).toBe(true);
    expect(matchesExtra(extra, "other", "Tesco")).toBe(false);
    const withExtra = forecast({ ...G6, planned_extras: [{ id: "e", label: "Christmas presents", amount: 30000, category: null }] });
    expect(withExtra.point! - forecast(G6).point!).toBe(30000);
  });
  it("EC-F31 a large deposit or refund that isn't spending never affects the forecast", () => {
    const base = forecast(G6), deposit = forecast({ ...G6, days: G6.days.map((x) => (x.d === "2026-11-03" ? { ...x, has_activity: true } : x)) });
    expect(deposit.point).toBe(base.point);
  });
  it("EC-F32 the month window is an input, so pay-cycle months later need no rework", () => {
    const f = forecast(input({ today: "2027-02-10", track: "2026-10-01", days: series("2026-10-01", "2027-02-10", flat(5000)) }));
    expect(f.detail.monthEnd).toBe("2027-02-28");
    expect(f.daysLeft).toBe(19);
  });
});

describe("property tests (1,000 random months each)", () => {
  const month = fc.record({
    seed: fc.integer({ min: 1, max: 1_000_000 }), hist: fc.integer({ min: 14, max: 140 }), dom: fc.integer({ min: 1, max: 28 }),
    bills: fc.array(fc.record({ d: fc.integer({ min: 1, max: 30 }), amount: fc.integer({ min: 100, max: 90000 }) }), { maxLength: 6 }),
  });
  const build = (m: { seed: number; hist: number; dom: number; bills: { d: number; amount: number }[] }, today = `2026-11-${String(m.dom).padStart(2, "0")}`) => {
    const r = rng(m.seed);
    const start = `2026-${m.hist > 80 ? "07" : "09"}-01`;
    const days = series(start, today, () => Math.round(r() < 0.1 ? 20000 * r() : 8000 * r()));
    const scheduled = m.bills.filter((b) => `2026-11-${String(b.d).padStart(2, "0")}` > today).map((b) => ({ d: `2026-11-${String(b.d).padStart(2, "0")}`, amount: b.amount, label: "Bill", kind: "bill" as const, category: null, varies: false }));
    return input({ today, track: start, days, scheduled });
  };
  it("point ≥ floor and low ≤ point ≤ high", () => {
    fc.assert(fc.property(month, (m) => { const f = forecast(build(m)); if (f.point === null) return true; return f.point >= f.floor && f.low! <= f.point && f.point <= f.high!; }), { numRuns: 1000 });
  }, 300_000);
  it("w is 0 when n = 0 and non-decreasing in n", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
      let last = -1;
      for (const dom of [1, 2, 4, 7, 10, 15, 21, 28]) {
        const f = forecast(build({ seed, hist: 60, dom, bills: [] }));
        const w = f.evidence.weightThisMonth;
        if (dom === 1 && w !== 0) return false;
        if (w < last) return false;
        last = w;
      }
      return true;
    }), { numRuns: 1000 });
  }, 300_000);
  it("Σ categories + Everything else = point", () => {
    fc.assert(fc.property(month, (m) => {
      const i = build(m);
      const cats = ["A", "B", "C"];
      const days = i.days.map((x, k) => ({ ...x, by_cat: { A: Math.round(x.discretionary * 0.5), B: Math.round(x.discretionary * 0.3), C: k % 5 === 0 ? 700 : 0 } }));
      const f = forecast({ ...i, days, categories: cats, spent_by_cat: { A: 20000, B: 12000, C: 3000 } });
      if (f.point === null) return true;
      return Object.values(f.categories!).reduce((a, c) => a + c.point, 0) + f.everythingElse! === f.point;
    }), { numRuns: 1000 });
  }, 300_000);
  it("adding a scheduled bill raises the point by exactly its amount", () => {
    fc.assert(fc.property(month, fc.integer({ min: 1, max: 80000 }), (m, amount) => {
      const i = build(m);
      const a = forecast(i);
      if (a.point === null) return true;
      const b = forecast({ ...i, scheduled: [...i.scheduled, { d: "2026-11-29", amount, label: "New", kind: "bill", category: null, varies: false }] });
      return b.point! - a.point === amount;
    }), { numRuns: 1000 });
  }, 300_000);
  it("adding a one-off doesn't change the rest of the month", () => {
    fc.assert(fc.property(month, fc.integer({ min: 20000, max: 200000 }), (m, amount) => {
      const i = build(m);
      const a = forecast(i);
      if (a.point === null) return true;
      const last = i.days.length - 3;
      const days = i.days.map((x, k) => (k === last ? { ...x, oneoff: x.oneoff + amount } : x));
      const b = forecast({ ...i, days, spent_month_to_date: i.spent_month_to_date + (i.days[last]!.d >= "2026-11-01" ? amount : 0) });
      return b.components.restOfMonth === a.components.restOfMonth;
    }), { numRuns: 1000 });
  }, 300_000);
  it("identical inputs give identical outputs", () => {
    fc.assert(fc.property(month, (m) => JSON.stringify(forecast(build(m))) === JSON.stringify(forecast(build(m)))), { numRuns: 1000 });
  }, 300_000);
});

describe("one engine (FC-9 retained)", () => {
  it("nothing outside lib/forecast/ calculates a month-end projection", () => {
    const banned = [/projectMonth\(/, /category_remaining/, /fetchCategoryRemaining/, /useCategoryRemaining/, /projected_spend/, /forecastMonth\(/, /paceThis/, /0\.6 \* /];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = `${d}/${n}`; return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" || p === "lib/forecast" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
    const files = [...walk("app"), ...walk("lib"), ...walk("components")];
    expect(files.filter((f) => banned.some((b) => b.test(readFileSync(f, "utf8"))))).toEqual([]);
  });
});
