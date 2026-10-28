// Row shapes returned by Supabase (PRD §10.2). Money fields are integer pence.
import type { ISODate } from "./dates";

export type AccountType = "current" | "savings" | "credit_card" | "cash" | "other";
export type TxnType = "expense" | "income" | "transfer" | "adjustment";
export type CategoryKind = "expense" | "income";
export type TxnSource = "app" | "nl" | "shortcut" | "recurring" | "favourite" | "receipt";
export type CategoryColor = "stone" | "sage" | "moss" | "sky" | "slate" | "clay" | "sand" | "plum" | "rose" | "ochre";

export interface Profile {
  id: string;
  display_name: string | null;
  month_start_day: number;
  timezone: string;
  tap_to_save: boolean;
  ai_enabled: boolean;
  ai_include_notes: boolean;
  lock_after_min: number | null;
  reminder_enabled: boolean;
  reminder_time: string; // "21:00:00"
  reminder_prompted: boolean;
  bills_notify: boolean;
  /** The earliest opening date of a live account; months before it are "Partial: before tracking" (BAL-07). */
  tracking_started_on?: ISODate | null;
  last_reminder_on: ISODate | null;
  onboarded_at: string | null;
}

export interface Account {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  opening_balance_pence: number;
  opening_date: ISODate;
  /** The last reconcile; with the opening date it is the balance anchor (BAL-01). */
  last_reconciled_on?: ISODate | null;
  counts_as_cash: boolean;
  is_default: boolean;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  kind: CategoryKind;
  name: string;
  icon: string;
  color: CategoryColor;
  sort_order: number;
  is_fixed: boolean;
  archived_at: string | null;
}

export interface Payee {
  id: string;
  name: string;
  name_norm: string;
  default_category_id: string | null;
  default_account_id: string | null;
  use_count: number;
  last_used_at: string | null;
}

export interface Transaction {
  id: string;
  client_id: string;
  type: TxnType;
  amount_pence: number;
  account_id: string;
  counter_account_id: string | null;
  category_id: string | null;
  payee_id: string | null;
  note: string | null;
  tags: string[];
  occurred_on: ISODate;
  occurred_at: string | null;
  source: TxnSource;
  needs_review: boolean;
  pot_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A row of list_transactions(): the transaction with its labels joined. */
export interface TxnRow {
  id: string;
  client_id: string;
  type: TxnType;
  amount_pence: number;
  account_id: string;
  account_name: string;
  counter_account_id: string | null;
  counter_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  parent_category_id: string | null;
  parent_category_name: string | null;
  category_icon: string | null;
  payee_id: string | null;
  payee_name: string | null;
  note: string | null;
  tags: string[];
  occurred_on: ISODate;
  occurred_at: string | null;
  source: TxnSource;
  needs_review: boolean;
  created_at: string;
  pot_id: string | null;
  pot_name: string | null;
  /** The recurring payment that logged this (REC-09), and whether its amount is still an estimate. Absent on older cached rows. */
  recurring_id?: string | null;
  is_estimate?: boolean;
  /** Whether this row moves an account balance (BAL-02). Absent on older cached rows: then it does. */
  counts_in_balance?: boolean;
  counter_counts_in_balance?: boolean | null;
  is_reconcile?: boolean;
  occurred_tz?: string | null;
  /** Set on rows that exist only in the offline outbox and have not reached the server yet. */
  pending?: boolean;
}

export interface AccountBalance {
  account_id: string;
  name: string;
  type: AccountType;
  counts_as_cash: boolean;
  balance_pence: number;
}

export interface CashFlow {
  opening_pence: number;
  income_pence: number;
  spend_pence: number;
  /** Net of one-off pot income and expenses in the period (not part of usual spending). */
  pot_pence: number;
  set_aside_pence: number;
  adjust_pence: number;
  closing_pence: number;
}

export interface MonthPace {
  month_start: ISODate;
  day_of_month: number;
  days_in_month: number;
  spend_pence: number;
  prev_spend_pence: number;
  prev_label_day: number;
  /** Last month's whole-month spend: the scale of the pace bar. */
  prev_total_pence: number;
}

export interface CategorySpend {
  category_id: string;
  name: string;
  icon: string;
  color: CategoryColor;
  parent_id: string | null;
  total_pence: number;
  txn_count: number;
  norm_pence: number | null;
  /** Name of the parent when this is a sub-category; null for a top-level category. */
  parent_name: string | null;
  /** True for a fixed sub-category, or a parent whose sub-categories are all fixed. */
  is_fixed: boolean;
  /** Spend assigned straight to a parent (shown as "Other ‹parent›"); only set in the leaf view. */
  is_parent_direct: boolean;
  visits: number;
}

export interface TopPlace { payee_id: string; name: string; category_id: string; category_name: string | null; visits: number; total_pence: number }

export interface DailySpend { day: ISODate; total_pence: number; cumulative_pence: number }
export interface MonthlyTotal { month: ISODate; income_pence: number; spend_pence: number }
export interface PayeeTotal { payee_id: string; name: string; visits: number; total_pence: number; avg_pence: number }
export interface TxnTotals { txn_count: number; spend_pence: number; income_pence: number; pot_pence: number }

/** A one-off pot such as "Home purchase": real money, never part of usual spending. */
export interface Pot { pot_id: string; name: string; target_pence: number | null; closed_at: string | null; spent_pence: number; received_pence: number; net_pence: number; txn_count: number; first_on: ISODate | null; last_on: ISODate | null }
export interface PotCategory { category_id: string | null; name: string; icon: string; color: CategoryColor; total_pence: number; txn_count: number }

// ── Bills (PRD §6.9) ───────────────────────────────────────────────────────────────────────────────────────────────
export type RecurFreq = "weekly" | "monthly" | "quarterly" | "yearly";
export type OccurStatus = "logged" | "estimate" | "confirmed" | "pending" | "skipped";

export interface RecurringItem {
  id: string;
  type: "expense" | "income" | "transfer";
  amount_pence: number;
  amount_varies: boolean;
  account_id: string;
  counter_account_id: string | null;
  category_id: string | null;
  payee_id: string | null;
  note: string | null;
  frequency: RecurFreq;
  day_of_month: number | null;
  last_day: boolean;
  weekday: number | null;
  month_of_year: number | null;
  working_day_rule: "on_day" | "next_working_day";
  starts_on: ISODate;
  ends_on: ISODate | null;
  max_occurrences: number | null;
  auto_log: boolean;
  paused_at: string | null;
  ended_at: string | null;
  next_due_on: ISODate;
  created_at: string;
}

export interface RecurringOccurrence {
  id: string;
  item_id: string;
  due_on: ISODate;
  scheduled_on: ISODate;
  status: OccurStatus;
  transaction_id: string | null;
  amount_pence: number;
}

export interface RecurringSuggestion {
  payee_id: string;
  payee_name: string;
  category_id: string;
  account_id: string;
  amount_pence: number;
  frequency: RecurFreq;
  day_of_month: number;
  weekday: number;
  month_of_year: number;
  seen: number;
  last_on: ISODate;
}
