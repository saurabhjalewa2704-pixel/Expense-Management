// TRIP-07: the numbers on a trip's overview, as integer pence (Appendix A.2 is the worked example).
import { diffDays, addDays, type ISODate } from "@/lib/dates";
import type { Pence } from "@/lib/money";

/** Integer division rounded half-up (n may be negative). */
const roundDiv = (n: number, d: number): number => (d === 0 ? 0 : Math.sign(n) * Math.floor((Math.abs(n) * 2 + d) / (2 * d)));

export interface TripDates { start_on: ISODate; end_on: ISODate }
export const tripLength = (t: TripDates): number => diffDays(t.end_on, t.start_on) + 1;

export type TripPhase = "before" | "during" | "after";
export interface TripClock { phase: TripPhase; /** 1-based day of the trip while it runs (0 before, length after). */ day: number; length: number; daysToStart: number; daysSinceEnd: number; daysLeftInclToday: number }
export function tripClock(t: TripDates, today: ISODate): TripClock {
  const length = tripLength(t);
  if (today < t.start_on) return { phase: "before", day: 0, length, daysToStart: diffDays(t.start_on, today), daysSinceEnd: 0, daysLeftInclToday: length };
  if (today > t.end_on) return { phase: "after", day: length, length, daysToStart: 0, daysSinceEnd: diffDays(today, t.end_on), daysLeftInclToday: 0 };
  const day = diffDays(today, t.start_on) + 1;
  return { phase: "during", day, length, daysToStart: 0, daysSinceEnd: 0, daysLeftInclToday: length - day + 1 };
}

/** What shows on Home (TRIP-01): during the trip, up to 14 days before it starts, and for 7 days after it ends. */
export type HomeTripKind = "now" | "upcoming" | "wrapup" | null;
export function homeTripKind(t: TripDates, today: ISODate): HomeTripKind {
  const c = tripClock(t, today);
  if (c.phase === "during") return "now";
  if (c.phase === "before" && c.daysToStart <= 14) return "upcoming";
  if (c.phase === "after" && c.daysSinceEnd <= 7) return "wrapup";
  return null;
}

export interface TripFigures {
  booked: Pence; onTrip: Pence; spent: Pence;
  budget: Pence | null;
  left: Pence | null;
  /** (budget − booked) ÷ trip days. */
  planPerDay: Pence | null;
  /** On-trip spending ÷ days elapsed. */
  actualPerDay: Pence;
  /** (budget − spent) ÷ days left including today, during the trip. */
  allowance: Pence | null;
  /** spent + actual per day × days still to come. */
  projected: Pence;
  over: boolean;
}
export function tripFigures(t: TripDates, budget: Pence | null, booked: Pence, onTrip: Pence, today: ISODate): TripFigures {
  const c = tripClock(t, today);
  const spent = booked + onTrip;
  const elapsed = c.phase === "before" ? 0 : c.phase === "after" ? c.length : c.day;
  const actualPerDay = elapsed > 0 ? roundDiv(onTrip, elapsed) : 0;
  const left = budget === null ? null : budget - spent;
  const toCome = c.phase === "during" ? c.length - c.day : c.phase === "before" ? c.length : 0;
  return {
    booked, onTrip, spent, budget, left,
    planPerDay: budget === null ? null : roundDiv(budget - booked, c.length),
    actualPerDay,
    allowance: budget !== null && c.phase === "during" ? roundDiv(budget - spent, c.daysLeftInclToday) : null,
    projected: c.phase === "after" ? spent : spent + actualPerDay * toCome,
    over: budget !== null && spent > budget,
  };
}

/** The days of a trip as ISO dates, for the timeline and the daily chart. */
export const tripDays = (t: TripDates): ISODate[] => Array.from({ length: tripLength(t) }, (_, i) => addDays(t.start_on, i));

/** EC-T16: a one-day trip hides the daily chart; one over 60 days draws weekly bars. */
export const dailyChartMode = (t: TripDates): "hidden" | "daily" | "weekly" => (tripLength(t) <= 1 ? "hidden" : tripLength(t) > 60 ? "weekly" : "daily");
