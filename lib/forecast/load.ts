// getForecast(): loads the facts for a month and scope, builds the engine's input, and returns its `Forecast`. The only entry the app uses.
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysInMonth, monthEnd, monthStart, todayLondon } from "@/lib/dates";
import { billsIn } from "@/lib/bills";
import type { Holidays } from "@/lib/recurrence";
import type { Category, Payee, RecurringItem, RecurringOccurrence, RecurringSuggestion } from "@/lib/types";
import { fetchBankHolidays, fetchCategories, fetchPayees, fetchRecurringItems, fetchRecurringOccurrences, fetchRecurringSuggestions } from "@/lib/queries/fetchers";
import { forecast } from "./index";
import type { DayFact, EngineParams, Forecast, ForecastInput, ISO, PlannedExtraIn, ScheduledIn, TripIn } from "./types";

export type Scope = NonNullable<ForecastInput["scope"]>;
export const excludesBills = (s: Scope) => s === "exclude_bills" || s === "exclude_both";
export const excludesTrips = (s: Scope) => s === "exclude_trips" || s === "exclude_both";

/** What the database returns from `forecast_input`. */
export interface RawInput {
  tracking_started_on: ISO; covers: Scope; days: (Omit<DayFact, "by_cat"> & { by_cat: Record<string, number> })[]; trips: TripIn[];
  future_dated: (Omit<ScheduledIn, "label"> & { label: string })[]; recurring_after: ScheduledIn[]; planned_extras: (PlannedExtraIn & { id: string })[]; one_offs: NonNullable<ForecastInput["one_offs"]>;
  params: Partial<Pick<EngineParams, "k_base" | "half_life" | "z90">> | null; params_version: string; backtest_mape: number | null; data_version: number;
  params_changed: { on: ISO; k: number; half_life: number } | null;
}

export interface BillsData { items: RecurringItem[]; occurrences: RecurringOccurrence[]; holidays: ISO[]; categories: Category[]; payees: Payee[] }
export async function fetchBillsData(db: SupabaseClient, month: ISO): Promise<BillsData> {
  const [items, occurrences, holidays, categories, payees] = await Promise.all([
    fetchRecurringItems(db), fetchRecurringOccurrences(db, monthStart(month), monthEnd(month)), fetchBankHolidays(db), fetchCategories(db), fetchPayees(db),
  ]);
  return { items, occurrences, holidays, categories, payees };
}

export async function fetchRawInput(db: SupabaseClient, month: ISO, asOf: ISO, cutoff?: string | null): Promise<RawInput> {
  const { data, error } = await db.rpc("forecast_input", { p_month: monthStart(month), p_today: asOf, p_cutoff: cutoff ?? null });
  if (error) throw new Error(error.message);
  return data as RawInput;
}

/** spent so far, in the scope, from the daily facts: everything counted from the 1st to today (today included), bills and trips left out when the budget does. */
export function spentFromFacts(days: readonly DayFact[], month: ISO, today: ISO, scope: Scope, cat?: string): number {
  let s = 0;
  const end = monthEnd(month);
  for (const x of days) {
    if (x.d < month || x.d > today || x.d > end) continue;
    if (cat) {
      s += (x.by_cat_all?.[cat] ?? 0) - (excludesBills(scope) ? (x.by_cat_rec?.[cat] ?? 0) : 0) - (excludesTrips(scope) ? (x.by_cat_trip?.[cat] ?? 0) : 0);
    } else s += x.discretionary + x.oneoff + (excludesBills(scope) ? 0 : x.recurring) + (excludesTrips(scope) ? 0 : x.trip);
  }
  return s;
}

export interface BuildOptions {
  month: ISO; today: ISO; scope?: Scope; categories?: string[]; bills?: BillsData; suggestions?: readonly RecurringSuggestion[];
  /** Backtests: use these as the bills still to come (what was actually paid after `today`) instead of the rules. */
  useRecurringAfter?: boolean;
}

/** The engine's input object (the shape of the fixtures' `*.input.json`) from the database's answer and the bills. */
export function buildInput(raw: RawInput, o: BuildOptions): ForecastInput {
  const scope: Scope = o.scope ?? raw.covers ?? "all";
  const S = monthStart(o.month), E = monthEnd(S), T = o.today;
  const catById = new Map((o.bills?.categories ?? []).map((c) => [c.id, c]));
  const l1 = (id: string | null) => { const c = id ? catById.get(id) : undefined; return c ? (c.parent_id ?? c.id) : id; };
  const nameOf = (id: string | null) => (id ? o.bills?.payees.find((p) => p.id === id)?.name : undefined);

  const scheduled: ScheduledIn[] = [];
  if (!excludesBills(scope)) {
    if (o.useRecurringAfter) scheduled.push(...raw.recurring_after);
    else if (o.bills) {
      const rows = billsIn(o.bills.items, o.bills.occurrences, S, E, o.bills.holidays as Holidays);
      for (const r of rows) {
        if (r.item.type !== "expense" || !(r.state === "due" || r.state === "pending")) continue;
        scheduled.push({ d: r.due_on < T ? T : r.due_on, amount: r.amount_pence, label: nameOf(r.item.payee_id) ?? r.item.note ?? "A bill", kind: r.item.amount_varies ? "bill_estimate" : "bill", category: l1(r.item.category_id), varies: r.item.amount_varies });
      }
    }
    // likely recurring (REC-07): a pattern seen several times, not yet a bill, whose usual day is still to come this month
    for (const s of o.suggestions ?? []) {
      if (s.frequency !== "monthly" || s.seen < 4) continue;
      const day = Math.min(s.day_of_month, daysInMonth(S));
      const d = `${S.slice(0, 8)}${String(day).padStart(2, "0")}`;
      if (d <= T) continue;
      scheduled.push({ d, amount: s.amount_pence, label: s.payee_name, kind: "likely_recurring", category: l1(s.category_id), varies: false });
    }
  }
  for (const f of raw.future_dated) scheduled.push({ ...f, category: f.category ? (l1(f.category) ?? f.category) : null });

  const cats = o.categories ?? [];
  const spentByCat: Record<string, number> = {};
  for (const c of cats) spentByCat[c] = spentFromFacts(raw.days, S, T, scope, c);
  return {
    today: T, month: S, tracking_started_on: raw.tracking_started_on, days: raw.days, spent_month_to_date: spentFromFacts(raw.days, S, T, scope),
    spent_by_cat: spentByCat, scheduled, trips: raw.trips, categories: cats, scope,
    params: raw.params ?? undefined, planned_extras: raw.planned_extras, one_offs: raw.one_offs, backtest_mape: raw.backtest_mape, params_changed: raw.params_changed,
    data_version: raw.data_version, params_version: raw.params_version,
  };
}

export interface ForecastResult { forecast: Forecast; input: ForecastInput }

/** getForecast({ scope, month, category?, asOf? }) (§6.14.2). `categories` adds budgeted categories to reconcile against the overall. */
export async function getForecast(db: SupabaseClient, o: { scope?: Scope; month?: ISO; asOf?: ISO; categories?: string[]; bills?: BillsData; suggestions?: readonly RecurringSuggestion[] } = {}): Promise<ForecastResult> {
  const asOf = o.asOf ?? todayLondon();
  const month = monthStart(o.month ?? asOf);
  const [raw, bills, suggestions] = await Promise.all([fetchRawInput(db, month, asOf), o.bills ?? fetchBillsData(db, month), o.suggestions ?? fetchRecurringSuggestions(db).catch(() => [] as RecurringSuggestion[])]);
  const input = buildInput(raw, { month, today: asOf, scope: o.scope, categories: o.categories, bills, suggestions });
  return { forecast: forecast(input), input };
}
