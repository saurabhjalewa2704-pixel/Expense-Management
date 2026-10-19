"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPot, updatePot } from "@/app/actions/pots";
import { Sheet } from "@/components/ui/sheet";
import { formatGBP, toPence } from "@/lib/money";
import { qk } from "@/lib/queries/keys";
import type { Pot } from "@/lib/types";

/** Create or edit a pot: a name, and an optional budget to measure it against. */
export function PotEditor({ open, onOpenChange, pot, nested, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; pot?: Pot; nested?: boolean; onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(pot?.name ?? ""); setTarget(pot?.target_pence ? String(pot.target_pence / 100).replace(/\.0+$/, "") : ""); setError(undefined); setBusy(false);
  }, [open, pot]);

  const save = async () => {
    const t = target.trim() ? toPence(target) : null;
    if (target.trim() && (t === null || t <= 0)) return setError("Enter the budget as an amount, like 45000.");
    setBusy(true); setError(undefined);
    const body = { name, target_pence: t };
    const r = pot ? await updatePot(pot.pot_id, body) : await createPot(body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries({ queryKey: qk.pots });
    onOpenChange(false);
    if (!pot && "data" in r) onSaved?.((r.data as { id: string }).id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} nested={nested} title={pot ? "Edit pot" : "New pot"}>
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">{pot ? "Edit pot" : "New pot"}</span><span /></div>
        <div className="stack" style={{ gap: 12 }}>
          <label className="sr-only" htmlFor="pot-name">Pot name</label>
          <input id="pot-name" className="field w-full" placeholder="Name, e.g. Home purchase" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="sr-only" htmlFor="pot-target">Budget</label>
          <input id="pot-target" className="field w-full" inputMode="decimal" placeholder="Budget (optional), e.g. 45000" value={target} onChange={(e) => setTarget(e.target.value)} />
          <p className="sub">{target.trim() && toPence(target) ? `We'll measure the pot against ${formatGBP(toPence(target)!)}.` : "A budget is optional. Without one the pot simply totals what you put in it."}</p>
          {error && <p role="alert" className="callout" style={{ color: "var(--caution)" }}>{error}</p>}
          <button className="btn" disabled={busy || !name.trim()} style={{ opacity: busy || !name.trim() ? 0.5 : 1 }} onClick={save}>{pot ? "Save" : "Create pot"}</button>
        </div>
      </div>
    </Sheet>
  );
}
