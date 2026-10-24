import type { ISODate } from "@/lib/dates";

export interface ActivityFilters {
  q?: string;
  types?: string[];
  categoryIds?: string[];
  accountIds?: string[];
  from?: ISODate;
  to?: ISODate;
  min?: number;
  max?: number;
  amount?: number;
  needsReview?: boolean;
  payeeId?: string;
  /** "exclude": usual spending only · "only": any pot · otherwise a pot id. */
  pot?: "exclude" | "only" | (string & {});
}

export const qk = {
  profile: ["profile"] as const,
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  payees: ["payees"] as const,
  balances: (asOf: ISODate) => ["balances", asOf] as const,
  cashFlow: (from: ISODate, to: ISODate) => ["cash-flow", from, to] as const,
  cashSeries: (from: ISODate, to: ISODate) => ["cash-series", from, to] as const,
  pace: (asOf: ISODate) => ["pace", asOf] as const,
  accountSeries: (id: string, from: ISODate, to: ISODate) => ["account-series", id, from, to] as const,
  activity: (f: ActivityFilters) => ["activity", f] as const,
  totals: (f: ActivityFilters) => ["activity-totals", f] as const,
  recent: ["recent"] as const,
  spendByCategory: (from: ISODate, to: ISODate, parent: string | null, pool = false, level = "parent") => ["spend-by-category", from, to, parent, pool, level] as const,
  dailySpend: (from: ISODate, to: ISODate, excludeFixed = false) => ["daily-spend", from, to, excludeFixed] as const,
  monthlyTotals: (n: number) => ["monthly-totals", n] as const,
  topPayees: (from: ISODate, to: ISODate) => ["top-payees", from, to] as const,
  categoryMonthly: (id: string, n: number, children = true) => ["category-monthly", id, n, children] as const,
  topPlaces: (from: ISODate, to: ISODate, limit: number, id: string, children = true) => ["top-places", from, to, limit, id, children] as const,
  categoryRemaining: (id: string, asOf: ISODate, children = true) => ["category-remaining", id, asOf, children] as const,
  suggestHistory: ["suggest-history"] as const,
  lastIncomeAccount: ["last-income-account"] as const,
  pots: ["pots"] as const,
  ask: ["ask"] as const,
  potCategories: (id: string) => ["pot-categories", id] as const,
  insights: ["insights"] as const,
};
