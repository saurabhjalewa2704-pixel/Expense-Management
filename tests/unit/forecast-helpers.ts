// Builders for the forecasting-engine tests: a synthetic user with a daily spending pattern, in the shape of the fixtures' input files.
import { addDays, weekdayIndex } from "@/lib/dates";
import type { DayFact, ForecastInput, ISO } from "@/lib/forecast/types";

export const day = (d: ISO, v: number, o: Partial<DayFact> = {}): DayFact => ({ d, discretionary: v, by_cat: {}, recurring: 0, trip: 0, oneoff: 0, has_activity: true, confirmed_zero: false, trip_day: false, ...o });

/** A small deterministic generator, so a failing case can be reproduced. */
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

export function series(from: ISO, to: ISO, f: (d: ISO, i: number) => number, o: (d: ISO, i: number) => Partial<DayFact> = () => ({})): DayFact[] {
  const out: DayFact[] = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) out.push(day(d, f(d, i), o(d, i)));
  return out;
}

export function input(o: Partial<ForecastInput> & { today: ISO; track: ISO; days: DayFact[] }): ForecastInput {
  const month = `${o.today.slice(0, 8)}01`;
  const spent = o.spent_month_to_date ?? o.days.filter((x) => x.d >= month && x.d <= o.today).reduce((a, x) => a + x.discretionary + x.oneoff + x.recurring + x.trip, 0);
  const { track, ...rest } = o;
  return { spent_by_cat: {}, scheduled: [], trips: [], categories: [], params: {}, ...rest, tracking_started_on: track, spent_month_to_date: spent };
}

/** Five synthetic spending styles (§6.14.18 test 3). */
export const STYLES = {
  flat: (_d: ISO, _i: number, r: () => number) => Math.round(6000 * (0.8 + 0.4 * r())),
  weekend: (d: ISO, _i: number, r: () => number) => Math.round((weekdayIndex(d) >= 5 ? 12000 : 4500) * (0.85 + 0.3 * r())),
  payday: (d: ISO, _i: number, r: () => number) => Math.round((Number(d.slice(8)) >= 21 ? 9000 : 5000) * (0.85 + 0.3 * r())),
  lumpy: (_d: ISO, _i: number, r: () => number) => (r() < 0.12 ? Math.round(30000 + 20000 * r()) : Math.round(3000 * r())),
  sparse: (_d: ISO, _i: number, r: () => number) => (r() < 0.25 ? Math.round(8000 + 6000 * r()) : 0),
  holiday: (_d: ISO, _i: number, r: () => number) => Math.round(5500 * (0.7 + 0.6 * r())),
};
