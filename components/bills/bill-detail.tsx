"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { deleteRecurring, pauseRecurring, resolveOccurrence, resumeRecurring, skipNext, stopRecurring, unskip } from "@/app/actions/recurring";
import { useQuickAdd } from "@/components/capture/quick-add";
import { ChartCard } from "@/components/charts/chart-card";
import { MonthlyBars, type MonthlyBar } from "@/components/charts/monthly-bars";
import { useToast } from "@/components/ui/toast";
import { asRule } from "@/lib/bills";
import { addDays, formatLong, formatMonth, formatShort, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { average } from "@/lib/analytics";
import { formatGBP } from "@/lib/money";
import { describeRule, nextOccurrences } from "@/lib/recurrence";
import { fetchTxnRow } from "@/lib/queries/fetchers";
import { useBankHolidays, useItemOccurrences, useRecurringItems, useToday } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { RecurringOccurrence } from "@/lib/types";
import { BillTile, useBillLabels } from "./shared";

const statusText = (o: RecurringOccurrence) =>
  o.status === "skipped" ? "Skipped" : o.status === "pending" ? "Waiting for you" : `Logged ${formatShort(o.due_on)} · ${o.status === "estimate" ? "estimate" : o.status === "confirmed" ? "confirmed" : "automatic"}`;

/** REC-06: the next payment, Skip next / Pause / Edit, the last six payments, the history and Stop. */
export function BillDetail({ id }: { id: string }) {
  const today = useToday();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const quick = useQuickAdd();
  const items = useRecurringItems();
  const occ = useItemOccurrences(id);
  const holidays = useBankHolidays().data;
  const labels = useBillLabels();
  const [confirm, setConfirm] = useState<"stop" | "delete" | null>(null);
  const item = (items.data ?? []).find((i) => i.id === id);
  const history = useMemo(() => occ.data ?? [], [occ.data]);

  const upcoming = useMemo(() => {
    if (!item || item.ended_at) return null;
    const recorded = new Set(history.map((o) => o.scheduled_on));
    const from = item.next_due_on;
    return nextOccurrences(asRule(item), from, addDays(from, 800), holidays).find((o) => !recorded.has(o.scheduled_on)) ?? null;
  }, [item, history, holidays]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    const r = await fn();
    if (!r.ok) return toast({ message: r.error ?? "Something went wrong.", tone: "error" });
    await qc.invalidateQueries();
    if (done) toast({ message: done });
  };
  const openTxn = async (o: RecurringOccurrence) => {
    if (!o.transaction_id) return;
    const row = await fetchTxnRow(supabaseBrowser(), o.transaction_id, o.due_on);
    if (row) quick.open({ edit: row });
  };

  if (!item) return <div className="scroll"><div className="navbar"><Link className="back" href="/bills"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Bills</Link></div></div>;

  const name = labels.nameOf(item);
  const parent = labels.parentOf(item);
  const real = history.filter((o) => o.status !== "skipped" && o.status !== "pending").slice(0, 6).reverse();
  const bars: MonthlyBar[] = real.map((o, k) => ({ month: o.due_on, spend: o.amount_pence, projectedExtra: 0, isCurrent: k === real.length - 1 }));
  const avg = average(real.map((o) => o.amount_pence));
  const latest = real.at(-1);
  const finding = !latest ? "No payments logged yet"
    : real.every((o) => o.amount_pence === real[0]!.amount_pence) ? `Always ${formatGBP(latest.amount_pence)}`
    : real.length >= 3 && latest.amount_pence >= Math.max(...real.map((o) => o.amount_pence)) ? `${formatMonth(latest.due_on)} was your highest in ${real.length === 6 ? "six" : real.length} payments`
    : real.length >= 3 && latest.amount_pence <= Math.min(...real.map((o) => o.amount_pence)) ? `${formatMonth(latest.due_on)} was your lowest in ${real.length === 6 ? "six" : real.length} payments`
    : `Last payment ${formatGBP(latest.amount_pence)}, against an average of ${formatGBP(avg)}`;
  const state = item.ended_at ? "ended" : item.paused_at ? "paused" : "active";
  const pendingSkip = history.find((o) => o.status === "skipped" && o.due_on > today);

  return (
    <div className="scroll" data-testid="bill-detail">
      <div className="navbar" style={{ justifyContent: "space-between" }}>
        <Link className="back" href="/bills"><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />Bills</Link>
        {state !== "ended" && <Link className="icon-btn" href={`/bills/${id}/edit`} aria-label="Edit"><UI.Pencil size={18} strokeWidth={1.75} aria-hidden /></Link>}
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 8 }}>
        <div style={{ transform: "scale(1.25)", transformOrigin: "left center", marginRight: 10 }}><BillTile item={item} icon={labels.iconOf(item)} /></div>
        <div style={{ minWidth: 0 }}>
          <h1 className="large-title" style={{ fontSize: "var(--t-large)" }}>{name}</h1>
          <div className="sub" style={{ marginTop: 2 }}>{item.type === "transfer" ? `Transfer · ${labels.accountName(item.account_id)}` : [labels.captionOf(item).split(" · ")[0], parent, labels.accountName(item.account_id)].filter(Boolean).join(" · ")}</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }} data-testid="bill-next">
        <div className="row-between"><span className="sub">{state === "ended" ? "Stopped" : state === "paused" ? "Paused" : "Next payment"}</span><span className="sub" style={{ display: "flex", gap: 6, alignItems: "center" }}><UI.Repeat size={14} strokeWidth={1.75} aria-hidden />{describeRule(item)}</span></div>
        {state === "active" && upcoming ? (
          <>
            <div className="num" data-testid="bill-next-amount" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-.02em", marginTop: 6 }}>{item.amount_varies ? "≈ " : ""}{formatGBP(item.amount_varies ? history.find((o) => o.status === "confirmed")?.amount_pence ?? item.amount_pence : item.amount_pence)}</div>
            <div style={{ marginTop: 6, fontWeight: 500 }} data-testid="bill-next-date">{formatLong(upcoming.due_on)} · {item.auto_log ? "logged at 6am" : "reminder at 6am"}</div>
            {item.amount_varies && <p className="sub" style={{ marginTop: 6 }}>Amount varies: Sterling logs your last amount as an estimate and asks you to confirm it.</p>}
          </>
        ) : (
          <p className="sub" style={{ marginTop: 10 }}>{state === "paused" ? "Nothing is logged while this is paused, and nothing is made up for the time it was paused." : "No more payments will be made."}</p>
        )}
      </section>

      {state !== "ended" && (
        <div className="bill-act">
          {pendingSkip
            ? <button onClick={() => run(() => unskip(pendingSkip.id), "Skip undone")} data-testid="bill-unskip"><UI.SkipForward size={20} strokeWidth={1.75} aria-hidden />Undo skip</button>
            : <button disabled={state !== "active" || !upcoming} onClick={() => run(() => skipNext(id), "Skipped. You can undo it until the due date.")} data-testid="bill-skip"><UI.SkipForward size={20} strokeWidth={1.75} aria-hidden />Skip next</button>}
          {state === "paused"
            ? <button onClick={() => run(() => resumeRecurring(id), "Resumed")} data-testid="bill-resume"><UI.Play size={20} strokeWidth={1.75} aria-hidden />Resume</button>
            : <button onClick={() => run(() => pauseRecurring(id), "Paused")} data-testid="bill-pause"><UI.Pause size={20} strokeWidth={1.75} aria-hidden />Pause</button>}
          <button onClick={() => router.push(`/bills/${id}/edit`)}><UI.Pencil size={20} strokeWidth={1.75} aria-hidden />Edit</button>
        </div>
      )}

      {real.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <ChartCard testId="bill-chart" finding={finding} sub={`Last ${real.length} payment${real.length === 1 ? "" : "s"} · average ${formatGBP(avg)}`}
            table={{ columns: ["Date", "Amount"], rows: real.map((o) => [o.due_on, formatGBP(o.amount_pence)]) }}>
            <MonthlyBars bars={bars} flagged={false} precise ariaLabel={`${name}, last ${real.length} payments`} />
          </ChartCard>
        </div>
      )}

      <div className="section-h"><h2>History</h2></div>
      <div className="list" data-testid="bill-history">
        {history.map((o) => (
          <div key={o.id} className="bill-row" data-testid="bill-history-row" data-status={o.status}>
            <button className="who" style={{ textAlign: "left" }} disabled={!o.transaction_id} onClick={() => openTxn(o)}>
              <div style={{ minWidth: 0 }}>
                <div className="row-t" style={{ fontWeight: 400 }}>{formatMonth(o.due_on)} {o.due_on.slice(0, 4)}</div>
                <div className="rs"><span>{statusText(o)}</span></div>
              </div>
            </button>
            <div className="when" style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              {o.status === "estimate" && <button className="link" style={{ fontSize: 13 }} onClick={() => run(() => resolveOccurrence({ occurrence: o.id, action: "confirm" }), "Confirmed")}>Looks right</button>}
              {o.status === "skipped" && o.due_on > today && <button className="link" style={{ fontSize: 13 }} onClick={() => run(() => unskip(o.id), "Skip undone")}>Undo</button>}
              <span className="amt num" style={o.status === "skipped" ? { color: "var(--ink-3)" } : undefined}>{formatGBP(o.amount_pence)}</span>
            </div>
          </div>
        ))}
        {history.length === 0 && <div className="row"><div className="row-main sub">Nothing yet. The first payment will appear here on {upcoming ? formatShort(upcoming.due_on as ISODate) : "its day"}.</div></div>}
      </div>

      {state === "ended" ? (
        <button className="btn secondary" style={{ marginTop: 22, color: "var(--danger)" }} onClick={() => setConfirm("delete")} data-testid="bill-delete">Delete this recurring payment</button>
      ) : (
        <>
          <button className="btn secondary" style={{ marginTop: 22, color: "var(--danger)" }} onClick={() => setConfirm("stop")} data-testid="bill-stop">Stop this recurring payment</button>
          <p className="bill-note">Stopping keeps every payment already logged. Nothing new is created from the next due date.</p>
        </>
      )}

      {confirm && (
        <div role="alertdialog" aria-label={confirm === "stop" ? "Stop this recurring payment?" : "Delete this recurring payment?"} style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "grid", placeItems: "end center", padding: "var(--gutter)", zIndex: 60 }}>
          <div className="card" style={{ width: "100%", maxWidth: 480, background: "var(--surface-2)" }}>
            <div className="headline">{confirm === "stop" ? `Stop ${name}?` : `Delete ${name}?`}</div>
            <p className="sub" style={{ marginTop: 4 }}>{confirm === "stop" ? "Every payment already logged stays in Activity. Nothing new is created." : "The payments already logged stay in Activity; they just stop being linked to a bill."}</p>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ height: 48, background: "var(--danger)", color: "var(--ink)" }} data-testid="bill-confirm"
                onClick={async () => { setConfirm(null); await run(() => (confirm === "stop" ? stopRecurring(id) : deleteRecurring(id)), confirm === "stop" ? "Stopped" : "Deleted"); if (confirm === "delete") router.replace("/bills"); }}>
                {confirm === "stop" ? "Stop" : "Delete"}
              </button>
              <button className="btn secondary" style={{ height: 48 }} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
