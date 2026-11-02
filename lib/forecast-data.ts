// Loads the one forecast (lib/forecast, getForecast) for the screens, the AI facts, the nightly job and the owner's debug endpoint, so every one
// of them gets the identical answer (FORECASTING-ENGINE-PRD §6.14, FC-9).
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthStart, type ISODate } from "@/lib/dates";
import { buildBudgetView, categoryView, type BudgetRow, type BudgetView } from "@/lib/budget";
import { fetchBillsData, getForecast, type BillsData, type ForecastResult, type Scope } from "@/lib/forecast/load";
import type { Forecast } from "@/lib/forecast/types";
import { fcView, type FcView } from "@/lib/forecast/view";

export type { BillsData };

async function rpc<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchBudgetRows = (db: SupabaseClient, month: ISODate) => rpc<BudgetRow[]>(db.rpc("budget_for_month", { p_month: monthStart(month) }));
export const fetchBudgetHistory = (db: SupabaseClient, months: number, today: ISODate) =>
  rpc<{ month: ISODate; budget_pence: number | null; spent_pence: number }[]>(db.rpc("budget_history", { p_months: months, p_today: today }));

/** The forecast for a month, overall or for one L1 category, with the view the screens read. */
export interface MonthForecast extends ForecastResult { view: FcView; category: string | null }

export async function loadMonthForecast(db: SupabaseClient, month: ISODate, today: ISODate, category: string | null = null, scope?: Scope, bills?: BillsData): Promise<MonthForecast> {
  const r = await getForecast(db, { month, asOf: today, scope, categories: category ? [category] : [], bills });
  return { ...r, category, view: category ? categoryView(r.forecast, category, today) : fcView(r.forecast, today) };
}

/** The Budget view for a month, or null when no budget applies to it. */
export async function loadBudgetView(db: SupabaseClient, month: ISODate, today: ISODate): Promise<BudgetView | null> {
  const [rows, bills] = await Promise.all([fetchBudgetRows(db, month), fetchBillsData(db, month)]);
  const overall = rows.find((r) => r.category_id === null);
  if (!overall) return null;
  const limitIds = rows.filter((r) => r.category_id !== null).map((r) => r.category_id!);
  const { forecast } = await getForecast(db, { month, asOf: today, scope: overall.covers, categories: limitIds, bills });
  return buildBudgetView({ month, today, rows, forecast, items: bills.items, occurrences: bills.occurrences, categories: bills.categories, holidays: bills.holidays });
}
export type { Forecast };
