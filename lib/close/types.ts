// Month-end close (MONTH-CLOSE-PRD.md). The shapes the SQL functions return; money is integer pence, dates are London-local ISO strings.
import type { ISODate } from "@/lib/dates";

export type CloseStatus = "open" | "in_progress" | "closed" | "closed_with_skips" | "closed_quick";
export const isClosed = (s: CloseStatus | undefined | null): boolean => s === "closed" || s === "closed_with_skips" || s === "closed_quick";

/** The six steps (§4), in order. `key` is what the database stores, `slug` is the URL. */
export const STEPS = [
  { key: "missing_days", slug: "missing-days", title: "Missing days", blurb: "Days in {month} with nothing logged" },
  { key: "bills", slug: "bills", title: "Bills", blurb: "Estimated or unconfirmed bills" },
  { key: "balances", slug: "balances", title: "Balances", blurb: "Compare each account with your bank" },
  { key: "tidy_up", slug: "tidy-up", title: "Tidy up", blurb: "Possible duplicates and big one-offs" },
  { key: "review", slug: "review", title: "Review", blurb: "How {month} went" },
  { key: "next_month", slug: "next-month", title: "{next}", blurb: "Budget and anything coming up" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
export type StepState = "done" | "skipped" | "nothing";
export const stepBySlug = (slug: string) => STEPS.find((s) => s.slug === slug);

export interface MissingDay { day: ISODate; answer: "no_spend" | "not_tracked" | null }
export interface BillItem {
  occurrence_id: string; item_id: string; payee: string; status: "estimate" | "pending" | "confirmed" | "logged" | "skipped"; due_on: ISODate; amount_pence: number;
  account_name: string; transaction_id: string | null; logged_on: ISODate | null; varies: boolean; answer: "confirmed" | "paid" | "paid_different" | "skipped" | null;
}
export type Resolution = "match" | "untracked_spend" | "untracked_income" | "adjustment";
export interface BalanceItem {
  account_id: string; name: string; type: "current" | "savings" | "credit_card" | "cash" | "other"; counts_as_cash: boolean; sterling_pence: number;
  answer: Resolution | null; payload: { sterling: number; bank: number; difference: number; resolution: Resolution; transaction_id: string | null } | null;
}
export interface DuplicateItem {
  key: string; payee: string; amount_pence: number; account_name: string; answer: "both_real" | null;
  txns: { id: string; occurred_on: ISODate; occurred_at: string | null }[];
}
export interface TidyTxn { id: string; payee: string; amount_pence: number; occurred_on: ISODate; category: string; account_name: string; answer: string | null }

export interface CloseChecks {
  month: ISODate; from: ISODate; to: ISODate; partial: boolean; tracking_started_on: ISODate | null;
  missing_days: MissingDay[]; bills: BillItem[]; balances: BalanceItem[]; duplicates: DuplicateItem[]; large: TidyTxn[]; one_offs: TidyTxn[];
}

export interface CloseSummary {
  month: ISODate; partial: boolean; days: number; spent: number; income: number; kept: number;
  budget: number | null; covers: string | null; budget_spent: number | null; budget_status: "within" | "over" | null;
  everyday: number; bills_regular: number; usual_estimate: number | null; by_l1: Record<string, number>;
  limits: { category_id: string; limit: number; actual: number }[]; forecasts: { date: ISODate; snapshot_day: ISODate; point: number }[]; income_sources: string[];
  /** The recurring part of each L1 category's spend and the sub-categories it sits in. */
  recurring_l1: Record<string, { total: number; names: string[] }>;
}

export interface Snapshot {
  v: 1; month: ISODate; closed_at?: string; spent: number; income: number; kept: number; budget: number | null; budget_status: "within" | "over" | null;
  everyday: number; usual_estimate: number | null; by_l1: Record<string, number>; limits: { category_id: string; limit: number; actual: number }[];
  forecasts: { date: ISODate; point: number }[];
  balances: { account_id: string; sterling: number; bank: number; difference: number; resolution: Resolution; transaction_id: string | null }[];
  fixes: { days_no_spend: number; days_not_tracked: number; bills_confirmed: number; duplicates_removed: number; one_offs_changed: number };
  skipped_steps: StepKey[];
}

export interface CloseRow {
  id: string; month: ISODate; status: CloseStatus; step_state: Partial<Record<StepKey, StepState>>; started_at: string | null; closed_at: string | null;
  duration_s: number | null; snapshot: Snapshot | null; snapshot_rev: number; changed_since_close: boolean; last_changed_at: string | null; reopened_count: number; summary: string | null;
}

export interface CloseMonthState {
  month: ISODate; status: CloseStatus; step_state: Partial<Record<StepKey, StepState>>; started_at: string | null; closed_at: string | null; changed_since_close: boolean;
  spent: number | null; snapshot_rev: number; prompted: boolean; partial: boolean; duration_s: number | null; reopened_count: number;
}
export interface CloseState { current: ISODate; since: ISODate | null; months: CloseMonthState[]; closed_count?: number }

export interface CloseChanges {
  closed_at: string; spent_before: number; spent_now: number; difference: number;
  categories: { category_id: string; before: number; now: number }[];
  transactions: { id: string; kind: "added" | "edited" | "deleted"; payee: string | null; amount_pence: number; type: string; occurred_on: ISODate; at: string }[];
}
