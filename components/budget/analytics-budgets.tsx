"use client";
// PRD §6.13 BUD-11 (mock-up 30): Analytics › Budgets. Variance by limit, budget vs actual vs forecast, six months against the budget, and health tiles.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ForecastWhySheet } from "@/components/budget/forecast-why";
import { StatusPill } from "@/components/budget/parts";
import { type LimitView } from "@/lib/budget";
import { addMonths, formatMonthShort, formatMonthYear, monthStart } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { accuracyAtDay, biasFlag } from "@/lib/forecast/backtest";
import { formatGBP } from "@/lib/money";
import { useBudgetHistory, useBudgetView, useToday } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";

const whole = (p: number) => formatGBP(p, { whole: true });
const signed = (p: number) => `${p > 0 ? "+" : "−"}${whole(Math.abs(p))}`;

export function AnalyticsBudgets() {
  const today = useToday();
  const [month, setMonth] = useState(monthStart(today));
  const [why, setWhy] = useState(false);
  const q = useBudgetView(month);
  const hist = useBudgetHistory(6);
  // BUD-11: forecast accuracy reads the nightly backtests (FORECASTING-ENGINE-PRD §6.14.13)
  const acc = useQuery({
    queryKey: ["forecast", "backtest"],
    queryFn: async () => {
      const { data } = await supabaseBrowser().from("forecast_backtest").select("month, day, point_pence, low_pence, high_pence, actual_pence");
      return ((data ?? []) as { month: string; day: number; point_pence: number; low_pence: number | null; high_pence: number | null; actual_pence: number }[])
        .map((r) => ({ month: r.month, day: r.day, point: r.point_pence, low: r.low_pence, high: r.high_pence, actual: r.actual_pence }));
    },
  });
  const v = q.data;
  const isCurrent = month === monthStart(today);
  const nav = (
    <div className="row-between" style={{ margin: "14px 4px 0" }}>
      <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><UI.ChevronLeft size={18} strokeWidth={1.75} aria-hidden /></button>
      <span style={{ fontSize: 17, fontWeight: 600 }} data-testid="abudget-month">{formatMonthYear(month)}</span>
      <button className="icon-btn" aria-label="Next month" disabled={isCurrent} style={{ opacity: isCurrent ? 0.35 : 1 }} onClick={() => setMonth(addMonths(month, 1))}><UI.ChevronRight size={18} strokeWidth={1.75} aria-hidden /></button>
    </div>
  );
  if (q.isLoading) return <div style={{ padding: "0 16px" }}>{nav}<div className="skeleton" style={{ height: 300, marginTop: 14 }} aria-busy /></div>;
  if (!v) return <div style={{ padding: "0 16px" }} data-testid="abudget-none">{nav}<p className="sub" style={{ margin: "18px 4px", lineHeight: 1.45 }}>{isCurrent ? "No budget yet. Set one to see how each category is tracking." : `No budget applied in ${formatMonthYear(month)}.`}</p></div>;

  const rows = [...v.limits, v.elsewhere];
  const closed = v.closed;
  const value = (l: LimitView) => (closed ? l.spent : l.forecast.forecast);
  const variance = (l: LimitView) => (closed ? l.spent - l.amount : l.variance);
  const sorted = [...rows].sort((a, b) => variance(b) - variance(a));
  const maxAbs = Math.max(1, ...sorted.map((l) => Math.abs(variance(l))));
  const net = value(v.overall) - v.overall.amount;
  const worst = sorted[0] && variance(sorted[0]) > 0 ? sorted[0] : null;
  const o = v.overall;

  // six months against the budget in force each month; a month with no budget uses today's amount, dashed (BUD-11)
  const h = hist.data ?? [];
  const todayBudget = o.amount;
  const bars = h.map((r) => ({ ...r, cur: r.month === monthStart(today), against: r.budget_pence ?? todayBudget, assumed: r.budget_pence === null }));
  const topV = Math.max(1, ...bars.map((b) => Math.max(b.spent_pence, b.against)), o.forecast.available ? o.forecast.forecast : 0) * 1.1;
  const done = bars.filter((b) => !b.cur && b.spent_pence > 0);
  const within = done.filter((b) => b.spent_pence <= b.against).length;
  const histTitle = isCurrent && o.forecast.available && done.length > 0 && within === 0 && o.forecast.forecast <= o.amount ? `${formatMonthYear(month).split(" ")[0]} could be your first month within ${whole(o.amount)}`
    : done.length ? `${within} of the last ${done.length} months within budget` : "Your months against budget";

  // health
  const atRisk = v.limits.filter((l) => l.variance > 0).map((l) => l.name);
  const unbudgeted = o.spent > 0 ? Math.round((v.elsewhere.spent * 100) / o.spent) : 0;
  const saving = v.limits.filter((l) => variance(l) < 0).sort((a, b) => variance(a) - variance(b))[0];
  const accuracy = accuracyAtDay(acc.data ?? [], v.dom);
  const bias = biasFlag(acc.data ?? []);

  return (
    <div style={{ padding: "0 16px" }} data-testid="analytics-budgets">
      {nav}
      <div className="bg-card" style={{ marginTop: 14 }} data-testid="variance-card">
        <div className="bg-top"><span style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>{worst ? `${worst.name} is the main risk` : closed ? "How the month ended" : "Every limit is on track"}</span><StatusPill status={o.status} /></div>
        <div className="sub" style={{ marginTop: 6 }}>{closed ? "Actual spend" : "Forecast"} against each limit at month end · right = over, left = under</div>
        <div style={{ marginTop: 14 }}>
          {sorted.map((l) => {
            const d = variance(l), w = (Math.abs(d) / maxAbs) * 48;
            return (
              <div key={l.name} className="var-row" data-testid="var-row">
                <span className="n" style={l.kind === "elsewhere" ? { color: "var(--ink-2)" } : undefined}>{l.name}</span>
                <div className="axis"><i style={{ left: d > 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: d > 0 ? "var(--caution)" : "var(--positive)", opacity: d > 0 ? 1 : 0.85 }} /></div>
                <span className="v" style={{ color: d > 0 ? "var(--caution)" : "var(--positive)" }}>{signed(d)}</span>
              </div>
            );
          })}
        </div>
        <div className="row-between" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 8 }}><span>← Under limit</span><span data-testid="variance-net">Net {signed(net)}</span><span>Over limit →</span></div>
      </div>

      <div className="bg-card" style={{ marginTop: 12 }} data-testid="budget-table">
        <button style={{ textAlign: "left", fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }} onClick={() => setWhy(true)} aria-label="Why this forecast?">{whole(o.spent)} spent, {whole(value(o))} {closed ? "actual" : "forecast"}</button>
        <div className="sub" style={{ marginTop: 4 }}>Budget vs actual vs {closed ? "result" : "forecast"}, {formatMonthYear(month).split(" ")[0]}</div>
        <table className="vtab"><thead><tr><th>Category</th><th>Limit</th><th>Spent</th><th>{closed ? "Result" : "Forecast"}</th></tr></thead>
          <tbody>
            {[...v.limits].sort((a, b) => a.name.localeCompare(b.name)).map((l) => {
              const bad = closed ? l.spent > l.amount : l.forecast.available && l.variance > 0;
              return <tr key={l.categoryId}><td>{l.name}</td><td>{whole(l.amount)}</td><td>{whole(l.spentShown)}</td><td style={{ color: bad ? "var(--caution)" : "var(--ink)" }}>{closed ? `${whole(l.spent)} ${bad ? "✗" : "✓"}` : l.forecast.available ? whole(l.forecast.forecast) : "–"}</td></tr>;
            })}
            <tr><td style={{ color: "var(--ink-2)" }}>Everything else</td><td>{whole(v.elsewhere.amount)}</td><td>{whole(v.elsewhere.spentShown)}</td><td>{whole(v.elsewhere.forecast.forecast)}</td></tr>
            <tr className="tot"><td>Total</td><td>{whole(o.amount)}</td><td>{whole(o.spentShown)}</td><td>{whole(value(o))}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="bg-card" style={{ marginTop: 12 }} data-testid="budget-history">
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>{histTitle}</div>
        <div className="sub" style={{ marginTop: 4 }}>Last 6 months against {bars.some((b) => b.assumed) ? `today’s ${whole(todayBudget)} budget (dashed)` : "the budget in force each month"} · orange = would have been over</div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, 1fr)`, gap: 10, alignItems: "end", height: 170, marginTop: 16 }} role="img" aria-label={histTitle}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(todayBudget / topV) * 130 + 22}px`, borderTop: "1.5px dashed var(--ink)" }} aria-hidden />
          {bars.map((b) => {
            const over = b.spent_pence > b.against;
            const fc = b.cur && o.forecast.available ? Math.max(0, o.forecast.forecast - b.spent_pence) : 0;
            const full = b.cur ? b.spent_pence + fc : b.spent_pence;
            return (
              <div key={b.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }}>
                <span style={{ fontSize: 11, color: over || (b.cur && full > b.against) ? "var(--caution)" : "var(--ink-2)" }}>{b.cur && fc ? `≈${whole(full)}` : whole(b.spent_pence)}</span>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: `${(full / topV) * 130}px` }}>
                  {fc > 0 && <div style={{ height: `${(fc / full) * 100}%`, background: "repeating-linear-gradient(45deg,var(--ink-2) 0 2px,transparent 2px 5px)", borderRadius: "5px 5px 0 0" }} />}
                  <div style={{ flex: 1, minHeight: 2, borderRadius: fc > 0 ? 0 : "5px 5px 2px 2px", background: b.cur ? "var(--ink)" : over ? "var(--caution-tint)" : "var(--chart-context)", boxShadow: !b.cur && over ? "inset 0 0 0 1px var(--caution)" : undefined }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: b.cur ? 600 : 400, color: b.cur ? "var(--ink)" : "var(--ink-3)" }}>{formatMonthShort(b.month)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-card" style={{ marginTop: 12 }} data-testid="budget-health">
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>Budget health</div>
        <div className="kpis">
          <div className="kpi"><div className="k">Limits on track</div><div className="v" data-testid="health-track">{v.limits.length ? `${v.limits.filter((l) => l.variance <= 0).length} of ${v.limits.length}` : "–"}</div><div className="s">{atRisk.length ? `${atRisk.join(", ")} at risk` : "none at risk"}</div></div>
          <div className="kpi"><div className="k">Forecast accuracy</div><div className="v" data-testid="health-accuracy">{accuracy === null ? "Learning" : `±${accuracy.pct}%`}</div><div className="s">{accuracy === null ? "2 full months needed" : `by mid-month, last ${accuracy.months} months`}{bias?.flag ? ` · Forecasts have been ${Math.abs(bias.pct)}% ${bias.pct < 0 ? "low" : "high"} recently` : ""}</div></div>
          <div className="kpi"><div className="k">Unbudgeted share</div><div className="v">{unbudgeted}%</div><div className="s">of spending has no limit of its own</div></div>
          <div className="kpi"><div className="k">Biggest saving</div><div className="v" style={{ color: saving ? "var(--positive)" : undefined }}>{saving ? saving.name : "–"}</div><div className="s">{saving ? `${whole(-variance(saving))} under its limit` : "no limit is under yet"}</div></div>
        </div>
      </div>
      <ForecastWhySheet open={why} onOpenChange={setWhy} month={month} />
    </div>
  );
}
