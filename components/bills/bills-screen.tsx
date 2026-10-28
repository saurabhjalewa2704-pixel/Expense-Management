"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { resolveOccurrence } from "@/app/actions/recurring";
import { useQuickAdd } from "@/components/capture/quick-add";
import { useToast } from "@/components/ui/toast";
import { billsIn, dotsByDay, summariseMonth, type BillRow } from "@/lib/bills";
import { addMonths, dayOfMonth, formatMonthYear, formatShort, monthEnd, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { fetchTxnRow } from "@/lib/queries/fetchers";
import { useBankHolidays, useRecurringItems, useRecurringOccurrences, useToday } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BillTile, useBillLabels } from "./shared";
import { SchedulerStatus } from "./scheduler-status";
import { Suggestions } from "./suggestions";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** REC-02: this month's bills, logged against to come, the calendar, and the lists under it. */
export function BillsScreen() {
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const quick = useQuickAdd();
  const [month, setMonth] = useState<ISODate>(monthStart(today));
  const [sel, setSel] = useState<ISODate | null>(null);
  const items = useRecurringItems();
  const from = monthStart(month), to = monthEnd(month);
  const occ = useRecurringOccurrences(from, to);
  const holidays = useBankHolidays().data;
  const labels = useBillLabels();
  const rows = useMemo(() => billsIn(items.data ?? [], occ.data ?? [], from, to, holidays), [items.data, occ.data, from, to, holidays]);
  const sum = summariseMonth(rows);
  const dots = useMemo(() => dotsByDay(rows), [rows]);
  const pending = rows.filter((r) => r.state === "pending");
  const coming = rows.filter((r) => r.state === "due");
  const logged = rows.filter((r) => r.state === "logged" || r.state === "estimate" || r.state === "skipped");
  const ended = (items.data ?? []).filter((i) => i.ended_at);
  const paused = (items.data ?? []).filter((i) => i.paused_at && !i.ended_at);
  const empty = !items.isLoading && (items.data ?? []).length === 0;
  const isNow = from === monthStart(today);

  const refresh = () => qc.invalidateQueries();
  const answer = async (r: BillRow, action: "confirm" | "log" | "skip") => {
    if (!r.occurrenceId) return;
    const res = await resolveOccurrence({ occurrence: r.occurrenceId, action });
    if (!res.ok) return toast({ message: res.error, tone: "error" });
    await refresh();
  };
  const openTxn = async (r: BillRow) => {
    if (!r.transactionId) return;
    const row = await fetchTxnRow(supabaseBrowser(), r.transactionId, r.due_on);
    if (row) quick.open({ edit: row });
  };
  const pick = (d: ISODate) => {
    setSel(d);
    document.getElementById(`bill-day-${d}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // the month grid, Monday first
  const lead = weekdayIndex(from);
  const n = Number(to.slice(8));
  const cells: (ISODate | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, "0")}`)];

  const Row = ({ r }: { r: BillRow }) => {
    const i = r.item;
    const est = r.state === "estimate";
    const skipped = r.state === "skipped";
    return (
      <div className="bill-row" id={`bill-day-${r.due_on}`} data-testid="bill-row" data-state={r.state} style={sel === r.due_on ? { background: "var(--surface-2)" } : undefined}>
        <Link className="who" href={`/bills/${i.id}`} aria-label={`${labels.nameOf(i)}, open bill`}>
          <BillTile item={i} icon={labels.iconOf(i)} />
          <div style={{ minWidth: 0 }}>
            <div className="row-t" style={skipped ? { color: "var(--ink-3)", textDecoration: "line-through" } : undefined}>{labels.nameOf(i)}{est && <span className="est" data-testid="est">EST</span>}</div>
            <div className="rs"><UI.Repeat size={13} strokeWidth={1.75} aria-hidden /><span>{skipped ? "Skipped" : labels.captionOf(i)}{r.n && i.max_occurrences ? ` · Payment ${r.n} of ${i.max_occurrences}` : ""}</span></div>
          </div>
        </Link>
        {r.state === "logged" || r.state === "estimate" ? (
          <button className="when" onClick={() => openTxn(r)} aria-label={`${labels.nameOf(i)} ${formatGBP(r.amount_pence)}, open transaction`}>
            <span className="amt num">{est ? "≈ " : ""}{formatGBP(r.amount_pence)}</span><small>{formatShort(r.due_on)}</small>
          </button>
        ) : (
          <Link className="when" href={`/bills/${i.id}`} tabIndex={-1} aria-hidden>
            <span className="amt num" style={skipped ? { color: "var(--ink-3)" } : undefined}>{i.amount_varies ? "≈ " : ""}{formatGBP(r.amount_pence)}</span><small>{formatShort(r.due_on)}</small>
          </Link>
        )}
      </div>
    );
  };

  return (
    <div className="scroll" data-testid="bills">
      <div className="navbar" style={{ justifyContent: "space-between" }}>
        <Link className="back" href="/"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Home</Link>
        <Link className="icon-btn" href="/bills/new" aria-label="New recurring payment"><UI.Plus size={20} strokeWidth={2} aria-hidden /></Link>
      </div>
      <h1 className="large-title">Bills</h1>
      <div className="sub" style={{ marginTop: 6 }}>Logged automatically on the day they’re due</div>

      {empty ? (
        <div className="card" style={{ marginTop: 16, textAlign: "center", padding: "28px 16px" }} data-testid="bills-empty">
          <div className="headline">No bills yet</div>
          <p className="sub" style={{ marginTop: 6 }}>Add rent, subscriptions or anything that repeats, and Sterling logs each one on its day.</p>
          <Link className="btn" href="/bills/new" style={{ marginTop: 16, display: "inline-flex", padding: "0 24px", height: 46 }}>Add a bill</Link>
        </div>
      ) : (
        <>
          <section className="card bill-sum" style={{ marginTop: 16 }} data-testid="bills-summary">
            <div className="row-between"><span className="sub">{formatMonthYear(from).split(" ")[0]} bills · {sum.count} payment{sum.count === 1 ? "" : "s"}</span>{isNow && <span className="sub">Day {dayOfMonth(today)} of {Number(to.slice(8))}</span>}</div>
            <div className="big num" data-testid="bills-total" style={{ marginTop: 4 }}>{formatGBP(sum.total)}</div>
            <div className="bill-bar" aria-hidden>
              {sum.logged > 0 && <i className="a" style={{ flex: sum.logged }} />}
              {sum.toCome > 0 && <i className="b" style={{ flex: sum.toCome }} />}
            </div>
            <div className="bill-split">
              <span><b className="num" data-testid="bills-logged">{formatGBP(sum.logged)}</b> logged · {sum.loggedCount}</span>
              <span><b className="num" data-testid="bills-tocome">{formatGBP(sum.toCome)}</b> to come · {sum.toComeCount}</span>
            </div>
          </section>

          {pending.length > 0 && (
            <section data-testid="bills-pending">
              <div className="section-h"><h2>Due today, confirm?</h2></div>
              <div className="list bill-box">
                {pending.map((r) => (
                  <div key={r.key} className="bill-row" style={{ gridTemplateColumns: "1fr", paddingBottom: 12 }}>
                    <Link className="who" href={`/bills/${r.item.id}`}><BillTile item={r.item} icon={labels.iconOf(r.item)} />
                      <div style={{ minWidth: 0, flex: 1 }}><div className="row-t">{labels.nameOf(r.item)}</div><div className="rs"><span>{labels.archived(r.item) ? "Account no longer active, choose another" : formatShort(r.due_on)}</span></div></div>
                      <span className="amt num" style={{ paddingRight: 16 }}>{formatGBP(r.amount_pence)}</span>
                    </Link>
                    {!labels.archived(r.item) && (
                      <div style={{ display: "flex", gap: 8, padding: "0 16px" }}>
                        <button className="btn" style={{ height: 40, flex: 1, fontSize: 14 }} onClick={() => answer(r, "log")}>Log {formatGBP(r.amount_pence)}</button>
                        <button className="btn secondary" style={{ height: 40, flex: 1, fontSize: 14 }} onClick={() => answer(r, "skip")}>Skip</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{ marginTop: 12 }} aria-label="Calendar" data-testid="bills-calendar">
            <div className="cal-head">
              <button className="icon-btn" aria-label="Previous month" onClick={() => { setMonth(addMonths(from, -1)); setSel(null); }}><UI.ChevronLeft size={16} strokeWidth={2} aria-hidden /></button>
              <span className="m" data-testid="cal-month">{formatMonthYear(from)}</span>
              <button className="icon-btn" aria-label="Next month" onClick={() => { setMonth(addMonths(from, 1)); setSel(null); }}><UI.ChevronRight size={16} strokeWidth={2} aria-hidden /></button>
            </div>
            <div className="cal">
              {DOW.map((d, i) => <span key={i} className="dow" aria-hidden>{d}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={`p${i}`} className="d pad" />;
                const dd = dots.get(d);
                const list = dd ? [...Array(dd.logged).fill("logged"), ...Array(dd.due).fill("due"), ...Array(dd.other).fill("other")] as string[] : [];
                return (
                  <button key={d} className={`d${d === today ? " today" : ""}${d === sel ? " sel" : ""}`} data-day={d} aria-label={`${formatShort(d)}${list.length ? `, ${list.length} bill${list.length === 1 ? "" : "s"}` : ""}`} aria-pressed={d === sel} onClick={() => pick(d)}>
                    <span className="n">{Number(d.slice(8))}</span>
                    <span className="cal-dots" aria-hidden>
                      {list.slice(0, 3).map((k, j) => <i key={j} className={`cal-dot ${k === "due" ? "due" : k === "other" ? "other" : ""}`} />)}
                      {list.length > 3 && <span>+</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="cal-legend"><span><i className="cal-dot" />Logged</span><span><i className="cal-dot due" />Due</span><span><i className="cal-dot other" />Transfer</span></div>
          </section>

          {coming.length > 0 && (
            <section data-testid="bills-coming">
              <div className="section-h"><h2>Coming up</h2><span className="sub num">{formatGBP(sum.toCome)}{sum.transferToCome > 0 ? ` + ${formatGBP(sum.transferToCome)} transfer` : ""}{sum.incomeToCome > 0 ? ` + ${formatGBP(sum.incomeToCome)} in` : ""}</span></div>
              <div className="list bill-box">{coming.map((r) => <Row key={r.key} r={r} />)}</div>
            </section>
          )}

          {logged.length > 0 && (
            <section data-testid="bills-logged-list">
              <div className="section-h"><h2>{isNow ? "Logged this month" : "Logged"}</h2><span className="sub num">{formatGBP(sum.logged)}</span></div>
              <div className="list bill-box">
                {logged.map((r) => (
                  <div key={r.key}><Row r={r} />
                    {r.state === "estimate" && <div style={{ padding: "0 16px 12px 68px" }}><button className="link" style={{ fontSize: 13 }} onClick={() => answer(r, "confirm")}>Looks right</button></div>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {coming.length === 0 && logged.length === 0 && pending.length === 0 && <p className="sub" style={{ margin: "18px 4px" }}>No bills in {formatMonthYear(from)}.</p>}

          {paused.length > 0 && (
            <section data-testid="bills-paused"><div className="section-h"><h2>Paused</h2></div>
              <div className="list">{paused.map((i) => <Link key={i.id} href={`/bills/${i.id}`} className="row"><BillTile item={i} icon={labels.iconOf(i)} /><div className="row-main"><div className="row-t">{labels.nameOf(i)}</div><div className="row-s">Paused · {formatGBP(i.amount_pence)}</div></div></Link>)}</div></section>
          )}
          {ended.length > 0 && (
            <section data-testid="bills-ended"><div className="section-h"><h2>Ended</h2></div>
              <div className="list">{ended.map((i) => <Link key={i.id} href={`/bills/${i.id}`} className="row"><BillTile item={i} icon={labels.iconOf(i)} /><div className="row-main"><div className="row-t">{labels.nameOf(i)}</div><div className="row-s">Stopped · {formatGBP(i.amount_pence)}</div></div></Link>)}</div></section>
          )}
        </>
      )}

      <Suggestions heading={empty ? "Looks like these repeat" : "Add these too?"} />

      {!empty && <SchedulerStatus />}
      {!empty && <p className="bill-note">Logged bills are ordinary transactions: they appear in Activity, count towards available cash and show up in Analytics.</p>}
    </div>
  );
}
