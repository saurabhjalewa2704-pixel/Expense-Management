"use client";
import Link from "next/link";
import { useState } from "react";
import { AccountEditor } from "./account-editor";
import { ReconcileSheet } from "./reconcile-sheet";
import { AccountPicker } from "@/components/capture/pickers";
import { PageHeader } from "@/components/ui/page-header";
import { accountTypeLabel } from "@/lib/accounts";
import { todayLondon } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useAccounts, useBalances } from "@/lib/queries/hooks";
import type { Account, AccountType } from "@/lib/types";

const ACCOUNT_ICONS = { current: UI.Landmark, savings: UI.PiggyBank, credit_card: UI.CreditCard, cash: UI.Wallet, other: UI.Wallet } as const;
export function AccountIcon({ type, size = 20 }: { type: AccountType; size?: number }) {
  const Icon = ACCOUNT_ICONS[type];
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

export function AccountsScreen() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: balances } = useBalances(todayLondon());
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [reconcileId, setReconcileId] = useState<string | null>(null);

  const live = (accounts ?? []).filter((a) => !a.archived_at);
  const bal = (id: string) => balances?.find((b) => b.account_id === id)?.balance_pence;
  const pool = live.filter((a) => a.counts_as_cash);
  const apart = live.filter((a) => !a.counts_as_cash);
  const sum = (list: Account[]) => list.reduce((s, a) => s + (bal(a.id) ?? 0), 0);
  const reconcileAccount = live.find((a) => a.id === reconcileId);

  return (
    <div className="scroll">
      <PageHeader title="Accounts" back="/settings" backLabel="Settings"
        right={<button className="icon-btn" aria-label="Add account" onClick={() => setCreating(true)}><UI.Plus size={18} strokeWidth={2} aria-hidden /></button>} />

      <div className="card" style={{ marginTop: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div><div className="sub">Available cash</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.03em", marginTop: 4 }} data-testid="accounts-cash">{balances ? formatGBP(sum(pool)) : "—"}</div></div>
        {apart.length > 0 && <div style={{ textAlign: "right" }}><div className="sub">Kept apart</div>
          <div className="num" style={{ fontSize: 17, fontWeight: 500, marginTop: 4 }}>{balances ? formatGBP(sum(apart)) : "—"}</div></div>}
      </div>

      {isLoading ? <div className="list" style={{ marginTop: 24 }} aria-busy><div className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div></div> : live.length === 0 ? (
        <div className="card" style={{ marginTop: 24, textAlign: "center", padding: 28 }}>
          <div className="headline">No accounts yet</div>
          <p className="sub" style={{ marginTop: 6 }}>Add the accounts you spend from. Sterling needs at least one.</p>
          <button className="btn" style={{ marginTop: 16, height: 48 }} onClick={() => setCreating(true)}>Add account</button>
        </div>
      ) : (
        <>
          <Group label={`In available cash · ${pool.length}`} accounts={pool} bal={bal} />
          {apart.length > 0 && <Group label={`Not counted · ${apart.length}`} accounts={apart} bal={bal} />}
          <div className="card" style={{ marginTop: 24, display: "flex", gap: 14, alignItems: "center" }}>
            <div className="tile"><UI.RefreshCw size={20} strokeWidth={1.75} aria-hidden /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600 }}>Balances drifting?</div>
              <div className="sub" style={{ marginTop: 2 }}>Type what your bank says and Sterling corrects the difference.</div></div>
            <button className="chip plain" style={{ height: 34 }} onClick={() => (live.length === 1 ? setReconcileId(live[0]!.id) : setChoosing(true))}>Reconcile</button>
          </div>
        </>
      )}

      <AccountEditor open={creating} onOpenChange={setCreating} />
      <AccountPicker open={choosing} onOpenChange={setChoosing} title="Reconcile which account?" selectedId={null} onSelect={(id) => setReconcileId(id)} />
      <ReconcileSheet open={!!reconcileAccount} onOpenChange={(o) => !o && setReconcileId(null)} account={reconcileAccount} balancePence={reconcileAccount ? bal(reconcileAccount.id) ?? 0 : 0} />
    </div>
  );
}

function Group({ label, accounts, bal }: { label: string; accounts: Account[]; bal: (id: string) => number | undefined }) {
  return (
    <>
      <div className="eyebrow group-label">{label}</div>
      <div className="list">
        {accounts.map((a) => {
          const b = bal(a.id);
          return (
            <Link key={a.id} href={`/accounts/${a.id}`} className="row" data-testid="account-row">
              <div className="tile"><AccountIcon type={a.type} /></div>
              <div className="row-main"><div className="row-t">{a.name}</div><div className="row-s">{accountTypeLabel(a.type)}{a.is_default ? " · Default" : ""}</div></div>
              <UI.ChevronRight size={18} strokeWidth={1.75} className="chev" aria-hidden />
              <div className="amt">{b === undefined ? "—" : formatGBP(b)}</div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
