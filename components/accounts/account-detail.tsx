"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAccount } from "@/app/actions/accounts";
import { AccountEditor } from "./account-editor";
import { ReconcileSheet } from "./reconcile-sheet";
import { TxnItem } from "@/components/activity/txn-row";
import { Sparkline } from "@/components/charts/sparkline";
import { Figure } from "@/components/money";
import { PageHeader } from "@/components/ui/page-header";
import { accountTypeLabel } from "@/lib/accounts";
import { addDays, dayHeader, todayLondon } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useAccountSeries, useAccounts, useActivity, useBalances } from "@/lib/queries/hooks";
import type { TxnRow } from "@/lib/types";

/** ACC-04: balance, 90-day sparkline, this account's transactions, and Edit / Reconcile / Archive. */
export function AccountDetail({ id }: { id: string }) {
  const today = todayLondon();
  const { data: accounts, isLoading } = useAccounts();
  const { data: balances } = useBalances(today);
  const series = useAccountSeries(id, addDays(today, -90), today);
  const filters = { accountIds: [id] };
  const activity = useActivity(filters);
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();
  const qc = useQueryClient();
  const account = accounts?.find((a) => a.id === id);
  const balance = balances?.find((b) => b.account_id === id)?.balance_pence;

  if (!account) {
    return <div className="scroll"><PageHeader title={isLoading ? "Account" : "Not found"} back="/settings/accounts" backLabel="Accounts" />
      {!isLoading && <p className="sub" style={{ marginTop: 12 }}>This account doesn&apos;t exist.</p>}</div>;
  }
  const groups = groupByDay(activity.rows);
  return (
    <div className="scroll">
      <PageHeader title={account.name} back="/settings/accounts" backLabel="Accounts"
        right={<button className="icon-btn" aria-label="Edit account" onClick={() => setEditing(true)}><UI.Pencil size={16} strokeWidth={1.75} aria-hidden /></button>} />
      <div className="sub" style={{ marginTop: 6 }}>{accountTypeLabel(account.type)}{account.institution ? ` · ${account.institution}` : ""}{account.archived_at ? " · Archived" : ""}</div>

      <div className="hero" style={{ marginTop: 16 }}>
        {balance === undefined ? <div className="skeleton" style={{ height: 64, width: 240 }} aria-busy /> : <div data-testid="account-balance"><Figure pence={balance} /></div>}
        <div className="sub" style={{ marginTop: 10 }}>{balance !== undefined && balance < 0 ? `${formatGBP(Math.abs(balance))} owed · ` : ""}{balance !== undefined && balance > 0 && account.type === "credit_card" ? `${formatGBP(balance)} in credit · ` : ""}{account.counts_as_cash ? "Counts towards available cash" : "Not in available cash"}</div>
      </div>

      <div className="card chart-card" style={{ marginTop: 20 }}>
        <div className="finding-sub" style={{ marginTop: 0 }}>Balance, last 90 days</div>
        <div style={{ marginTop: 12 }}><Sparkline values={(series.data ?? []).map((p) => p.balance_pence)} label={`${account.name} balance over the last 90 days`} /></div>
      </div>

      {!account.archived_at && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn secondary" style={{ height: 48 }} onClick={() => setReconciling(true)}><UI.RefreshCw size={18} strokeWidth={1.75} aria-hidden />Reconcile</button>
          <button className="btn secondary" style={{ height: 48 }} onClick={() => setEditing(true)}><UI.Pencil size={18} strokeWidth={1.75} aria-hidden />Edit</button>
        </div>
      )}

      {!activity.isLoading && groups.length === 0 && (
        <div style={{ marginTop: 12 }}>
          {deleting ? (
            <div className="card"><div className="headline">Delete {account.name}?</div><p className="sub" style={{ marginTop: 4 }}>It has no transactions, so nothing is lost.</p>
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn" style={{ height: 46, background: "var(--danger)", color: "var(--ink)" }} data-testid="account-delete-confirm"
                  onClick={async () => { const r = await deleteAccount(account.id); if (!r.ok) { setDeleting(false); return setError(r.error); } await qc.invalidateQueries(); router.replace("/settings/accounts"); }}>Delete</button>
                <button className="btn secondary" style={{ height: 46 }} onClick={() => setDeleting(false)}>Keep it</button></div></div>
          ) : <button className="btn secondary" style={{ height: 48, color: "var(--danger)" }} data-testid="account-delete" onClick={() => setDeleting(true)}><UI.Trash2 size={18} strokeWidth={1.75} aria-hidden />Delete account</button>}
        </div>
      )}
      {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}

      <div className="section-h"><h2>Transactions</h2></div>
      {activity.isLoading && activity.rows.length === 0 ? <div className="list" aria-busy><div className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div></div>
        : groups.length === 0 ? <p className="sub" style={{ margin: "0 4px" }}>No transactions on this account yet.</p>
        : groups.map((g) => (
          <div key={g.day}>
            <div className="day-h"><b>{dayHeader(g.day, today)}</b></div>
            <div className="list">{g.rows.map((r) => <TxnItem key={r.client_id} row={r} />)}</div>
          </div>
        ))}
      {activity.hasNextPage && <button className="btn secondary" style={{ marginTop: 16, height: 48 }} disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>{activity.isFetchingNextPage ? "Loading…" : "Load more"}</button>}

      <AccountEditor open={editing} onOpenChange={setEditing} account={account} balancePence={balance} />
      <ReconcileSheet open={reconciling} onOpenChange={setReconciling} account={account} balancePence={balance ?? 0} />
    </div>
  );
}

export function groupByDay(rows: TxnRow[]): { day: string; rows: TxnRow[] }[] {
  const out: { day: string; rows: TxnRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.occurred_on) last.rows.push(r);
    else out.push({ day: r.occurred_on, rows: [r] });
  }
  return out;
}
