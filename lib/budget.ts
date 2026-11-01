// PRD §6.13: everything the Budget screens show, built from the one forecast engine (lib/forecast, getForecast).
// This file never projects anything itself: every month-end figure is a `Forecast` returned by the one engine.
import { dayOfMonth, daysInMonth, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import { billsIn, type BillRow } from "@/lib/bills";
import { budgetStatus, planToDate, safeToSpend, whatIfs, type BudgetStatus, type WhatIf } from "@/lib/forecast/measures";
import { fcView, type FcView } from "@/lib/forecast/view";
import type { Forecast } from "@/lib/forecast/types";
import type { Holidays } from "@/lib/recurrence";
import type { Category, RecurringItem, RecurringOccurrence } from "@/lib/types";
import type { Pence } from "@/lib/money";

export type Covers = "all" | "exclude_bills" | "exclude_trips" | "exclude_both";
export const COVERS_LABEL: Record<Covers, string> = {
  all: "All spending, including bills and trips",
  exclude_bills: "Everything except bills",
  exclude_trips: "Everything except trips",
  exclude_both: "Everything except bills and trips",
};
export const excludesBills = (c: Covers) => c === "exclude_bills" || c === "exclude_both";
export const excludesTrips = (c: Covers) => c === "exclude_trips" || c === "exclude_both";

/** One row of `budget_for_month`: the amount that applies to a month, overall (category_id null) or for one limit. */
export interface BudgetRow {
  category_id: string | null;
  base_pence: Pence;
  override_pence: Pence | null;
  carried_pence: Pence;
  amount_pence: Pence;
  rollover: boolean;
  covers: Covers;
}

export interface BillSums { toCome: Pence; upToToday: Pence; allMonth: Pence }

/** Recurring expenses for a month, in one scope: still to come, scheduled on or before today, and scheduled in the whole month (BUD-03). */
export function billSums(
  items: readonly RecurringItem[], occurrences: readonly RecurringOccurrence[], month: ISODate, today: ISODate,
  inScope: (categoryId: string | null) => boolean, holidays?: Holidays,
): BillSums {
  const rows: BillRow[] = billsIn(items, occurrences, monthStart(month), monthEnd(month), holidays)
    .filter((r) => r.item.type === "expense" && r.state !== "skipped" && inScope(r.item.category_id));
  let toCome = 0, upToToday = 0, allMonth = 0;
  for (const r of rows) {
    allMonth += r.amount_pence;
    if (r.due_on <= today) upToToday += r.amount_pence;
    if (r.state === "due" || r.state === "pending") toCome += r.amount_pence;
  }
  return { toCome, upToToday, allMonth };
}

/** Recurring expenses scheduled each day of the month (index 0 = the 1st), for the plan line. */
export function billsByDay(
  items: readonly RecurringItem[], occurrences: readonly RecurringOccurrence[], month: ISODate,
  inScope: (categoryId: string | null) => boolean, holidays?: Holidays,
): Pence[] {
  const out = Array<Pence>(daysInMonth(month)).fill(0);
  for (const r of billsIn(items, occurrences, monthStart(month), monthEnd(month), holidays)) {
    if (r.item.type === "expense" && r.state !== "skipped" && inScope(r.item.category_id)) out[Number(r.due_on.slice(8)) - 1]! += r.amount_pence;
  }
  return out;
}

export interface LimitView {
  /** null for the overall budget and for "Everything else". */
  categoryId: string | null;
  kind: "overall" | "limit" | "elsewhere";
  name: string;
  icon: string | null;
  color: string | null;
  /** What applies this month: base (or this month's override) plus anything carried by rollover. */
  amount: Pence;
  base: Pence;
  override: Pence | null;
  carried: Pence;
  rollover: boolean;
  spent: Pence;
  /** Spent for display: never below £0 (a net refund shows £0 with a note). */
  spentShown: Pence;
  netRefund: boolean;
  left: Pence;
  pctSpent: number;
  pctLeft: number;
  plan: Pence;
  /** plan − spent: positive = under plan. */
  againstPlan: Pence;
  billsToCome: Pence;
  safePerDay: Pence;
  forecast: FcView;
  /** forecast − amount: positive = over. */
  variance: Pence;
  /** amount − forecast: positive = room to spare. */
  headroom: Pence;
  status: BudgetStatus;
}

export interface BudgetView {
  month: ISODate;
  today: ISODate;
  closed: boolean;
  dom: number;
  dim: number;
  monthPct: number;
  covers: Covers;
  overall: LimitView;
  /** Riskiest first: forecast as a share of the limit, largest first. */
  limits: LimitView[];
  elsewhere: LimitView;
  limitsTotal: Pence;
  /** How far the limits exceed the overall budget (EC-G3), or 0. */
  limitsOverBy: Pence;
  whatIfs: WhatIf[];
  /** The overall plan for each day of the month, 1st first (BUD-03). */
  planByDay: Pence[];
  /** The engine's full answer, for the Why sheet. */
  forecast: Forecast;
}

export interface BudgetSource {
  month: ISODate;
  today: ISODate;
  rows: readonly BudgetRow[];
  /** The one forecast for the month, with the budgeted categories reconciled into it (getForecast). */
  forecast: Forecast;
  items: readonly RecurringItem[];
  occurrences: readonly RecurringOccurrence[];
  categories: readonly Category[];
  holidays?: Holidays;
}

const pct = (a: Pence, b: Pence) => (b > 0 ? Math.round((a * 100) / b) : 0);

/** A category's reading of the month's forecast: its own spent, scheduled and point (reconciled so they add up to the overall). */
export function categoryView(f: Forecast, cat: string, today: ISODate): FcView {
  const base = fcView(f, today);
  const c = f.categories?.[cat];
  if (!c) return { ...base, spent: 0, scheduled: 0, restOfMonth: 0, trips: 0, extras: 0, floor: 0, forecast: 0, point: base.available ? 0 : null, low: null, high: null, expectedPerDay: 0 };
  const per = f.perDay.length || 1;
  return {
    ...base, spent: c.spent, scheduled: c.scheduled, restOfMonth: c.restOfMonth, trips: 0, extras: 0, floor: c.spent + c.scheduled, forecast: c.point,
    point: base.available ? c.point : null, low: null, high: null, expectedPerDay: Math.round(c.restOfMonth / per), weight: c.weightThisMonth ?? base.weight, loggedToday: 0,
  };
}

function scopeView(args: {
  categoryId: string | null; kind: LimitView["kind"]; name: string; icon: string | null; color: string | null;
  row: Pick<BudgetRow, "amount_pence" | "base_pence" | "override_pence" | "carried_pence" | "rollover">;
  fc: FcView; bills: BillSums; covers: Covers;
}): LimitView {
  const { row, fc, bills } = args;
  const noBills = excludesBills(args.covers);
  const dim = fc.daysInMonth;
  const dom = fc.closed ? dim : Math.min(dim, Math.max(1, fc.dom));
  const plan = planToDate(row.amount_pence, noBills ? 0 : bills.upToToday, noBills ? 0 : bills.allMonth, dom, dim, noBills);
  const spent = fc.spent;
  return {
    categoryId: args.categoryId, kind: args.kind, name: args.name, icon: args.icon, color: args.color,
    amount: row.amount_pence, base: row.base_pence, override: row.override_pence, carried: row.carried_pence, rollover: row.rollover,
    spent, spentShown: Math.max(0, spent), netRefund: spent < 0, left: row.amount_pence - spent,
    pctSpent: pct(Math.max(0, spent), row.amount_pence), pctLeft: Math.max(0, 100 - pct(Math.max(0, spent), row.amount_pence)),
    plan, againstPlan: plan - spent, billsToCome: fc.scheduled, safePerDay: safeToSpend(row.amount_pence, fc), forecast: fc,
    variance: fc.forecast - row.amount_pence, headroom: row.amount_pence - fc.forecast,
    status: budgetStatus(fc, row.amount_pence, plan),
  };
}

/** The Budget view for a month: overall, each limit, and "Everything else" (BUD-01 to BUD-07). Null when no budget applies. */
export function buildBudgetView(src: BudgetSource): BudgetView | null {
  const overallRow = src.rows.find((r) => r.category_id === null);
  if (!overallRow) return null;
  const month = monthStart(src.month), dim = daysInMonth(month);
  const covers = overallRow.covers;
  const catById = new Map(src.categories.map((c) => [c.id, c]));
  const l1 = (id: string | null) => { const c = id ? catById.get(id) : undefined; return c ? (c.parent_id ?? c.id) : null; };
  const overallFc = fcView(src.forecast, src.today);

  const all = billSums(src.items, src.occurrences, month, src.today, () => true, src.holidays);
  const overall = scopeView({ categoryId: null, kind: "overall", name: "Monthly budget", icon: null, color: null, row: overallRow, fc: overallFc, bills: all, covers });

  const limits: LimitView[] = [];
  for (const row of src.rows) {
    if (row.category_id === null) continue;
    const cat = catById.get(row.category_id);
    if (!cat) continue;
    const bills = billSums(src.items, src.occurrences, month, src.today, (c) => l1(c) === row.category_id, src.holidays);
    limits.push(scopeView({ categoryId: row.category_id, kind: "limit", name: cat.name, icon: cat.icon, color: cat.color, row, fc: categoryView(src.forecast, row.category_id, src.today), bills, covers }));
  }
  // Riskiest first: the largest forecast as a share of its limit (a limit forecast over comes before one that is under, then by how close it is).
  limits.sort((a, b) => b.forecast.forecast * a.amount - a.forecast.forecast * b.amount || a.name.localeCompare(b.name));

  // Everything else = the overall figures less the limits, so the parts always add up to the whole, to the penny (invariant 10).
  const sum = (f: (l: LimitView) => number) => limits.reduce((s, l) => s + f(l), 0);
  const limitsTotal = sum((l) => l.amount);
  const elseAmountRaw = overall.amount - limitsTotal;
  const elseAmount = Math.max(0, elseAmountRaw);
  const elseSpent = overall.spent - sum((l) => l.spent);
  const elseForecastValue = overall.forecast.forecast - sum((l) => l.forecast.forecast);
  const elsePlan = Math.max(0, overall.plan - sum((l) => l.plan));
  const elseBills = Math.max(0, overall.billsToCome - sum((l) => l.billsToCome));
  const elseFc: FcView = { ...overallFc, spent: elseSpent, scheduled: elseBills, forecast: elseForecastValue, point: overallFc.available ? elseForecastValue : null, low: null, high: null, floor: elseSpent + elseBills };
  const elsewhere: LimitView = {
    categoryId: null, kind: "elsewhere", name: "Everything else", icon: null, color: null,
    amount: elseAmount, base: elseAmount, override: null, carried: 0, rollover: false,
    spent: elseSpent, spentShown: Math.max(0, elseSpent), netRefund: elseSpent < 0, left: elseAmount - elseSpent,
    pctSpent: pct(Math.max(0, elseSpent), elseAmount), pctLeft: Math.max(0, 100 - pct(Math.max(0, elseSpent), elseAmount)),
    plan: elsePlan, againstPlan: elsePlan - elseSpent, billsToCome: elseBills, safePerDay: 0, forecast: elseFc,
    variance: elseForecastValue - elseAmountRaw, headroom: elseAmountRaw - elseForecastValue,
    // "Everything else" has no limit of its own to be tight against: it is on track, or over (A.3)
    status: elseForecastValue > elseAmountRaw ? "over" : "on_track",
  };

  return {
    month, today: src.today, closed: overallFc.closed, dom: overallFc.closed ? dim : overallFc.dom, dim,
    monthPct: overallFc.closed ? 100 : pct(overallFc.dom, dim), covers,
    overall, limits, elsewhere, limitsTotal, limitsOverBy: Math.max(0, -elseAmountRaw),
    planByDay: (() => {
      const noBills = excludesBills(covers);
      const days = billsByDay(src.items, src.occurrences, month, () => true, src.holidays);
      const total = noBills ? 0 : days.reduce((a, b) => a + b, 0);
      let cum = 0;
      return days.map((d, i) => { cum += noBills ? 0 : d; return planToDate(overall.amount, cum, total, i + 1, dim, noBills); });
    })(),
    whatIfs: overallFc.available && !overallFc.closed ? whatIfs(overall.amount, overallFc) : [],
    forecast: src.forecast,
  };
}

/** Invariant 10 (§6.13): Σ category forecasts + Everything else = the overall forecast, and Σ variances = forecast − budget. */
export function invariant10(v: BudgetView): { forecastsAddUp: boolean; variancesAddUp: boolean } {
  const parts = v.limits.reduce((s, l) => s + l.forecast.forecast, 0) + v.elsewhere.forecast.forecast;
  const variances = v.limits.reduce((s, l) => s + l.variance, 0) + v.elsewhere.variance;
  return { forecastsAddUp: parts === v.overall.forecast.forecast, variancesAddUp: variances === v.overall.forecast.forecast - v.overall.amount };
}

/** "£142 over" / "£38 under" for a limit (BUD-06). */
export const varianceWord = (variance: Pence) => (variance > 0 ? "over" : "under");

export interface PoolFlows { transfersOut: Pence; incomeIn: Pence }

/** Recurring money still to move across the edge of the cash pool this month (CASH-06): transfers out to savings, transfers in, income. */
export function poolFlowsToCome(
  items: readonly RecurringItem[], occurrences: readonly RecurringOccurrence[], poolAccountIds: ReadonlySet<string>, month: ISODate, holidays?: Holidays,
): PoolFlows {
  let transfersOut = 0, incomeIn = 0;
  for (const r of billsIn(items, occurrences, monthStart(month), monthEnd(month), holidays)) {
    if (r.state !== "due" && r.state !== "pending") continue;
    const from = poolAccountIds.has(r.item.account_id), to = r.item.counter_account_id ? poolAccountIds.has(r.item.counter_account_id) : false;
    if (r.item.type === "transfer") { if (from && !to) transfersOut += r.amount_pence; else if (!from && to) incomeIn += r.amount_pence; }
    else if (r.item.type === "income" && from) incomeIn += r.amount_pence;
  }
  return { transfersOut, incomeIn };
}
