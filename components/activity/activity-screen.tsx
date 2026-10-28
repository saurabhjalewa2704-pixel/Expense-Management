"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountsFilterSheet, AmountFilterSheet, CategoriesFilterSheet, PeriodSheet, PotFilterSheet, TripFilterSheet, TypeFilterSheet, periodLabel, periodRange, type Period } from "./filter-sheets";
import { TxnItem } from "./txn-row";
import { groupByDay } from "@/components/accounts/account-detail";
import { dayHeader, todayLondon } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useActivity, useTotals, useToday } from "@/lib/queries/hooks";
import type { ActivityFilters } from "@/lib/queries/keys";
import { parseSearch } from "@/lib/search";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import type { TxnRow } from "@/lib/types";

/** S4: grouped by day with net totals, search, and filter chips (ACT-01..03). */
export function ActivityScreen() {
  const qc = useQueryClient();
  const today = useToday();
  const spq = useSearchParams();
  const [input, setInput] = useState(spq.get("q") ?? "");
  const [debounced, setDebounced] = useState(spq.get("q") ?? "");
  // drill-down links (Analytics, top payees) arrive with ?categories=&from=&to=&payee=
  const sp = useSearchParams();
  const urlFrom = sp.get("from") ?? undefined, urlTo = sp.get("to") ?? undefined;
  const [payeeId, setPayeeId] = useState<string | undefined>(sp.get("payee") ?? undefined);
  const [trip, setTrip] = useState<string | undefined>(sp.get("trip") ?? undefined);
  const [period, setPeriod] = useState<Period>(urlFrom || urlTo ? { key: "custom", from: urlFrom, to: urlTo } : sp.get("trip") ? { key: "all" } : { key: "this-month", ...periodRange("this-month", todayLondon()) });
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>(sp.get("categories")?.split(",").filter(Boolean) ?? []);
  const [types, setTypes] = useState<string[]>([]);
  const [amount, setAmount] = useState<{ min?: number; max?: number }>({});
  const [pot, setPot] = useState<ActivityFilters["pot"]>((sp.get("pot") as ActivityFilters["pot"]) ?? undefined);
  const [recurring, setRecurring] = useState(sp.get("recurring") === "1");
  const [sheet, setSheet] = useState<null | "period" | "accounts" | "category" | "type" | "amount" | "pot" | "trip">(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(input), 250); return () => clearTimeout(t); }, [input]);

  const filters = useMemo<ActivityFilters>(() => {
    const s = parseSearch(debounced);
    return {
      q: s.text || undefined, amount: s.amount, min: s.min ?? amount.min, max: s.max ?? amount.max,
      from: period.from, to: period.to, payeeId, pot, recurring: recurring || undefined, trip,
      accountIds: accountIds.length ? accountIds : undefined, categoryIds: categoryIds.length ? categoryIds : undefined, types: types.length ? types : undefined,
    };
  }, [debounced, period, accountIds, categoryIds, types, amount, payeeId, pot, recurring, trip]);

  const activity = useActivity(filters);
  const totals = useTotals(filters);
  const groups = useMemo(() => groupByDay(activity.rows), [activity.rows]);
  const { pull, refreshing } = usePullToRefresh(() => qc.invalidateQueries());

  // infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && activity.hasNextPage && !activity.isFetchingNextPage) void activity.fetchNextPage(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [activity]);

  const active = (n: number) => (n ? ` · ${n}` : "");
  const exportHref = `/api/export?format=csv${filters.from ? `&from=${filters.from}` : ""}${filters.to ? `&to=${filters.to}` : ""}${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ""}${accountIds.length ? `&accounts=${accountIds.join(",")}` : ""}${categoryIds.length ? `&categories=${categoryIds.join(",")}` : ""}${types.length ? `&types=${types.join(",")}` : ""}${pot ? `&pot=${pot}` : ""}`;
  const t = totals.data;

  return (
    <div className="scroll">
      {(pull > 0 || refreshing) && <div aria-hidden style={{ position: "fixed", top: "calc(var(--safe-top) - 8px)", left: 0, right: 0, display: "grid", placeItems: "center", height: Math.max(pull, refreshing ? 40 : 0), overflow: "hidden", zIndex: 5 }}><UI.RefreshCw size={20} className={refreshing ? "caret" : ""} style={{ opacity: Math.min(1, pull / 64), transform: `rotate(${pull * 4}deg)` }} /></div>}
      <div className="topbar" style={{ justifyContent: "flex-end" }}>
        <a className="icon-btn" aria-label="Export CSV" href={exportHref} download><UI.Download size={18} strokeWidth={1.75} aria-hidden /></a>
      </div>
      <h1 className="large-title">Activity</h1>
      <label className="field" style={{ marginTop: 14, height: 44, background: "var(--surface)" }}>
        <UI.Search size={18} strokeWidth={1.75} className="faint" aria-hidden />
        <input style={{ flex: 1, background: "none", border: 0, outline: "none", minWidth: 0 }} type="search" enterKeyHint="search" placeholder="Payee, note, category or £ amount" aria-label="Search transactions" value={input} onChange={(e) => setInput(e.target.value)} data-testid="search" />
        {input && <button aria-label="Clear search" onClick={() => setInput("")}><UI.X size={16} strokeWidth={2} className="faint" /></button>}
      </label>

      <div className="chips nowrap" style={{ marginTop: 12, overflowX: "auto", scrollbarWidth: "none" }}>
        <button className={`chip plain ${period.key !== "all" ? "sel" : ""}`} onClick={() => setSheet("period")}>{periodLabel(period, today)} <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${accountIds.length ? "sel" : ""}`} onClick={() => setSheet("accounts")}>Accounts{active(accountIds.length)} <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${categoryIds.length ? "sel" : ""}`} onClick={() => setSheet("category")}>Category{active(categoryIds.length)} <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${types.length ? "sel" : ""}`} onClick={() => setSheet("type")}>Type{active(types.length)} <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${pot ? "sel" : ""}`} onClick={() => setSheet("pot")}>One-off <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${trip ? "sel" : ""}`} data-testid="trip-chip-filter" onClick={() => setSheet("trip")}><UI.MapPin size={14} strokeWidth={1.75} aria-hidden />Trip <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
        <button className={`chip plain ${recurring ? "sel" : ""}`} aria-pressed={recurring} data-testid="recurring-chip" onClick={() => setRecurring((v) => !v)}><UI.Repeat size={14} strokeWidth={1.75} aria-hidden />Recurring</button>
        <button className={`chip plain ${amount.min != null || amount.max != null ? "sel" : ""}`} onClick={() => setSheet("amount")}>Amount <UI.ChevronDown size={14} strokeWidth={2} aria-hidden /></button>
      </div>

      {payeeId && <div className="chips" style={{ marginTop: 10 }}><button className="chip plain sel" onClick={() => setPayeeId(undefined)} aria-label="Remove payee filter">One payee <UI.X size={14} strokeWidth={2} aria-hidden /></button></div>}
      <div className="sub" style={{ margin: "14px 2px 0" }} data-testid="summary" aria-live="polite">
        {t ? (<>{t.txn_count.toLocaleString("en-GB")} transaction{t.txn_count === 1 ? "" : "s"} · <span className="num">{formatGBP(t.spend_pence)}</span> out{t.income_pence > 0 && <> · <span className="num pos">{formatGBP(t.income_pence)}</span> in</>}{!!t.pot_pence && <> · <span className="num" data-testid="pot-total">{formatGBP(Math.abs(t.pot_pence))}</span> {t.pot_pence < 0 ? "out" : "in"} in pots</>}</>) : " "}
      </div>

      {activity.isLoading && activity.rows.length === 0 ? (
        <div className="list" style={{ marginTop: 24 }} aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div>)}</div>
      ) : groups.length === 0 ? (
        <div className="card" style={{ marginTop: 24, textAlign: "center", padding: 28 }}>
          <div className="headline">{debounced || accountIds.length || categoryIds.length || types.length ? "Nothing matches" : "No transactions here"}</div>
          <p className="sub" style={{ marginTop: 6 }}>{debounced || accountIds.length || categoryIds.length || types.length ? "Try a different search or clear a filter." : "Add one with the ＋ button."}</p>
        </div>
      ) : (
        groups.map((g) => <DayGroup key={g.day} day={g.day} rows={g.rows} today={today} />)
      )}
      <div ref={sentinel} style={{ height: 1 }} />
      {activity.isFetchingNextPage && <p className="sub" style={{ textAlign: "center", margin: "16px 0" }}>Loading…</p>}

      <TripFilterSheet open={sheet === "trip"} onOpenChange={(o) => setSheet(o ? "trip" : null)} value={trip} onChange={setTrip} />
      <PotFilterSheet open={sheet === "pot"} onOpenChange={(o) => setSheet(o ? "pot" : null)} value={pot} onChange={setPot} />
      <PeriodSheet open={sheet === "period"} onOpenChange={(o) => setSheet(o ? "period" : null)} value={period} today={today} onChange={setPeriod} />
      <AccountsFilterSheet open={sheet === "accounts"} onOpenChange={(o) => setSheet(o ? "accounts" : null)} value={accountIds} onChange={setAccountIds} />
      <CategoriesFilterSheet open={sheet === "category"} onOpenChange={(o) => setSheet(o ? "category" : null)} value={categoryIds} onChange={setCategoryIds} />
      <TypeFilterSheet open={sheet === "type"} onOpenChange={(o) => setSheet(o ? "type" : null)} value={types} onChange={setTypes} />
      <AmountFilterSheet open={sheet === "amount"} onOpenChange={(o) => setSheet(o ? "amount" : null)} min={amount.min} max={amount.max} onChange={setAmount} />
    </div>
  );
}

/** The day's net: income minus spend (transfers and adjustments are not behaviour). */
function dayNet(rows: TxnRow[]): number {
  return rows.reduce((s, r) => s + (r.type === "income" ? r.amount_pence : r.type === "expense" ? -r.amount_pence : 0), 0);
}

function DayGroup({ day, rows, today }: { day: string; rows: TxnRow[]; today: string }) {
  const net = dayNet(rows);
  return (
    <section aria-label={dayHeader(day, today)}>
      <div className="day-h"><b>{dayHeader(day, today)}</b><span className={`num ${net > 0 ? "pos" : ""}`} data-testid="day-net">{formatGBP(net, { signed: true })}</span></div>
      <div className="list">{rows.map((r) => <TxnItem key={r.client_id} row={r} />)}</div>
    </section>
  );
}
