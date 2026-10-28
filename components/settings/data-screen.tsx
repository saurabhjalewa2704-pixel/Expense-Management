"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAllData } from "@/app/actions/profile";
import { PageHeader } from "@/components/ui/page-header";
import { UI } from "@/lib/icons";
import { del } from "idb-keyval";

/** SET-05 / AN-11: export CSV or a full JSON backup; delete everything after typing DELETE. */
export function DataScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true); setError(undefined);
    const r = await deleteAllData(typed);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    qc.clear();
    await del("sterling-query-cache").catch(() => {});
    router.replace("/sign-in");
  };

  return (
    <div className="scroll">
      <PageHeader title="Your data" back="/settings" backLabel="Settings" />
      <div className="eyebrow group-label" style={{ marginTop: 24 }}>Export</div>
      <div className="list">
        <a className="row" href="/api/export?format=csv" download>
          <div className="tile"><UI.Download size={20} strokeWidth={1.75} aria-hidden /></div>
          <div className="row-main"><div className="row-t">All transactions (CSV)</div><div className="row-s">Opens in Numbers, Excel or Sheets</div></div>
        </a>
        <a className="row" href="/api/export?format=json" download>
          <div className="tile"><UI.Database size={20} strokeWidth={1.75} aria-hidden /></div>
          <div className="row-main"><div className="row-t">Full backup (JSON)</div><div className="row-s">Accounts, categories, payees and transactions</div></div>
        </a>
      </div>
      <p className="sub" style={{ margin: "10px 16px 0" }}>Amounts are in pounds with two decimals. Dates are London dates. Filtered exports are in Activity.</p>

      <div className="eyebrow group-label" style={{ marginTop: 32 }}>Delete everything</div>
      <div className="card">
        <p className="callout">This permanently erases every account, transaction, payee and insight, and returns {`Sterling`} to first-run setup. Export a backup first.</p>
        <label className="field" style={{ marginTop: 14 }}>
          <input style={{ flex: 1, background: "none", border: 0, outline: "none" }} placeholder='Type DELETE to confirm' aria-label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        </label>
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 10 }}>{error}</p>}
        <button className="btn" style={{ marginTop: 14, height: 48, background: "var(--danger)", color: "var(--ink)", opacity: typed === "DELETE" && !busy ? 1 : 0.4 }} disabled={typed !== "DELETE" || busy} onClick={wipe}>Delete all my data</button>
      </div>
    </div>
  );
}
