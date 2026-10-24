// Read functions. They take a Supabase client so they run the same in the browser (the user's session + RLS)
// and anywhere else a client is available. Every figure comes from a SQL function (PRD §10.4); nothing is derived here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ISODate } from "@/lib/dates";
import type {
  Account, AccountBalance, CashFlow, Category, CategorySpend, DailySpend, MonthPace, MonthlyTotal, Payee, PayeeTotal, Profile,
  TxnRow, TxnTotals, Pot, PotCategory, TopPlace,
} from "@/lib/types";
import type { ActivityFilters } from "./keys";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchProfile = async (db: SupabaseClient): Promise<Profile> =>
  unwrap<Profile>(db.from("profiles").select("*").single());

export const fetchAccounts = (db: SupabaseClient) =>
  unwrap<Account[]>(db.from("accounts").select("*").order("sort_order").order("created_at"));

export const fetchCategories = (db: SupabaseClient) =>
  unwrap<Category[]>(db.from("categories").select("id,parent_id,kind,name,icon,color,sort_order,is_fixed,archived_at").order("sort_order").order("name"));

export const fetchPayees = (db: SupabaseClient) =>
  unwrap<Payee[]>(db.from("payees").select("*").order("use_count", { ascending: false }).limit(500));

export const fetchBalances = (db: SupabaseClient, asOf: ISODate) =>
  unwrap<AccountBalance[]>(db.rpc("account_balances", { p_as_of: asOf }));

export async function fetchCashFlow(db: SupabaseClient, from: ISODate, to: ISODate): Promise<CashFlow> {
  const rows = await unwrap<CashFlow[]>(db.rpc("cash_flow", { p_from: from, p_to: to }));
  return rows[0]!;
}

export const fetchCashSeries = (db: SupabaseClient, from: ISODate, to: ISODate) =>
  unwrap<{ day: ISODate; cash_pence: number }[]>(db.rpc("cash_series", { p_from: from, p_to: to }));

export async function fetchPace(db: SupabaseClient, asOf: ISODate): Promise<MonthPace> {
  const rows = await unwrap<MonthPace[]>(db.rpc("month_pace", { p_as_of: asOf }));
  return rows[0]!;
}

export const fetchAccountSeries = (db: SupabaseClient, id: string, from: ISODate, to: ISODate) =>
  unwrap<{ day: ISODate; balance_pence: number }[]>(db.rpc("account_balance_series", { p_account: id, p_from: from, p_to: to }));

const filterArgs = (f: ActivityFilters) => ({
  p_q: f.q || null,
  p_types: f.types?.length ? f.types : null,
  p_category_ids: f.categoryIds?.length ? f.categoryIds : null,
  p_account_ids: f.accountIds?.length ? f.accountIds : null,
  p_from: f.from ?? null,
  p_to: f.to ?? null,
  p_min: f.min ?? null,
  p_max: f.max ?? null,
  p_amount: f.amount ?? null,
  p_needs_review: f.needsReview ?? null,
  p_payee: f.payeeId ?? null,
  p_pot_id: f.pot && f.pot !== "exclude" && f.pot !== "only" ? f.pot : null,
  p_pots: f.pot === "exclude" || f.pot === "only" ? f.pot : null,
});

export interface ActivityCursor { on: ISODate; created: string; id: string }
export const PAGE_SIZE = 40;

export const fetchActivityPage = (db: SupabaseClient, f: ActivityFilters, cursor?: ActivityCursor, limit = PAGE_SIZE) =>
  unwrap<TxnRow[]>(db.rpc("list_transactions", {
    ...filterArgs(f), p_limit: limit,
    p_after_on: cursor?.on ?? null, p_after_created: cursor?.created ?? null, p_after_id: cursor?.id ?? null,
  }));

export async function fetchTotals(db: SupabaseClient, f: ActivityFilters): Promise<TxnTotals> {
  const rows = await unwrap<TxnTotals[]>(db.rpc("transaction_totals", filterArgs(f)));
  return rows[0]!;
}

export const fetchSpendByCategory = (db: SupabaseClient, from: ISODate, to: ISODate, parent: string | null, pool = false, level: "parent" | "leaf" = "parent") =>
  unwrap<CategorySpend[]>(db.rpc("spend_by_category", { p_from: from, p_to: to, p_parent: parent, p_pool_only: pool, p_level: level }));

export const fetchDailySpend = (db: SupabaseClient, from: ISODate, to: ISODate, excludeFixed = false) =>
  unwrap<DailySpend[]>(db.rpc("daily_spend", { p_from: from, p_to: to, p_exclude_fixed: excludeFixed }));

export const fetchMonthlyTotals = (db: SupabaseClient, months: number) =>
  unwrap<MonthlyTotal[]>(db.rpc("monthly_totals", { p_months: months }));

export const fetchTopPayees = (db: SupabaseClient, from: ISODate, to: ISODate, limit = 10, category: string | null = null) =>
  unwrap<PayeeTotal[]>(db.rpc("top_payees", { p_from: from, p_to: to, p_limit: limit, p_category: category }));

export const fetchCategoryMonthly = (db: SupabaseClient, id: string, months: number, children = true) =>
  unwrap<{ month: ISODate; total_pence: number; txn_count: number }[]>(db.rpc("category_monthly", { p_category: id, p_months: months, p_include_children: children }));

export const fetchTopPlaces = (db: SupabaseClient, from: ISODate, to: ISODate, limit: number, category: string, children = true) =>
  unwrap<TopPlace[]>(db.rpc("top_places", { p_from: from, p_to: to, p_limit: limit, p_category: category, p_include_children: children }));

/** The median spend in the rest of the month (after `asOf`'s day) over the previous three months: the trend projection. */
export const fetchCategoryRemaining = async (db: SupabaseClient, id: string, asOf: ISODate, children = true) =>
  Number(await unwrap<number | string>(db.rpc("category_remaining", { p_category: id, p_as_of: asOf, p_include_children: children })));

import type { HistoryRow } from "@/lib/suggest";
import { addDays, todayLondon } from "@/lib/dates";

/** The last 180 days of expenses, the minimum the suggestion ranking needs (CAP-01.1). */
export async function fetchSuggestHistory(db: SupabaseClient): Promise<HistoryRow[]> {
  const rows = await unwrap<{ category_id: string; occurred_on: ISODate; occurred_at: string | null; created_at: string }[]>(
    db.from("transactions").select("category_id,occurred_on,occurred_at,created_at").eq("type", "expense").is("deleted_at", null).is("pot_id", null)
      .gte("occurred_on", addDays(todayLondon(), -180)).order("occurred_on", { ascending: false }).limit(5000));
  return rows.map((r) => ({ category_id: r.category_id, occurred_on: r.occurred_on, at: r.occurred_at ?? r.created_at }));
}

/** CAP-02: income defaults to the account that last received income. */
export async function fetchLastIncomeAccount(db: SupabaseClient): Promise<string | null> {
  const rows = await unwrap<{ account_id: string }[]>(
    db.from("transactions").select("account_id").eq("type", "income").is("deleted_at", null)
      .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(1));
  return rows[0]?.account_id ?? null;
}

/** The latest insight runs (digests and refreshes), newest first. Cards are stored with the run, so this works offline from the cache. */
export const fetchInsightRuns = (db: SupabaseClient) =>
  unwrap<import("@/lib/ai/generate").InsightRunRow[]>(
    db.from("insight_runs").select("id,scope,period_start,period_end,facts,cards,model,input_tokens,output_tokens,used_fallback,created_at").order("created_at", { ascending: false }).limit(12),
  );

export interface FeedbackRow { run_id: string; card_key: string; card_type: string; action: "helpful" | "dismissed" | "opened" }
export const fetchInsightFeedback = (db: SupabaseClient) =>
  unwrap<FeedbackRow[]>(db.from("insight_feedback").select("run_id,card_key,card_type,action").order("created_at", { ascending: false }).limit(200));

/** Days with something logged, and days marked "Nothing to log", in [from, to] (Settings → Reminders week view). */
export async function fetchWeekActivity(db: SupabaseClient, from: ISODate, to: ISODate): Promise<{ logged: ISODate[]; noSpend: ISODate[] }> {
  const [t, n] = await Promise.all([
    unwrap<{ occurred_on: ISODate }[]>(db.from("transactions").select("occurred_on").gte("occurred_on", from).lte("occurred_on", to).is("deleted_at", null)),
    unwrap<{ day: ISODate }[]>(db.from("no_spend_days").select("day").gte("day", from).lte("day", to)),
  ]);
  return { logged: [...new Set(t.map((r) => r.occurred_on))], noSpend: n.map((r) => r.day) };
}

export const fetchTransactionCount = async (db: SupabaseClient): Promise<number> => {
  const { count, error } = await db.from("transactions").select("id", { count: "exact", head: true }).is("deleted_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

export const fetchPots = (db: SupabaseClient) => unwrap<Pot[]>(db.rpc("pot_summary", { p_pot: null }));
export const fetchPotCategories = (db: SupabaseClient, id: string) => unwrap<PotCategory[]>(db.rpc("pot_by_category", { p_pot: id }));

export interface AskTurn { id: string; question: string; answer: string; facts: { label: string; display: string }[]; used_fallback: boolean; model: string; created_at: string }
/** The latest questions and answers, oldest first (a conversation reads top to bottom). */
export async function fetchAskTurns(db: SupabaseClient): Promise<AskTurn[]> {
  const rows = await unwrap<AskTurn[]>(db.from("ask_turns").select("id,question,answer,facts,used_fallback,model,created_at").order("created_at", { ascending: false }).limit(30));
  return rows.reverse();
}
