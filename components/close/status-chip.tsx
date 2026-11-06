"use client";
// §10.3: the month's status chip, on Analytics for past months and in Settings › Month close.
import Link from "next/link";
import { useCloseChanges, useCloseState } from "@/lib/close/data";
import { closeUrl, statusChip } from "@/lib/close/logic";
import { isClosed, type CloseMonthState } from "@/lib/close/types";
import type { ISODate } from "@/lib/dates";

export const monthPath = (m: ISODate) => `/settings/month-close/${m.slice(0, 7)}`;
const TONE = { pos: "pos", cau: "cau", muted: "muted" } as const;

export function StatusChip({ m, asLink = true }: { m: CloseMonthState; asLink?: boolean }) {
  const changes = useCloseChanges(m.month, m.changed_since_close && isClosed(m.status));
  const chip = statusChip(m, changes.data?.difference ?? null);
  const body = <span className={`mc-pill ${TONE[chip.tone]}`} data-testid="close-chip" data-status={m.status} data-changed={m.changed_since_close ? "1" : "0"}>{chip.label}</span>;
  return asLink ? <Link href={isClosed(m.status) ? monthPath(m.month) : closeUrl(m.month)} aria-label={`${chip.label}. ${isClosed(m.status) ? "Open the review" : "Start the close"}`}>{body}</Link> : body;
}

/** The chip for one month, or nothing when that month cannot be closed (the current month, or before tracking began). */
export function MonthChip({ month }: { month: ISODate }) {
  const state = useCloseState();
  const m = state.data?.months.find((x) => x.month === month);
  if (!m) return null;
  return <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}><StatusChip m={m} /></div>;
}
