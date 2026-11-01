// FORECASTING-ENGINE-PRD §6.14.18 test 3: the backtest harness on synthetic users (flat, weekend-heavy, payday-spike, lumpy, sparse, holiday-heavy).
import { describe, expect, it } from "vitest";
import { accuracyAtDay, biasFlag, correctZ, metrics, replayRows, replaysFromFacts, tune } from "@/lib/forecast/backtest";
import type { DayFact } from "@/lib/forecast/types";
import { rng, series, STYLES } from "./forecast-helpers";

const TRACK = "2026-03-01";
const MONTHS = ["2026-08-01", "2026-09-01", "2026-10-01"];
function user(style: keyof typeof STYLES, seed: number): DayFact[] {
  const r = rng(seed);
  return series(TRACK, "2026-10-31", (d, i) => STYLES[style](d, i, r), (d) => ({ recurring: d.endsWith("-01") ? 120000 : 0 }));
}
const rowsFor = (style: keyof typeof STYLES) => replayRows(replaysFromFacts(user(style, 42), TRACK, MONTHS));
const mid = (rows: ReturnType<typeof rowsFor>) => rows.filter((r) => r.day >= 8 && r.day <= 21);

describe("backtest harness on synthetic users", () => {
  const all = Object.fromEntries((Object.keys(STYLES) as (keyof typeof STYLES)[]).map((s) => [s, rowsFor(s)]));
  it("mid-month MAPE is at most 10% for the flat and weekend-heavy users", () => {
    for (const s of ["flat", "weekend"] as const) expect(metrics(mid(all[s]!)).mape!, s).toBeLessThanOrEqual(0.1);
  });
  it("the p10–p90 range covers between 65% and 95% of outcomes", () => {
    const rows = Object.values(all).flat();
    const c = metrics(rows).coverage!;
    expect(c).toBeGreaterThanOrEqual(0.65);
    expect(c).toBeLessThanOrEqual(0.95);
  });
  it("every style produces a forecast on every replayed day with enough history", () => {
    for (const rows of Object.values(all)) expect(rows.length).toBeGreaterThanOrEqual(80);
  });
  it("error falls through the month: the last band is no worse than the first", () => {
    const m = metrics(all.flat!);
    expect(m.mapeByBand[3]!).toBeLessThanOrEqual(m.mapeByBand[0]! + 1e-9);
  });
  it("tuning adopts a new pair only when it improves the weighted error by a percentage point", () => {
    const replays = replaysFromFacts(user("lumpy", 7), TRACK, MONTHS);
    const t = tune(replays, { k: 7, half_life: 60 });
    if (t.changed) expect(t.before! - t.after!).toBeGreaterThanOrEqual(0.01);
    else expect(t.k).toBe(7);
  }, 120_000);
  it("accuracy shows 'Learning' before two complete months, then a percentage", () => {
    const rows = all.flat!;
    expect(accuracyAtDay(rows.filter((r) => r.month === "2026-10-01"), 15)).toBeNull();
    expect(accuracyAtDay(rows, 15)!.pct).toBeGreaterThanOrEqual(0);
  });
  it("a forecast that is 6% low three months running raises the bias flag, and it is not fudged away", () => {
    const biased = ["2026-08-01", "2026-09-01", "2026-10-01"].flatMap((month) => [10, 20].map((day) => ({ month, day, point: 94000, low: 80000, high: 100000, actual: 100000 })));
    expect(biasFlag(biased)).toEqual({ flag: true, pct: -6 });
    expect(biasFlag(all.flat!)!.flag).toBe(false);
  });
  it("the range multiplier moves 10% at most, within [1.0, 2.0]", () => {
    expect(correctZ(1.2816, 0.5)).toBeCloseTo(1.41, 2);
    expect(correctZ(1.2816, 0.95)).toBeCloseTo(1.1534, 3);
    expect(correctZ(1.95, 0.5)).toBe(2);
    expect(correctZ(1.0, 0.99)).toBe(1);
  });
});
