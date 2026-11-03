"use client";
// "Why this forecast?" (FORECASTING-ENGINE-PRD §6.14.16, mock-ups F1 and F2): the forecast as a sum anyone can check, what "usual" means, how much
// this month has earned, and what will make it sharper. Every sentence comes from the engine's own `Forecast`.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deletePlannedExtra } from "@/app/actions/forecast";
import { ExtraSheet } from "@/components/budget/extra-sheet";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatDayMonth, formatMonth, formatMonthShort, monthEnd, type ISODate } from "@/lib/dates";
import { displayPoint } from "@/lib/forecast/view";
import type { Forecast } from "@/lib/forecast/types";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { ordinal } from "@/lib/recurrence";
import { useMonthForecast, useToday } from "@/lib/queries/hooks";

const gbp = (p: number) => formatGBP(p);
const whole = (p: number) => formatGBP(p, { whole: true });
const day = (iso: ISODate) => Number(iso.slice(8));
const range = (a: ISODate, b: ISODate) => (a.slice(0, 7) === b.slice(0, 7) ? `${day(a)}–${formatDayMonth(b)}` : `${formatDayMonth(a)} – ${formatDayMonth(b)}`);

export function ConfidencePill({ f }: { f: Forecast }) {
  const early = f.evidence.completedDays < 3 && f.confidence === "Low";
  const tone = f.confidence === "High" ? "pos" : f.confidence === "Medium" ? "" : "cau";
  return <span className={`pill ${tone}`} data-testid="why-confidence">{f.confidence} confidence{early ? " · early in the month" : ""}</span>;
}

/** Weight on this month by day of the month, so the owner can see it grow (F1, F2). */
function WeightBars({ f, today }: { f: Forecast; today: ISODate }) {
  const dim = day(f.detail.monthEnd), n = f.evidence.completedDays;
  const k = f.prior.kEff ?? 7;
  const w = (d: number) => (d <= 0 ? 0 : d / (d + k));
  const mark = day(today) - 1;
  return (
    <div data-testid="why-weight-bars">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56, marginTop: 14 }} aria-hidden>
        {Array.from({ length: dim }, (_, i) => (
          <i key={i} style={{ flex: 1, height: `${Math.max(6, w(i) * 100)}%`, background: i <= n && i <= mark ? "var(--ink)" : "var(--surface-3)", borderRadius: 2 }} />
        ))}
      </div>
      <div className="row-between" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
        <span>1 {formatMonthShort(f.detail.monthStart)} · 0%</span><span>{Math.round(w(Math.min(8, dim)) * 100)}% by day 8</span><span>{dim} {formatMonthShort(f.detail.monthStart)} · {Math.round(w(dim - 1) * 100)}%</span>
      </div>
    </div>
  );
}

/** Seven weekday bars scaled to the multipliers. */
function WeekdayBars({ m }: { m: number[] }) {
  const top = Math.max(...m);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8, alignItems: "end", height: 72, marginTop: 10 }} data-testid="why-weekday" aria-hidden>
      {m.map((v, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
          <i style={{ width: "100%", height: `${(v / top) * 100}%`, background: i >= 5 ? "var(--ink)" : "var(--surface-3)", borderRadius: 4 }} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{"MTWTFSS"[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function ForecastWhy({ data, onAdd }: { data: NonNullable<ReturnType<typeof useMonthForecast>["data"]>; onAdd: () => void }) {
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const f = data.forecast, input = data.input;
  const name = formatMonth(f.detail.monthStart);
  const end = monthEnd(f.detail.monthStart);
  const closed = f.regime === "actual";
  const bills = f.scheduledItems.filter((s) => s.kind !== "extra");
  const extras = (input.planned_extras ?? []);
  const oneOffs = f.detail.oneOffs;
  const row = (key: string, label: string, sub: React.ReactNode, value: string, first = false) => (
    <div key={key} className="row-between" style={{ padding: "12px 0", borderTop: first ? undefined : "1px solid var(--rule)", alignItems: "flex-start", gap: 12 }}>
      <div><div style={{ fontSize: 15, fontWeight: 500 }}>{label}</div>{sub ? <div className="sub" style={{ marginTop: 2, fontSize: 12.5, lineHeight: 1.4 }}>{sub}</div> : null}</div>
      <span className="num" style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
  const group = { background: "var(--surface-2)", padding: "2px 16px 4px", borderRadius: 12 } as const;
  const eyebrow = (t: string, right?: React.ReactNode) => <div className="row-between" style={{ margin: "20px 4px 8px" }}><span className="eyebrow">{t}</span>{right}</div>;

  const shown = f.point === null ? null : displayPoint(f.point, f.confidence);
  const removeExtra = async (id: string) => {
    const r = await deletePlannedExtra(id);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
  };

  const usualDays = f.prior.historyFrom && f.prior.historyTo ? range(f.prior.historyFrom, f.prior.historyTo) : "";
  const restSub = (() => {
    if (f.regime === "insufficient") return "Not enough days logged yet";
    const parts: string[] = [];
    if (f.prior.usualPerDay !== null && f.evidence.completedDays === 0) parts.push(`Your usual ${gbp(f.prior.usualPerDay)} a day × ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"}`);
    else if (f.regime === "this-month-only") parts.push(`This month’s pace for the ${f.daysLeft} days left`);
    else {
      const w = [f.prior.weekdayProfile ? "weekends" : null, f.prior.monthPositionProfile ? "month-end" : null].filter(Boolean).join(" and ");
      parts.push(`Your usual for the ${f.daysLeft} days left${w ? `, ${w} weighted` : ""}`);
      const r = f.evidence.ratioUsed;
      if (Math.abs(r - 1) >= 0.005) parts.push(`${r > 1 ? "plus" : "less"} ${Math.round(Math.abs(r - 1) * 100)}% because ${name} is running ${r > 1 ? "above" : "below"} usual`);
    }
    if (f.evidence.loggedToday > 0) parts.push(`less ${gbp(f.evidence.loggedToday)} already spent today`);
    return parts.join(", ").replace(/^(.)/, (m) => m.toUpperCase());
  })();

  return (
    <div data-testid="why-body" className="stagger">
      <div style={{ textAlign: "center", marginTop: 4 }}>
        {!closed && <ConfidencePill f={f} />}
        <div className="num" data-testid="why-headline" style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.1, marginTop: 12 }}>
          {f.point === null ? <>At least {whole(f.floor)}</> : <>{shown!.approx ? "≈ " : ""}{shown!.approx ? whole(shown!.pence) : gbp(shown!.pence)}</>}
        </div>
        <div className="sub" style={{ marginTop: 4 }} data-testid="why-range">
          {closed ? `${name} actual` : f.point === null ? f.message : `${name} forecast${f.low !== null && f.high !== null ? ` · likely ${whole(f.low)}–${whole(f.high)}` : ""}`}
        </div>
      </div>

      <div style={{ ...group, marginTop: 18 }} data-testid="why-sum">
        {row("spent", "Spent so far", oneOffs.length ? <>{`${day(f.detail.monthStart)}–${formatDayMonth(closed ? end : today)}`} · includes {oneOffs.map((o) => `${gbp(o.amount)} ${o.label.toLowerCase()}`).join(", ")} marked as a one-off, so it isn’t used for your daily pace</> : `${range(f.detail.monthStart, closed ? end : today)}, all categories`, gbp(f.components.spent), true)}
        {!closed && row("bills", "Bills still to come", bills.length ? bills.map((b) => `${b.label} ${ordinal(day(b.date))}${b.varies ? " est." : b.kind === "likely_recurring" ? " (likely)" : ""}`).join(" · ") : "None", `+${gbp(f.components.scheduled)}`)}
        {!closed && f.components.trips > 0 && row("trips", "Trips still to come", "Budget left on the trip, for the days left in this month", `+${gbp(f.components.trips)}`)}
        {!closed && f.components.extras > 0 && row("extras", "Planned", extras.map((e) => `${e.label} ${gbp(e.amount)}`).join(" · "), `+${gbp(f.components.extras)}`)}
        {!closed && f.point !== null && row("rest", "Rest of the month", restSub, `+${gbp(f.components.restOfMonth)}`)}
        <div className="row-between" style={{ padding: "14px 0 10px", borderTop: "1.5px solid var(--ink)" }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{closed ? "Actual" : "Forecast"}, {formatDayMonth(end)}</span>
          <span className="num" data-testid="why-forecast" style={{ fontSize: 17, fontWeight: 600 }}>{f.point === null ? `At least ${gbp(f.floor)}` : gbp(f.point)}</span>
        </div>
      </div>

      {!closed && (
        <>
          {eyebrow("Your usual")}
          <div style={{ ...group, padding: "12px 16px" }} data-testid="why-usual">
            {f.prior.usualPerDay === null ? (
              <div className="sub" style={{ lineHeight: 1.45 }}>{f.regime === "this-month-only" ? "No history to lean on yet, so this month’s own daily pace is used." : "No tracked days yet."}</div>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 500 }}>{gbp(f.prior.usualPerDay)} a day</div>
                <div className="sub" style={{ marginTop: 3, fontSize: 13, lineHeight: 1.45 }}>Average of {f.prior.historyDays} tracked days, {usualDays}. Recent days count more. Bills, trips and one-offs are left out.</div>
                {f.detail.weekdayMultipliers && (
                  <div style={{ borderTop: "1px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{f.explanation.find((s) => /^Week(ends|days) usually/.test(s)) ?? "Weekday pattern is on"}</div>
                    <WeekdayBars m={f.detail.weekdayMultipliers} />
                  </div>
                )}
                {f.detail.positionMultipliers && f.explanation.find((s) => /third of the month/.test(s)) && (
                  <div style={{ borderTop: "1px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{f.explanation.find((s) => /third of the month/.test(s))}</div>
                    <div className="sub" style={{ fontSize: 13, marginTop: 2 }}>Compared with an average third of the month</div>
                  </div>
                )}
              </>
            )}
          </div>

          {eyebrow("This month so far", <span className="sub" style={{ fontSize: 13 }}>Weight on {name}: <b style={{ color: "var(--ink)" }} data-testid="why-weight">{Math.round(f.evidence.weightThisMonth * 100)}%</b></span>)}
          <div style={{ ...group, padding: "12px 16px" }} data-testid="why-evidence">
            {f.evidence.completedDays === 0 ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 500 }}>No full days yet</div>
                <div className="sub" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>Today doesn’t count until it’s over. {name} earns more weight each day: about {Math.round((8 / (8 + (f.prior.kEff ?? 7))) * 100)}% after a week.</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 500 }}>{f.explanation.find((s) => /^Running|^No full/.test(s)) ?? `${f.evidence.completedDays} full days`}</div>
                {f.evidence.ratioActual !== null && (
                  <div className="sub" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>
                    {name} has earned {Math.round(f.evidence.weightThisMonth * 100)}% of the say, so the forecast assumes {f.evidence.ratioUsed >= 1 ? "+" : "−"}{Math.round(Math.abs(f.evidence.ratioUsed - 1) * 100)}%, not {f.evidence.ratioActual >= 1 ? "+" : "−"}{Math.round(Math.abs(f.evidence.ratioActual - 1) * 100)}%.
                    {f.evidence.loggedToday > 0 ? ` Today (${gbp(f.evidence.loggedToday)} so far) counts once it’s over.` : ""}
                  </div>
                )}
              </>
            )}
            <WeightBars f={f} today={today} />
          </div>

          {eyebrow("Getting sharper")}
          <div style={group} data-testid="why-sharper">
            {[
              { on: f.prior.weekdayProfile, title: "Weekday pattern", onT: "is on.", offT: `switches on after 21 tracked days. ${Math.max(0, 21 - f.prior.historyDays)} to go.` },
              { on: f.prior.monthPositionProfile, title: "Payday pattern", onT: "is on.", offT: "needs two months covering each part of the month." },
              { on: (data.input.backtest_mape ?? null) !== null, title: "Accuracy checks", onT: "are on.", offT: "start after 2 full months, then the model tunes itself." },
              { on: f.prior.season !== null, title: "Seasonal pattern", onT: "is on.", offT: "needs 13 months of history." },
            ].map((x, i) => (
              <div key={x.title} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: i ? "1px solid var(--rule)" : undefined }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", marginTop: 1, display: "grid", placeItems: "center", background: x.on ? "var(--positive)" : "transparent", boxShadow: x.on ? undefined : "inset 0 0 0 2px var(--ink-3)", color: "var(--bg)" }}>
                  {x.on && <UI.Check size={14} strokeWidth={3} aria-hidden />}
                </span>
                <span style={{ fontSize: 15, lineHeight: 1.4 }}><b style={{ fontWeight: 600 }}>{x.title}</b> <span style={{ color: "var(--ink-2)" }}>{x.on ? x.onT : x.offT}</span></span>
              </div>
            ))}
          </div>

          {extras.length > 0 && (
            <div style={{ ...group, marginTop: 12 }} data-testid="why-extras">
              {extras.map((e, i) => (
                <div key={e.id} className="row-between" style={{ padding: "11px 0", borderTop: i ? "1px solid var(--rule)" : undefined }}>
                  <span style={{ fontSize: 15 }}>{e.label}<span className="sub" style={{ marginLeft: 8 }}>{gbp(e.amount)}</span></span>
                  <button className="link" onClick={() => removeExtra(e.id!)} aria-label={`Remove ${e.label}`}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <button className="row-between" onClick={onAdd} data-testid="add-extra" style={{ width: "100%", justifyContent: "center", gap: 8, marginTop: 14, minHeight: 52, borderRadius: 14, background: "var(--surface-2)", fontSize: 15, fontWeight: 500 }}>
            <UI.Plus size={16} strokeWidth={2} aria-hidden />Add something you’re planning this month
          </button>
          {input.params_changed && input.today >= input.params_changed.on && (
            <div className="sub" style={{ textAlign: "center", marginTop: 12, fontSize: 13 }} data-testid="why-tuned">{f.explanation.find((s) => s.startsWith("Model updated")) ?? `Model tuned to your data on ${formatDayMonth(input.params_changed.on)}`}</div>
          )}
        </>
      )}
    </div>
  );
}

/** The sheet itself: tap any forecast figure to open it. */
export function ForecastWhySheet({ open, onOpenChange, month }: { open: boolean; onOpenChange: (o: boolean) => void; month: ISODate }) {
  const q = useMonthForecast(month, null, open);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Why this forecast?">
        <div className="vaul-body" data-testid="why-sheet" style={{ maxHeight: "calc(96dvh - 36px)", overflowY: "auto", paddingBottom: 28 }}>
          <div className="sheet-head"><span /><span className="t">Why this forecast?</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
          {q.data ? <ForecastWhy data={q.data} onAdd={() => setAdding(true)} /> : <div className="skeleton" style={{ height: 260 }} aria-busy />}
        </div>
      </Sheet>
      {q.data && <ExtraSheet open={adding} onOpenChange={setAdding} month={month} data={q.data} />}
    </>
  );
}
