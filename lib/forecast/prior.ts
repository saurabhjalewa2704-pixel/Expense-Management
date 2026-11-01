// §6.14.3 and §6.14.5: tracked days, and the "usual": a recency-weighted, winsorised mean with weekday, month-position and seasonal profiles.
import Decimal from "decimal.js";
import { addDays, addMonths, diffDays, weekdayIndex } from "@/lib/dates";
import type { DayFact, EngineParams, ISO } from "./types";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });
export const D = (x: Decimal.Value) => new Decimal(x);
const ONE = D(1);

/** 0.5^(age ÷ half-life) for whole-day ages, computed once per half-life: the weights are the same for every series and every run. */
const weightTables = new Map<number, Decimal[]>();
function weightFor(age: number, halfLife: number): Decimal {
  let t = weightTables.get(halfLife);
  if (!t) { t = []; weightTables.set(halfLife, t); }
  return (t[age] ??= D(0.5).pow(D(age).div(halfLife)));
}

/** Round to integer pence, half-even. */
export const r2p = (x: Decimal.Value): number => D(x).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();

export const posBucket = (d: ISO): 0 | 1 | 2 => { const n = Number(d.slice(8)); return n <= 10 ? 0 : n <= 20 ? 1 : 2; };

/** Days in [start, end] that count as evidence: not inside a logging gap (a run of `gap_run`+ days with no activity and no confirmed zero), not trip days. */
export function trackedDays(days: readonly DayFact[], start: ISO, end: ISO, p: EngineParams): DayFact[] {
  const sel = days.filter((x) => x.d >= start && x.d <= end);
  const out: DayFact[] = [];
  let run: DayFact[] = [];
  for (const x of sel) {
    if (!x.has_activity && !x.confirmed_zero) { run.push(x); continue; }
    if (run.length) { if (run.length < p.gap_run) out.push(...run); run = []; }
    out.push(x);
  }
  if (run.length && run.length < p.gap_run) out.push(...run);       // a short quiet spell at the end is genuine
  return out.filter((x) => !x.trip_day);
}

export interface Prior {
  H: number; mu: Decimal | null; dow: Decimal[]; pos: Decimal[]; season: Decimal | null; cap: Decimal | null;
  hist: DayFact[]; dowOn: boolean; posOn: boolean; histFrom: ISO | null; histTo: ISO | null;
}
type Value = (x: DayFact) => number;

export function buildPrior(days: readonly DayFact[], monthStart: ISO, trackingStart: ISO, p: EngineParams, value: Value = (x) => x.discretionary, allDays: readonly DayFact[] = days): Prior {
  const winStart = trackingStart > addDays(monthStart, -p.window_days) ? trackingStart : addDays(monthStart, -p.window_days);
  const hist = trackedDays(days, winStart, addDays(monthStart, -1), p);
  const H = hist.length;
  const empty: Prior = { H, mu: null, dow: Array(7).fill(ONE), pos: Array(3).fill(ONE), season: null, cap: null, hist, dowOn: false, posOn: false, histFrom: hist[0]?.d ?? null, histTo: hist.at(-1)?.d ?? null };
  if (H < p.min_history_for_prior) return empty;

  let vals = hist.map((x) => D(value(x)));
  let cap: Decimal | null = null;
  if (H >= p.winsor_min_days) {
    const s = [...vals].sort((a, b) => a.cmp(b));
    const idx = Math.min(s.length - 1, Math.ceil(p.winsor_pct * s.length) - 1);
    cap = s[idx]!;
    vals = vals.map((v) => Decimal.min(v, cap!));
  }
  const ws = hist.map((x) => weightFor(diffDays(monthStart, x.d), p.half_life));
  const W = ws.reduce((a, b) => a.plus(b), D(0));
  const mu = ws.reduce((a, w, i) => a.plus(w.mul(vals[i]!)), D(0)).div(W);

  // weekday profile (H ≥ 21): multipliers shrunk towards 1 with c/(c+4), then normalised to average 1
  let dow: Decimal[] = Array(7).fill(ONE);
  const dowOn = H >= p.dow_min_history && mu.gt(0);
  if (dowOn) {
    const raw: Decimal[] = [];
    for (let k = 0; k < 7; k++) {
      const idx = hist.map((x, i) => (weekdayIndex(x.d) === k ? i : -1)).filter((i) => i >= 0);
      const c = idx.length;
      if (c === 0) { raw.push(ONE); continue; }
      const num = idx.reduce((a, i) => a.plus(ws[i]!.mul(vals[i]!)), D(0));
      const den = idx.reduce((a, i) => a.plus(ws[i]!), D(0));
      const m = num.div(den).div(mu);
      raw.push(ONE.plus(D(c).div(D(c).plus(p.dow_lambda)).mul(m.minus(1))));
    }
    const avg = raw.reduce((a, b) => a.plus(b), D(0)).div(7);
    dow = raw.map((r) => r.div(avg));
  }

  // month-position profile: each third needs ≥ 2 distinct months and ≥ 5 days
  let pos: Decimal[] = Array(3).fill(ONE);
  const months: Set<string>[] = [new Set(), new Set(), new Set()];
  const counts = [0, 0, 0];
  for (const x of hist) { const b = posBucket(x.d); months[b]!.add(x.d.slice(0, 7)); counts[b]!++; }
  const posOn = mu.gt(0) && [0, 1, 2].every((b) => months[b]!.size >= p.pos_min_months && counts[b]! >= 5);
  if (posOn) {
    const raw: Decimal[] = [], wts: Decimal[] = [];
    for (let b = 0; b < 3; b++) {
      const idx = hist.map((x, i) => (posBucket(x.d) === b ? i : -1)).filter((i) => i >= 0);
      const num = idx.reduce((a, i) => a.plus(ws[i]!.mul(vals[i]!).div(dow[weekdayIndex(hist[i]!.d)]!)), D(0));
      const den = idx.reduce((a, i) => a.plus(ws[i]!), D(0));
      const m = num.div(den).div(mu);
      const c = idx.length;
      raw.push(ONE.plus(D(c).div(D(c).plus(p.pos_lambda)).mul(m.minus(1)))); wts.push(D(c));
    }
    const avg = raw.reduce((a, r, i) => a.plus(r.mul(wts[i]!)), D(0)).div(wts.reduce((a, b) => a.plus(b), D(0)));
    pos = raw.map((r) => r.div(avg));
  }

  // seasonality (13+ months of tracked history): last year's same-month daily mean over the 12-month daily mean, halfway to 1, clamped
  let season: Decimal | null = null;
  const monthsTracked = trackingStart <= addMonths(monthStart, -13);
  if (monthsTracked && mu.gt(0)) {
    const lyStart = addMonths(monthStart, -12), lyEnd = addDays(addMonths(monthStart, -11), -1);
    const same = trackedDays(allDays, lyStart, lyEnd, p);
    const all12 = trackedDays(allDays, addMonths(monthStart, -12), addDays(monthStart, -1), p);
    if (same.length >= 10 && all12.length >= 90) {
      const mean = (xs: DayFact[]) => xs.reduce((a, x) => a.plus(value(x)), D(0)).div(xs.length);
      const m12 = mean(all12);
      if (m12.gt(0)) season = Decimal.min(1.6, Decimal.max(0.7, ONE.plus(mean(same).div(m12).minus(1).mul(0.5))));
    }
  }
  return { H, mu, dow, pos, season, cap, hist, dowOn, posOn, histFrom: hist[0]?.d ?? null, histTo: hist.at(-1)?.d ?? null };
}

/** Expected discretionary spend on a day: μ × weekday × position × season. */
export const expectedOn = (prior: Prior, d: ISO): Decimal =>
  prior.mu!.mul(prior.dow[weekdayIndex(d)]!).mul(prior.pos[posBucket(d)]!).mul(prior.season ?? ONE);
