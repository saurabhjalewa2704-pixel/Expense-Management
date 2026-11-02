// §6.14.13: replay the engine over past months as it would have run, measure its error, and tune k and the half-life. Pure: the server feeds it replays.
import { addDays, daysInMonth, monthEnd } from "@/lib/dates";
import { forecast } from "./index";
import { HALF_LIFE_GRID, K_GRID } from "./params";
import { spentFromFacts } from "./load";
import type { DayFact, EngineParams, ForecastInput, ISO } from "./types";

/** One point-in-time input (what was known at the end of `asOf`) with what the month turned out to total. */
export interface Replay { month: ISO; day: number; input: ForecastInput; actual: number }
export interface BacktestRow { month: ISO; day: number; point: number; low: number | null; high: number | null; actual: number }

export const band = (day: number) => (day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3);

export function replayRows(replays: readonly Replay[], params: Partial<EngineParams> = {}): BacktestRow[] {
  const out: BacktestRow[] = [];
  for (const r of replays) {
    const f = forecast({ ...r.input, params: { ...r.input.params, ...params } });
    if (f.point === null) continue;
    out.push({ month: r.month, day: r.day, point: f.point, low: f.low, high: f.high, actual: r.actual });
  }
  return out;
}

export interface Metrics { mapeByBand: (number | null)[]; mape: number | null; weighted: number | null; bias: number | null; coverage: number | null; n: number }
export function metrics(rows: readonly BacktestRow[]): Metrics {
  const err = (r: BacktestRow) => Math.abs(r.point - r.actual) / Math.max(1, r.actual);
  const by: number[][] = [[], [], [], []];
  for (const r of rows) by[band(r.day)]!.push(err(r));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const mapeByBand = by.map(avg);
  const w = [1, 2, 2, 1];
  const have = mapeByBand.map((m, i) => (m === null ? null : { m, w: w[i]! })).filter((x): x is { m: number; w: number } => x !== null);
  const weighted = have.length ? have.reduce((a, x) => a + x.m * x.w, 0) / have.reduce((a, x) => a + x.w, 0) : null;
  const rangeRows = rows.filter((r) => r.low !== null && r.high !== null);
  return {
    mapeByBand, mape: avg(rows.map(err)), weighted,
    bias: rows.length ? rows.reduce((a, r) => a + (r.point - r.actual) / Math.max(1, r.actual), 0) / rows.length : null,
    coverage: rangeRows.length ? rangeRows.filter((r) => r.actual >= r.low! && r.actual <= r.high!).length / rangeRows.length : null, n: rows.length,
  };
}

export interface TuneResult { k: number; half_life: number; changed: boolean; before: number | null; after: number | null }
/** Grid-search k and the half-life; adopt a new pair only if it improves the weighted MAPE by at least one percentage point. */
export function tune(replays: readonly Replay[], current: { k: number; half_life: number }): TuneResult {
  const base = metrics(replayRows(replays, { k_base: current.k, half_life: current.half_life })).weighted;
  let best = { k: current.k, half_life: current.half_life, score: base };
  for (const k of K_GRID) for (const h of HALF_LIFE_GRID) {
    const m = metrics(replayRows(replays, { k_base: k, half_life: h })).weighted;
    if (m !== null && (best.score === null || m < best.score - 1e-12)) best = { k, half_life: h, score: m };
  }
  const improves = base !== null && best.score !== null && base - best.score >= 0.01;
  return improves ? { k: best.k, half_life: best.half_life, changed: true, before: base, after: best.score } : { k: current.k, half_life: current.half_life, changed: false, before: base, after: base };
}

/** "Forecast accuracy ±4%": the mean absolute error at the same day of the month over the last three months (BUD-11). Null before two complete months. */
export function accuracyAtDay(rows: readonly BacktestRow[], dom: number): { pct: number; months: number } | null {
  const months = [...new Set(rows.map((r) => r.month))].sort().slice(-3);
  if (months.length < 2) return null;
  const at = rows.filter((r) => months.includes(r.month) && r.day === Math.min(dom, daysInMonth(r.month)));
  if (!at.length) return null;
  return { pct: Math.round((at.reduce((a, r) => a + Math.abs(r.point - r.actual) / Math.max(1, r.actual), 0) / at.length) * 100), months: months.length };
}

/** §6.14.13 bias guard: more than ±5% bias in each of the last three months raises a flag; nothing is adjusted to hide it. */
export function biasFlag(rows: readonly BacktestRow[]): { flag: boolean; pct: number } | null {
  const months = [...new Set(rows.map((r) => r.month))].sort().slice(-3);
  if (months.length < 3) return null;
  const per = months.map((m) => { const rs = rows.filter((r) => r.month === m); return rs.reduce((a, r) => a + (r.point - r.actual) / Math.max(1, r.actual), 0) / rs.length; });
  const same = per.every((b) => b > 0.05) || per.every((b) => b < -0.05);
  return { flag: same, pct: Math.round((per.reduce((a, b) => a + b, 0) / per.length) * 100) };
}

/** Coverage correction: scale the range multiplier ±10% when the p10–p90 range misses 80% by a lot, within [1.0, 2.0]. */
export function correctZ(z: number, coverage: number | null): number {
  if (coverage === null) return z;
  const next = coverage < 0.7 ? z * 1.1 : coverage > 0.9 ? z * 0.9 : z;
  return Math.min(2, Math.max(1, Math.round(next * 10000) / 10000));
}

/** Builds replays from a user's daily facts alone (synthetic users, and the pure harness tests): bills are whatever recurring was later paid in the month. */
export function replaysFromFacts(days: readonly DayFact[], trackingStart: ISO, months: readonly ISO[]): Replay[] {
  const out: Replay[] = [];
  for (const month of months) {
    const end = monthEnd(month);
    const actual = spentFromFacts(days, month, end, "all");
    for (let d = 1; d <= daysInMonth(month); d++) {
      const asOf = addDays(month, d - 1);
      const known = days.filter((x) => x.d <= asOf);
      const scheduled = days.filter((x) => x.d > asOf && x.d >= month && x.d <= end && x.recurring > 0).map((x) => ({ d: x.d, amount: x.recurring, label: "Bill", kind: "bill" as const, category: null, varies: false }));
      out.push({ month, day: d, actual, input: { today: asOf, month, tracking_started_on: trackingStart, days: known, spent_month_to_date: spentFromFacts(known, month, asOf, "all"), scheduled, trips: [], categories: [] } });
    }
  }
  return out;
}
