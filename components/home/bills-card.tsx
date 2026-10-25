"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useBillLabels } from "@/components/bills/shared";
import { UI } from "@/lib/icons";
import { toComeThisMonth } from "@/lib/bills";
import { formatMonth, formatShort, monthEnd, monthStart } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { useBankHolidays, useRecurringItems, useRecurringOccurrences, useToday } from "@/lib/queries/hooks";

const KEY = "bills.prompt.dismissed";

/** REC-01: a slim card under the pace card ("Bills · £34.97 to come this month · Next: Spotify, Thu 22 Oct"). Until the first bill exists it is a one-time prompt. */
export function BillsCard() {
  const today = useToday();
  const items = useRecurringItems();
  const occ = useRecurringOccurrences(monthStart(today), monthEnd(today));
  const holidays = useBankHolidays().data;
  const labels = useBillLabels();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(localStorage.getItem(KEY) === "1"); } catch { setDismissed(false); } }, []);
  if (items.isLoading || !items.data) return null;

  const list = items.data.filter((i) => !i.ended_at);
  if (items.data.length === 0) {
    if (dismissed) return null;
    return (
      <div className="card" data-testid="bills-prompt" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/bills/new" style={{ flex: 1, minWidth: 0 }}>
          <div className="row-t">Set up your regular bills so they log themselves</div>
          <div className="sub" style={{ marginTop: 2 }}>Rent, subscriptions, anything that repeats</div>
        </Link>
        <button className="icon-btn" aria-label="Dismiss" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ } setDismissed(true); }}><UI.X size={16} strokeWidth={2} aria-hidden /></button>
      </div>
    );
  }
  if (list.length === 0) return null;
  const c = toComeThisMonth(list, occ.data ?? [], today, holidays);
  return (
    <Link href="/bills" className="card" data-testid="bills-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
      <UI.Repeat size={18} strokeWidth={1.75} aria-hidden className="faint" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 500 }}>Bills · {c.count > 0 ? <><span className="num">{formatGBP(c.pence)}</span> to come this month</> : `all logged for ${formatMonth(today)}`}</div>
        {c.next && <div className="sub" style={{ marginTop: 2 }}>Next: {labels.nameOf(c.next.item)}, {formatShort(c.next.due_on)}</div>}
      </div>
      <UI.ChevronRight size={16} strokeWidth={2} aria-hidden className="faint" />
    </Link>
  );
}

