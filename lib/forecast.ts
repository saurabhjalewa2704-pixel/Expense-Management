// PRD §6.13 BUD-05 / BUD-05a: the ONE forecast engine. Every month-end figure in the app (Home budget card, Budget detail, Analytics trend chart,
// Available cash projection, Category detail, AI facts, alerts) comes from `forecastMonth`. Nothing else may project spending.
// The database supplies the facts (`forecast_inputs`); this file turns them into a number, in integer pence with exact rational arithmetic
// and half-even rounding. Missing history is excluded, never treated as £0.
import { addDays, dayOfMonth, daysInMonth, diffDays, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import type { Pence } from "@/lib/money";

/** What the database knows about a month for one scope (the whole month, or one L1 category). All amounts in pence. */
export interface ForecastInputs {
  /** First day of the month being forecast. */
  month: ISODate;
  /** London today. */
  today: ISODate;
  /** `profiles.tracking_started_on`, if any. */
  trackingStart: ISODate | null;
  /** Counted spend this month up to today (expenses, less linked refunds), trips and one-offs included when the budget covers them. */
  spent: Pence;
  /** The part of `spent` logged by Bills. */
  recurringLogged: Pence;
  /** Discretionary spend since the tracked start of the month: not Bills, not trips, not one-offs. */
  discretionary: Pence;
  /** Discretionary spend logged today. */
  discretionaryToday: Pence;
  /** Recurring expenses still scheduled after today this month, in this scope. */
  billsToCome: Pence;
  /** The prior fully tracked months (up to the last three) whose daily discretionary spend is in `historyDaily`. */
  qualifyingMonths: ISODate[];
  /** Daily discretionary spend for the same remaining day-range in those months, pooled; zero days included. */
  historyDaily: number[];
}

export interface Forecast {
  month: ISODate;
  /** The month is over: `forecast` is the actual. */
  closed: boolean;
  /** False when there is too little data to say anything (BUD-05a rule 4). */
  available: boolean;
  unavailableReason: string | null;
  spent: Pence;
  billsToCome: Pence;
  daysElapsed: number;
  daysLeft: number;
  daysInMonth: number;
  /** The London day of the month today is (0 for a closed month). */
  dom: number;
  /** This month's discretionary pace a day, and the history pace a day (null with no qualifying months). */
  paceThis: Pence;
  paceHist: Pence | null;
  /** Weights in tenths: this month / history. */
  wThis: number;
  wHist: number;
  qualifyingMonths: ISODate[];
  expectedPerDay: Pence;
  /** Expected discretionary spend for the rest of the month, after what is already logged today. */
  remaining: Pence;
  forecast: Pence;
  low: Pence | null;
  high: Pence | null;
  /** The per-day amounts behind low and high (history 25th and 75th percentile). */
  lowPerDay: Pence | null;
  highPerDay: Pence | null;
  confidence: "low" | "normal";
  /** BUD-05a rule 6: the forecast equals spent + bills to come although it should not. Never expected. */
  degenerate: boolean;
}

// ---- exact arithmetic -----------------------------------------------------------------------------------------------------------------

/** n / d rounded half-even (n ≥ 0, d > 0). */
export function roundHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d, r = n % d, twice = r * 2n;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}
const rhe = (n: bigint, d: bigint): Pence => Number(roundHalfEven(n < 0n ? 0n : n, d));

interface Rat { n: bigint; d: bigint }

/** The p-th percentile (num/den, linear interpolation like SQL percentile_cont) of integer values, as an exact fraction. */
export function percentile(values: readonly number[], num: number, den: number): Rat | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = BigInt((s.length - 1) * num);                 // position × den
  const D = BigInt(den);
  const lo = Number(pos / D), rem = pos % D;
  const a = BigInt(s[lo]!), b = BigInt(s[Math.min(lo + 1, s.length - 1)]!);
  return { n: a * D + (b - a) * rem, d: D };
}

/** Weights in tenths (this month, history) by how much history there is and how far into the month we are. */
export function weights(qualifying: number, dom: number): { wThis: number; wHist: number } {
  if (qualifying === 0) return { wThis: 10, wHist: 0 };
  if (qualifying === 1) return { wThis: 8, wHist: 2 };
  if (dom <= 7) return { wThis: 3, wHist: 7 };
  if (dom <= 21) return { wThis: 6, wHist: 4 };
  return { wThis: 8, wHist: 2 };
}

export const MIN_DAYS = 3;

export function forecastMonth(i: ForecastInputs): Forecast {
  const start = monthStart(i.month), end = monthEnd(i.month), dim = daysInMonth(start);
  const closed = i.today > end;
  const base: Forecast = {
    month: start, closed, available: true, unavailableReason: null, spent: i.spent, billsToCome: 0, daysElapsed: 0, daysLeft: 0, daysInMonth: dim, dom: 0,
    paceThis: 0, paceHist: null, wThis: 10, wHist: 0, qualifyingMonths: i.qualifyingMonths, expectedPerDay: 0, remaining: 0, forecast: i.spent,
    low: null, high: null, lowPerDay: null, highPerDay: null, confidence: "normal", degenerate: false,
  };
  // the month is closed from the 1st of the next month: it shows what happened, not a forecast (rule 5)
  if (closed) return base;
  if (i.today < start) return { ...base, available: false, unavailableReason: "This month has not started." };

  const dom = dayOfMonth(i.today);
  const trackedFrom = i.trackingStart && i.trackingStart > start ? i.trackingStart : start;
  const daysElapsed = Math.max(0, diffDays(i.today, trackedFrom) + 1);          // tracked days, not calendar days (rule 2)
  const daysLeft = diffDays(end, i.today) + 1;                                  // 1 on the last day, never 0 (rule 5)
  const q = i.qualifyingMonths.length;
  const w = weights(q, dom);
  const out: Forecast = { ...base, dom, billsToCome: i.billsToCome, daysElapsed, daysLeft, wThis: w.wThis, wHist: w.wHist, confidence: q < 2 || dom <= 6 ? "low" : "normal" };

  if (daysElapsed < MIN_DAYS && q === 0) {
    return { ...out, available: false, unavailableReason: `Forecast available after ${MIN_DAYS} days of logging`, forecast: i.spent + i.billsToCome };
  }

  const de = BigInt(Math.max(1, daysElapsed));
  const disc = BigInt(i.discretionary);
  const median = percentile(i.historyDaily, 1, 2);
  const q25 = percentile(i.historyDaily, 1, 4), q75 = percentile(i.historyDaily, 3, 4);
  const paceThis = rhe(disc, de);
  const paceHist = q > 0 && median ? rhe(median.n, median.d) : null;
  // expected a day = (wThis × pace + wHist × history) ÷ 10, rounded once
  const wt = BigInt(w.wThis), wh = BigInt(w.wHist);
  const expected = q > 0 && median
    ? rhe(wt * disc * median.d + wh * median.n * de, 10n * de * median.d)
    : paceThis;
  const remaining = Math.max(0, expected * daysLeft - i.discretionaryToday);
  const forecast = i.spent + i.billsToCome + remaining;
  const lowPerDay = q > 0 && q25 ? rhe(q25.n, q25.d) : null, highPerDay = q > 0 && q75 ? rhe(q75.n, q75.d) : null;
  const rangeFor = (perDay: Pence | null) => (perDay === null ? null : i.spent + i.billsToCome + Math.max(0, perDay * daysLeft - i.discretionaryToday));
  const degenerate = daysLeft >= 2 && paceThis > 0 && forecast === i.spent + i.billsToCome;
  return { ...out, paceThis, paceHist, expectedPerDay: expected, remaining, forecast, low: rangeFor(lowPerDay), high: rangeFor(highPerDay), lowPerDay, highPerDay, degenerate };
}

// ---- budget measures built on the forecast (BUD-03, BUD-04, BUD-07) --------------------------------------------------------------------

export type BudgetStatus = "early" | "on_track" | "tight" | "over";

/** BUD-04: Over if the forecast is above the budget, Tight above 95% of it, otherwise On track. Days 1–6: only "Early days" unless spend is >10% over plan. */
export function budgetStatus(f: Forecast, budget: Pence, plan: Pence): BudgetStatus {
  if (f.closed) return f.spent > budget ? "over" : "on_track";
  if (f.dom <= 6 && !(plan > 0 && f.spent * 10 > plan * 11)) return "early";
  if (!f.available) return f.spent > budget ? "over" : "on_track";
  if (f.forecast > budget) return "over";
  if (f.forecast * 100 > budget * 95) return "tight";
  return "on_track";
}

/** BUD-03: plan to date = recurring expenses scheduled on or before today + (budget − all recurring scheduled this month) × days elapsed ÷ days in month. */
export function planToDate(budget: Pence, recurringUpToToday: Pence, recurringAllMonth: Pence, dayOfMonthToday: number, dim: number, straightLine = false): Pence {
  if (straightLine) return rhe(BigInt(budget) * BigInt(dayOfMonthToday), BigInt(dim));
  const rest = Math.max(0, budget - recurringAllMonth);
  return recurringUpToToday + rhe(BigInt(rest) * BigInt(dayOfMonthToday), BigInt(dim));
}

/** BUD-04: (budget − spent − bills to come) ÷ days left including today, floored at £0. */
export function safeToSpend(budget: Pence, f: Pick<Forecast, "spent" | "billsToCome" | "daysLeft">): Pence {
  if (f.daysLeft <= 0) return 0;
  const left = budget - f.spent - f.billsToCome;
  return left <= 0 ? 0 : rhe(BigInt(left), BigInt(f.daysLeft));
}

export interface WhatIf { key: "low" | "safe" | "usual" | "high"; perDay: Pence; monthEnd: Pence; diff: Pence }
/** BUD-07: where the month ends at four daily spends: a lower and a higher round figure, the stay-on-budget amount (safe to spend) and your usual pace. */
export function whatIfs(budget: Pence, f: Forecast, discretionaryToday: Pence): WhatIf[] {
  const usual = f.expectedPerDay;
  const safe = safeToSpend(budget, f);
  const tenth = (n: Pence) => Math.max(1000, Math.round(n / 1000) * 1000);
  const rows: { key: WhatIf["key"]; perDay: Pence }[] = [
    { key: "low", perDay: tenth(Math.round(usual * 0.75)) }, { key: "safe", perDay: safe }, { key: "usual", perDay: usual }, { key: "high", perDay: tenth(Math.round(usual * 1.25)) },
  ];
  return rows.map((r) => {
    const end = f.spent + f.billsToCome + Math.max(0, r.perDay * f.daysLeft - discretionaryToday);
    return { ...r, monthEnd: end, diff: budget - end };
  });
}

/**
 * CASH-06: where Available cash is heading by month end = available now − what the forecast says is still to be spent − recurring transfers
 * out of the pool + recurring income into it. The spend side is the forecast engine's own `billsToCome` and `remaining`; nothing is re-projected.
 */
export function projectedClose(availableNow: Pence, f: Pick<Forecast, "available" | "closed" | "billsToCome" | "remaining">, transfersOut: Pence, incomeIn: Pence): Pence | null {
  if (!f.available || f.closed) return null;
  return availableNow - f.billsToCome - f.remaining - transfersOut + incomeIn;
}
