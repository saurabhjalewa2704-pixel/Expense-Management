"use client";
import { diffDays, formatShort, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { useTripByCategory, useTripByDay, useTripsOverview } from "@/lib/queries/hooks";
import { roundDiv, tripClock, tripFigures } from "@/lib/tripMath";
import type { Trip, TripSummary } from "@/lib/types";

/** TRIP-08: the wrap-up at the top of a finished trip: total, a day, against budget, top three categories, cheapest and priciest day, and the other trips. */
export function TripWrapUp({ trip, summary, today }: { trip: Trip; summary: TripSummary | null | undefined; today: ISODate }) {
  const cats = useTripByCategory(trip.id, "parent").data;
  const days = useTripByDay(trip.id).data;
  const overview = useTripsOverview(today).data;
  const c = tripClock(trip, today);
  if (c.phase !== "after" || c.daysSinceEnd < 1 || !summary) return null;
  const figs = tripFigures(trip, trip.budget_pence, summary.booked_pence, summary.on_trip_pence, today);
  const spentDays = (days ?? []).filter((d) => d.total_pence > 0);
  const priciest = [...spentDays].sort((a, b) => b.total_pence - a.total_pence)[0];
  const cheapest = [...spentDays].sort((a, b) => a.total_pence - b.total_pence)[0];
  const top = [...(cats ?? [])].sort((a, b) => b.total_pence - a.total_pence).slice(0, 3);
  const perDay = roundDiv(figs.onTrip, c.length);
  const others = (overview ?? []).filter((o) => o.trip_id !== trip.id && o.end_on < today && o.on_trip_pence > 0).map((o) => ({ ...o, perDay: roundDiv(o.on_trip_pence, diffDays(o.end_on, o.start_on) + 1) }));
  const dearer = others.filter((o) => o.perDay >= perDay).sort((a, b) => b.end_on.localeCompare(a.end_on))[0];
  return (
    <section className="card" style={{ marginTop: 16 }} data-testid="trip-wrapup">
      <div className="eyebrow">Wrap-up</div>
      <div className="big num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.035em", marginTop: 4 }} data-testid="wrapup-total">{formatGBP(figs.spent)}</div>
      <div className="sub" style={{ marginTop: 2 }}>
        in total · {formatGBP(perDay)} a day on the trip{figs.budget !== null ? ` · ${figs.over ? `${formatGBP(-(figs.left ?? 0))} over` : `${formatGBP(figs.left ?? 0)} under`} the ${formatGBP(figs.budget, { whole: figs.budget % 100 === 0 })} budget` : ""}
      </div>
      {top.length > 0 && <div className="sub" style={{ marginTop: 10 }}>Most of it went on {top.map((t) => `${t.name} (${formatGBP(t.total_pence)})`).join(", ")}.</div>}
      {priciest && cheapest && priciest.day !== cheapest.day && (
        <div className="sub" style={{ marginTop: 6 }}>Priciest day: {formatShort(priciest.day)}, {formatGBP(priciest.total_pence)}. Best day: {formatShort(cheapest.day)}, {formatGBP(cheapest.total_pence)}.</div>
      )}
      {others.length > 0 && (
        <div className="sub" style={{ marginTop: 6 }}>{dearer ? `Cheaper per day than ${dearer.name}, which came to ${formatGBP(dearer.perDay)} a day.` : "Your priciest trip per day so far."}</div>
      )}
    </section>
  );
}
