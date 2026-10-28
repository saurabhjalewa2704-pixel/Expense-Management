"use client";
import { diffDays, formatShort, type ISODate } from "@/lib/dates";
import { formatGBP, type Pence } from "@/lib/money";
import { tripClock, tripDays, tripLength, type TripFigures } from "@/lib/tripMath";
import { countryOf } from "@/lib/countries";
import type { Trip, TripStop } from "@/lib/types";

/** "Sat 6 – Sat 20 Mar" (same month) or "Sat 27 Mar – Sun 4 Apr". */
export function rangeLabel(start: ISODate, end: ISODate): string {
  if (start === end) return formatShort(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${sameMonth ? formatShort(start).replace(/ [A-Za-z]{3}$/, "") : formatShort(start)} – ${formatShort(end)}`;
}
export const stopsLabel = (stops: readonly Pick<TripStop, "name">[]) => stops.map((s) => s.name).join(" · ");
export const placeOf = (t: Pick<Trip, "country_code" | "name">) => countryOf(t.country_code)?.name ?? "";
/** Nights between the start and end dates. */
export const nightsOf = (t: Pick<Trip, "start_on" | "end_on">) => diffDays(t.end_on, t.start_on);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The stop a date falls in, if any. */
export const stopOn = (stops: readonly TripStop[], d: ISODate) => stops.find((s) => s.start_on <= d && d <= s.end_on);

/** TRIP-02: one segment per day, past days filled, a "now" marker, and stop names under their spans. */
export function TripTimeline({ trip, stops, today }: { trip: Pick<Trip, "start_on" | "end_on">; stops: readonly TripStop[]; today: ISODate }) {
  const days = tripDays(trip), c = tripClock(trip, today);
  const spans: { name: string; n: number }[] = [];
  for (const d of days) {
    const name = stopOn(stops, d)?.name ?? "";
    const last = spans.at(-1);
    if (last && last.name === name) last.n += 1; else spans.push({ name, n: 1 });
  }
  const done = c.phase === "after" ? days.length : c.phase === "before" ? 0 : c.day - 1;
  const now = c.phase === "during" ? ((c.day - 0.5) / c.length) * 100 : null;
  return (
    <div className="timeline" data-testid="trip-timeline" aria-label={c.phase === "during" ? `Day ${c.day} of ${c.length}` : `${c.length} days`}>
      <div className="segs">{days.map((d, i) => <i key={d} className={i < done ? "done" : ""} style={{ flex: 1 }} />)}</div>
      {now !== null && <span className="now" style={{ left: `calc(${now.toFixed(2)}% - 1.5px)` }} />}
      {stops.length > 0 && <div className="stops">{spans.map((s, i) => <span key={i} style={{ flex: s.n }}>{s.name}</span>)}</div>}
    </div>
  );
}

/** The two-part bar: booked before, then on the trip (TRIP-07). */
export function BudgetBar({ figs }: { figs: Pick<TripFigures, "booked" | "onTrip" | "budget"> }) {
  const total = figs.budget ?? Math.max(figs.booked + figs.onTrip, 1);
  const w = (n: Pence) => `${Math.min(100, Math.max(0, (n * 100) / total)).toFixed(1)}%`;
  return (
    <>
      <div className="bud" aria-hidden><i style={{ width: w(figs.booked), background: "var(--ink-2)" }} /><i style={{ width: w(figs.onTrip), background: "var(--ink)" }} /></div>
      <div className="bud-legend"><span><i style={{ background: "var(--ink-2)" }} />Booked before · {formatGBP(figs.booked)}</span><span><i style={{ background: "var(--ink)" }} />On the trip · {formatGBP(figs.onTrip)}</span></div>
    </>
  );
}

export { tripLength };
