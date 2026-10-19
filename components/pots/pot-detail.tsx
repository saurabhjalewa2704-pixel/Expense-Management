"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PotEditor } from "./pot-editor";
import { deletePot, setPotClosed } from "@/app/actions/pots";
import { TxnItem } from "@/components/activity/txn-row";
import { groupByDay } from "@/components/accounts/account-detail";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { dayHeader } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useActivity, usePotCategories, usePots, useToday } from "@/lib/queries/hooks";

/** One pot: what it has cost so far, against its budget, by category, and every transaction in it. */
export function PotDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const pots = usePots();
  const pot = pots.data?.find((p) => p.pot_id === id);
  const cats = usePotCategories(id);
  const filters = useMemo(() => ({ pot: id }), [id]);
  const activity = useActivity(filters);
  const groups = useMemo(() => groupByDay(activity.rows), [activity.rows]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  if (!pot) return <div className="scroll"><PageHeader title={pots.isLoading ? "Pot" : "Not found"} back="/pots" backLabel="Pots" /></div>;
  const refresh = () => qc.invalidateQueries();
  const pct = pot.target_pence ? Math.min(100, Math.round((Math.max(pot.net_pence, 0) / pot.target_pence) * 100)) : null;
  const left = pot.target_pence ? pot.target_pence - pot.net_pence : null;
  const maxCat = Math.max(1, ...(cats.data ?? []).map((c) => c.total_pence));

  const toggleClosed = async () => {
    const r = await setPotClosed(pot.pot_id, !pot.closed_at);
    if (!r.ok) return setError(r.error);
    await refresh(); toast({ message: pot.closed_at ? `${pot.name} reopened` : `${pot.name} closed`, duration: 3000 });
  };
  const remove = async () => {
    const r = await deletePot(pot.pot_id);
    if (!r.ok) return setError(r.error);
    await refresh(); router.replace("/pots");
  };

  return (
    <div className="scroll">
      <PageHeader title={pot.name} back="/pots" backLabel="Pots" right={<button className="icon-btn" aria-label="Edit pot" onClick={() => setEditing(true)}><UI.Pencil size={18} strokeWidth={1.75} aria-hidden /></button>} />
      <section className="card" style={{ marginTop: 16 }} aria-label="Pot total" data-testid="pot-summary">
        <div className="sub">{pot.closed_at ? "Closed · net cost" : "Net cost so far"}</div>
        <div className="num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", marginTop: 4 }} data-testid="pot-net">{formatGBP(pot.net_pence)}</div>
        <div className="sub" style={{ marginTop: 6 }}>
          <span data-testid="pot-spent">Spent {formatGBP(pot.spent_pence)}</span>{pot.received_pence > 0 && <> · <span className="pos" data-testid="pot-received">Received {formatGBP(pot.received_pence)}</span></>}
        </div>
        {pct !== null && pot.target_pence && (
          <div style={{ marginTop: 14 }}>
            <div role="progressbar" aria-label="Share of budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: left! < 0 ? "var(--caution)" : "var(--ink)" }} />
            </div>
            <div className="sub" style={{ marginTop: 8 }} data-testid="pot-budget">
              {left! >= 0 ? `${formatGBP(left!)} left of ${formatGBP(pot.target_pence)}` : `${formatGBP(-left!)} over the ${formatGBP(pot.target_pence)} budget`}
            </div>
          </div>
        )}
        <p className="sub" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>Kept out of your monthly spend, analytics and insights. It still comes out of your accounts.</p>
      </section>

      {(cats.data?.length ?? 0) > 0 && (
        <>
          <div className="section-h"><h2>By category</h2></div>
          <div className="list" data-testid="pot-categories">
            {cats.data!.map((c) => (
              <div key={c.category_id} className="row">
                <div className="tile"><CategoryIcon name={c.icon} size={20} /></div>
                <div className="row-main"><div className="row-t">{c.name}</div><div className="row-s">{c.txn_count} transaction{c.txn_count === 1 ? "" : "s"}</div>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--surface-3)", marginTop: 6 }}><div style={{ width: `${(c.total_pence / maxCat) * 100}%`, height: "100%", borderRadius: 2, background: "var(--chart-ink)" }} /></div></div>
                <div className="amt num">{formatGBP(c.total_pence)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-h"><h2>Transactions</h2></div>
      {groups.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 24 }}><p className="sub">Nothing in this pot yet. Add a transaction and choose “One-off”.</p></div>
      ) : groups.map((g) => (
        <section key={g.day} aria-label={dayHeader(g.day, today)}>
          <div className="day-h"><b>{dayHeader(g.day, today)}</b></div>
          <div className="list">{g.rows.map((r) => <TxnItem key={r.client_id} row={r} />)}</div>
        </section>
      ))}
      {activity.hasNextPage && <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => void activity.fetchNextPage()}>Show more</button>}

      {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 16 }}>{error}</p>}
      <div className="stack" style={{ marginTop: 28, gap: 10 }}>
        <button className="btn secondary" onClick={toggleClosed}>{pot.closed_at ? "Reopen pot" : "Close pot"}</button>
        {pot.txn_count === 0 && <button className="btn secondary" style={{ color: "var(--danger)" }} onClick={remove}>Delete pot</button>}
      </div>
      <PotEditor open={editing} onOpenChange={setEditing} pot={pot} />
    </div>
  );
}
