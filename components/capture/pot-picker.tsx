"use client";
import { useState } from "react";
import { PotEditor } from "@/components/pots/pot-editor";
import { Sheet } from "@/components/ui/sheet";
import { UI } from "@/lib/icons";
import { usePots } from "@/lib/queries/hooks";

/** Put a transaction in a one-off pot (or take it out). Closed pots are hidden unless the transaction is already in one. */
export function PotPicker({ open, onOpenChange, selectedId, onSelect }: { open: boolean; onOpenChange: (o: boolean) => void; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const pots = (usePots().data ?? []).filter((p) => !p.closed_at || p.pot_id === selectedId);
  const [creating, setCreating] = useState(false);
  const choose = (id: string | null) => { onSelect(id); onOpenChange(false); };
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} nested title="One-off pot">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">One-off pot</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
          <p className="sub" style={{ margin: "0 2px 12px" }}>For big one-time costs. They still come out of your cash, but stay out of monthly spend, analytics and insights.</p>
          <div className="subs" style={{ marginTop: 0 }}>
            <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => choose(null)}>
              <div className="row-main"><div className="row-t">Not in a pot</div><div className="row-s">Counts as usual spending</div></div>
              <span className={`radio ${selectedId === null ? "on" : ""}`}>{selectedId === null && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
            {pots.map((p) => (
              <button key={p.pot_id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => choose(p.pot_id)}>
                <div className="row-main"><div className="row-t">{p.name}</div>{p.closed_at && <div className="row-s">Closed</div>}</div>
                <span className={`radio ${selectedId === p.pot_id ? "on" : ""}`}>{selectedId === p.pot_id && <UI.Check size={14} strokeWidth={2.5} />}</span>
              </button>
            ))}
            <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setCreating(true)}>
              <div className="tile"><UI.Plus size={18} strokeWidth={2} aria-hidden /></div>
              <div className="row-main"><div className="row-t">New pot…</div></div>
            </button>
          </div>
        </div>
      </Sheet>
      <PotEditor open={creating} onOpenChange={setCreating} nested onSaved={(id) => choose(id)} />
    </>
  );
}
