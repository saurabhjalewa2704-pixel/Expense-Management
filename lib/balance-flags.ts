// BAL-01..04 (PRD §6.2a), the same rule the database applies in `set_balance_flags()`. The app uses it to explain an entry
// before it is saved, to show optimistic balances while offline, and to keep the two in step (tests compare them).
import type { ISODate } from "@/lib/dates";

export interface AnchorAccount { opening_date: ISODate; last_reconciled_on?: ISODate | null }

/** The moment the owner last told Sterling this account's true balance. */
export const anchorOn = (a: AnchorAccount): ISODate => (a.last_reconciled_on && a.last_reconciled_on > a.opening_date ? a.last_reconciled_on : a.opening_date);

export type FlagKind =
  | "before_tracking"      // before the account was opened in Sterling: already in the opening balance
  | "on_opening"           // the day it was opened: counts, but the owner may say it was already in
  | "before_reconcile"     // after opening but on or before the last reconcile: ask
  | "counts";              // after the anchor

export function flagKind(a: AnchorAccount, d: ISODate): FlagKind {
  if (d < a.opening_date) return "before_tracking";
  if (d === a.opening_date) return "on_opening";
  if (d <= anchorOn(a)) return "before_reconcile";
  return "counts";
}

/** What the database will choose when the owner gives no answer. */
export const defaultCounts = (a: AnchorAccount, d: ISODate): boolean => {
  const k = flagKind(a, d);
  return k === "on_opening" || k === "counts";
};

/** Optimistic flags for an entry still in the outbox: the two sides of a transfer are judged against their own accounts. */
export function pendingFlags(type: "expense" | "income" | "transfer", d: ISODate, from: AnchorAccount | undefined, to: AnchorAccount | undefined,
  answer?: { a?: boolean | null; b?: boolean | null }): { a: boolean; b: boolean | null } {
  const a = answer?.a ?? (from ? defaultCounts(from, d) : true);
  if (type !== "transfer") return { a, b: null };
  return { a, b: answer?.b ?? (to ? defaultCounts(to, d) : true) };
}

/** The line that explains why a row is not in the balance (BAL-05). */
export function notInBalanceReason(kind: FlagKind): string {
  return kind === "before_tracking" ? "before tracking began" : "already in reconciled balance";
}
