"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { attachToTrip, detachFromTrip } from "@/app/actions/trips";
import { TxnItem } from "@/components/activity/txn-row";
import { useQuickAdd } from "@/components/capture/quick-add";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { rowTitle } from "@/lib/categories";
import { dayHeader, type ISODate } from "@/lib/dates";
import { effectiveRate, formatMinor, currencySymbol } from "@/lib/fx";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { fetchActivityPage } from "@/lib/queries/fetchers";
import { useTripSummary, useTripTxns } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Trip, TripStop, TxnRow } from "@/lib/types";
import { plural, stopOn } from "./shared";

/** Swipe left to reveal "Remove from trip" (TRIP-10). Taps pass through to the row. */
function SwipeRow({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; open: boolean } | null>(null);
  const W = 120;
  return (
    <div style={{ position: "relative", overflow: "hidden" }} data-testid="swipe-row">
      <button className="btn" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: W, borderRadius: 0, background: "var(--surface-3)", color: "var(--ink)", fontSize: 14 }} tabIndex={dx < -20 ? 0 : -1} onClick={onRemove} data-testid="remove-from-trip">Remove from trip</button>
      <div style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform 200ms var(--spring)", background: "var(--surface)", position: "relative" }}
        onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY, open: dx < 0 }; setDragging(true); }}
        onPointerMove={(e) => {
          const s = start.current; if (!s || e.pointerType === "mouse") return;
          const mx = e.clientX - s.x;
          if (Math.abs(mx) > Math.abs(e.clientY - s.y)) setDx(Math.max(-W, Math.min(0, (s.open ? -W : 0) + mx)));
        }}
        onPointerUp={() => { start.current = null; setDragging(false); setDx((v) => (v < -W / 2 ? -W : 0)); }}
        onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}>
        {children}
      </div>
    </div>
  );
}

const dayTotal = (rows: TxnRow[]) => rows.reduce((a, r) => a + (r.type === "income" ? -r.amount_pence : r.amount_pence), 0);

/** TRIP-10: search, a summary line, on-trip days (newest first), then "Booked before the trip". */
export function TripExpenses({ trip, stops, today }: { trip: Trip; stops: TripStop[]; today: ISODate }) {
  const qc = useQueryClient();
  const toast = useToast();
  const quick = useQuickAdd();
  const txns = useTripTxns(trip.id);
  const summary = useTripSummary(trip.id, today).data;
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const rows = txns.data ?? [];
  const norm = q.trim().toLowerCase();
  const hit = (r: TxnRow) => !norm || [rowTitle(r), r.note, r.category_name, r.parent_category_name, formatGBP(r.amount_pence)].some((s) => s?.toLowerCase().includes(norm));
  const shown = rows.filter(hit);
  const before = shown.filter((r) => r.occurred_on < trip.start_on).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  const onTrip = shown.filter((r) => r.occurred_on >= trip.start_on);
  const byDay = new Map<ISODate, TxnRow[]>();
  for (const r of onTrip) byDay.set(r.occurred_on, [...(byDay.get(r.occurred_on) ?? []), r]);
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const remove = async (r: TxnRow) => {
    const res = await detachFromTrip(r.id);
    if (!res.ok) return toast({ message: res.error, tone: "error" });
    await qc.invalidateQueries();
    toast({ message: `Removed from ${trip.name}. It’s still in Activity.` });
  };
  const foreign = trip.currency !== "GBP" && summary && summary.local_minor > 0;

  return (
    <div data-testid="trip-expenses">
      <label className="field" style={{ marginTop: 14, height: 42, background: "var(--surface)" }}>
        <UI.Search size={16} strokeWidth={1.75} aria-hidden />
        <input aria-label="Search this trip" placeholder="Search this trip" value={q} onChange={(e) => setQ(e.target.value)} data-testid="trip-search" style={{ flex: 1, background: "none", border: 0, outline: "none", color: "var(--ink)" }} />
      </label>
      <div className="trip-sum" data-testid="trip-summary">
        <span className="num">{rows.length}</span> {rows.length === 1 ? "expense" : "expenses"} · <span className="num">{formatGBP(summary?.spent_pence ?? dayTotal(rows))}</span>
        {foreign && <> · on-trip <span className="num">{formatMinor(summary.local_minor, trip.currency)}</span> at an average {effectiveRate(summary.local_pence, summary.local_minor, trip.currency)} £/{currencySymbol(trip.currency)}</>}
      </div>

      {txns.isLoading && <div className="skeleton" style={{ height: 120, marginTop: 14 }} aria-busy />}
      {!txns.isLoading && rows.length === 0 && (
        <div className="card" style={{ marginTop: 16, textAlign: "center", padding: "24px 16px" }} data-testid="trip-expenses-empty">
          <div className="headline">Nothing on this trip yet</div>
          <p className="sub" style={{ marginTop: 6 }}>{trip.auto_tag ? "Expenses you add during the trip dates are tagged here automatically." : "Add expenses to this trip from the button below."}</p>
        </div>
      )}
      {norm && shown.length === 0 && rows.length > 0 && <p className="sub" style={{ margin: "16px 4px" }}>Nothing on this trip matches “{q}”.</p>}

      {days.map(([d, list]) => (
        <section key={d} data-testid="trip-day" data-day={d}>
          <div className="day-h"><b>{dayHeader(d, today)}</b><span className="num">{[stopOn(stops, d)?.name, formatGBP(dayTotal(list))].filter(Boolean).join(" · ")}</span></div>
          <div className="list">{list.map((r) => <SwipeRow key={r.id} onRemove={() => remove(r)}><TxnItem row={r} /></SwipeRow>)}</div>
        </section>
      ))}
      {before.length > 0 && (
        <section data-testid="trip-booked-before">
          <div className="day-h"><b>Booked before the trip</b><span className="num">{formatGBP(dayTotal(before))}</span></div>
          <div className="list">{before.map((r) => <SwipeRow key={r.id} onRemove={() => remove(r)}><TxnItem row={r} subtitle={`${r.category_name ?? ""} · ${dayHeader(r.occurred_on, today)}`} /></SwipeRow>)}</div>
        </section>
      )}

      <div className="stack" style={{ marginTop: 16, gap: 8 }}>
        <button className="list" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, width: "100%" }} onClick={() => quick.open({ trip: trip.id })} data-testid="trip-add-expense"><UI.Plus size={18} strokeWidth={2} aria-hidden />Add to {trip.name}</button>
        <button className="list" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, width: "100%", color: "var(--ink-2)" }} onClick={() => setPicker(true)} data-testid="trip-add-existing"><UI.Search size={18} strokeWidth={1.75} aria-hidden />Add an existing expense</button>
      </div>
      <ExistingPicker trip={trip} open={picker} onOpenChange={setPicker} />
    </div>
  );
}

/** "Add an existing expense": a searchable list of untagged expenses. */
function ExistingPicker({ trip, open, onOpenChange }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<TxnRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      fetchActivityPage(supabaseBrowser(), { q: q.trim() || undefined, trip: "none", types: ["expense"], pot: "exclude" }, undefined, 40).then((r) => { if (live) setFound(r); }).catch(() => undefined);
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [open, q]);
  useEffect(() => { if (!open) { setQ(""); setPicked(new Set()); } }, [open]);
  const add = async () => {
    setBusy(true);
    const r = await attachToTrip(trip.id, [...picked]);
    setBusy(false);
    if (!r.ok) return toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries();
    toast({ message: `${plural(r.data.attached, "expense")} added to ${trip.name}` });
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add an existing expense">
      <div className="vaul-body" data-testid="existing-picker">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">Add to {trip.name}</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600, opacity: picked.size ? 1 : 0.4 }} disabled={busy || picked.size === 0} onClick={add} data-testid="existing-add">Add {picked.size || ""}</button></div>
        <label className="field"><UI.Search size={16} strokeWidth={1.75} aria-hidden /><input aria-label="Search expenses" placeholder="Search expenses" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, background: "none", border: 0, outline: "none", color: "var(--ink)" }} /></label>
        <div className="list" style={{ marginTop: 10, background: "var(--surface-2)", maxHeight: "52dvh", overflowY: "auto" }}>
          {found.map((r) => {
            const on = picked.has(r.id);
            return (
              <button key={r.id} className="row" style={{ width: "100%", textAlign: "left", minHeight: 56 }} role="checkbox" aria-checked={on} data-testid="existing-row"
                onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                <span className={`chk${on ? " on" : ""}`}>{on && <UI.Check size={14} strokeWidth={2.5} aria-hidden />}</span>
                <div className="row-main"><div className="row-t">{rowTitle(r)}</div><div className="row-s">{[r.category_name, dayHeader(r.occurred_on)].filter(Boolean).join(" · ")}</div></div>
                <div className="amt">{formatGBP(r.amount_pence)}</div>
              </button>
            );
          })}
          {found.length === 0 && <p className="sub" style={{ padding: 16 }}>No other expenses found.</p>}
        </div>
      </div>
    </Sheet>
  );
}
