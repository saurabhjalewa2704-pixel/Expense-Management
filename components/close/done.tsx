"use client";
// MC10: "November is closed".
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCloseState, useCloseRow } from "@/lib/close/data";
import { dayShortLabel, formatDuration, monthFromParam, monthName, nextCloseDate } from "@/lib/close/logic";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useToday } from "@/lib/queries/hooks";

export function CloseDone({ param }: { param: string }) {
  const month = monthFromParam(param);
  const router = useRouter();
  const today = useToday();
  const row = useCloseRow(month ?? "2000-01-01");
  const state = useCloseState();
  const tidy = useQuery({
    queryKey: ["close", "tidy-count", month], enabled: !!month,
    queryFn: async () => { const { count } = await supabaseBrowser().from("month_close_answers").select("id", { count: "exact", head: true }).eq("month", month!).in("item_type", ["duplicate", "large", "one_off"]); return count ?? 0; },
  });
  if (!month) return null;
  const sn = row.data?.snapshot;
  const name = monthName(month);
  if (!sn) return <div className="mc-shell"><div className="mc-body" style={{ paddingTop: 140 }}><div className="skeleton" style={{ height: 160 }} aria-busy /></div></div>;
  const diff = sn.budget !== null ? sn.budget - sn.spent : null;
  const fx = sn.fixes;
  const rows: string[] = [];
  if (fx.days_no_spend + fx.days_not_tracked > 0) rows.push(`${fx.days_no_spend + fx.days_not_tracked} ${fx.days_no_spend + fx.days_not_tracked === 1 ? "day" : "days"} confirmed${fx.days_not_tracked ? ` (${fx.days_not_tracked} as not tracked)` : " as no-spend"}`);
  if (fx.bills_confirmed > 0) rows.push(`${fx.bills_confirmed} ${fx.bills_confirmed === 1 ? "bill" : "bills"} confirmed`);
  if (sn.balances.length > 0) {
    const added = sn.balances.filter((b) => b.resolution === "untracked_spend" || b.resolution === "untracked_income").reduce((a, b) => a + Math.abs(b.difference), 0);
    rows.push(`${sn.balances.length} ${sn.balances.length === 1 ? "balance" : "balances"} checked${added ? `, ${formatGBP(added)} of cash spending added` : ""}`.replace("cash spending", sn.balances.some((b) => b.resolution === "untracked_income") ? "spending or income" : "cash spending"));
  }
  const reviewed = tidy.data ?? fx.duplicates_removed + fx.one_offs_changed;
  if (reviewed > 0) rows.push(`${reviewed} ${reviewed === 1 ? "item" : "items"} reviewed`);
  return (
    <div className="mc-shell" data-testid="close-done">
      <div className="mc-body" style={{ paddingTop: "calc(var(--safe-top) + 36px)", textAlign: "center" }}>
        <div className="mc-done-tick"><UI.Check size={44} strokeWidth={2.5} aria-hidden /></div>
        <h1 className="title" style={{ fontSize: "var(--t-large)", marginTop: 20 }} data-testid="done-title">{name} is closed</h1>
        <p className="mc-lead" style={{ textAlign: "center" }} data-testid="done-line">{formatGBP(sn.spent)} spent{diff !== null ? ` · ${formatGBP(Math.abs(diff))} ${diff >= 0 ? "under" : "over"} budget` : ""}</p>
        {rows.length > 0 && <div className="mc-ticks" style={{ textAlign: "left" }} data-testid="done-fixes">{rows.map((r) => <div key={r}><span className="mc-pill pos" style={{ padding: 4 }}><UI.Check size={12} strokeWidth={3} aria-hidden /></span>{r}</div>)}</div>}
        <div className="mc-tiles" style={{ textAlign: "left", marginTop: 12 }}>
          <div><div className="k">Time taken</div><div className="v" data-testid="done-time">{row.data?.duration_s != null ? formatDuration(row.data.duration_s) : "—"}</div></div>
          <div><div className="k">Months closed</div><div className="v" data-testid="done-count">{state.data?.closed_count ?? 1}</div></div>
          <div><div className="k">Next close</div><div className="v" data-testid="done-next">{dayShortLabel(nextCloseDate(today))}</div></div>
        </div>
      </div>
      <footer className="mc-foot">
        <button className="btn" data-testid="done-button" onClick={() => router.push("/")}>Done</button>
        <p className="mc-note" style={{ textAlign: "center" }}>You can still edit {name}. Sterling will tell you if its totals change.</p>
      </footer>
    </div>
  );
}
