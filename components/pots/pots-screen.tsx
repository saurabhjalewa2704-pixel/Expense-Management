"use client";
import Link from "next/link";
import { useState } from "react";
import { PotEditor } from "./pot-editor";
import { PageHeader } from "@/components/ui/page-header";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { usePots } from "@/lib/queries/hooks";
import type { Pot } from "@/lib/types";

export function PotRow({ pot }: { pot: Pot }) {
  const pct = pot.target_pence ? Math.min(100, Math.round((Math.max(pot.net_pence, 0) / pot.target_pence) * 100)) : null;
  return (
    <Link href={`/pots/${pot.pot_id}`} className="row" data-testid="pot-row">
      <div className="tile"><UI.PiggyBank size={20} strokeWidth={1.75} aria-hidden /></div>
      <div className="row-main">
        <div className="row-t">{pot.name}</div>
        <div className="row-s">{pot.txn_count === 0 ? "Nothing in it yet" : `${pot.txn_count} transaction${pot.txn_count === 1 ? "" : "s"}`}{pct !== null ? ` · ${pct}% of budget` : ""}{pot.closed_at ? " · Closed" : ""}</div>
      </div>
      <div className="amt num">{formatGBP(pot.net_pence)}</div>
    </Link>
  );
}

/** One-off pots: big one-time costs (a home purchase) that move your cash but stay out of usual spending and insights. */
export function PotsScreen() {
  const pots = usePots();
  const [creating, setCreating] = useState(false);
  const open = (pots.data ?? []).filter((p) => !p.closed_at), closed = (pots.data ?? []).filter((p) => p.closed_at);
  return (
    <div className="scroll">
      <PageHeader title="One-off pots" back="/settings" backLabel="Settings" />
      <p className="sub" style={{ marginTop: 6 }}>For big one-time costs, like the deposit and stamp duty on a home. The money still leaves your accounts, but a pot is kept out of your monthly spend, analytics and insights.</p>
      {pots.isLoading ? <div className="list" style={{ marginTop: 20 }} aria-busy><div className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div></div> : (
        <>
          {open.length > 0 ? <div className="list" style={{ marginTop: 20 }}>{open.map((p) => <PotRow key={p.pot_id} pot={p} />)}</div>
            : <div className="card" style={{ marginTop: 20, textAlign: "center", padding: 28 }}><div className="headline">No pots yet</div><p className="sub" style={{ marginTop: 6 }}>Create one, then pick it with the “One-off” chip when you add a transaction.</p></div>}
          {closed.length > 0 && (<><div className="eyebrow group-label">Closed</div><div className="list">{closed.map((p) => <PotRow key={p.pot_id} pot={p} />)}</div></>)}
        </>
      )}
      <button className="btn" style={{ marginTop: 20 }} onClick={() => setCreating(true)}><UI.Plus size={20} strokeWidth={2} aria-hidden /> New pot</button>
      <PotEditor open={creating} onOpenChange={setCreating} />
    </div>
  );
}
