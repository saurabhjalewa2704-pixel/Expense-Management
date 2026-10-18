"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { UI } from "@/lib/icons";
import { canStepForward, resolvePeriod, stepPeriod, type PeriodKind, type PeriodSel } from "@/lib/periods";
import { addDays, type ISODate } from "@/lib/dates";

const KINDS: { id: PeriodKind; label: string }[] = [{ id: "month", label: "Month" }, { id: "quarter", label: "Quarter" }, { id: "year", label: "Year" }, { id: "custom", label: "Custom" }];

/** Month · Quarter · Year · Custom, with arrows to step backwards and forwards (defaults to the current month). */
export function PeriodControl({ value, today, onChange }: { value: PeriodSel; today: ISODate; onChange: (v: PeriodSel) => void }) {
  const p = resolvePeriod(value, today);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState<string>(p.from), [to, setTo] = useState<string>(p.to);
  const pick = (k: PeriodKind) => {
    if (k === "custom") { setFrom(p.from); setTo(p.to); setCustom(true); return; }
    onChange({ kind: k, anchor: value.kind === "custom" ? p.to : value.anchor });
  };
  return (
    <div data-testid="period">
      <div className="seg" role="tablist" aria-label="Period" style={{ marginTop: 14 }}>
        {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={value.kind === k.id} className={value.kind === k.id ? "on" : ""} onClick={() => pick(k.id)}>{k.label}</button>)}
      </div>
      <div className="period">
        <button className="icon-btn" aria-label="Previous period" onClick={() => onChange(stepPeriod(value, -1))}><UI.ChevronLeft size={16} strokeWidth={2} aria-hidden /></button>
        <span className="p" data-testid="period-label" aria-live="polite">{p.label}</span>
        <button className="icon-btn" aria-label="Next period" disabled={!canStepForward(value, today)} style={{ opacity: canStepForward(value, today) ? 1 : 0.35 }} onClick={() => onChange(stepPeriod(value, 1))}><UI.ChevronRight size={16} strokeWidth={2} aria-hidden /></button>
      </div>
      <Sheet open={custom} onOpenChange={setCustom} title="Custom range">
        <div className="vaul-body">
          <div className="sheet-head"><button className="txt" onClick={() => setCustom(false)}>Cancel</button><span className="t">Custom range</span><span /></div>
          <div className="stack">
            <label className="field"><span className="muted" style={{ width: 44 }}>From</span><input type="date" aria-label="From date" max={today} style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span className="muted" style={{ width: 44 }}>To</span><input type="date" aria-label="To date" max={addDays(today, 366)} style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="btn" style={{ height: 48 }} disabled={!from || !to || from > to} onClick={() => { onChange({ kind: "custom", anchor: to, custom: { from, to } }); setCustom(false); }}>Apply range</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
