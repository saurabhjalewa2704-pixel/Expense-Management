"use client";
// Month close: the reads, and the writes that go through the answer queue (lib/close/queue.ts).
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ISODate } from "@/lib/dates";
import { useToday } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { flushCloseQueue, queuedCount, saveCloseCall, watchCloseQueue, type CloseFn } from "./queue";
import type { CloseChanges, CloseChecks, CloseRow, CloseState, CloseSummary } from "./types";

const db = () => supabaseBrowser();
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const ck = {
  all: ["close"] as const,
  state: (today: ISODate) => ["close", "state", today] as const,
  checks: (m: ISODate, today: ISODate) => ["close", "checks", m, today] as const,
  summary: (m: ISODate, today: ISODate) => ["close", "summary", m, today] as const,
  row: (m: ISODate) => ["close", "row", m] as const,
  changes: (m: ISODate, today: ISODate) => ["close", "changes", m, today] as const,
  summaryText: (m: ISODate) => ["close", "summary-text", m] as const,
};

export function useCloseState() {
  const today = useToday();
  return useQuery({ queryKey: ck.state(today), queryFn: () => rpc<CloseState>("month_close_state", { p_today: today }), staleTime: 15_000 });
}
/** Item lists are computed when a step opens and again on return to it (MC-08). */
export function useCloseChecks(month: ISODate, enabled = true) {
  const today = useToday();
  return useQuery({ queryKey: ck.checks(month, today), queryFn: () => rpc<CloseChecks>("month_close_checks", { p_month: month, p_today: today }), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, enabled });
}
export function useCloseSummary(month: ISODate, enabled = true) {
  const today = useToday();
  return useQuery({ queryKey: ck.summary(month, today), queryFn: () => rpc<CloseSummary>("month_close_summary", { p_month: month, p_today: today }), staleTime: 0, refetchOnMount: "always", enabled });
}
export function useCloseRow(month: ISODate) {
  return useQuery({
    queryKey: ck.row(month),
    queryFn: async () => { const { data, error } = await db().from("month_closes").select("*").eq("month", month).maybeSingle(); if (error) throw new Error(error.message); return (data ?? null) as CloseRow | null; },
    staleTime: 0, refetchOnMount: "always",
  });
}
export function useCloseChanges(month: ISODate, enabled: boolean) {
  const today = useToday();
  return useQuery({ queryKey: ck.changes(month, today), queryFn: () => rpc<CloseChanges | null>("close_changes", { p_month: month, p_today: today }), enabled, staleTime: 0 });
}

/** How many answers are waiting on this device for the network. */
export function useQueuedAnswers(): number {
  const [n, setN] = useState(0);
  useEffect(() => { const read = () => void queuedCount().then(setN); read(); return watchCloseQueue(read); }, []);
  return n;
}

/** Flush on mount and when the network returns; refetch what the answers changed. */
export function useFlushCloseQueue() {
  const qc = useQueryClient();
  useEffect(() => {
    const run = async () => { if ((await flushCloseQueue(db()).catch(() => 0)) > 0) await qc.invalidateQueries({ queryKey: ck.all }); };
    void run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [qc]);
}

type Patch = (c: CloseChecks) => CloseChecks;
const patchChecks = (qc: QueryClient, month: ISODate, patch: Patch) =>
  qc.setQueriesData<CloseChecks>({ queryKey: ["close", "checks", month] }, (old) => (old ? patch(old) : old));

/** An answer, optimistic first (the card ticks at once), then saved or queued. A refusal rolls the screen back by refetching. */
export function useCloseActions(month: ISODate) {
  const qc = useQueryClient();
  const today = useToday();
  const run = async (fn: CloseFn, args: Record<string, unknown>, patch?: Patch) => {
    if (patch) patchChecks(qc, month, patch);
    const r = await saveCloseCall(db(), fn, { p_month: month, ...args, p_today: today });
    await qc.invalidateQueries({ queryKey: ck.all });
    if (r.error) return { ok: false as const, error: r.error };
    return { ok: true as const, queued: r.queued };
  };
  return {
    answerDay: (day: ISODate, answer: "no_spend" | "not_tracked" | "reset") =>
      run("close_answer", { p_type: "missing_day", p_key: day, p_answer: answer }, (c) => ({ ...c, missing_days: c.missing_days.map((d) => (d.day === day ? { ...d, answer: answer === "reset" ? null : answer } : d)) })),
    answerDays: (days: ISODate[], answer: "no_spend" | "not_tracked") =>
      run("close_answer_days", { p_days: days, p_answer: answer }, (c) => ({ ...c, missing_days: c.missing_days.map((d) => (days.includes(d.day) ? { ...d, answer } : d)) })),
    answerDuplicate: (key: string, answer: "both_real" | "deleted" | "reset") =>
      run("close_answer", { p_type: "duplicate", p_key: key, p_answer: answer }, (c) => ({ ...c, duplicates: c.duplicates.map((d) => (d.key === key ? { ...d, answer: answer === "both_real" ? "both_real" : null } : d)) })),
    answerLarge: (id: string, answer: "one_off" | "normal" | "reset") =>
      run("close_answer", { p_type: "large", p_key: id, p_answer: answer }, (c) => ({ ...c, large: c.large.map((t) => (t.id === id ? { ...t, answer: answer === "reset" ? null : answer } : t)) })),
    answerOneOff: (id: string, answer: "keep" | "normal" | "reset") =>
      run("close_answer", { p_type: "one_off", p_key: id, p_answer: answer }, (c) => ({ ...c, one_offs: c.one_offs.map((t) => (t.id === id ? { ...t, answer: answer === "reset" ? null : answer } : t)) })),
    resolveBill: (occurrence: string, action: "confirm" | "log" | "skip", amount?: number) =>
      run("close_resolve_bill", { p_occurrence: occurrence, p_action: action, p_amount: amount ?? null }, (c) => ({
        ...c, bills: c.bills.map((b) => (b.occurrence_id === occurrence ? { ...b, answer: action === "confirm" ? "confirmed" : action === "skip" ? "skipped" : amount ? "paid_different" : "paid", amount_pence: amount ?? b.amount_pence } : b)),
      })),
    setStep: (step: string, state: "done" | "skipped" | "nothing") => run("close_set_step", { p_step: step, p_state: state }),
  };
}

/** Writes that need a connection. */
export async function closeOnline<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const { data, error } = await db().rpc(fn, args);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: String(e).replace(/^TypeError: /, "") };
  }
}
