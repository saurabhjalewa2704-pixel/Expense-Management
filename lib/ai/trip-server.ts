import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { londonParts, addDays, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { sendPush } from "@/lib/push-send";
import { roundDiv, tripClock } from "@/lib/tripMath";
import type { Trip } from "@/lib/types";
import { generateTripInsights, type InsightRunRow } from "./generate";
import { configuredWriter, serverToday, tokenCap, tokensUsedThisMonth } from "./server";

import { TRIP_RUNS_PER_DAY, tripInsightsDue } from "./trip-due";


/** The newest run for a trip, regenerated first when it is due. Runs as the signed-in user (RLS applies) or as the service role from the cron. */
export async function ensureTripInsights(db: SupabaseClient, userId: string, tripId: string, o: { today?: ISODate; now?: Date; force?: boolean } = {}): Promise<{ run: InsightRunRow | null; generated: boolean; reason: string }> {
  const today = o.today ?? serverToday(), now = o.now ?? new Date();
  const { data: trip } = await db.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (!trip) return { run: null, generated: false, reason: "no such trip" };
  const { data: latestRows } = await db.from("insight_runs").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(1);
  const latest = ((latestRows ?? [])[0] as InsightRunRow | undefined) ?? null;
  const { data: changed } = await db.rpc("trip_changed_at", { p_trip: tripId });
  const since = new Date(now); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("insight_runs").select("id", { count: "exact", head: true }).eq("trip_id", tripId).gte("created_at", since.toISOString());
  const d = tripInsightsDue({ latest, changedAt: (changed as string | null) ?? null, trip: trip as Trip, today, now, hourLondon: londonParts(now).hour, runsToday: count ?? 0 });
  if (!d.due && !(o.force && (count ?? 0) < TRIP_RUNS_PER_DAY)) return { run: latest, generated: false, reason: d.reason };
  const run = await generateTripInsights({
    db, userId, tripId, today, writer: configuredWriter(), usedTokens: await tokensUsedThisMonth(db, userId, today), tokenCap: tokenCap(),
    log: (message, data) => console.warn(`[trip-insights] ${message}`, data ?? ""),
  });
  return { run, generated: true, reason: d.reason };
}

/** "USA wrap-up ready", once, the day after the trip ends. Uses the reminders permission; switch off in Settings → Reminders. */
export async function sendWrapUp(db: SupabaseClient, userId: string, trip: Trip, today: ISODate): Promise<"sent" | "skipped"> {
  const c = tripClock(trip, today);
  if (c.phase !== "after" || c.daysSinceEnd < 1) return "skipped";
  const { data: fresh } = await db.from("trips").select("wrapup_sent_at").eq("id", trip.id).single();
  if (fresh && (fresh as { wrapup_sent_at: string | null }).wrapup_sent_at) return "skipped";
  const { data: prof } = await db.from("profiles").select("trip_notify").eq("id", userId).single();
  if (prof && (prof as { trip_notify: boolean }).trip_notify === false) return "skipped";
  const { data: s } = await db.rpc("trip_summary", { p_trip: trip.id, p_as_of: today });
  const sum = (s as { spent_pence: number; days: number }[] | null)?.[0];
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const sub of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const r = await sendPush(sub, {
      title: `${trip.name} wrap-up ready`, tag: `trip-wrapup-${trip.id}`, url: `/trips/${trip.id}`,
      body: sum ? `${formatGBP(sum.spent_pence)} in total · ${formatGBP(roundDiv(sum.spent_pence, sum.days))} a day` : "See how the trip went.",
    });
    if (r.ok) sent++;
    else if (r.gone) await db.from("push_subscriptions").delete().eq("id", sub.id);
  }
  if (sent > 0 || !subs?.length) await db.from("trips").update({ wrapup_sent_at: new Date().toISOString() }).eq("id", trip.id);
  return sent > 0 ? "sent" : "skipped";
}

export { addDays };
