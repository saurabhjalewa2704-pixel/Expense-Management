"use client";
// Step 6 · Next month, and closing (MC09, MC-60 to MC-64).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExtraSheet } from "@/components/budget/extra-sheet";
import { useToast } from "@/components/ui/toast";
import { fetchBillsData } from "@/lib/forecast/load";
import { billSums } from "@/lib/budget";
import { ck, closeOnline, useCloseSummary } from "@/lib/close/data";
import { closeUrl, monthFromParam, monthName, nextMonthOf, suggestedLimit } from "@/lib/close/logic";
import type { Snapshot } from "@/lib/close/types";
import { addMonths, type ISODate } from "@/lib/dates";
import { UI, CategoryIcon } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useBudgetRows, useCategoryTree, useMonthForecast } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CloseGate, CloseShell, StepHead, useCloseFlow } from "./common";

const whole = (p: number) => formatGBP(p, { whole: true });

export function StepNext({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}

function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const qc = useQueryClient();
  const toast = useToast();
  const next = nextMonthOf(month);
  const nextName = monthName(next);
  const summary = useCloseSummary(month);
  const rows = useBudgetRows(next);
  const { tree } = useCategoryTree();
  const forecast = useMonthForecast(next);
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [keep, setKeep] = useState<Record<string, "keep" | "change">>({});
  useEffect(() => { const u = () => setOnline(navigator.onLine); u(); window.addEventListener("online", u); window.addEventListener("offline", u); return () => { window.removeEventListener("online", u); window.removeEventListener("offline", u); }; }, []);

  const overall = rows.data?.find((r) => r.category_id === null) ?? null;
  const bills = useQuery({
    queryKey: ["close", "bills-known", next, f.counts?.bills.open ?? 0],
    queryFn: async () => {
      const db = supabaseBrowser();
      const b = await fetchBillsData(db, next);
      // a varying bill counts at the amount last confirmed (the app's own estimate), not the rule's figure (MC-60)
      const items = await Promise.all(b.items.map(async (i) => {
        if (!i.amount_varies) return i;
        const { data } = await db.rpc("recurring_estimate", { p_item: i.id });
        return typeof data === "number" ? { ...i, amount_pence: data } : i;
      }));
      return billSums(items, b.occurrences, next, f.today, () => true, b.holidays).allMonth;
    },
  });
  // the previous two closed months' limits, for "2 months running" and the suggested figure (MC-61)
  const history = useQuery({
    queryKey: ["close", "limit-history", month],
    queryFn: async () => {
      const { data } = await supabaseBrowser().from("month_closes").select("month, snapshot, status").in("month", [addMonths(month, -1), addMonths(month, -2)]).in("status", ["closed", "closed_with_skips", "closed_quick"]);
      return (data ?? []) as { month: ISODate; snapshot: Snapshot | null }[];
    },
  });
  const over = (summary.data?.limits ?? []).filter((l) => l.actual > l.limit);
  const overIn = (cat: string) => (history.data ?? []).filter((h) => h.snapshot?.limits.some((l) => l.category_id === cat && l.actual > l.limit));
  const spentWhole = summary.data ? whole(summary.data.spent) : "";
  const left = overall && bills.data !== undefined ? overall.amount_pence - bills.data : null;
  const back = closeUrl(month, "next-month");
  const to = (path: string) => f.router.push(path);

  const close = async () => {
    setBusy(true);
    await f.actions.setStep("next_month", "done");
    const r = await closeOnline("close_month", { p_month: month, p_today: f.today, p_quick: false });
    setBusy(false);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
    await qc.invalidateQueries({ queryKey: ck.all });
    f.go("done");
  };

  return (
    <CloseShell month={month} index={6} back={() => f.go("review")}
      hint={!online ? "Connect to close the month" : undefined}
      footer={<button className="btn" data-testid="close-month" disabled={busy || !online} style={{ opacity: busy || !online ? 0.5 : 1 }} onClick={close}>Close {f.name}</button>}>
      <StepHead step={`Step 6 · ${nextName}`} title={`Ready for ${nextName}?`} lead={overall ? "Your budget carries over unless you change it." : `You haven’t set a budget for ${nextName}.`} />
      {overall ? (
        <div className="mc-item" data-testid="next-budget">
          <div className="hd"><div className="tile"><UI.Target size={20} aria-hidden /></div>
            <div className="ti"><b>{nextName} budget</b><span>Same as {f.name}{summary.data ? ` · you spent ${spentWhole}` : ""}</span></div><div className="am" data-testid="next-budget-amount">{whole(overall.amount_pence)}</div></div>
          <div className="mc-diff">
            <div><div className="k">Bills already known</div><div className="v" data-testid="bills-known">{bills.data !== undefined ? formatGBP(bills.data) : "…"}</div></div>
            <div><div className="k">Left for everything else</div><div className="v" data-testid="left-else">{left !== null ? formatGBP(left) : "…"}</div></div>
          </div>
          <div className="mc-acts">
            <button className={`mc-act ${keep.budget !== "change" ? "on" : ""}`} data-testid="budget-keep" onClick={() => setKeep((k) => ({ ...k, budget: "keep" }))}>{keep.budget !== "change" && <UI.Check size={16} aria-hidden />}Keep {whole(overall.amount_pence)}</button>
            <button className="mc-act" data-testid="budget-change" onClick={() => to(`/budget/setup?from=next&return=${encodeURIComponent(back)}`)}>Change</button>
          </div>
        </div>
      ) : (
        <button className="mc-item" style={{ width: "100%", textAlign: "left" }} data-testid="set-budget" onClick={() => to(`/budget/setup?from=next&return=${encodeURIComponent(back)}`)}>
          <div className="hd"><div className="tile"><UI.Target size={20} aria-hidden /></div><div className="ti"><b>Set a budget for {nextName}?</b><span>A monthly amount, and limits on the categories that tend to run over.</span></div><UI.ChevronRight size={16} className="chev" aria-hidden /></div>
        </button>
      )}
      {over.map((l) => {
        const c = tree.byId.get(l.category_id);
        const prior = overIn(l.category_id);
        const running = prior.length + 1;
        const suggestion = running >= 2 || prior.length >= 1 ? suggestedLimit([l.actual, ...prior.map((p) => p.snapshot!.limits.find((x) => x.category_id === l.category_id)!.actual)]) : null;
        const choice = keep[l.category_id] ?? "keep";
        return (
          <div className="mc-item" key={l.category_id} data-testid="next-limit">
            <div className="hd"><div className="tile"><CategoryIcon name={c?.icon} size={20} /></div>
              <div className="ti"><b>{c?.name} limit</b><span>Over by {formatGBP(l.actual - l.limit)} in {f.name} · {running >= 2 ? `${running} months running` : "first time"}</span></div><div className="am">{whole(l.limit)}</div></div>
            <div className="mc-acts">
              <button className={`mc-act ${choice === "keep" ? "on" : ""}`} data-testid="limit-keep" onClick={() => setKeep((k) => ({ ...k, [l.category_id]: "keep" }))}>{choice === "keep" && <UI.Check size={16} aria-hidden />}Keep {whole(l.limit)}</button>
              <button className="mc-act" data-testid="limit-change" onClick={() => to(`/budget/setup?from=next&limit=${l.category_id}&amount=${l.limit}&return=${encodeURIComponent(back)}`)}>Change</button>
              {suggestion !== null && suggestion !== l.limit && <button className="mc-act" data-testid="limit-suggest" onClick={() => to(`/budget/setup?from=next&limit=${l.category_id}&amount=${suggestion}&return=${encodeURIComponent(back)}`)}>Use {whole(suggestion)}</button>}
            </div>
          </div>
        );
      })}
      <button className="mc-item" style={{ width: "100%", textAlign: "left" }} data-testid="anything-big" onClick={() => setExtra(true)}>
        <div className="hd"><div className="tile"><UI.Calendar size={20} aria-hidden /></div><div className="ti"><b>Anything big in {nextName}?</b><span>Presents, a party, travel. Add it so the forecast knows from day one.</span></div><UI.ChevronRight size={16} className="chev" aria-hidden /></div>
      </button>
      {over.length > 0 && <p className="mc-note">Limits that are over two months running get a suggested new amount here.</p>}
      {forecast.data && <ExtraSheet open={extra} onOpenChange={setExtra} month={next} data={forecast.data} />}
    </CloseShell>
  );
}
