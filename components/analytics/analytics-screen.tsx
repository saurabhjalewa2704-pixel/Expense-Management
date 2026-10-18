"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CategoryBars } from "@/components/charts/category-bars";
import { ChartCard } from "@/components/charts/chart-card";
import { Heatmap } from "@/components/charts/heatmap";
import { PaceChart } from "@/components/charts/pace-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { WaterfallChart } from "@/components/charts/waterfall-chart";
import { PeriodControl } from "./period-control";
import { average, buildWaterfall, categoryFinding, paceFinding, projectMonth, rhythmFinding, trendBars, trendFinding, waterfallFinding, weekdayAverages, WEEKDAY_NAMES } from "@/lib/analytics";
import { addMonths, formatDayMonth, formatMonthYear, monthStart } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP, pctChange } from "@/lib/money";
import { resolvePeriod, type PeriodSel } from "@/lib/periods";
import { useCashFlow, useCategories, useDailySpend, useMonthlyTotals, usePayees, useSpendByCategory, useToday, useTopPayees } from "@/lib/queries/hooks";

/** S5: the long scroll of finding-titled charts (AN-01..06, AN-08). */
export function AnalyticsScreen() {
  const today = useToday();
  const [sel, setSel] = useState<PeriodSel>({ kind: "month", anchor: today });
  const [showIncome, setShowIncome] = useState(false);
  const p = resolvePeriod(sel, today);

  const cur = useDailySpend(p.from, p.to);
  const prev = useDailySpend(p.prevFrom, p.prevEnd);
  const cats = useSpendByCategory(p.from, p.to, null);
  const prevCats = useSpendByCategory(p.prevFrom, p.prevTo, null);
  const poolCats = useSpendByCategory(p.from, p.to, null, true);
  const flow = useCashFlow(p.from, p.to);
  const totals = useMonthlyTotals(12);
  const history = useDailySpend(monthStart(addMonths(monthStart(today), -6)), today);
  const payees = useTopPayees(p.from, p.to, 6);
  const allPayees = usePayees().data ?? [];
  const categories = useCategories().data ?? [];

  const catRows = cats.data ?? [];
  const totalSpend = catRows.reduce((s, r) => s + r.total_pence, 0);
  const curRows = cur.data ?? [], prevRows = prev.data ?? [];
  const curSpend = curRows.at(-1)?.cumulative_pence ?? 0;
  const prevAt = prevRows[Math.min(curRows.length, prevRows.length) - 1]?.cumulative_pence ?? 0;
  const hasPrev = prevRows.some((d) => d.total_pence > 0);
  const hrefFor = (id: string) => `/analytics/category/${id}?from=${p.from}&to=${p.to}`;
  const showUsual = p.kind === "month";

  // fixed costs: a parent where more than half of its sub-categories are fixed (Home yes, Bills no)
  const fixedIds = useMemo(() => {
    const set = new Set<string>();
    for (const parent of categories.filter((c) => !c.parent_id && c.kind === "expense")) {
      const kids = categories.filter((c) => c.parent_id === parent.id);
      if (kids.length && kids.filter((k) => k.is_fixed).length / kids.length > 0.5) set.add(parent.id);
    }
    return set;
  }, [categories]);

  // 12-month trend with the current month projected
  const thisMonth = monthStart(today);
  const monthSpendSoFar = totals.data?.find((t) => t.month === thisMonth)?.spend_pence ?? 0;
  const projected = p.kind === "month" && p.isCurrent && history.data ? projectMonth(history.data, today, monthSpendSoFar) : null;
  const bars = trendBars(totals.data ?? [], thisMonth, projected);
  const past = bars.filter((b) => !b.isCurrent && b.spend > 0);
  const avg = average(past.map((b) => b.spend));
  const trendTitle = projected !== null ? trendFinding(formatMonthYear(thisMonth).split(" ")[0]!, projected, avg) : avg ? `You spend about ${formatGBP(avg, { whole: true })} a month` : "Monthly spend";
  const first = bars[0], lastBar = bars.at(-1);

  // rhythm
  const heatMonth = monthStart(p.to);
  const heatDays = useDailySpend(heatMonth, p.kind === "month" ? p.to : heatMonth.slice(0, 8) + "28", true);   // behaviour, not rent
  const wk = weekdayAverages((heatDays.data ?? []).filter((d) => d.day <= today));
  const rhythm = rhythmFinding(wk);

  const wf = flow.data && poolCats.data ? buildWaterfall(flow.data, poolCats.data) : null;

  // compare periods (AN-08): largest absolute change first
  const cmp = useMemo(() => {
    const m = new Map<string, { name: string; icon: string; cur: number; prev: number }>();
    for (const r of cats.data ?? []) m.set(r.category_id, { name: r.name, icon: r.icon, cur: r.total_pence, prev: 0 });
    for (const r of prevCats.data ?? []) { const e = m.get(r.category_id); if (e) e.prev = r.total_pence; else m.set(r.category_id, { name: r.name, icon: r.icon, cur: 0, prev: r.total_pence }); }
    return [...m.entries()].map(([id, v]) => ({ id, ...v, delta: v.cur - v.prev })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [cats.data, prevCats.data]);

  const loadingAll = cats.isLoading || cur.isLoading;
  const exportHref = `/api/export?format=csv&from=${p.from}&to=${p.end}`;

  return (
    <div className="scroll">
      <div className="topbar" style={{ justifyContent: "flex-end" }}>
        <a className="icon-btn" aria-label="Export CSV for this period" href={exportHref} download><UI.Download size={18} strokeWidth={1.75} aria-hidden /></a>
      </div>
      <h1 className="large-title">Analytics</h1>
      <PeriodControl value={sel} today={today} onChange={setSel} />

      <div className="analytics-grid" style={{ marginTop: 12 }}>
        <div className="span-all">
          <ChartCard testId="chart-pace" loading={cur.isLoading || prev.isLoading} empty={curSpend === 0 && !hasPrev}
            finding={paceFinding(curSpend, prevAt, p.prevLabel, hasPrev)}
            sub={`Cumulative spend, ${p.kind === "month" ? `${formatDayMonth(p.from)}–${formatDayMonth(p.end)}` : p.label} vs ${p.prevLabel}`}
            table={{ columns: ["Day", p.label, p.prevLabel], rows: curRows.map((d, i) => [i + 1, formatGBP(d.cumulative_pence), prevRows[i] ? formatGBP(prevRows[i]!.cumulative_pence) : "—"]) }}>
            <PaceChart from={p.from} to={p.to} today={today} cur={curRows} prev={prevRows} prevFrom={p.prevFrom} prevLabel={p.prevLabel} curLabel={p.kind === "month" ? formatMonthYear(p.from).split(" ")[0]! : p.label} />
          </ChartCard>
        </div>

        <ChartCard testId="chart-categories" loading={cats.isLoading} empty={catRows.length === 0}
          finding={showUsual ? categoryFinding(catRows, totalSpend) : catRows[0] ? `${catRows[0].name} is where most of the money went` : "Where it went"}
          sub={showUsual ? `Category spend this month · marker = usual by day ${p.elapsed}` : `Category spend, ${p.label}`}
          table={{ columns: ["Category", "Spend", "Share", ...(showUsual ? ["Usual by now"] : [])], rows: catRows.map((r) => [r.name, formatGBP(r.total_pence), `${Math.round((r.total_pence * 100) / (totalSpend || 1))}%`, ...(showUsual ? [r.norm_pence == null ? "—" : formatGBP(r.norm_pence)] : [])]) }}>
          <CategoryBars rows={catRows} fixedIds={fixedIds} showUsual={showUsual} href={hrefFor} total={totalSpend} />
        </ChartCard>

        <ChartCard testId="chart-waterfall" loading={flow.isLoading || poolCats.isLoading} empty={!wf || (flow.data?.spend_pence === 0 && flow.data?.income_pence === 0)}
          finding={flow.data ? waterfallFinding(flow.data) : ""} sub={`${formatDayMonth(p.from)}–${formatDayMonth(p.to)} · scale starts at ${wf ? formatGBP(wf.base, { whole: true }) : "£0"}`}
          table={wf ? { columns: ["Step", "Amount"], rows: wf.steps.map((s) => [s.label, formatGBP(s.value, { signed: s.kind === "up" })]) } : undefined}>
          {wf && <WaterfallChart steps={wf.steps} base={wf.base} />}
        </ChartCard>

        <ChartCard testId="chart-trend" loading={totals.isLoading} empty={past.length === 0 && monthSpendSoFar === 0}
          finding={trendTitle} sub={first && lastBar ? `Monthly spend, ${formatMonthYear(first.month).replace(/(\w+) (\d+)/, "$1 $2").slice(0, 3)} ${first.month.slice(0, 4)} – ${formatMonthYear(lastBar.month).slice(0, 3)} ${lastBar.month.slice(0, 4)}${projected !== null ? " · hatched = projected" : ""}` : "Monthly spend"}
          actions={<button className={`chip plain ${showIncome ? "sel" : ""}`} style={{ height: 30, fontSize: 12 }} aria-pressed={showIncome} onClick={() => setShowIncome((v) => !v)}>Income</button>}
          table={{ columns: ["Month", "Spend", "Income"], rows: bars.map((b) => [formatMonthYear(b.month), formatGBP(b.spend + b.projectedExtra) + (b.projectedExtra ? " (projected)" : ""), formatGBP(b.income)]) }}>
          <TrendChart bars={bars} avg={avg} showIncome={showIncome} />
        </ChartCard>

        <ChartCard testId="chart-rhythm" loading={heatDays.isLoading} empty={!rhythm}
          finding={rhythm?.text ?? "Daily rhythm"} sub={rhythm ? `Daily spend excluding fixed costs, ${formatMonthYear(heatMonth).split(" ")[0]} · ${WEEKDAY_NAMES[rhythm.weekday]!.toLowerCase().replace(/^./, (c) => c.toUpperCase())} average ${formatGBP(wk[rhythm.weekday]!)}` : undefined}
          table={{ columns: ["Weekday", "Average"], rows: wk.map((a, i) => [WEEKDAY_NAMES[i]!, formatGBP(a)]) }}>
          <Heatmap month={heatMonth} days={heatDays.data ?? []} today={today} />
        </ChartCard>
      </div>

      <div className="section-h"><h2>Top payees</h2><Link className="link" href={`/activity?from=${p.from}&to=${p.end}`}>All</Link></div>
      <div className="list" data-testid="top-payees">
        {(payees.data ?? []).map((t) => {
          const cat = categories.find((c) => c.id === allPayees.find((x) => x.id === t.payee_id)?.default_category_id);
          return (
            <Link key={t.payee_id} href={`/activity?payee=${t.payee_id}&from=${p.from}&to=${p.end}`} className="row">
              <div className="tile"><CategoryIcon name={cat?.icon} size={20} /></div>
              <div className="row-main"><div className="row-t">{t.name}</div><div className="row-s">{t.visits} visit{t.visits === 1 ? "" : "s"} · avg {formatGBP(t.avg_pence)}</div></div>
              <div className="amt">{formatGBP(t.total_pence)}</div>
            </Link>
          );
        })}
        {!payees.isLoading && (payees.data ?? []).length === 0 && <div className="row"><div className="row-main sub">No payees in this period.</div></div>}
      </div>

      <div style={{ marginTop: 12 }}>
        <ChartCard testId="compare" loading={loadingAll || prevCats.isLoading} empty={cmp.length === 0}
          finding={`${p.label} vs ${p.prevLabel}`} sub={`By category, to the same point · biggest change first`}
          table={{ columns: ["Category", p.label, p.prevLabel, "Change"], rows: cmp.map((r) => [r.name, formatGBP(r.cur), formatGBP(r.prev), formatGBP(r.delta, { signed: true })]) }}>
          <div data-testid="compare-table" style={{ marginTop: 8 }}>
            {cmp.slice(0, 10).map((r) => {
              const pct = pctChange(r.cur, r.prev);
              return (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "9px 0", borderTop: "1px solid var(--rule)", alignItems: "baseline" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                  <span className="num sub" style={{ fontSize: 13 }}>{formatGBP(r.cur, { whole: true })} <span className="faint">vs {formatGBP(r.prev, { whole: true })}</span></span>
                  <span className={`num ${r.delta > 0 ? "cau" : r.delta < 0 ? "pos" : ""}`} style={{ fontSize: 13, fontWeight: 600, minWidth: 92, textAlign: "right" }}>{formatGBP(r.delta, { signed: true })}{pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}</span>
                </div>
              );
            })}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
