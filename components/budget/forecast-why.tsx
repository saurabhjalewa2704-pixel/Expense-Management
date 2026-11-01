"use client";
// "Why this forecast?" (PRD §6.13 BUD-05a rule 8, mock-up 32): the forecast as a sum anyone can check, like the Available-cash equation.
import { formatDayMonth, formatMonthShort, monthEnd } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { ordinal } from "@/lib/recurrence";
import type { MonthForecast } from "@/lib/forecast-data";
import { usePayees, useMonthForecast } from "@/lib/queries/hooks";
import { Sheet } from "@/components/ui/sheet";
import type { ISODate } from "@/lib/dates";

const gbp = (p: number) => formatGBP(p);
const whole = (p: number) => formatGBP(p, { whole: true });
const days = (iso: ISODate) => Number(iso.slice(8));

/** The sum behind a forecast, for the sheet and for anywhere that wants to show it inline. */
export function ForecastWhy({ data, scopeName }: { data: MonthForecast; scopeName?: string }) {
  const payees = usePayees();
  const nameOf = (id: string | null, note: string | null) => payees.data?.find((p) => p.id === id)?.name ?? note ?? "A bill";
  const f = data.forecast, i = data.inputs;
  const month = f.month;
  const to = f.closed ? monthEnd(month) : i.today;
  const bills = data.bills.map((b) => `${nameOf(b.payeeId, b.note)} ${ordinal(days(b.dueOn))}`).join(" · ");
  const used = f.qualifyingMonths.slice().reverse().map((m) => formatMonthShort(m)).join(", ");
  const histRange = `${f.dom}–${f.daysInMonth}`;

  if (!f.available) {
    return (
      <p className="sub" data-testid="why-unavailable" style={{ lineHeight: 1.45, margin: "4px 4px 18px" }}>
        {f.unavailableReason}. {f.closed ? "" : "Nothing is shown rather than a guess."}
      </p>
    );
  }
  const row = (key: string, label: string, sub: string | null, value: string, first = false) => (
    <div key={key} className="row-between" style={{ padding: "12px 0", borderTop: first ? undefined : "1px solid var(--rule)", alignItems: "flex-start", gap: 12 }}>
      <div><div style={{ fontSize: 15, fontWeight: 500 }}>{label}</div>{sub && <div className="sub" style={{ marginTop: 2, fontSize: 12.5 }}>{sub}</div>}</div>
      <span className="num" style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );

  return (
    <div data-testid="why-body">
      <div className="list" style={{ background: "var(--surface-2)", padding: "2px 16px 4px", borderRadius: 12 }}>
        {row("spent", "Spent so far", f.closed ? `${formatDayMonth(month)} to ${formatDayMonth(to)}, ${scopeName ?? "all categories"}` : `${formatDayMonth(month)} to ${formatDayMonth(to)}, ${scopeName ?? "all categories"}`, gbp(f.spent), true)}
        {!f.closed && row("bills", "Bills still to come", bills || "None", `+${gbp(f.billsToCome)}`)}
        {!f.closed && row("rest", "Rest of the month",
          `${gbp(f.expectedPerDay)}/day × ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"}${i.discretionaryToday > 0 ? `, less ${gbp(i.discretionaryToday)} already logged today` : ""}`,
          `+${gbp(f.remaining)}`)}
        <div className="row-between" style={{ padding: "14px 0 10px", borderTop: "1.5px solid var(--ink)" }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{f.closed ? "Actual" : "Forecast"}, {formatDayMonth(monthEnd(month))}</span>
          <span className="num" data-testid="why-forecast" style={{ fontSize: 17, fontWeight: 600 }}>{gbp(f.forecast)}</span>
        </div>
      </div>

      {!f.closed && (
        <>
          <div className="eyebrow" style={{ margin: "18px 4px 8px" }}>How the daily pace is worked out</div>
          <div className="list" style={{ background: "var(--surface-2)", padding: "2px 16px 4px", borderRadius: 12 }}>
            {row("this", "This month", `${gbp(i.discretionary)} non-bill spend ÷ ${f.daysElapsed} tracked ${f.daysElapsed === 1 ? "day" : "days"}`, `${gbp(f.paceThis)} × ${f.wThis * 10}%`, true)}
            {f.paceHist !== null
              ? row("hist", "Your history", `Median for ${histRange} in ${used}`, `${gbp(f.paceHist)} × ${f.wHist * 10}%`)
              : row("hist", "Your history", "No full months tracked yet, so none is used", "–")}
            <div className="row-between" style={{ padding: "12px 0", borderTop: "1px solid var(--rule)" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Daily pace</span>
              <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{gbp(f.expectedPerDay)}/day</span>
            </div>
          </div>
          <p className="sub" style={{ margin: "14px 4px 0", lineHeight: 1.45 }}>
            {f.low !== null && f.high !== null ? `Likely range ${whole(f.low)}–${whole(f.high)}. ` : ""}
            Trips and one-off purchases over 5× your usual are left out of the pace.
            {f.paceHist === null ? " With no full months tracked yet, the pace uses this month only, and no forecast is shown until you’ve logged for 3 days." : ""}
            {f.confidence === "low" ? " This is a low-confidence forecast: there is little history or the month has only just begun." : ""}
          </p>
        </>
      )}
      {f.degenerate && <p className="sub" data-testid="why-degenerate" style={{ margin: "12px 4px 0", color: "var(--caution)" }}>This forecast equals what is already spent and due, which should not happen. It has been logged.</p>}
    </div>
  );
}

/** The sheet itself: tap any forecast figure to open it. */
export function ForecastWhySheet({ open, onOpenChange, month, scope = null, scopeName }: { open: boolean; onOpenChange: (o: boolean) => void; month: ISODate; scope?: string | null; scopeName?: string }) {
  const q = useMonthForecast(month, scope, open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Why this forecast?">
      <div className="vaul-body" data-testid="why-sheet">
        <div className="sheet-head"><span /><span className="t">Why this forecast?</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
        {q.data ? <ForecastWhy data={q.data} scopeName={scopeName} /> : <div className="skeleton" style={{ height: 200 }} aria-busy />}
      </div>
    </Sheet>
  );
}
