"use client";
// MC-70 (MC11 state 5): editing or adding an entry dated in a closed month says so, and that saving changes its totals. Never blocks.
import { useCloseState } from "@/lib/close/data";
import { monthName } from "@/lib/close/logic";
import { isClosed } from "@/lib/close/types";
import { monthStart, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";

export function ClosedMonthBanner({ date }: { date: ISODate | null | undefined }) {
  const state = useCloseState();
  if (!date) return null;
  const m = state.data?.months.find((x) => x.month === monthStart(date));
  if (!m || !isClosed(m.status)) return null;
  return (
    <div className="mc-banner" role="note" data-testid="closed-month-banner" style={{ marginTop: 10, marginBottom: 0 }}>
      <UI.Info size={16} aria-hidden /><span>{monthName(m.month)} is closed. Saving this changes its totals.</span>
    </div>
  );
}
