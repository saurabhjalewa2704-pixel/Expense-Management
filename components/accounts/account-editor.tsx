"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { archiveAccount, setDefaultAccount, upsertAccount } from "@/app/actions/accounts";
import { DateSheet } from "@/components/capture/pickers";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ACCOUNT_TYPES } from "@/lib/accounts";
import { dateChipLabel, todayLondon, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP, toPence } from "@/lib/money";
import { defaultCountsAsCash } from "@/lib/schemas/account";
import type { Account, AccountType } from "@/lib/types";

/** ACC-01: create or edit an account. A balance entered for a credit card is "amount owed" and is stored negative. */
export function AccountEditor({ open, onOpenChange, account, balancePence, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; account?: Account; balancePence?: number; onSaved?: (a: Account) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [type, setType] = useState<AccountType>("current");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState<ISODate>(todayLondon());
  const [counts, setCounts] = useState(true);
  const [countsTouched, setCountsTouched] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(undefined); setBusy(false); setArchiving(false); setCountsTouched(false);
    setName(account?.name ?? ""); setInstitution(account?.institution ?? ""); setType(account?.type ?? "current");
    setCounts(account?.counts_as_cash ?? true); setBalance(""); setAsOf(todayLondon());
  }, [open, account]);

  const isCard = type === "credit_card";
  const pickType = (t: AccountType) => { setType(t); if (!countsTouched) setCounts(defaultCountsAsCash(t)); };

  const save = async () => {
    setError(undefined);
    let opening = 0;
    if (!account) {
      const p = balance.trim() === "" ? 0 : toPence(balance);
      if (p === null) return setError("Enter the balance as a number, like 1,250.40.");
      opening = isCard ? -Math.abs(p) : p;
    }
    setBusy(true);
    const r = await upsertAccount({ id: account?.id, name, institution: institution || null, type, counts_as_cash: counts, opening_balance_pence: opening, opening_date: asOf });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: account ? "Account updated" : `Added ${r.data.name}`, duration: 3000 });
    onOpenChange(false);
    onSaved?.(r.data);
  };

  const archive = async (writeOff: boolean) => {
    if (!account) return;
    setBusy(true);
    const r = await archiveAccount(account.id, writeOff);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: `Archived ${account.name}`, duration: 3000 });
    onOpenChange(false);
  };

  const makeDefault = async () => {
    if (!account) return;
    const r = await setDefaultAccount(account.id);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: `${account.name} is now your default`, duration: 3000 });
  };

  const hasBalance = !!account && (balancePence ?? 0) !== 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={account ? "Edit account" : "New account"} maxHeight="94dvh">
      <div className="vaul-body" data-testid="account-editor">
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button>
          <span className="t">{account ? "Edit account" : "New account"}</span>
          <button className="txt" style={{ color: "var(--ink)", fontWeight: 600, opacity: busy || !name.trim() ? 0.4 : 1 }} disabled={busy || !name.trim()} onClick={save}>{account ? "Save" : "Add"}</button>
        </div>

        <input className="field w-full" placeholder="Account name" aria-label="Account name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!account} />
        <input className="field w-full" style={{ marginTop: 8 }} placeholder="Bank or institution (optional)" aria-label="Institution" maxLength={60} value={institution} onChange={(e) => setInstitution(e.target.value)} />

        <div className="eyebrow" style={{ margin: "18px 4px 10px" }}>Type</div>
        <div className="chips" role="radiogroup" aria-label="Account type">
          {ACCOUNT_TYPES.map((t) => (
            <button key={t.id} role="radio" aria-checked={type === t.id} className={`chip plain ${type === t.id ? "sel" : ""}`} onClick={() => pickType(t.id)}>{t.label}</button>
          ))}
        </div>

        {!account && (
          <>
            <div className="eyebrow" style={{ margin: "18px 4px 10px" }}>{isCard ? "Amount owed" : "Balance"}</div>
            <div className="field"><span className="muted">£</span>
              <input style={{ flex: 1, background: "none", border: 0, outline: "none", minWidth: 0 }} inputMode="decimal" placeholder="0.00" aria-label={isCard ? "Amount owed" : "Balance"} value={balance} onChange={(e) => setBalance(e.target.value.replace(/[^\d.,-]/g, ""))} />
              <button className="chip plain" style={{ height: 30, fontSize: 13 }} onClick={() => setDateOpen(true)} aria-label={`As of ${dateChipLabel(asOf)}`}>As of {dateChipLabel(asOf)}</button>
            </div>
            <p className="sub" style={{ margin: "8px 4px 0" }}>{isCard ? "Enter what you owe as a positive number; it is stored as money owed." : "Your balance at the start of that day. Add anything spent since."}</p>
          </>
        )}

        <div className="list" style={{ marginTop: 18, background: "var(--surface-2)" }}>
          <div className="row" style={{ minHeight: 56 }}>
            <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Counts towards available cash</div>
              <div className="row-s">{counts ? "Included in your hero figure" : "Kept apart, like savings"}</div></div>
            <Switch checked={counts} onChange={(v) => { setCounts(v); setCountsTouched(true); }} label="Counts towards available cash" />
          </div>
        </div>

        {account && !account.is_default && !account.archived_at && (
          <button className="btn secondary" style={{ marginTop: 12, height: 48 }} onClick={makeDefault}>Make default for new entries</button>
        )}
        {account && !account.archived_at && (
          archiving ? (
            <div className="card" style={{ marginTop: 12, background: "var(--surface-2)" }}>
              <div className="headline">Archive {account.name}?</div>
              <p className="sub" style={{ marginTop: 4 }}>{hasBalance ? `It still holds ${formatGBP(balancePence ?? 0)}. Write that off to archive it; history stays.` : "It disappears from pickers; its history stays."}</p>
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn" style={{ height: 46, background: "var(--danger)", color: "var(--ink)" }} disabled={busy} onClick={() => archive(hasBalance)}>{hasBalance ? "Write off and archive" : "Archive"}</button>
                <button className="btn secondary" style={{ height: 46 }} onClick={() => setArchiving(false)}>Keep it</button>
              </div>
            </div>
          ) : (
            <button className="btn secondary" style={{ marginTop: 12, height: 48 }} onClick={() => setArchiving(true)}><UI.Archive size={18} strokeWidth={1.75} aria-hidden />Archive account</button>
          )
        )}
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}
      </div>
      <DateSheet open={dateOpen} onOpenChange={setDateOpen} value={asOf} onChange={setAsOf} />
    </Sheet>
  );
}
