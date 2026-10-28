"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { CURRENCIES } from "@/lib/countries";
import { formatShort, type ISODate } from "@/lib/dates";
import { currencySymbol, exponentOf, pressKeyFx } from "@/lib/fx";
import { UI } from "@/lib/icons";
import { pressKey } from "@/lib/money";
import type { Trip } from "@/lib/types";

/** TRIP-04: tapping the trip chip lists the trips around this date, plus None. */
export function TripPicker({ open, onOpenChange, trips, date, selectedId, onSelect }: {
  open: boolean; onOpenChange: (o: boolean) => void; trips: Trip[]; date: ISODate; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  const near = (t: Trip) => (date < t.start_on ? t.start_on.localeCompare(date) : date > t.end_on ? 1 : 0);
  const dist = (t: Trip) => Math.abs(Date.parse(date) - Date.parse(date < t.start_on ? t.start_on : date > t.end_on ? t.end_on : date));
  const list = [...trips].sort((a, b) => dist(a) - dist(b) || near(a) - near(b));
  return (
    <Sheet open={open} onOpenChange={onOpenChange} nested title="Trip">
      <div className="vaul-body" data-testid="trip-picker">
        <div className="sheet-head"><span /><span className="t">Trip</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {list.map((t) => (
            <button key={t.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onSelect(t.id); onOpenChange(false); }} data-testid="trip-pick-row">
              <div className="row-main"><div className="row-t">{t.name}</div><div className="row-s">{formatShort(t.start_on)} – {formatShort(t.end_on)}</div></div>
              <span className={`radio ${selectedId === t.id ? "on" : ""}`}>{selectedId === t.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
          <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onSelect(null); onOpenChange(false); }} data-testid="trip-pick-none">
            <div className="row-main"><div className="row-t">None</div><div className="row-s">Not part of a trip</div></div>
            <span className={`radio ${selectedId === null ? "on" : ""}`}>{selectedId === null && <UI.Check size={14} strokeWidth={2.5} />}</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** TRIP-06 / EC-T7: pounds, the trip's currency, or any other, for this expense only. */
export function CurrencySheet({ open, onOpenChange, value, suggested, onSelect }: {
  open: boolean; onOpenChange: (o: boolean) => void; value: string; suggested: string[]; onSelect: (c: string) => void;
}) {
  const [q, setQ] = useState("");
  const quick = ["GBP", ...suggested.filter((c) => c !== "GBP")];
  const rest = CURRENCIES.filter((c) => c !== "GBP" && !quick.includes(c) && c.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (c: string) => { onSelect(c); onOpenChange(false); setQ(""); };
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }} nested title="Currency">
      <div className="vaul-body" data-testid="currency-sheet">
        <div className="sheet-head"><span /><span className="t">Currency</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {quick.map((c) => (
            <button key={c} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c)} data-testid={`cur-${c}`}>
              <div className="row-main"><div className="row-t">{c === "GBP" ? "£ Pounds" : `${currencySymbol(c)} ${c}`}</div>{c === "GBP" && <div className="row-s">Use when the amount on your statement is already known</div>}</div>
              <span className={`radio ${value === c ? "on" : ""}`}>{value === c && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 10 }}><UI.Search size={16} strokeWidth={1.75} aria-hidden /><input aria-label="Search currencies" placeholder="Another currency" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, background: "none", border: 0, outline: "none", color: "var(--ink)" }} /></label>
        {q.trim() !== "" && (
          <div className="subs" style={{ marginTop: 8, maxHeight: "30dvh", overflowY: "auto" }}>
            {rest.map((c) => <button key={c} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c)}><div className="row-main"><div className="row-t">{currencySymbol(c)} {c}</div></div></button>)}
            {rest.length === 0 && <p className="sub" style={{ padding: 12 }}>No currency matches “{q}”.</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** TRIP-06: type the £ the card actually charged. The effective rate is worked out from it. */
export function PoundsSheet({ open, onOpenChange, value, placeholder = "0.00", onChange, onClear }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; placeholder?: string; onChange: (v: string) => void; onClear: () => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} nested title="Amount in pounds">
      <div className="vaul-body" data-testid="pounds-sheet">
        <div className="sheet-head"><button className="txt" onClick={() => { onClear(); onOpenChange(false); }}>Use the rate</button><span className="t">Amount in £</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="amount num" style={{ marginTop: 4 }}><span className="cur">£</span><span className="whole" style={value === "" ? { color: "var(--ink-3)" } : undefined}>{value === "" ? placeholder : value}</span></div>
        <p className="sub" style={{ textAlign: "center" }}>What your statement shows</p>
        <div className="keypad num" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => <button key={k} className="key" aria-label={k === "." ? "Decimal point" : k} onClick={() => onChange(pressKey(value, k))}>{k}</button>)}
          <button className="key fn" aria-label="Delete" onClick={() => onChange(pressKey(value, "back"))}><UI.Delete size={24} strokeWidth={1.75} /></button>
        </div>
      </div>
    </Sheet>
  );
}

export { exponentOf, pressKeyFx };
