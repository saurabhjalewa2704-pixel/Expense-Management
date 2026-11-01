// Loads the facts for the one forecast engine (lib/forecast.ts) and returns its answer. Used by the screens (through hooks), by the AI facts, by the
// nightly job and by the owner's debug endpoint, so every one of them gets the identical forecast (PRD §6.13 BUD-05a rule 7, FC-9).
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthEnd, monthStart, type ISODate } from "@/lib/dates";
import { billsToCome, billSums, buildBudgetView, excludesBills, toForecastInputs, type BillToCome, type BudgetRow, type BudgetView, type Covers, type ScopeFacts } from "@/lib/budget";
import { forecastMonth, type Forecast, type ForecastInputs } from "@/lib/forecast";
import type { Category, RecurringItem, RecurringOccurrence } from "@/lib/types";
import { fetchBankHolidays, fetchCategories, fetchRecurringItems, fetchRecurringOccurrences } from "@/lib/queries/fetchers";

async function rpc<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchBudgetRows = (db: SupabaseClient, month: ISODate) => rpc<BudgetRow[]>(db.rpc("budget_for_month", { p_month: monthStart(month) }));

/** `forecast_inputs`: the facts for one scope (null = the whole month, else an L1 category id). */
export async function fetchScopeFacts(db: SupabaseClient, month: ISODate, today: ISODate, scope: string | null): Promise<ScopeFacts> {
  const rows = await rpc<ScopeFacts[]>(db.rpc("forecast_inputs", { p_month: monthStart(month), p_scope: scope, p_today: today }));
  const r = rows[0]!;
  return { ...r, qualifying_months: r.qualifying_months ?? [], history_daily: (r.history_daily ?? []).map(Number) };
}

export const fetchBudgetHistory = (db: SupabaseClient, months: number, today: ISODate) =>
  rpc<{ month: ISODate; budget_pence: number | null; spent_pence: number }[]>(db.rpc("budget_history", { p_months: months, p_today: today }));

/** Everything the bills side of the engine needs. */
export interface BillsData { items: RecurringItem[]; occurrences: RecurringOccurrence[]; holidays: ISODate[]; categories: Category[] }
export async function fetchBillsData(db: SupabaseClient, month: ISODate): Promise<BillsData> {
  const [items, occurrences, holidays, categories] = await Promise.all([
    fetchRecurringItems(db), fetchRecurringOccurrences(db, monthStart(month), monthEnd(month)), fetchBankHolidays(db), fetchCategories(db),
  ]);
  return { items, occurrences, holidays, categories };
}

/** The forecast for a month and scope, with every input that produced it (the "Why this forecast?" sheet and the debug endpoint). */
export interface MonthForecast { forecast: Forecast; inputs: ForecastInputs; facts: ScopeFacts; covers: Covers; bills: BillToCome[] }

export async function loadMonthForecast(db: SupabaseClient, month: ISODate, today: ISODate, scope: string | null = null, bills?: BillsData): Promise<MonthForecast> {
  const [facts, b] = await Promise.all([fetchScopeFacts(db, month, today, scope), bills ?? fetchBillsData(db, month)]);
  const catById = new Map(b.categories.map((c) => [c.id, c]));
  const l1 = (id: string | null) => { const c = id ? catById.get(id) : undefined; return c ? (c.parent_id ?? c.id) : null; };
  const sums = billSums(b.items, b.occurrences, month, today, (c) => scope === null || l1(c) === scope, b.holidays);
  const inputs = toForecastInputs(monthStart(month), today, facts, excludesBills(facts.covers) ? 0 : sums.toCome);
  const list = excludesBills(facts.covers) ? [] : billsToCome(b.items, b.occurrences, month, (c) => scope === null || l1(c) === scope, b.holidays);
  return { forecast: forecastMonth(inputs), inputs, facts, covers: facts.covers, bills: list };
}

/** The Budget view for a month, or null when no budget applies to it. */
export async function loadBudgetView(db: SupabaseClient, month: ISODate, today: ISODate): Promise<BudgetView | null> {
  const [rows, bills] = await Promise.all([fetchBudgetRows(db, month), fetchBillsData(db, month)]);
  if (!rows.some((r) => r.category_id === null)) return null;
  const limitIds = rows.filter((r) => r.category_id !== null).map((r) => r.category_id!);
  const [overall, ...per] = await Promise.all([fetchScopeFacts(db, month, today, null), ...limitIds.map((id) => fetchScopeFacts(db, month, today, id))]);
  const byCategory: Record<string, ScopeFacts> = {};
  limitIds.forEach((id, i) => { byCategory[id] = per[i]!; });
  return buildBudgetView({ month, today, rows, overall: overall!, byCategory, items: bills.items, occurrences: bills.occurrences, categories: bills.categories, holidays: bills.holidays });
}
