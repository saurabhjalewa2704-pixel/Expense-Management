"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { TxnItem } from "@/components/activity/txn-row";
import { formatLong, formatMonthYear, formatShort, type ISODate } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP, type Pence } from "@/lib/money";
import { useTripBudgets, useTripByCategory, useTripByDay, useTripByStop, useTripSummary, useTripTxns } from "@/lib/queries/hooks";
import { dailyChartMode, tripClock, tripDays, tripFigures, tripLength } from "@/lib/tripMath";
import type { Trip, TripCategoryRow, TripStop } from "@/lib/types";
import { BudgetBar, plural, stopOn, TripTimeline } from "./shared";
import { TripInsights } from "./trip-insights";
import { TripWrapUp } from "./trip-wrapup";

const divRound = (n: number, d: number) => (d === 0 ? 0 : Math.round(n / d));

/** TRIP-07: budget, daily spending, by stop, where it went, insights and the monthly explainer. */
export function TripOverview({ trip, stops, today }: { trip: Trip; stops: TripStop[]; today: ISODate }) {
  const summary = useTripSummary(trip.id, today).data;
  const figs = tripFigures(trip, trip.budget_pence, summary?.booked_pence ?? 0, summary?.on_trip_pence ?? 0, today);
  const c = tripClock(trip, today);
  const txns = useTripTxns(trip.id).data;

  return (
    <div data-testid="trip-overview">
      <TripWrapUp trip={trip} summary={summary} today={today} />
      <section className="tr-hero" style={{ marginTop: 16 }} data-testid="trip-budget-card">
        <TripTimeline trip={trip} stops={stops} today={today} />
        <div className="tr-figs">
          <div><div className="big num" data-testid="trip-spent">{formatGBP(figs.spent)}</div><div className="of">{figs.budget !== null ? `spent of ${formatGBP(figs.budget, { whole: figs.budget % 100 === 0 })} budget` : "spent in total"}</div></div>
          {figs.left !== null && <div style={{ textAlign: "right" }}><div className="num" style={{ fontSize: 17, fontWeight: 600, color: figs.over ? "var(--caution)" : undefined }} data-testid="trip-left">{formatGBP(Math.abs(figs.left))}</div><div className="of">{figs.over ? "over" : "left"}</div></div>}
        </div>
        <BudgetBar figs={figs} />
        <div className="allow" data-testid="trip-allowance"><UI.Info size={18} strokeWidth={1.75} aria-hidden style={{ flex: "none" }} />
          <span><AllowanceLine figs={figs} phase={c.phase} daysLeft={c.daysLeftInclToday} /></span></div>
      </section>

      <DailyChart trip={trip} stops={stops} today={today} planPerDay={figs.planPerDay} txns={txns} />
      <ByStop trip={trip} stops={stops} today={today} />
      <WhereItWent trip={trip} />
      <TripInsights trip={trip} />

      <section className="card" style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "flex-start" }} data-testid="trip-explainer">
        <div className="tile"><UI.Info size={18} strokeWidth={1.75} aria-hidden /></div>
        <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>
          <b style={{ color: "var(--ink)", fontWeight: 600 }}>Also in your monthly spending.</b>{" "}
          <Explainer trip={trip} onTrip={figs.onTrip} booked={figs.booked} txns={txns} />
        </div>
      </section>
    </div>
  );
}

function AllowanceLine({ figs, phase, daysLeft }: { figs: ReturnType<typeof tripFigures>; phase: "before" | "during" | "after"; daysLeft: number }) {
  if (figs.budget === null) return <>On the trip you’re averaging <b>{formatGBP(figs.actualPerDay)} a day</b>{figs.booked > 0 ? `, with ${formatGBP(figs.booked)} booked before.` : "."}</>;
  if (phase === "before") return <><b>{formatGBP(figs.planPerDay ?? 0)} a day</b> planned once you arrive.</>;
  if (phase === "after") return figs.over ? <>Finished <b>{formatGBP(-(figs.left ?? 0))} over budget</b>.</> : <>Finished <b>{formatGBP(figs.left ?? 0)} under budget</b>.</>;
  if (figs.over) return <>You’re <b>{formatGBP(-(figs.left ?? 0))} over budget</b> with {plural(daysLeft, "day")} to go.</>;
  return <>You can spend <b>{formatGBP(figs.allowance ?? 0)} a day</b> for the next {plural(daysLeft, "day")} and stay on budget.</>;
}

function Explainer({ trip, onTrip, booked, txns }: { trip: Trip; onTrip: Pence; booked: Pence; txns?: { occurred_on: ISODate; trip_origin?: string | null; amount_pence: number; type: string }[] }) {
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const t of txns ?? []) if (t.trip_origin === "booking" && t.occurred_on < trip.start_on) set.add(t.occurred_on.slice(0, 7));
    return [...set].sort();
  }, [txns, trip.start_on]);
  const fmt = (m: string) => formatMonthYear(`${m}-01`);
  const first = months[0], last = months.at(-1);
  const when = !first ? "" : first === last ? fmt(first).split(" ")[0] : `${fmt(first).split(" ")[0]} to ${fmt(last!).split(" ")[0]}`;
  const month = formatMonthYear(trip.start_on).split(" ")[0];
  return <>{formatGBP(onTrip)} counts in {month}{booked > 0 && when ? `; ${formatGBP(booked)} of bookings counted in ${when}, when you paid` : ""}.</>;
}

function DailyChart({ trip, stops, today, planPerDay, txns }: { trip: Trip; stops: TripStop[]; today: ISODate; planPerDay: Pence | null; txns?: ReturnType<typeof useTripTxns>["data"] }) {
  const byDay = useTripByDay(trip.id).data;
  const [sel, setSel] = useState<ISODate | null>(null);
  const mode = dailyChartMode(trip);
  const days = tripDays(trip);
  const step = mode === "weekly" ? 7 : 1;
  const totals = new Map((byDay ?? []).map((d) => [d.day, d]));
  const buckets = useMemo(() => {
    const out: { from: ISODate; days: ISODate[]; total: Pence }[] = [];
    for (let i = 0; i < days.length; i += step) {
      const ds = days.slice(i, i + step);
      out.push({ from: ds[0]!, days: ds, total: ds.reduce((a, d) => a + (totals.get(d)?.total_pence ?? 0), 0) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, byDay]);
  if (mode === "hidden") return null;                                                          // EC-T16: a one-day trip has no daily chart
  const plan = planPerDay === null ? null : planPerDay * step;
  const scale = Math.max(1, plan ?? 0, ...buckets.map((b) => b.total));
  const H = 118;
  const past = days.filter((d) => d <= today && (totals.get(d)?.total_pence ?? 0) > 0);
  const biggest = past.map((d) => totals.get(d)!).sort((a, b) => b.total_pence - a.total_pence)[0];
  const finding = biggest ? `${formatLong(biggest.day).split(" ")[0]} was your biggest day${biggest.top_payee ? `: ${biggest.top_payee}` : ""}` : "No spending on the trip yet";
  const shade = (d: ISODate) => { const s = stopOn(stops, d); return s && stops.indexOf(s) % 2 === 0 ? "var(--ink-2)" : "var(--ink)"; };
  const dayRows = sel && txns ? txns.filter((t) => t.occurred_on >= sel && t.occurred_on <= addDays(sel, step - 1) && t.trip_origin !== "booking") : [];
  const legend = stops.map((s, i) => ({ name: s.name, color: i % 2 === 0 ? "var(--ink-2)" : "var(--ink)", future: s.start_on > today }));

  return (
    <ChartCard testId="trip-daily" finding={finding} sub={`On-trip spending by ${mode === "weekly" ? "week" : "day"}${plan !== null ? ` · dashed = planned ${formatGBP(plan)} a ${mode === "weekly" ? "week" : "day"}` : ""}`}
      table={{ columns: ["Day", "Spent"], rows: buckets.map((b) => [formatShort(b.from), formatGBP(b.total)]) }}>
      <div className="dbars" style={{ gridTemplateColumns: `repeat(${buckets.length},1fr)`, height: H + 22 }} role="group" aria-label="Spending by day">
        {buckets.map((b) => {
          const fut = b.from > today;
          return (
            <button key={b.from} className={`b${fut ? " fut" : ""}`} data-day={b.from} data-testid="trip-bar" aria-label={`${formatShort(b.from)}${mode === "weekly" ? " week" : ""}, ${formatGBP(b.total)}`} aria-pressed={sel === b.from}
              onClick={() => setSel(sel === b.from ? null : b.from)}
              style={fut ? undefined : { height: Math.max(b.total > 0 ? 3 : 0, (b.total / scale) * H), background: shade(b.from), alignSelf: "end", outline: sel === b.from ? "2px solid var(--ink)" : undefined }} />
          );
        })}
        {plan !== null && plan > 0 && <div className="plan" style={{ bottom: Math.min(H, (plan / scale) * H) }}><span>plan</span></div>}
      </div>
      <div className="dlabels num" style={{ gridTemplateColumns: `repeat(${buckets.length},1fr)` }}>
        {buckets.map((b, i) => <span key={b.from} style={b.days.includes(today) ? { color: "var(--ink)", fontWeight: 600 } : undefined}>{buckets.length > 20 && i % 2 ? "" : Number(b.from.slice(8))}</span>)}
      </div>
      {legend.length > 0 && <div className="legend">{legend.map((l) => <span key={l.name}><i style={l.future ? { background: "transparent", boxShadow: "inset 0 0 0 1px var(--rule-strong)", height: 6 } : { background: l.color }} />{l.name}{l.future ? " (to come)" : ""}</span>)}</div>}
      {sel && (
        <div style={{ marginTop: 14 }} data-testid="trip-day-list">
          <div className="day-h"><b>{formatShort(sel)}</b><span className="num">{formatGBP(dayRows.reduce((a, r) => a + (r.type === "income" ? -r.amount_pence : r.amount_pence), 0))}</span></div>
          {dayRows.length === 0 ? <p className="sub">Nothing spent.</p> : <div className="list" style={{ background: "var(--surface-2)" }}>{dayRows.map((r) => <TxnItem key={r.id} row={r} />)}</div>}
        </div>
      )}
    </ChartCard>
  );
}

const addDays = (d: ISODate, n: number): ISODate => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function ByStop({ trip, stops, today }: { trip: Trip; stops: TripStop[]; today: ISODate }) {
  const rows = useTripByStop(trip.id, today).data;
  if (stops.length === 0 || !rows) return null;                                                // hidden when no stops are defined
  const shown = rows.filter((r) => r.stop_id !== null || r.total_pence > 0);
  const perDay = (r: (typeof rows)[number]) => (r.days_elapsed > 0 ? divRound(r.total_pence, r.days_elapsed) : 0);
  const top = [...shown].filter((r) => r.days_elapsed > 0 && r.stop_id).sort((a, b) => perDay(b) - perDay(a))[0];
  const max = Math.max(1, ...shown.map((r) => r.total_pence));
  const after = tripClock(trip, today).phase === "after";
  return (
    <ChartCard testId="trip-by-stop" finding={top ? `${top.name} ${after ? "was" : "is"} your priciest stop${after ? " per day" : " so far"}` : "No stop spending yet"} sub="On-trip spending by stop"
      table={{ columns: ["Stop", "Spent", "A day"], rows: shown.map((r) => [r.name, formatGBP(r.total_pence), formatGBP(perDay(r))]) }}>
      <div className="stopbars" style={{ marginTop: 8 }}>
        {shown.map((r) => {
          const upcoming = r.days_elapsed === 0 && r.start_on !== null && r.start_on > today;
          return (
            <div className="r" key={r.stop_id ?? "other"} data-testid="trip-stop-row">
              <div className="n">{r.name}<span>{upcoming ? `From ${formatShort(r.start_on!)}` : after || r.days_elapsed === r.days ? plural(r.days, "day") : `${plural(r.days_elapsed, "day")} so far`}</span></div>
              <div className="t"><i style={{ width: `${(r.total_pence / max) * 100}%` }} /></div>
              <div className="v">{upcoming ? <span style={{ fontSize: 14 }}>Upcoming</span> : <>{formatGBP(r.total_pence)}<span>{formatGBP(perDay(r))} a day</span></>}</div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

function WhereItWent({ trip }: { trip: Trip }) {
  const [level, setLevel] = useState<"parent" | "leaf">("leaf");                                // sub-categories by default: trips are small
  const [all, setAll] = useState(false);
  const rows = useTripByCategory(trip.id, level).data;
  const budgets = useTripBudgets(trip.id).data;
  const total = (rows ?? []).reduce((a, r) => a + r.total_pence, 0);
  const sorted = rows ?? [];
  const shown = all ? sorted : sorted.slice(0, 7);
  const scale = Math.max(1, ...sorted.map((r) => Math.max(r.total_pence, r.budget_pence ?? 0)));
  const share = (r: TripCategoryRow) => (total > 0 ? Math.round((r.total_pence * 100) / total) : 0);
  const top2 = sorted.slice(0, 2);
  const finding = !sorted.length ? "Nothing on this trip yet"
    : top2.length === 1 ? `${top2[0]!.name} is ${share(top2[0]!)}% of the trip`
    : `${top2[0]!.name} and ${top2[1]!.name.toLowerCase()} are ${Math.round(((top2[0]!.total_pence + top2[1]!.total_pence) * 100) / total)}% of the trip`;
  return (
    <ChartCard testId="trip-where" finding={finding} sub="Whole trip, including bookings made before" empty={rows !== undefined && sorted.length === 0} emptyText="Spending will show up here as you add expenses."
      table={{ columns: ["Category", "Spent", "Share"], rows: sorted.map((r) => [r.name, formatGBP(r.total_pence), `${share(r)}%`]) }}>
      <div className="seg view-seg" role="tablist" aria-label="Group by">
        <button role="tab" aria-selected={level === "parent"} className={level === "parent" ? "on" : ""} onClick={() => setLevel("parent")}>Categories</button>
        <button role="tab" aria-selected={level === "leaf"} className={level === "leaf" ? "on" : ""} onClick={() => setLevel("leaf")}>Sub-categories</button>
      </div>
      <div style={{ marginTop: 6 }}>
        {shown.map((r) => {
          const budget = r.budget_pence ?? (level === "parent" ? budgets?.find((b) => b.category_id === r.category_id)?.amount_pence ?? null : null);
          const over = budget !== null && r.total_pence > budget;
          return (
            <Link key={r.category_id} href={`/activity?trip=${trip.id}&categories=${r.category_id}`} className="srow" data-testid="trip-cat-row" aria-label={`${r.name}, ${formatGBP(r.total_pence)}${budget !== null ? `, budget ${formatGBP(budget)}` : ""}`}>
              <div className="tile"><CategoryIcon name={r.icon} size={16} /></div>
              <div className="sn"><span className="nm">{r.name}</span></div>
              <div className="cbar-amt num" style={over ? { color: "var(--caution)" } : undefined}>{formatGBP(r.total_pence)}</div>
              <div className="cap">{[r.is_parent_direct || level === "parent" ? null : r.parent_name, `${share(r)}%`].filter(Boolean).join(" · ")}{budget !== null ? ` · budget ${formatGBP(budget, { whole: budget % 100 === 0 })}` : ""}</div>
              <div className={`cbar-track rel${over ? " over" : ""}`} aria-hidden>
                <div className="b" style={{ width: `${Math.min(100, (r.total_pence / scale) * 100)}%` }} />
                {budget !== null && <div className="cat-budget" style={{ left: `${Math.min(100, (budget / scale) * 100)}%` }} />}
              </div>
            </Link>
          );
        })}
      </div>
      {sorted.length > 7 && <button className="more" style={{ width: "100%" }} onClick={() => setAll((v) => !v)} data-testid="trip-cat-more">{all ? "Show fewer" : `Show all ${sorted.length}`}<UI.ChevronDown size={16} strokeWidth={2} aria-hidden /></button>}
    </ChartCard>
  );
}
