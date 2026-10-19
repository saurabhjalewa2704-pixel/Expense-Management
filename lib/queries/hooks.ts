"use client";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { monthStart, todayLondon, type ISODate } from "@/lib/dates";
import { buildTree } from "@/lib/categories";
import { watchOutbox, type OutboxItem } from "@/lib/outbox";
import { applyBalances, applyFlow, applyPace, livePending, mergePending, pendingRow } from "@/lib/overlay";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AccountBalance, TxnRow } from "@/lib/types";
import {
  fetchAccounts, fetchAccountSeries, fetchActivityPage, fetchBalances, fetchCashFlow, fetchCashSeries, fetchCategories,
  fetchCategoryMonthly, fetchDailySpend, fetchMonthlyTotals, fetchPace, fetchPayees, fetchProfile, fetchSpendByCategory,
  fetchAskTurns, fetchPotCategories, fetchPots, fetchTransactionCount, fetchWeekActivity, fetchInsightFeedback, fetchInsightRuns, fetchLastIncomeAccount, fetchSuggestHistory, fetchTopPayees, fetchTotals, PAGE_SIZE, type ActivityCursor,
} from "./fetchers";
import { qk, type ActivityFilters } from "./keys";

const db = () => supabaseBrowser();

/** London "today", refreshed when the app returns to the foreground and when midnight passes. */
export function useToday(): ISODate {
  const [today, setToday] = useState<ISODate>(() => todayLondon());
  useEffect(() => {
    const tick = () => setToday(todayLondon());
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return today;
}

/** The current instant, refreshed every 30 s (for "As at 09:12" style labels; reading the clock in render would be impure). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  return now;
}

/** The offline outbox, live. */
export function useOutbox(): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => watchOutbox(setItems), []);
  return items;
}

export const useProfile = () => useQuery({ queryKey: qk.profile, queryFn: () => fetchProfile(db()), staleTime: 60_000 });
export const useAccounts = () => useQuery({ queryKey: qk.accounts, queryFn: () => fetchAccounts(db()), staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: qk.categories, queryFn: () => fetchCategories(db()), staleTime: 60_000 });
export const usePayees = () => useQuery({ queryKey: qk.payees, queryFn: () => fetchPayees(db()), staleTime: 60_000 });

export function useCategoryTree() {
  const q = useCategories();
  const tree = useMemo(() => buildTree(q.data ?? []), [q.data]);
  return { tree, categories: q.data ?? [], isLoading: q.isLoading };
}

/** Account balances as at a date, with pending entries layered on (only for today or later). */
export function useBalances(asOf: ISODate) {
  const today = todayLondon();
  const q = useQuery({ queryKey: qk.balances(asOf), queryFn: () => fetchBalances(db(), asOf) });
  const outbox = useOutbox();
  const data = useMemo<AccountBalance[] | undefined>(() => {
    if (!q.data) return undefined;
    return asOf >= today ? applyBalances(q.data, livePending(outbox, q.dataUpdatedAt)) : q.data;
  }, [q.data, q.dataUpdatedAt, outbox, asOf, today]);
  return { ...q, data };
}

/** cash_flow() for a period with pending entries layered on: the Home hero reads this. */
export function useCashFlow(from: ISODate, to: ISODate) {
  const q = useQuery({ queryKey: qk.cashFlow(from, to), queryFn: () => fetchCashFlow(db(), from, to), placeholderData: keepPreviousData });
  const accounts = useAccounts().data;
  const outbox = useOutbox();
  const data = useMemo(() => {
    if (!q.data) return undefined;
    if (!accounts) return q.data;
    return applyFlow(q.data, livePending(outbox, q.dataUpdatedAt), accounts, from, to);
  }, [q.data, q.dataUpdatedAt, accounts, outbox, from, to]);
  return { ...q, data };
}

export function useMonthFlow() {
  const today = useToday();
  return { today, ...useCashFlow(monthStart(today), today) };
}

export function usePace() {
  const today = useToday();
  const q = useQuery({ queryKey: qk.pace(today), queryFn: () => fetchPace(db(), today) });
  const outbox = useOutbox();
  const data = useMemo(() => (q.data ? applyPace(q.data, livePending(outbox, q.dataUpdatedAt), today) : undefined), [q.data, q.dataUpdatedAt, outbox, today]);
  return { ...q, data };
}

export const useCashSeries = (from: ISODate, to: ISODate) =>
  useQuery({ queryKey: qk.cashSeries(from, to), queryFn: () => fetchCashSeries(db(), from, to), placeholderData: keepPreviousData });

export const useAccountSeries = (id: string, from: ISODate, to: ISODate) =>
  useQuery({ queryKey: qk.accountSeries(id, from, to), queryFn: () => fetchAccountSeries(db(), id, from, to) });

/** Does a pending item satisfy the active Activity filters? (Search text matches the payee and note only.) */
function matches(row: TxnRow, f: ActivityFilters): boolean {
  if (f.types?.length && !f.types.includes(row.type)) return false;
  if (f.categoryIds?.length && !(row.category_id && f.categoryIds.includes(row.category_id))) return false;
  if (f.accountIds?.length && !f.accountIds.includes(row.account_id) && !(row.counter_account_id && f.accountIds.includes(row.counter_account_id))) return false;
  if (f.from && row.occurred_on < f.from) return false;
  if (f.to && row.occurred_on > f.to) return false;
  if (f.min != null && row.amount_pence < f.min) return false;
  if (f.max != null && row.amount_pence > f.max) return false;
  if (f.amount != null && row.amount_pence !== f.amount) return false;
  if (f.needsReview) return false;
  if (f.pot === "exclude" && row.pot_id) return false;
  if (f.pot === "only" && !row.pot_id) return false;
  if (f.pot && f.pot !== "exclude" && f.pot !== "only" && row.pot_id !== f.pot) return false;
  if (f.q) {
    const hay = `${row.payee_name ?? ""} ${row.note ?? ""} ${row.category_name ?? ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

/** ACT-01: the Activity list, newest first, with keyset pagination and pending rows on top. */
export function useActivity(filters: ActivityFilters) {
  const q = useInfiniteQuery({
    queryKey: qk.activity(filters),
    queryFn: ({ pageParam }) => fetchActivityPage(db(), filters, pageParam),
    initialPageParam: undefined as ActivityCursor | undefined,
    getNextPageParam: (last) => {
      const tail = last[last.length - 1];
      return last.length < PAGE_SIZE || !tail ? undefined : { on: tail.occurred_on, created: tail.created_at, id: tail.id };
    },
    placeholderData: keepPreviousData,
  });
  const accounts = useAccounts().data;
  const { categories } = useCategoryTree();
  const outbox = useOutbox();
  const pots = usePots().data;
  const rows = useMemo(() => {
    const server = q.data?.pages.flat() ?? [];
    if (!accounts) return server;
    const pending = livePending(outbox, q.dataUpdatedAt).map((i) => pendingRow(i, accounts, categories, pots ?? [])).filter((r) => matches(r, filters));
    return mergePending(server, pending);
  }, [q.data, q.dataUpdatedAt, outbox, accounts, categories, pots, filters]);
  return { ...q, rows };
}

export const useTotals = (filters: ActivityFilters) =>
  useQuery({ queryKey: qk.totals(filters), queryFn: () => fetchTotals(db(), filters), placeholderData: keepPreviousData });

/** The latest few transactions for Home. */
export function useRecent(limit = 4) {
  const q = useQuery({ queryKey: [...qk.recent, limit], queryFn: () => fetchActivityPage(db(), {}, undefined, limit) });
  const accounts = useAccounts().data;
  const { categories } = useCategoryTree();
  const outbox = useOutbox();
  const pots = usePots().data;
  const rows = useMemo(() => {
    const server = q.data ?? [];
    if (!accounts) return server.slice(0, limit);
    const pending = livePending(outbox, q.dataUpdatedAt).map((i) => pendingRow(i, accounts, categories, pots ?? []));
    return mergePending(server, pending).slice(0, limit);
  }, [q.data, q.dataUpdatedAt, outbox, accounts, categories, pots, limit]);
  return { ...q, rows };
}

// ---- analytics (server only: charts are not overlaid with pending entries) ----
export const useSpendByCategory = (from: ISODate, to: ISODate, parent: string | null = null, pool = false) =>
  useQuery({ queryKey: qk.spendByCategory(from, to, parent, pool), queryFn: () => fetchSpendByCategory(db(), from, to, parent, pool), placeholderData: keepPreviousData });
export const useDailySpend = (from: ISODate, to: ISODate, excludeFixed = false) =>
  useQuery({ queryKey: qk.dailySpend(from, to, excludeFixed), queryFn: () => fetchDailySpend(db(), from, to, excludeFixed), placeholderData: keepPreviousData });
export const useMonthlyTotals = (months = 12) =>
  useQuery({ queryKey: qk.monthlyTotals(months), queryFn: () => fetchMonthlyTotals(db(), months) });
export const useTopPayees = (from: ISODate, to: ISODate, limit = 10, category: string | null = null) =>
  useQuery({ queryKey: [...qk.topPayees(from, to), limit, category], queryFn: () => fetchTopPayees(db(), from, to, limit, category), placeholderData: keepPreviousData });
export const useCategoryMonthly = (id: string, months = 12) =>
  useQuery({ queryKey: qk.categoryMonthly(id, months), queryFn: () => fetchCategoryMonthly(db(), id, months) });

/** Refresh everything after a write that happened outside the outbox (edits, deletes, account changes). */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export const useSuggestHistory = () =>
  useQuery({ queryKey: qk.suggestHistory, queryFn: () => fetchSuggestHistory(db()), staleTime: 5 * 60_000 });
export const useLastIncomeAccount = () =>
  useQuery({ queryKey: qk.lastIncomeAccount, queryFn: () => fetchLastIncomeAccount(db()), staleTime: 5 * 60_000 });

export const useInsightRuns = () => useQuery({ queryKey: qk.insights, queryFn: () => fetchInsightRuns(db()) });
export const useInsightFeedback = () => useQuery({ queryKey: [...qk.insights, "feedback"] as const, queryFn: () => fetchInsightFeedback(db()) });
export const useWeekActivity = (from: ISODate, to: ISODate) => useQuery({ queryKey: ["week-activity", from, to] as const, queryFn: () => fetchWeekActivity(db(), from, to) });
export const useTransactionCount = () => useQuery({ queryKey: ["txn-count"] as const, queryFn: () => fetchTransactionCount(db()), staleTime: 60_000 });

export const usePots = () => useQuery({ queryKey: qk.pots, queryFn: () => fetchPots(db()) });
export const usePotCategories = (id: string) => useQuery({ queryKey: qk.potCategories(id), queryFn: () => fetchPotCategories(db(), id) });

export const useAskTurns = () => useQuery({ queryKey: qk.ask, queryFn: () => fetchAskTurns(db()) });
