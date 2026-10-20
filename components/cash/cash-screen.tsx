"use client";
import { useState } from "react";
import { AccountIcon } from "@/components/accounts/accounts-screen";
import { CashChart } from "@/components/charts/cash-chart";
import { Figure } from "@/components/money";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { accountTypeLabel } from "@/lib/accounts";
import { addMonths, formatLong, formatShort, londonTime, monthEnd, monthStart, yearEnd, yearStart, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useAccounts, useBalances, useCashFlow, useCashSeries, useNow, useToday, useTotals } from "@/lib/queries/hooks";
import { useAnimatedNumber } from "@/lib/use-animated-number";

type Span = "month" | "year";

/** S7: available cash at any moment, how it adds up, and which accounts make it (CASH-02..04). */
export function CashScreen() {
  const today = useToday();
  const now = useNow();
  const [asAt, setAsAt] = useState<ISODate | null>(null);
  const [span, setSpan] = useState<Span>("month");
  const [picking, setPicking] = useState(false);
  const at = asAt && asAt <= today ? asAt : today;
  const isToday = at === today;

  const from = span === "month" ? monthStart(at) : yearStart(at);
  const to = (span === "month" ? monthEnd(at) : yearEnd(at)) < today ? (span === "month" ? monthEnd(at) : yearEnd(at)) : today;
  const series = useCashSeries(from, to);
  // the figure and its equation are for the month containing the chosen day (the owner's definition, PRD §6.5)
  const eqFrom = span === "month" ? monthStart(at) : yearStart(at);
  const flow = useCashFlow(eqFrom, at);
  const incomeN = useTotals({ from: eqFrom, to: at, types: ["income"] }).data?.txn_count;
  const spendN = useTotals({ from: eqFrom, to: at, types: ["expense"] }).data?.txn_count;
  const accounts = useAccounts().data ?? [];
  const balances = useBalances(at).data;
  const cash = useAnimatedNumber(flow.data?.closing_pence);

  const f = flow.data;
  const pool = (balances ?? []).filter((b) => b.counts_as_cash);
  const apart = (balances ?? []).filter((b) => !b.counts_as_cash);
  const typeOf = (id: string) => accounts.find((a) => a.id === id)?.type;
  const n = (c: number | undefined, word: string) => (c === undefined ? "" : `${c} ${word}${c === 1 ? "" : "s"}`);

  return (
    <div className="scroll" style={{ paddingBottom: 48 }}>
      <PageHeader title="" back="/" backLabel="Home"
        right={<button className="icon-btn" style={{ marginRight: 8 }} aria-label="Pick a date" onClick={() => setPicking(true)}><UI.Calendar size={18} strokeWidth={1.75} aria-hidden /></button>} />
      <div className="hero" style={{ marginTop: -26 }}>
        <div className="hero-label">Available cash</div>
        {cash === undefined ? <div className="skeleton" style={{ height: 76, width: 280, marginTop: 10 }} aria-busy /> : (
          <div data-testid="cash-figure" aria-label={`Available cash ${formatGBP(f?.closing_pence ?? 0)}`}><Figure pence={cash} xl /></div>
        )}
        <div className="sub" style={{ marginTop: 10 }} data-testid="as-at">As at {isToday ? `${formatLong(at)}, ${londonTime(now)}` : formatLong(at)}</div>
      </div>

      <div className="card chart-card" style={{ marginTop: 24 }}>
        <div className="row-between">
          <span className="headline">{span === "month" ? (isToday ? "This month" : formatLong(at).split(" ").slice(2).join(" ")) : at.slice(0, 4)}</span>
          <span className="seg" role="tablist" aria-label="Range" style={{ width: 150, height: 32 }}>
            <button role="tab" aria-selected={span === "month"} className={span === "month" ? "on" : ""} onClick={() => setSpan("month")}>Month</button>
            <button role="tab" aria-selected={span === "year"} className={span === "year" ? "on" : ""} onClick={() => setSpan("year")}>Year</button>
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          {series.data ? <CashChart points={series.data.map((p) => ({ day: p.day, cash_pence: p.cash_pence }))} selected={at} onSelect={(d) => setAsAt(d)} label="Available cash by day" /> : <div className="skeleton" style={{ height: 190 }} aria-busy />}
        </div>
        <div className="sub" style={{ marginTop: 10 }}>Drag across the line to see your cash on any day.</div>
      </div>

      <div className="card" style={{ marginTop: 12, paddingBottom: 6 }} data-testid="adds-up">
        <div className="headline" style={{ marginBottom: 6 }}>How it adds up</div>
        {f ? (
          <>
            <Line k="Opening cash" sub={formatLong(eqFrom).split(" ").slice(1).join(" ")} v={formatGBP(f.opening_pence)} />
            <Line k="Income" sub={n(incomeN, "transaction")} v={formatGBP(f.income_pence, { signed: true })} pos />
            <Line k="Spending" sub={n(spendN, "transaction")} v={`−${formatGBP(f.spend_pence)}`} />
            {f.pot_pence !== 0 && <Line k="One-off pots" sub="Kept out of monthly spend" v={formatGBP(f.pot_pence, { signed: true })} />}
            {f.set_aside_pence !== 0 && <Line k="Set aside" sub="Moved to savings" v={formatGBP(f.set_aside_pence, { signed: true })} />}
            {f.adjust_pence !== 0 && <Line k="Adjustments" sub="Balance corrections" v={formatGBP(f.adjust_pence, { signed: true })} />}
            <div className="row-between" style={{ padding: "14px 0 10px", borderTop: "1.5px solid var(--ink)" }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{isToday ? "Available now" : `Available ${formatShort(at)}`}</span>
              <span className="num" style={{ fontSize: 17, fontWeight: 600 }} data-testid="closing">{formatGBP(f.closing_pence)}</span>
            </div>
          </>
        ) : <div className="skeleton" style={{ height: 180, marginBottom: 12 }} aria-busy />}
      </div>

      {balances && (
        <>
          <div className="eyebrow group-label">In available cash</div>
          <div className="list">
            {pool.map((b) => <AccountRow key={b.account_id} name={b.name} type={typeOf(b.account_id)} bal={b.balance_pence} />)}
            {pool.length === 0 && <div className="row"><div className="row-main sub">No accounts count towards available cash.</div></div>}
          </div>
          {apart.length > 0 && (
            <>
              <div className="eyebrow group-label">Not counted</div>
              <div className="list">{apart.map((b) => <AccountRow key={b.account_id} name={b.name} type={typeOf(b.account_id)} bal={b.balance_pence} apart />)}</div>
            </>
          )}
          <p className="sub" style={{ margin: "10px 16px 0", lineHeight: 1.4 }}>Choose which accounts count towards available cash in Accounts.</p>
        </>
      )}

      <Sheet open={picking} onOpenChange={setPicking} title="Pick a date">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">Cash on a day</span><button className="txt" onClick={() => setPicking(false)}>Cancel</button></div>
          <input type="date" className="field w-full" aria-label="Date" max={today} value={at} onChange={(e) => { if (e.target.value) { setAsAt(e.target.value); setPicking(false); } }} />
          <button className="btn secondary" style={{ marginTop: 12, height: 48 }} onClick={() => { setAsAt(null); setPicking(false); }}>Back to now</button>
          <p className="sub" style={{ margin: "10px 4px 0" }}>{formatShort(addMonths(at, 0))}: the figure is worked out from your transactions up to the end of that day.</p>
        </div>
      </Sheet>
    </div>
  );
}

function Line({ k, sub, v, pos }: { k: string; sub?: string; v: string; pos?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "12px 0", borderTop: "1px solid var(--rule)" }}>
      <div><div style={{ fontSize: 16, fontWeight: 500 }}>{k}</div>{sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}</div>
      <span className={`num ${pos ? "pos" : ""}`} style={{ fontSize: 16, fontWeight: 500 }}>{v}</span>
    </div>
  );
}

function AccountRow({ name, type, bal, apart }: { name: string; type?: import("@/lib/types").AccountType; bal: number; apart?: boolean }) {
  return (
    <div className="row" data-testid="cash-account">
      <div className="tile"><AccountIcon type={type ?? "other"} /></div>
      <div className="row-main"><div className="row-t">{name}</div><div className="row-s">{type ? accountTypeLabel(type) : ""}{apart && type === "savings" ? " · set aside" : ""}</div></div>
      <div className="amt">{formatGBP(bal)}</div>
    </div>
  );
}
