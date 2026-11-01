"use client";
// PRD §6.13 BUD-06 (mock-up 26): the budget card and the category-limits card on Home. Without a budget, a prompt to set one.
import Link from "next/link";
import { useState } from "react";
import { BudgetMeter, LimitRow, StatusPill } from "@/components/budget/parts";
import { ForecastWhySheet } from "@/components/budget/forecast-why";
import { formatDayMonth, formatMonth, monthEnd } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useBudgetView, useToday } from "@/lib/queries/hooks";
import { monthStart } from "@/lib/dates";

const whole = (p: number) => formatGBP(p, { whole: true });

/** The Home budget card, or null while loading / when the caller should show the pace card instead (hasBudget false). */
export function useHasBudget() {
  const today = useToday();
  const q = useBudgetView(monthStart(today));
  return { loading: q.isLoading, view: q.data ?? null };
}

export function BudgetCard() {
  const { view: v, loading } = useHasBudget();
  const [why, setWhy] = useState(false);
  const today = useToday();
  if (loading) return <div className="bg-card"><div className="skeleton" style={{ height: 210 }} aria-busy /></div>;
  if (!v) return null;
  const o = v.overall, f = o.forecast;
  const over = o.left < 0;
  const planGap = o.againstPlan;
  return (
    <>
      <div className="bg-card" data-testid="budget-card" style={{ position: "relative" }}>
        <Link href="/budget" aria-label="Open the budget" style={{ position: "absolute", inset: 0, borderRadius: "var(--r-card)" }} />
        <div className="bg-top" style={{ position: "relative", pointerEvents: "none" }}>
          <span className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><UI.Target size={14} strokeWidth={1.75} aria-hidden />{formatMonth(today)} budget</span>
          <StatusPill status={o.status} />
        </div>
        <div className="bg-big" style={{ position: "relative", pointerEvents: "none" }}>
          <span className="v" data-testid="budget-left">{formatGBP(Math.abs(o.left))}</span>
          <span className="u">{over ? `over ${whole(o.amount)}` : `left of ${whole(o.amount)}`}</span>
        </div>
        <div className="bg-sub" style={{ position: "relative", pointerEvents: "none" }} data-testid="budget-sub">
          {o.pctSpent}% spent · {v.monthPct}% of the month gone ·{" "}
          <span className={planGap >= 0 ? "pos" : "cau"}>{whole(Math.abs(planGap))} {planGap >= 0 ? "under" : "over"} plan</span>
        </div>
        <div style={{ position: "relative", pointerEvents: "none" }}><BudgetMeter v={o} /></div>
        <div className="kpis" style={{ position: "relative" }}>
          <div className="kpi" style={{ pointerEvents: "none" }} data-testid="safe-to-spend">
            <div className="k">Safe to spend</div>
            <div className="v">{formatGBP(o.safePerDay)}<span style={{ fontSize: 13, fontWeight: 400, color: "var(--ink-2)" }}> /day</span></div>
            <div className="s">{over ? "Over budget: anything more adds to the overspend" : `for ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"}, after bills`}</div>
          </div>
          <button className="kpi" data-testid="forecast-kpi" onClick={() => setWhy(true)} aria-label="Why this forecast?">
            <div className="k">Forecast · {formatDayMonth(monthEnd(today))}</div>
            {f.available ? (
              <>
                <div className="v">{whole(f.forecast)}</div>
                <div className="s" style={{ color: o.variance > 0 ? "var(--caution)" : "var(--positive)" }}>{o.variance > 0 ? `${whole(o.variance)} over` : `${whole(o.headroom)} headroom`}{f.confidence === "low" ? " · Low confidence" : ""}</div>
              </>
            ) : (
              <>
                <div className="v">–</div>
                <div className="s">{f.unavailableReason}</div>
              </>
            )}
          </button>
        </div>
      </div>
      <ForecastWhySheet open={why} onOpenChange={setWhy} month={v.month} />
    </>
  );
}

/** The three limits most at risk, with a link to all of them (BUD-06). */
export function LimitsCard() {
  const { view: v } = useHasBudget();
  if (!v || v.limits.length === 0) return null;
  return (
    <div className="bg-card" style={{ marginTop: 12, paddingBottom: 6 }} data-testid="limits-card">
      <div className="bg-top"><span className="eyebrow">Category limits · {v.limits.length}</span><Link className="sub" href="/budget" style={{ display: "flex", alignItems: "center", gap: 2 }}>All <UI.ChevronRight size={14} strokeWidth={2} aria-hidden /></Link></div>
      <div style={{ marginTop: 4 }}>
        {v.limits.slice(0, 3).map((l) => <LimitRow key={l.categoryId} v={l} href={`/analytics/category/${l.categoryId}`} />)}
      </div>
    </div>
  );
}

/** Shown on Home when no budget exists yet. */
export function BudgetPrompt() {
  return (
    <Link href="/budget/setup" className="bg-card" data-testid="budget-prompt" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className="tile" style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center" }}><UI.Target size={18} strokeWidth={1.75} aria-hidden /></span>
      <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>Set a monthly budget</span><span className="sub">See what’s left, where you’re heading and what to spend each day.</span></span>
      <UI.ChevronRight size={16} strokeWidth={2} aria-hidden />
    </Link>
  );
}
