"use client";
import Link from "next/link";
import { useMemo } from "react";
import { diffDays, formatMonthShort, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { flagOf } from "@/lib/countries";
import { formatGBP } from "@/lib/money";
import { useToday, useTripStops, useTrips, useTripsOverview } from "@/lib/queries/hooks";
import { tripClock, tripFigures } from "@/lib/tripMath";
import type { Trip, TripOverviewRow, TripStop } from "@/lib/types";
import { BudgetBar, nightsOf, placeOf, plural, rangeLabel, stopsLabel, TripTimeline } from "./shared";

/** TRIP-02: the current (or next) trip as a hero card, then upcoming and past trips. */
export function TripsScreen() {
  const today = useToday();
  const trips = useTrips();
  const stops = useTripStops().data;
  const overview = useTripsOverview(today).data;
  const rows = useMemo(() => new Map((overview ?? []).map((r) => [r.trip_id, r])), [overview]);
  const list = trips.data ?? [];
  const hero = list.find((t) => t.start_on <= today && today <= t.end_on) ?? [...list].filter((t) => t.start_on > today).sort((a, b) => a.start_on.localeCompare(b.start_on))[0];
  const upcoming = list.filter((t) => t.start_on > today && t.id !== hero?.id).sort((a, b) => a.start_on.localeCompare(b.start_on));
  const past = list.filter((t) => t.end_on < today).sort((a, b) => b.start_on.localeCompare(a.start_on));
  const empty = !trips.isLoading && list.length === 0;
  const stopsOf = (t: Trip) => (stops ?? []).filter((s) => s.trip_id === t.id);

  return (
    <div className="scroll" data-testid="trips">
      <div className="navbar" style={{ justifyContent: "space-between" }}>
        <Link className="back" href="/settings"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Settings</Link>
        <Link className="icon-btn" href="/trips/new" aria-label="New trip" data-testid="trip-new"><UI.Plus size={20} strokeWidth={2} aria-hidden /></Link>
      </div>
      <h1 className="large-title">Trips</h1>
      <div className="sub" style={{ marginTop: 6 }}>Each trip keeps its own spending, budget and insights</div>

      {empty && (
        <div className="card" style={{ marginTop: 16, textAlign: "center", padding: "28px 16px" }} data-testid="trips-empty">
          <div className="headline">Plan a trip to keep its spending in one place</div>
          <p className="sub" style={{ marginTop: 6 }}>Add the dates and Sterling tags what you spend, converts foreign currency and tells you how the trip is going.</p>
          <Link className="btn" href="/trips/new" style={{ marginTop: 16, display: "inline-flex", padding: "0 24px", height: 46 }}>New trip</Link>
        </div>
      )}

      {hero && <Hero trip={hero} stops={stopsOf(hero)} row={rows.get(hero.id)} today={today} />}

      {upcoming.length > 0 && (
        <section data-testid="trips-upcoming">
          <div className="section-h"><h2>Upcoming</h2></div>
          <div className="list">{upcoming.map((t) => <TripRow key={t.id} trip={t} row={rows.get(t.id)} today={today} />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section data-testid="trips-past">
          <div className="section-h"><h2>Past trips</h2></div>
          <div className="list">{past.map((t) => <TripRow key={t.id} trip={t} row={rows.get(t.id)} today={today} />)}</div>
        </section>
      )}
    </div>
  );
}

function Hero({ trip, stops, row, today }: { trip: Trip; stops: TripStop[]; row?: TripOverviewRow; today: ISODate }) {
  const c = tripClock(trip, today);
  const figs = tripFigures(trip, trip.budget_pence, row?.booked_pence ?? 0, row?.on_trip_pence ?? 0, today);
  const label = c.phase === "during" ? `Now · day ${c.day} of ${c.length}` : `In ${plural(c.daysToStart, "day")}`;
  return (
    <Link href={`/trips/${trip.id}`} className="tr-hero" style={{ display: "block", marginTop: 16 }} data-testid="trip-hero">
      <div className="tr-head"><span className="lbl"><i />{label}</span></div>
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="tr-name">{trip.name}</div>
        {trip.currency !== "GBP" && <span className="cur-chip" style={{ marginTop: 4 }}>{flagOf(trip.country_code)} {trip.currency}</span>}
      </div>
      <div className="tr-sub">{[stopsLabel(stops), rangeLabel(trip.start_on, trip.end_on)].filter(Boolean).join(" · ")}</div>
      <TripTimeline trip={trip} stops={stops} today={today} />
      <div className="tr-figs">
        <div><div className="big num" data-testid="trip-hero-spent">{formatGBP(figs.spent)}</div><div className="of">{figs.budget !== null ? `spent of ${formatGBP(figs.budget, { whole: figs.budget % 100 === 0 })} budget` : "spent so far"}</div></div>
        {figs.left !== null && <div style={{ textAlign: "right" }}><div className="num" style={{ fontSize: 17, fontWeight: 600, color: figs.over ? "var(--caution)" : undefined }}>{formatGBP(Math.abs(figs.left))}</div><div className="of">{figs.over ? "over" : "left"}</div></div>}
      </div>
      <BudgetBar figs={figs} />
    </Link>
  );
}

function TripRow({ trip, row, today }: { trip: Trip; row?: TripOverviewRow; today: ISODate }) {
  const nights = nightsOf(trip);
  const place = placeOf(trip);
  const upcoming = trip.start_on > today;
  return (
    <Link href={`/trips/${trip.id}`} className="past-trip" data-testid="trip-row">
      <div className="tile" aria-hidden><UI.Plane size={18} strokeWidth={1.75} /></div>
      <div className="row-main" style={{ minWidth: 0 }}>
        <div className="row-t">{trip.name}</div>
        <div className="row-s">{[place, plural(nights, "night"), upcoming ? `in ${plural(diffDays(trip.start_on, today), "day")}` : `${formatMonthShort(trip.start_on)} ${trip.start_on.slice(0, 4)}`].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="num" style={{ fontWeight: 500 }}>{formatGBP(row?.spent_pence ?? 0)}</span>
    </Link>
  );
}
