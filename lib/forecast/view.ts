// A flat reading of a `Forecast` for the screens: what to show, in the words the screens use. Nothing here calculates a forecast.
import type { Forecast } from "./types";

export interface FcView {
  month: string;
  available: boolean;                // there is a point forecast
  closed: boolean;                   // the month is over: `forecast` is the actual
  message: string | null;
  regime: Forecast["regime"];
  confidence: Forecast["confidence"];
  spent: number;
  scheduled: number;                 // bills and other known amounts still to come
  restOfMonth: number;
  trips: number;
  extras: number;
  floor: number;
  /** The point, or the floor when there is no point. */
  forecast: number;
  point: number | null;
  low: number | null; high: number | null;
  daysLeft: number;
  daysInMonth: number;
  dom: number;
  expectedPerDay: number;            // rest of month over the home-spending days left
  weight: number;
  loggedToday: number;
}

export function fcView(f: Forecast, today: string): FcView {
  const m = f.detail.monthStart;
  const dim = Number(f.detail.monthEnd.slice(8));
  const closed = f.regime === "actual";
  const dom = closed ? dim : today < m ? 0 : Number(today.slice(8));
  const homeDays = f.perDay.length;
  return {
    month: m, available: f.point !== null, closed, message: f.message ?? null, regime: f.regime, confidence: f.confidence,
    spent: f.components.spent, scheduled: f.components.scheduled, restOfMonth: f.components.restOfMonth, trips: f.components.trips, extras: f.components.extras,
    floor: f.floor, forecast: f.point ?? f.floor, point: f.point, low: f.low, high: f.high, daysLeft: f.daysLeft, daysInMonth: dim, dom,
    expectedPerDay: homeDays > 0 ? Math.round(f.components.restOfMonth / homeDays) : 0, weight: f.evidence.weightThisMonth, loggedToday: f.evidence.loggedToday,
  };
}

/** §6.14.11 display rules: High exact, Medium to the nearest £10, Low to the nearest £50. */
export function displayPoint(point: number, confidence: Forecast["confidence"]): { pence: number; approx: boolean } {
  if (confidence === "High") return { pence: point, approx: false };
  const step = confidence === "Medium" ? 1000 : 5000;
  return { pence: Math.round(point / step) * step, approx: true };
}
