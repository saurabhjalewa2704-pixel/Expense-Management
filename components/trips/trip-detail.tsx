"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { UI } from "@/lib/icons";
import { useToday, useTripStops, useTrips, useTripTxns } from "@/lib/queries/hooks";
import { tripClock } from "@/lib/tripMath";
import { BookingsSheet } from "./bookings-sheet";
import { rangeLabel, plural, stopOn, stopsLabel } from "./shared";
import { TripExpenses } from "./trip-expenses";
import { TripOverview } from "./trip-overview";

/** TRIP-07: header, then Overview · Expenses. `?tab=expenses` and `?bookings=1` (just after creating a trip) are honoured. */
export function TripDetail({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const today = useToday();
  const trips = useTrips();
  const stops = useTripStops(id).data ?? [];
  const txns = useTripTxns(id).data;
  const trip = (trips.data ?? []).find((t) => t.id === id);
  const [tab, setTab] = useState<"overview" | "expenses">(sp.get("tab") === "expenses" ? "expenses" : "overview");
  const [bookings, setBookings] = useState(sp.get("bookings") === "1");

  if (!trip) {
    return (
      <div className="scroll"><div className="navbar"><Link className="back" href="/trips"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Trips</Link></div>
        {trips.isLoading ? <div className="skeleton" style={{ height: 200, marginTop: 20 }} aria-busy /> : <p className="sub" style={{ margin: "24px 4px" }} data-testid="trip-missing">This trip no longer exists.</p>}
      </div>
    );
  }
  const c = tripClock(trip, today);
  const here = c.phase === "during" ? stopOn(stops, today)?.name : undefined;
  const label = c.phase === "during" ? `Day ${c.day} of ${c.length}${here ? ` · ${here}` : ""}` : c.phase === "before" ? `In ${plural(c.daysToStart, "day")}` : "Wrap-up";
  const closeBookings = (o: boolean) => { setBookings(o); if (!o && sp.get("bookings")) router.replace(`/trips/${id}`); };
  const count = txns?.length;

  return (
    <div className="scroll" data-testid="trip-detail" style={{ paddingBottom: 48 }}>
      <div className="navbar" style={{ justifyContent: "space-between" }}>
        <Link className="back" href="/trips"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Trips</Link>
        <Link className="icon-btn" href={`/trips/${id}/edit`} aria-label="Edit trip" data-testid="trip-edit"><UI.Pencil size={18} strokeWidth={1.75} aria-hidden /></Link>
      </div>
      <div className="tr-head" style={{ marginTop: 6 }}>
        <span className="lbl" data-testid="trip-label"><i />{label}</span>
        <h1 className="tr-name" style={{ fontSize: 34 }} data-testid="trip-title">{trip.name}</h1>
        <div className="tr-sub">{[stopsLabel(stops), rangeLabel(trip.start_on, trip.end_on)].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="view-seg" role="tablist" aria-label="Trip" style={{ marginTop: 16 }}>
        <span role="tab" tabIndex={0} aria-selected={tab === "overview"} className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")} onKeyDown={(e) => e.key === "Enter" && setTab("overview")} data-testid="tab-overview">Overview</span>
        <span role="tab" tabIndex={0} aria-selected={tab === "expenses"} className={tab === "expenses" ? "on" : ""} onClick={() => setTab("expenses")} onKeyDown={(e) => e.key === "Enter" && setTab("expenses")} data-testid="tab-expenses">Expenses{count !== undefined ? ` · ${count}` : ""}</span>
      </div>
      {tab === "overview" ? <TripOverview trip={trip} stops={stops} today={today} /> : <TripExpenses trip={trip} stops={stops} today={today} />}
      <BookingsSheet trip={trip} open={bookings} onOpenChange={closeBookings} />
    </div>
  );
}
