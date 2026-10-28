"use client";
import { Switch } from "@/components/ui/switch";
import { flagKind, type AnchorAccount } from "@/lib/balance-flags";
import { formatDayMonth, formatMonth, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";

/**
 * BAL-03 / BAL-05, under the chips in Add expense and the editor: why an entry may not move the balance, and the one question or toggle
 * the owner can answer. `counts` is the effective value; `onAnswer` records an explicit (manual) answer.
 */
export function BalanceFlagBlock({ account, accountName, date, counts, editing, trackingStart, tripName, onAnswer }: {
  account: AnchorAccount | undefined; accountName: string; date: ISODate; counts: boolean; editing: boolean;
  trackingStart: ISODate | null | undefined; tripName?: string | null; onAnswer: (v: boolean) => void;
}) {
  if (!account) return null;
  const kind = flagKind(account, date);
  const month = formatMonth(date);

  if (kind === "before_tracking") {
    const since = formatDayMonth(account.opening_date);
    return (
      <div className="card flag-note" data-testid="flag-note" style={{ marginTop: 12, display: "flex", gap: 12, background: "transparent", boxShadow: "inset 0 0 0 1px var(--rule-strong)" }}>
        <span className="tile" style={{ flex: "none", width: 32, height: 32 }}><UI.Lock size={16} strokeWidth={1.75} aria-hidden /></span>
        <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>
          <b style={{ color: "var(--ink)" }}>Before you started tracking ({formatDayMonth(trackingStart && trackingStart < account.opening_date ? trackingStart : account.opening_date) === since ? since : since}).</b>{" "}
          Your opening balances already include this, so it won’t change available cash. It still counts in {month}’s spending{tripName ? ` and ${tripName}` : ""}.
          {editing && (
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10, color: "var(--ink)" }}>
              <span>Affects balance: {counts ? "Yes" : "No"}</span>
              <Switch label="Affects balance" checked={counts} onChange={onAnswer} />
            </label>
          )}
        </div>
      </div>
    );
  }

  if (kind === "on_opening") {
    return (
      <label className="card" data-testid="flag-toggle" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px" }}>
        <span style={{ fontSize: 14 }}>Already included in my opening balance</span>
        <Switch label="Already included in my opening balance" checked={!counts} onChange={(v) => onAnswer(!v)} />
      </label>
    );
  }

  if (kind === "before_reconcile") {
    return (
      <div className="card" role="group" aria-label={`Was this already in your ${accountName} balance?`} data-testid="flag-question" style={{ marginTop: 12 }}>
        <div className="headline" style={{ fontSize: 15 }}>Was this already in your {accountName} balance?</div>
        <p className="sub" style={{ marginTop: 4 }}>You reconciled it on {formatDayMonth(account.last_reconciled_on ?? account.opening_date)}.</p>
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          <button className={`btn${!counts ? "" : " secondary"}`} aria-pressed={!counts} style={{ height: 44, fontSize: 14 }} onClick={() => onAnswer(false)}>Yes, it had already left my account</button>
          <button className={`btn${counts ? "" : " secondary"}`} aria-pressed={counts} style={{ height: 44, fontSize: 14 }} onClick={() => onAnswer(true)}>No, it was still pending</button>
        </div>
      </div>
    );
  }
  return null;
}
