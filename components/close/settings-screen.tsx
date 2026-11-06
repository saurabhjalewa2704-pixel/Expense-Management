"use client";
// MC-81: Settings › Month close: notifications, the "Check savings" default, and the history.
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { updateProfile } from "@/app/actions/profile";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useCloseState } from "@/lib/close/data";
import { monthName } from "@/lib/close/logic";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useProfile } from "@/lib/queries/hooks";
import { StatusChip } from "./status-chip";

const TIMES = Array.from({ length: 29 }, (_, i) => { const m = 7 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });

export function MonthCloseSettings() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const state = useCloseState();
  const set = async (patch: Record<string, unknown>) => { await updateProfile(patch); await qc.invalidateQueries({ queryKey: ["profile"] }); };
  const past = [...(state.data?.months ?? [])].filter((m) => m.month < (state.data?.current ?? "")).reverse();
  return (
    <div className="scroll">
      <PageHeader title="Month close" back="/settings" backLabel="Settings" />
      <p className="sub" style={{ margin: "4px 2px 0" }}>A short check on the 1st: missing days, bills, balances and a review, so every month is a known-good record.</p>
      <div className="eyebrow group-label">Notifications</div>
      <div className="list">
        <div className="row"><div className="row-main"><div className="row-t">Remind me to close the month</div><div className="row-s">On the 1st, and once more on the 4th if it’s still open</div></div>
          <Switch label="Month close notifications" checked={profile?.close_notify ?? true} onChange={(v) => void set({ close_notify: v })} /></div>
        <div className="row"><div className="row-main"><div className="row-t">Time on the 1st</div></div>
          <select aria-label="Time on the 1st" data-testid="close-time" value={(profile?.close_notify_time ?? "09:00").slice(0, 5)} disabled={profile?.close_notify === false}
            onChange={(e) => void set({ close_notify_time: e.target.value })} style={{ background: "var(--surface-2)", border: 0, borderRadius: "var(--r-tile)", color: "var(--ink)", padding: "8px 10px", fontSize: "var(--t-callout)" }}>
            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></div>
      </div>
      <div className="eyebrow group-label">Balances</div>
      <div className="list">
        <div className="row"><div className="row-main"><div className="row-t">Check savings too</div><div className="row-s">Also compare accounts that aren’t in available cash</div></div>
          <Switch label="Check savings too" checked={profile?.close_check_savings ?? false} onChange={(v) => void set({ close_check_savings: v })} /></div>
      </div>
      <div className="eyebrow group-label">History</div>
      {past.length === 0 ? <div className="card" style={{ textAlign: "center" }}><p className="sub">Your first month will appear here once it has ended.</p></div> : (
        <div className="list" data-testid="close-history">
          {past.map((m) => (
            <Link key={m.month} className="row" href={`/settings/month-close/${m.month.slice(0, 7)}`} data-testid="close-history-row">
              <div className="row-main"><div className="row-t">{monthName(m.month)} {m.month.slice(0, 4)}</div><div className="row-s">{m.spent != null ? `${formatGBP(m.spent)} spent` : "Not closed"}</div></div>
              <StatusChip m={m} asLink={false} /><UI.ChevronRight size={16} className="chev" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
