"use client";
import { useQuickAdd } from "@/components/capture/quick-add";
import { addDays, formatShort, londonTime, todayLondon, type ISODate } from "@/lib/dates";
import { rowSubtitle, rowTitle } from "@/lib/categories";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import type { TxnRow } from "@/lib/types";

/** The little "when" on Home rows: a time for today, "Yesterday", else the weekday. */
export function recentWhen(r: TxnRow, today: ISODate = todayLondon()): string {
  if (r.occurred_on === today) return londonTime(r.occurred_at ?? r.created_at);
  if (r.occurred_on === addDays(today, -1)) return "Yesterday";
  return formatShort(r.occurred_on).split(" ")[0]!;
}

export function rowAmount(r: TxnRow): { text: string; positive: boolean; muted: boolean } {
  if (r.type === "income") return { text: formatGBP(r.amount_pence, { signed: true }), positive: true, muted: false };
  if (r.type === "transfer") return { text: formatGBP(r.amount_pence), positive: false, muted: true };
  if (r.type === "adjustment") return { text: formatGBP(r.amount_pence, { signed: true }), positive: false, muted: true };
  return { text: formatGBP(r.amount_pence), positive: false, muted: false };
}

/** BAL-05: a row that does not move a balance says so under its amount (it is never hidden). */
export const notInBalance = (r: Pick<TxnRow, "type" | "counts_in_balance" | "counter_counts_in_balance">) =>
  r.type === "transfer" ? r.counts_in_balance === false && r.counter_counts_in_balance === false : r.counts_in_balance === false;

/** One transaction. Tapping opens it in Quick Add to edit (CAP-04). */
export function TxnItem({ row, subtitle }: { row: TxnRow; subtitle?: string }) {
  const { open } = useQuickAdd();
  const amt = rowAmount(row);
  const icon = row.type === "transfer" ? <UI.ArrowLeftRight size={20} strokeWidth={1.75} aria-hidden />
    : row.type === "adjustment" ? <UI.SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
    : <CategoryIcon name={row.category_icon ?? undefined} size={20} />;
  return (
    <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => open({ edit: row })} data-testid="txn-row" data-pending={row.pending ? "" : undefined}>
      <div className={`tile ${row.type === "income" ? "pos" : ""}`}>{icon}</div>
      <div className="row-main">
        <div className="row-t">{rowTitle(row)}{row.recurring_id && <UI.Repeat size={13} strokeWidth={1.75} aria-label="Recurring" className="faint" style={{ marginLeft: 6, verticalAlign: "-1px" }} data-testid="recurring-glyph" />}{row.is_estimate && <span className="est" data-testid="est">EST</span>}</div>
        <div className="row-s">{subtitle ?? rowSubtitle(row)}</div>
      </div>
      <div className={`amt ${amt.positive ? "pos" : ""} ${amt.muted ? "muted" : ""}`}>
        {amt.text}
        {notInBalance(row) && <small data-testid="not-in-balance" style={{ display: "block", color: "var(--ink-3)", fontWeight: 400 }}>Not in balance</small>}
        {row.pending && (
          <small aria-label="Waiting to sync" title="Waiting to sync" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
            <UI.CloudUpload size={12} strokeWidth={2} aria-hidden /> Waiting
          </small>
        )}
      </div>
    </button>
  );
}
