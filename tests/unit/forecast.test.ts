import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetStatus, forecastMonth, percentile, planToDate, roundHalfEven, safeToSpend, whatIfs, type ForecastInputs } from "@/lib/forecast";

// PRD §6.13 BUD-05a: FC-1 to FC-10. Fixtures are integer pence and London dates; tracking started on 18 Oct 2026 unless stated.
const base = (o: Partial<ForecastInputs>): ForecastInputs => ({
  month: "2026-10-01", today: "2026-10-25", trackingStart: "2026-10-18", spent: 56000, recurringLogged: 0, discretionary: 56000, discretionaryToday: 0,
  billsToCome: 0, qualifyingMonths: [], historyDaily: [], ...o,
});

// Appendix A.3: 42 daily values (three months × 14 days) whose median is £92.00 and quartiles £60.00 and £105.00
const A3_HISTORY = [...Array(12).fill(6000), ...Array(8).fill(7000), 9200, 9200, ...Array(8).fill(10400), 10500, 10500, ...Array(10).fill(14000)];
const A3: ForecastInputs = {
  month: "2026-10-01", today: "2026-10-18", trackingStart: "2026-04-01", spent: 323685, recurringLogged: 198882, discretionary: 124803, discretionaryToday: 640,
  billsToCome: 3497, qualifyingMonths: ["2026-07-01", "2026-08-01", "2026-09-01"], historyDaily: A3_HISTORY,
};

describe("the forecast engine (BUD-05a)", () => {
  it("FC-1 the owner's real situation: tracking started 18 Oct, so on 25 Oct the pace is over 8 days and the forecast is above what is spent", () => {
    const f = forecastMonth(base({}));
    expect(f.daysElapsed).toBe(8);
    expect(f.paceThis).toBe(7000);
    expect(f.daysLeft).toBe(7);
    expect(f.remaining).toBe(49000);
    expect(f.forecast).toBe(56000 + 49000);
    expect(f.forecast).toBeGreaterThan(f.spent);
    expect(f.qualifyingMonths).toEqual([]);
    expect(f.wHist).toBe(0);                                        // no history: this month's pace only, never £0 history
  });

  it("FC-2 with fewer than 3 tracked days and no history there is no number", () => {
    const f = forecastMonth(base({ today: "2026-10-19", spent: 14000, discretionary: 14000 }));
    expect(f.daysElapsed).toBe(2);
    expect(f.available).toBe(false);
    expect(f.unavailableReason).toBe("Forecast available after 3 days of logging");
  });

  it("FC-3 on the last day days_left is 1, not 0", () => {
    const f = forecastMonth(base({ today: "2026-10-31", spent: 98000 + 2000, discretionary: 98000 + 2000 - 0, discretionaryToday: 2000 }));
    // pace = (98000+2000)/14 = 7142.86 → £71.43; the spec's £70.00 pace is reproduced with a £980.00 total
    const g = forecastMonth(base({ today: "2026-10-31", spent: 98000, discretionary: 98000, discretionaryToday: 2000 }));
    expect(g.daysElapsed).toBe(14);
    expect(g.paceThis).toBe(7000);
    expect(g.daysLeft).toBe(1);
    expect(g.remaining).toBe(7000 - 2000);
    expect(g.forecast).toBe(98000 + 5000);
    expect(f.daysLeft).toBe(1);
  });

  it("FC-4 from the 1st of the next month the old month shows the actual, and the new month does not borrow from a partly tracked one", () => {
    const oct = forecastMonth(base({ today: "2026-11-01", spent: 200000 }));
    expect(oct.closed).toBe(true);
    expect(oct.forecast).toBe(200000);
    const nov = forecastMonth(base({ month: "2026-11-01", today: "2026-11-01", spent: 0, discretionary: 0, qualifyingMonths: [] }));
    expect(nov.daysElapsed).toBe(1);
    expect(nov.available).toBe(false);
    expect(nov.wHist).toBe(0);
  });

  it("FC-5 exactly one qualifying month weighs 0.8 this month, 0.2 history", () => {
    const f = forecastMonth(base({ today: "2026-12-10", month: "2026-12-01", spent: 70000, discretionary: 70000, qualifyingMonths: ["2026-11-01"], historyDaily: Array(22).fill(5000) }));
    expect([f.wThis, f.wHist]).toEqual([8, 2]);
    expect(f.confidence).toBe("low");                              // fewer than two prior months
    expect(f.expectedPerDay).toBe(Math.round(0.8 * 7000 + 0.2 * 5000));
  });

  it("FC-6 Appendix A.3: £4,363.02, range £4,105.42 to £4,735.42, expected £78.40 a day", () => {
    const f = forecastMonth(A3);
    expect(f.daysElapsed).toBe(18);
    expect(f.daysLeft).toBe(14);
    expect([f.wThis, f.wHist]).toEqual([6, 4]);
    expect(f.paceHist).toBe(9200);
    expect(f.expectedPerDay).toBe(7840);
    expect(f.remaining).toBe(7840 * 14 - 640);
    expect(f.forecast).toBe(436302);
    expect(f.low).toBe(410542);
    expect(f.high).toBe(473542);
    expect(f.confidence).toBe("normal");
    expect(f.degenerate).toBe(false);
  });

  it("FC-7 a fully tracked month with £0 spend is a real £0 month, not missing data", () => {
    const f = forecastMonth(base({ today: "2026-12-10", month: "2026-12-01", spent: 70000, discretionary: 70000, qualifyingMonths: ["2026-09-01", "2026-10-01", "2026-11-01"], historyDaily: Array(66).fill(0) }));
    expect(f.qualifyingMonths).toHaveLength(3);
    expect(f.paceHist).toBe(0);
    expect([f.wThis, f.wHist]).toEqual([6, 4]);
    expect(f.expectedPerDay).toBe(Math.round(0.6 * 7000));
  });

  it("FC-8 bills to come with nothing discretionary yet: the forecast is spent + bills + a history-weighted remainder, above spent", () => {
    const f = forecastMonth({ ...A3, today: "2026-10-05", spent: 0, discretionary: 0, discretionaryToday: 0, billsToCome: 3497 });
    expect([f.wThis, f.wHist]).toEqual([3, 7]);
    expect(f.expectedPerDay).toBe(6440);                              // 0.7 × £92.00
    expect(f.forecast).toBe(3497 + 6440 * 27);
    expect(f.forecast).toBeGreaterThan(f.spent + f.billsToCome);
  });

  it("FC-10 the degenerate guard stays quiet on every fixture above, and fires when it should", () => {
    for (const i of [base({}), A3, { ...A3, today: "2026-10-05" }]) expect(forecastMonth(i).degenerate).toBe(false);
    expect(forecastMonth(base({ discretionary: 70000, discretionaryToday: 100000 })).degenerate).toBe(true);        // today's spend swallows the whole remaining term
  });

  it("weights follow the day of the month when there is history (0.3/0.7, 0.6/0.4, 0.8/0.2)", () => {
    const w = (today: string) => forecastMonth({ ...A3, today }).wThis;
    expect([w("2026-10-07"), w("2026-10-08"), w("2026-10-21"), w("2026-10-22")]).toEqual([3, 6, 6, 8]);
  });

  it("exact arithmetic: percentiles and half-even rounding", () => {
    expect(percentile([1, 2, 3, 4], 1, 2)).toEqual({ n: 5n, d: 2n });                  // 2.5
    expect(percentile([], 1, 2)).toBeNull();
    expect(roundHalfEven(5n, 2n)).toBe(2n);
    expect(roundHalfEven(7n, 2n)).toBe(4n);
  });
});

describe("budget measures on the forecast (BUD-03, BUD-04, BUD-07)", () => {
  const f = forecastMonth(A3);
  it("plan to date puts bills on their days: £3,368.55, which is £131.70 above what is spent", () => {
    const plan = planToDate(440000, 198882, 202379, 18, 31);
    expect(plan).toBe(336855);
    expect(plan - A3.spent).toBe(13170);
    expect(planToDate(440000, 198882, 202379, 18, 31, true)).toBe(Math.round(440000 * 18 / 31));      // Exclude bills: a straight line
  });
  it("safe to spend is £80.58 a day for 14 days, and the status is Tight", () => {
    expect(safeToSpend(440000, f)).toBe(8058);
    expect(budgetStatus(f, 440000, 336855)).toBe("tight");
    expect(440000 - f.forecast).toBe(3698);                                             // headroom
  });
  it("status: Over above the budget, On track below 95%, Early days in the first week", () => {
    expect(budgetStatus(f, 400000, 336855)).toBe("over");
    expect(budgetStatus(f, 600000, 336855)).toBe("on_track");
    const early = forecastMonth({ ...A3, today: "2026-10-04", spent: 30000, discretionary: 20000, discretionaryToday: 0 });
    expect(budgetStatus(early, 440000, 50000)).toBe("early");
  });
  it("what-if rows: at the safe amount the month ends at £4,394 (£6 inside); at your usual pace £4,363 (£37 inside)", () => {
    const rows = whatIfs(440000, f, 640);
    const safe = rows.find((r) => r.key === "safe")!, usual = rows.find((r) => r.key === "usual")!;
    expect([safe.perDay, Math.round(safe.monthEnd / 100), Math.round(safe.diff / 100)]).toEqual([8058, 4394, 6]);
    expect([usual.perDay, Math.round(usual.monthEnd / 100), Math.round(usual.diff / 100)]).toEqual([7840, 4363, 37]);
    expect(rows.map((r) => r.key)).toEqual(["low", "safe", "usual", "high"]);
    expect(rows[0]!.perDay).toBe(6000);
    expect(rows[3]!.perDay).toBe(10000);
  });
});

describe("one engine (FC-9)", () => {
  // Nothing outside lib/forecast.ts may calculate a month-end projection. These names belonged to the old, separate calculations.
  const banned = [/projectMonth\s*\(/, /category_remaining/, /fetchCategoryRemaining/, /useCategoryRemaining/, /\bprojected_spend\b/];
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (/node_modules|\.next|\.stack/.test(p)) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|sql)$/.test(p) ? [p] : [];
  });
  it("the old projection code is gone", () => {
    const files = [...walk("app"), ...walk("lib"), ...walk("components")];
    const hits = files.filter((f) => banned.some((b) => b.test(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });
});
