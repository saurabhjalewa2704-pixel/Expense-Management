"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mergePayees } from "@/app/actions/payees";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { UI } from "@/lib/icons";
import { usePayees } from "@/lib/queries/hooks";
import type { Payee } from "@/lib/types";

/** EC-C7: payee variants are matched automatically; any that slip through can be merged here. */
export function PayeesScreen() {
  const payees = usePayees().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState<Payee | null>(null);
  const [q, setQ] = useState("");
  const list = [...payees].sort((a, b) => b.use_count - a.use_count || a.name.localeCompare(b.name)).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const merge = async (into: Payee) => {
    if (!from) return;
    const r = await mergePayees(from.id, into.id);
    if (!r.ok) return toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries();
    toast({ message: `Merged ${from.name} into ${into.name}` });
    setFrom(null);
  };
  return (
    <div className="scroll" data-testid="payees">
      <PageHeader title="Payees" back="/settings" backLabel="Settings" />
      <label className="field" style={{ marginTop: 12 }}><UI.Search size={16} strokeWidth={1.75} aria-hidden /><input aria-label="Search payees" placeholder="Search payees" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, background: "none", border: 0, outline: "none", color: "var(--ink)" }} /></label>
      <div className="list" style={{ marginTop: 12 }}>
        {list.map((p) => (
          <button key={p.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setFrom(p)} data-testid="payee-row">
            <div className="row-main"><div className="row-t">{p.name}</div><div className="row-s">{p.use_count} {p.use_count === 1 ? "time" : "times"}</div></div>
            <UI.Merge size={16} strokeWidth={1.75} className="faint" aria-hidden />
          </button>
        ))}
      </div>
      <Sheet open={!!from} onOpenChange={(o) => !o && setFrom(null)} title="Merge payee" maxHeight="92dvh">
        <div className="vaul-body">
          <div className="sheet-head"><button className="txt" onClick={() => setFrom(null)}>Cancel</button><span className="t">Merge {from?.name}</span><span /></div>
          <p className="sub" style={{ marginBottom: 12 }}>Everything paid to {from?.name} moves to the payee you choose, and {from?.name} is removed.</p>
          <div className="subs" style={{ marginTop: 0, maxHeight: "56dvh", overflowY: "auto" }}>
            {payees.filter((p) => p.id !== from?.id).map((p) => <button key={p.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => merge(p)} data-testid="merge-target"><div className="row-main"><div className="row-t">{p.name}</div></div></button>)}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
