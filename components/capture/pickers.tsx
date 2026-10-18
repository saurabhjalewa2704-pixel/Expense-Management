"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { addDays, formatShort, todayLondon, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useAccounts, useBalances } from "@/lib/queries/hooks";

export function AccountPicker({ open, onOpenChange, title, selectedId, excludeId, onSelect }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; selectedId: string | null; excludeId?: string | null; onSelect: (id: string) => void;
}) {
  const accounts = useAccounts().data ?? [];
  const balances = useBalances(todayLondon()).data ?? [];
  const live = accounts.filter((a) => !a.archived_at && a.id !== excludeId);
  const typeLabel = (t: string) => ({ current: "Current account", savings: "Savings", credit_card: "Credit card", cash: "Cash", other: "Other" })[t] ?? t;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} nested title={title}>
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">{title}</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {live.map((a) => {
            const bal = balances.find((b) => b.account_id === a.id)?.balance_pence;
            return (
              <button key={a.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onSelect(a.id); onOpenChange(false); }}>
                <div className="row-main"><div className="row-t">{a.name}</div><div className="row-s">{typeLabel(a.type)}{!a.counts_as_cash ? " · not in available cash" : ""}</div></div>
                {bal !== undefined && <span className="num muted" style={{ fontSize: 15 }}>{formatGBP(bal)}</span>}
                <span className={`radio ${selectedId === a.id ? "on" : ""}`}>{selectedId === a.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
              </button>
            );
          })}
          {live.length === 0 && <div className="row"><div className="row-main sub">Add an account in Settings first.</div></div>}
        </div>
      </div>
    </Sheet>
  );
}

export function DateSheet({ open, onOpenChange, value, min, onChange }: {
  open: boolean; onOpenChange: (o: boolean) => void; value: ISODate; min?: ISODate; onChange: (d: ISODate) => void;
}) {
  const today = todayLondon();
  const yesterday = addDays(today, -1);
  const [custom, setCustom] = useState(false);
  const choose = (d: ISODate) => { onChange(d); onOpenChange(false); setCustom(false); };
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setCustom(false); }} nested title="Choose a date">
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">Date</span><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {[{ label: "Today", d: today }, { label: "Yesterday", d: yesterday }].map((o) => (
            <button key={o.d} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => choose(o.d)}>
              <div className="row-main"><div className="row-t">{o.label}</div><div className="row-s">{formatShort(o.d)}</div></div>
              <span className={`radio ${value === o.d ? "on" : ""}`}>{value === o.d && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
          <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setCustom(true)}>
            <div className="row-main"><div className="row-t">Pick a date</div>{value !== today && value !== yesterday && <div className="row-s">{formatShort(value)}</div>}</div>
            <UI.ChevronRight size={18} strokeWidth={1.75} className="chev" />
          </button>
        </div>
        {custom && (
          <input type="date" className="field w-full" style={{ marginTop: 12 }} aria-label="Date" value={value} min={min} max={today}
            onChange={(e) => e.target.value && choose(e.target.value)} />
        )}
      </div>
    </Sheet>
  );
}

export function NoteSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onChange: (v: string) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} nested title="Add a note">
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">Note</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
        <textarea className="field w-full" style={{ height: 120, padding: 14, resize: "none", alignItems: "flex-start" }} placeholder="Anything to remember?" aria-label="Note" maxLength={280}
          value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
        <div className="sub" style={{ textAlign: "right", marginTop: 6 }}>{value.length}/280</div>
      </div>
    </Sheet>
  );
}
