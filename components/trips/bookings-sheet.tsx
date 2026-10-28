"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { attachToTrip } from "@/app/actions/trips";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { mentionsTrip } from "@/lib/countries";
import { formatDayMonth, formatShort } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useTripCandidates, useTripStops } from "@/lib/queries/hooks";
import type { Trip, TripCandidate } from "@/lib/types";
import { plural } from "./shared";

const NO_STOPS: never[] = [];
const iconFor = (c: TripCandidate) => (/hotel|stay|lodg/i.test(c.category_name) ? "bed-double" : /insur|visa/i.test(c.category_name) ? "shield-check" : "plane");
const dateLabel = (d: string, trip: Trip) => (d < `${Number(trip.start_on.slice(0, 4)) - 1}-${trip.start_on.slice(5)}` || d.slice(0, 4) !== trip.start_on.slice(0, 4) && d.slice(5, 7) < "07" ? `${formatDayMonth(d)} ${d.slice(0, 4)}` : formatDayMonth(d));

/** TRIP-05: "These travel expenses from the last 12 months look like they belong to ‹trip›". */
export function BookingsSheet({ trip, open, onOpenChange }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cands = useTripCandidates(trip.id, open);
  const stops = useTripStops(trip.id).data ?? NO_STOPS;
  const list = useMemo(() => cands.data ?? [], [cands.data]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);

  // pre-check those whose payee or note mention the destination, a stop or an airport code
  // travel insurance and visas cover the trip whatever the payee is called, so they start checked too (as in the mock-up)
  const suggested = useMemo(() => new Set(list.filter((c) => /insur|visa/i.test(c.category_name) || mentionsTrip(`${c.payee_name ?? ""} ${c.note ?? ""}`, trip, stops)).map((c) => c.id)), [list, trip, stops]);
  useEffect(() => { if (open && cands.data && picked === null) setPicked(new Set(suggested)); }, [open, cands.data, picked, suggested]);
  useEffect(() => { if (!open) setPicked(null); }, [open]);

  const chosen = list.filter((c) => picked?.has(c.id));
  const sum = chosen.reduce((a, c) => a + c.amount_pence, 0);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p ?? []); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = async () => {
    if (chosen.length === 0) return onOpenChange(false);
    setBusy(true);
    const r = await attachToTrip(trip.id, chosen.map((c) => c.id));
    setBusy(false);
    if (!r.ok) return toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries();
    toast({ message: `${plural(r.data.attached, "booking")} added to ${trip.name}` });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Earlier bookings">
      <div className="vaul-body" data-testid="bookings-sheet">
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)} data-testid="bookings-not-now">Not now</button>
          <span className="t">Earlier bookings</span>
          <button className="txt" style={{ color: "var(--ink)", fontWeight: 600, opacity: chosen.length ? 1 : 0.4 }} disabled={busy || chosen.length === 0} onClick={add}>Add {chosen.length || ""}</button>
        </div>
        {cands.isLoading || picked === null && !cands.data ? <div className="skeleton" style={{ height: 160 }} aria-busy /> : list.length === 0 ? (
          <p className="sub" style={{ lineHeight: 1.45, margin: "4px 4px 18px" }} data-testid="bookings-empty">No flights, hotels or insurance from the last 12 months are waiting to be added to <b style={{ color: "var(--ink)", fontWeight: 600 }}>{trip.name}</b>. You can add any expense later from the trip’s Expenses tab.</p>
        ) : (
          <>
            <p className="sub" style={{ lineHeight: 1.45, margin: "0 4px 14px" }}>These travel expenses from the last 12 months look like they belong to <b style={{ color: "var(--ink)", fontWeight: 600 }}>{trip.name}</b>. They’ll stay in the months you paid for them, and also count towards this trip.</p>
            <div className="list" style={{ background: "var(--surface-2)", maxHeight: "44dvh", overflowY: "auto" }}>
              {list.map((c) => {
                const on = !!picked?.has(c.id);
                return (
                  <button key={c.id} className="row" style={{ minHeight: 64, width: "100%", textAlign: "left" }} role="checkbox" aria-checked={on} onClick={() => toggle(c.id)} data-testid="booking-row" data-picked={on ? "1" : "0"}>
                    <span className={`chk${on ? " on" : ""}`}>{on && <UI.Check size={14} strokeWidth={2.5} aria-hidden />}</span>
                    <div className="tile"><CategoryIcon name={iconFor(c)} size={18} /></div>
                    <div className="row-main"><div className="row-t">{c.payee_name ?? c.category_name}</div><div className="row-s">{[c.note, dateLabel(c.occurred_on, trip)].filter(Boolean).join(" · ")}</div></div>
                    <div className="amt">{formatGBP(c.amount_pence)}</div>
                  </button>
                );
              })}
            </div>
            <div className="row-between" style={{ margin: "16px 4px 0", fontSize: 15 }}><span className="muted" data-testid="bookings-count">{chosen.length} selected</span><span className="num" style={{ fontWeight: 600 }}>{formatGBP(sum)}</span></div>
            <button className="btn" style={{ marginTop: 16, opacity: chosen.length ? 1 : 0.4 }} disabled={busy || chosen.length === 0} onClick={add} data-testid="bookings-add">Add {chosen.length} to {trip.name}</button>
          </>
        )}
        <span hidden>{formatShort(trip.start_on)}</span>
      </div>
    </Sheet>
  );
}
