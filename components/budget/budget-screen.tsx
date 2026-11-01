"use client";
// PRD §6.13 BUD-07 (mock-up 27): the Budget detail. Month switcher, forecast chart with range and plan, four tiles, what-ifs, every limit, and a watch card.
import Link from "next/link";
import { useState } from "react";
import { ForecastChart } from "@/components/budget/forecast-chart";
import { ForecastWhySheet } from "@/components/budget/forecast-why";
import { LimitRow, StatusPill } from "@/components/budget/parts";
import { PageHeader } from "@/components/ui/page-header";
import { excludesTrips, type LimitView } from "@/lib/budget";
import { addMonths, formatMonthYear, monthEnd, monthStart } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useBudgetView, useDailySpend, useToday } from "@/lib/queries/hooks";

const whole = (p: number) => formatGBP(p, { whole: true });

/** The watch card: the riskiest limit's remaining allowance against its usual pace. Every figure is from the forecast engine. */
export function watchText(l: LimitView): { title: string; body: string } | null {
  const f = l.forecast;
  if (!f.available || f.closed || l.variance <= 0 || l.left <= 0) return null;
  const perDay = Math.floor(l.left / f.daysLeft);   // the watch card talks about the whole allowance, as the mock-up does
  return {
    title: `${l.name} has ${formatGBP(l.left)} left for ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"}`,
    body: `That’s ${formatGBP(perDay)} a day. Your usual pace is ${formatGBP(f.expectedPerDay)} a day, which would finish ${whole(l.variance)} over the ${whole(l.amount)} limit.`,
  };
}

export function BudgetScreen() {
  const today = useToday();
  const [month, setMonth] = useState(monthStart(today));
  const [why, setWhy] = useState(false);
  const q = useBudgetView(month);
  const v = q.data;
  const isCurrent = month === monthStart(today);
  const to = monthEnd(month) < today ? monthEnd(month) : today;
  const daily = useDailySpend(month, to, false, !!v && excludesTrips(v.covers));
  const nav = (
    <div className="row-between" style={{ margin: "4px 4px 0" }}>
      <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><UI.ChevronLeft size={18} strokeWidth={1.75} aria-hidden /></button>
      <span style={{ fontSize: 17, fontWeight: 600 }} data-testid="budget-month">{formatMonthYear(month)}</span>
      <button className="icon-btn" aria-label="Next month" disabled={isCurrent} style={{ opacity: isCurrent ? 0.35 : 1 }} onClick={() => setMonth(addMonths(month, 1))}><UI.ChevronRight size={18} strokeWidth={1.75} aria-hidden /></button>
    </div>
  );

  return (
    <div className="scroll" style={{ paddingBottom: 48 }} data-testid="budget-screen">
      <PageHeader title="" back="/" backLabel="Home" right={<Link className="icon-btn" style={{ marginRight: 8 }} href="/budget/setup" aria-label="Edit budgets"><UI.Pencil size={18} strokeWidth={1.75} aria-hidden /></Link>} />
      <div style={{ marginTop: 6 }}>{nav}</div>
      {q.isLoading ? <div className="skeleton" style={{ height: 320, margin: 16 }} aria-busy /> : !v ? (
        <div className="bg-card" style={{ margin: "24px 16px 0" }} data-testid="budget-none">
          <p style={{ fontSize: 17, fontWeight: 600 }}>{isCurrent ? "No budget yet" : `No budget for ${formatMonthYear(month)}`}</p>
          <p className="sub" style={{ marginTop: 6, lineHeight: 1.45 }}>{isCurrent ? "Set a monthly amount and, if you like, limits on the categories that tend to run over." : "Past months keep the budget that applied at the time, and none did."}</p>
          {isCurrent && <Link className="btn primary" href="/budget/setup" style={{ marginTop: 14, display: "inline-flex" }}>Set a monthly budget</Link>}
        </div>
      ) : (
        <Detail v={v} daily={daily.data ?? []} onWhy={() => setWhy(true)} />
      )}
      <ForecastWhySheet open={why} onOpenChange={setWhy} month={month} />
    </div>
  );
}

function Detail({ v, daily, onWhy }: { v: NonNullable<ReturnType<typeof useBudgetView>["data"]>; daily: Parameters<typeof ForecastChart>[0]["daily"]; onWhy: () => void }) {
  const o = v.overall, f = o.forecast;
  const closed = v.closed;
  const over = o.left < 0;
  const safe = v.whatIfs.find((w) => w.key === "safe");
  const risky = v.limits.find((l) => watchText(l));
  const watch = risky ? watchText(risky) : null;
  const title = closed ? (o.spent > o.amount ? `Finished ${whole(o.spent - o.amount)} over budget` : `Finished ${whole(o.amount - o.spent)} under budget`)
    : !f.available ? f.unavailableReason!
    : o.variance > 0 ? `On course to finish ${whole(o.variance)} over budget` : `On course to finish ${whole(o.headroom)} under budget`;
  return (
    <div className="bm-two" style={{ padding: "0 16px" }}>
      <div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <StatusPill status={o.status} />
          <div className="num" style={{ fontSize: 52, fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.1, marginTop: 10 }} data-testid="budget-left">{formatGBP(Math.abs(o.left))}</div>
          <div className="sub" style={{ marginTop: 4 }}>{over ? `over ${formatGBP(o.amount)}` : `left of ${formatGBP(o.amount)}`} · {over ? `${o.pctSpent}% spent` : `${o.pctLeft}% remaining`}{closed ? "" : ` · day ${v.dom} of ${v.dim}`}</div>
          {(o.carried !== 0 || o.override !== null) && <div className="sub" style={{ marginTop: 4 }}>{o.override !== null ? `Adjusted for this month only: ${whole(o.override)}` : ""}</div>}
        </div>

        <div className="bg-card" style={{ marginTop: 18 }} data-testid="forecast-card">
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }} data-testid="forecast-title">{title}</div>
          <div className="sub" style={{ marginTop: 6, lineHeight: 1.4 }}>Cumulative spend · green = plan (bills on their days, the rest spread evenly) · shaded = likely range</div>
          <div style={{ marginTop: 8 }}><ForecastChart v={v} daily={daily} /></div>
          <div className="row-between" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, flexWrap: "wrap" }}>
            <span>— Actual &nbsp; ··· {closed ? "Actual" : "Forecast"} &nbsp; <span style={{ color: "var(--positive)" }}>— Plan</span></span>
            {f.available && !closed && f.low !== null && f.high !== null && <button className="link" onClick={onWhy} data-testid="why-link">Range {whole(f.low)}–{whole(f.high)} · Why?</button>}
          </div>
        </div>

        {!closed && (
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi" data-testid="tile-safe"><div className="k">Safe to spend</div><div className="v">{formatGBP(o.safePerDay)}/day</div><div className="s">{over ? "Over budget: anything more adds to the overspend" : `${f.daysLeft} days left incl. today`}</div></div>
            <div className="kpi" data-testid="tile-usual"><div className="k">Your usual pace</div><div className="v">{f.available ? `${formatGBP(f.expectedPerDay)}/day` : "–"}</div><div className="s">{f.paceHist !== null ? "this month + late-month history" : "this month so far"}</div></div>
            <div className="kpi" data-testid="tile-plan"><div className="k">Against plan</div><div className="v" style={{ color: o.againstPlan >= 0 ? "var(--positive)" : "var(--caution)" }}>{formatGBP(Math.abs(o.againstPlan))} {o.againstPlan >= 0 ? "under" : "over"}</div><div className="s">{o.pctSpent}% spent{o.againstPlan >= 0 ? " is mostly bills" : ""}</div></div>
            <div className="kpi" data-testid="tile-bills"><div className="k">Bills to come</div><div className="v">{formatGBP(o.billsToCome)}</div><div className="s">{o.billsToCome > 0 ? "still to be paid this month" : "nothing else due"}</div></div>
          </div>
        )}

        {!closed && f.available && v.whatIfs.length > 0 && (
          <div className="bg-card" style={{ marginTop: 12 }} data-testid="whatif">
            <div style={{ fontSize: 17, fontWeight: 600 }}>{safe && safe.perDay > 0 ? `At ${whole(safe.perDay)} a day you land on budget` : "Already over budget"}</div>
            <div className="sub" style={{ marginTop: 4 }}>What the rest of {formatMonthYear(v.month).split(" ")[0]} looks like at different daily spends</div>
            <table className="wi"><tbody>
              {v.whatIfs.map((w) => (
                <tr key={w.key} className={w.key === "safe" ? "hl" : ""} data-testid={`whatif-${w.key}`}>
                  <td>{whole(w.perDay)}/day{w.key === "safe" ? <span style={{ fontWeight: 400, color: "var(--ink-2)" }}> Stay on budget</span> : w.key === "usual" ? <span style={{ fontWeight: 400, color: "var(--ink-2)" }}> Your usual pace</span> : null}</td>
                  <td>{whole(w.monthEnd)}</td>
                  <td style={{ color: w.diff >= 0 ? "var(--positive)" : "var(--caution)" }}>{w.diff >= 0 ? "+" : "−"}{whole(Math.abs(w.diff))}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>

      <div>
        <div className="row-between" style={{ margin: "24px 4px 8px" }}><h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>Category limits</h2><span className="sub">Most at risk first</span></div>
        {v.limits.length === 0 ? (
          <div className="bg-card"><p className="sub">No category limits yet. Add one for a category that tends to run over.</p><Link className="link" href="/budget/setup">Add a limit</Link></div>
        ) : (
          <div className="bg-card" style={{ padding: "4px 16px" }} data-testid="limits-list">
            {v.limits.map((l) => <LimitRow key={l.categoryId} v={l} href={`/analytics/category/${l.categoryId}`} />)}
            <LimitRow v={v.elsewhere} />
          </div>
        )}
        {v.limitsOverBy > 0 && <p className="sub" data-testid="limits-warning" style={{ margin: "10px 4px 0", color: "var(--caution)" }}>Your limits add up to {formatGBP(v.limitsOverBy)} more than your monthly budget.</p>}
        {watch && (
          <div className="bg-card" style={{ marginTop: 18 }} data-testid="watch-card">
            <span className="eyebrow" style={{ color: "var(--caution)", display: "flex", gap: 6, alignItems: "center" }}><UI.Sparkles size={14} strokeWidth={1.75} aria-hidden />Watch</span>
            <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em", marginTop: 8 }}>{watch.title}</div>
            <p className="sub" style={{ marginTop: 6, lineHeight: 1.45, fontSize: 15 }}>{watch.body}</p>
          </div>
        )}
      </div>
    </div>
  );
}
