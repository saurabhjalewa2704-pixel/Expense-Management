"use client";
import Link from "next/link";
import { formatGBP } from "@/lib/money";
import { UI } from "@/lib/icons";
import { useToday, useTripStops, useTrips, useTripsOverview } from "@/lib/queries/hooks";
import { homeTripKind, tripClock, tripFigures } from "@/lib/tripMath";
import { plural, stopOn } from "@/components/trips/shared";

/**
 * TRIP-01: between the hero and the pace card. During a trip: day N of M, the stop, what is left to spend today and spent vs budget.
 * Up to 14 days before: "USA in 9 days" (with "Add bookings" until one is attached). For 7 days after: "USA wrap-up ready". Otherwise hidden.
 */
export function TripCard() {
  const today = useToday();
  const trips = useTrips().data;
  const stops = useTripStops().data;
  const overview = useTripsOverview(today).data;
  if (!trips) return null;
  const rank = { now: 0, upcoming: 1, wrapup: 2 } as const;
  const shown = trips.map((t) => ({ t, kind: homeTripKind(t, today) })).filter((x): x is { t: typeof x.t; kind: "now" | "upcoming" | "wrapup" } => !!x.kind)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.t.start_on.localeCompare(b.t.start_on))[0];
  if (!shown) return null;
  const { t, kind } = shown;
  const row = overview?.find((r) => r.trip_id === t.id);
  const c = tripClock(t, today);
  const figs = tripFigures(t, t.budget_pence, row?.booked_pence ?? 0, row?.on_trip_pence ?? 0, today);
  const here = stopOn((stops ?? []).filter((s) => s.trip_id === t.id), today)?.name;

  if (kind === "now") {
    return (
      <Link href={`/trips/${t.id}`} className="tr-hero" style={{ display: "block", padding: "16px 16px 16px" }} data-testid="home-trip-card" data-kind="now">
        <div className="tr-head row-between"><span className="lbl"><i />On a trip · day {c.day} of {c.length}</span><UI.ChevronRight size={16} strokeWidth={2} aria-hidden className="faint" /></div>
        <div className="tr-name" style={{ marginTop: 6, fontSize: 24 }}>{t.name}</div>
        <div className="row-between" style={{ alignItems: "flex-start", gap: 12, marginTop: 6 }}>
          <div className="sub" style={{ fontSize: 15, lineHeight: 1.35 }}>
            {here ? `${here} today` : "Today"}
            {figs.allowance !== null && <> · <span data-testid="home-trip-allowance" style={{ color: figs.allowance < 0 ? "var(--caution)" : undefined }}>{formatGBP(Math.max(0, figs.allowance))} a day</span> {figs.over ? "over budget" : "left to spend"}</>}
          </div>
          <div style={{ textAlign: "right", flex: "none" }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }} data-testid="home-trip-spent">{formatGBP(figs.spent)}</div>
            <div className="sub" style={{ fontSize: 15 }}>{figs.budget !== null ? `of ${formatGBP(figs.budget, { whole: figs.budget % 100 === 0 })}` : "spent so far"}</div>
          </div>
        </div>
      </Link>
    );
  }
  if (kind === "upcoming") {
    const noBookings = (row?.booked_pence ?? 0) === 0;
    return (
      <div className="card" data-testid="home-trip-card" data-kind="upcoming" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <Link href={`/trips/${t.id}`} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <UI.Plane size={18} strokeWidth={1.75} aria-hidden className="faint" />
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 500 }}>{t.name} in {plural(c.daysToStart, "day")}</div>
            {row && !noBookings && <div className="sub" style={{ marginTop: 2 }}>{formatGBP(row.booked_pence)} booked so far</div>}</div>
        </Link>
        {noBookings && <Link href={`/trips/${t.id}?bookings=1`} className="chip soft" data-testid="home-trip-bookings" style={{ height: 34, fontSize: 13 }}>Add bookings</Link>}
      </div>
    );
  }
  return (
    <Link href={`/trips/${t.id}`} className="card" data-testid="home-trip-card" data-kind="wrapup" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
      <UI.Sparkles size={18} strokeWidth={1.75} aria-hidden className="faint" />
      <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 500 }}>{t.name} wrap-up ready</div><div className="sub num" style={{ marginTop: 2 }}>{formatGBP(figs.spent)} in total</div></div>
      <UI.ChevronRight size={16} strokeWidth={2} aria-hidden className="faint" />
    </Link>
  );
}
