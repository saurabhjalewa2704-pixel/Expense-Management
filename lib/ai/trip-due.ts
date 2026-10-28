import { londonDateOf, type ISODate } from "@/lib/dates";
import { tripClock } from "@/lib/tripMath";
import type { Trip } from "@/lib/types";

export const TRIP_RUNS_PER_DAY = 10;
export const DEBOUNCE_MS = 10 * 60_000;

export interface DueInput { latest: { created_at: string } | null; changedAt: string | null; trip: Pick<Trip, "start_on" | "end_on">; today: ISODate; now: Date; hourLondon: number; runsToday: number }

/**
 * TRIP-08: when a trip's insights are due. Each morning from 07:00 London while the trip runs, after an edit to the trip or anything on it
 * (debounced by 10 minutes), and once more the day after it ends (the wrap-up). Never more than ten runs a day.
 */
export function tripInsightsDue(i: DueInput): { due: boolean; reason: string } {
  if (i.runsToday >= TRIP_RUNS_PER_DAY) return { due: false, reason: "daily limit" };
  if (!i.latest) return { due: true, reason: "first run" };
  const made = new Date(i.latest.created_at);
  const c = tripClock(i.trip, i.today);
  const madeOn = londonDateOf(made);
  if (c.phase === "after" && madeOn <= i.trip.end_on) return { due: true, reason: "wrap-up" };                      // the first run after the trip has ended
  if (i.changedAt && new Date(i.changedAt) > made) return i.now.getTime() - made.getTime() >= DEBOUNCE_MS ? { due: true, reason: "edited" } : { due: false, reason: "debounced" };
  if (c.phase === "during" && madeOn < i.today && i.hourLondon >= 7) return { due: true, reason: "morning" };
  return { due: false, reason: "fresh" };
}

