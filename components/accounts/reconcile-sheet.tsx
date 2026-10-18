"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { reconcileAccount } from "@/app/actions/accounts";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatGBP, toPence } from "@/lib/money";
import type { Account } from "@/lib/types";

/** ACC-05: "What does your bank app say?" The difference becomes a signed adjustment dated today. */
export function ReconcileSheet({ open, onOpenChange, account, balancePence }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account | undefined; balancePence: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTyped(""); setError(undefined); setBusy(false); } }, [open]);

  const isCard = account?.type === "credit_card";
  const entered = typed.trim() === "" ? null : toPence(typed);
  // For a card the user types what they owe, which is a negative balance.
  const actual = entered === null ? null : isCard ? -Math.abs(entered) : entered;
  const diff = actual === null ? null : actual - balancePence;

  const confirm = async () => {
    if (!account || actual === null) return;
    setBusy(true);
    const r = await reconcileAccount(account.id, actual);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: diff === 0 ? "Already matches your bank" : `Balance adjusted by ${formatGBP(diff ?? 0, { signed: true })}`, duration: 4000 });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Reconcile account">
      <div className="vaul-body" data-testid="reconcile">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">Reconcile</span><span /></div>
        <div className="headline">{account?.name}</div>
        <p className="sub" style={{ marginTop: 4 }}>What does your bank app say{isCard ? " you owe" : ""}?</p>
        <div className="field" style={{ marginTop: 14, height: 56 }}><span className="muted" style={{ fontSize: 22 }}>£</span>
          <input style={{ flex: 1, background: "none", border: 0, outline: "none", fontSize: 24, fontWeight: 600, minWidth: 0 }} inputMode="decimal" placeholder="0.00" aria-label="Balance in your bank app" autoFocus value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d.,-]/g, ""))} />
        </div>
        <div className="card" style={{ marginTop: 12, background: "var(--surface-2)" }}>
          <div className="row-between"><span className="sub">Sterling says</span><span className="num">{formatGBP(balancePence)}</span></div>
          <div className="row-between" style={{ marginTop: 8 }}><span className="sub">Difference</span>
            <span className={`num ${diff && diff !== 0 ? "cau" : ""}`} data-testid="reconcile-diff">{diff === null ? "—" : diff === 0 ? "None" : formatGBP(diff, { signed: true })}</span></div>
        </div>
        <p className="sub" style={{ margin: "10px 4px 0" }}>The difference is recorded as a “Balance adjustment” today. It counts towards your balance but not towards spend or income.</p>
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}
        <button className="btn" style={{ marginTop: 16, opacity: actual === null || busy ? 0.4 : 1 }} disabled={actual === null || busy} onClick={confirm}>{diff === 0 ? "Matches, nothing to do" : "Adjust balance"}</button>
      </div>
    </Sheet>
  );
}
