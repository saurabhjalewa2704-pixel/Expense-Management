"use server";
import { fail, friendlyDbError, isRetryableDbError, ok, type ActionResult } from "@/lib/action";
import { createTransactionWith } from "@/lib/transactions-write";
import { TxnEdit } from "@/lib/schemas/transaction";
import { supabaseServer } from "@/lib/supabase/server";
import type { Transaction } from "@/lib/types";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the entry and try again.";

/** CAP-05: idempotent on (user_id, client_id), so the offline outbox can retry safely. The outbox itself uses POST /api/transactions (the same code), because a Server Action id changes with every build and an app that has not updated yet cannot call the new one. */
export async function createTransaction(input: unknown): Promise<ActionResult<Transaction>> {
  return createTransactionWith(await supabaseServer(), input);
}

export async function updateTransaction(id: string, input: unknown): Promise<ActionResult<Transaction>> {
  const p = TxnEdit.safeParse(input);
  if (!p.success) return fail(firstIssue(p.error));
  const v = p.data;
  const supabase = await supabaseServer();
  if (v.expected_updated_at) {
    const { data: cur } = await supabase.from("transactions").select("updated_at").eq("id", id).maybeSingle();
    if (cur && new Date((cur as { updated_at: string }).updated_at).getTime() > new Date(v.expected_updated_at).getTime()) return fail("Updated on another device");
  }
  const { data, error } = await supabase.rpc("update_transaction", {
    p_id: id, p_type: v.type, p_amount_pence: v.amount_pence, p_account_id: v.account_id,
    p_counter_account_id: v.type === "transfer" ? v.counter_account_id : null,
    p_category_id: v.type === "transfer" ? null : v.category_id,
    p_payee: v.type === "transfer" ? null : (v.payee ?? null), p_note: v.note ?? null, p_tags: v.tags,
    p_occurred_on: v.occurred_on, p_occurred_at: v.occurred_at ?? null,
    p_pot_id: v.type === "transfer" ? null : (v.pot_id ?? null),
    p_counts_in_balance: v.counts_in_balance ?? null, p_counter_counts_in_balance: v.type === "transfer" ? (v.counter_counts_in_balance ?? null) : null,
    p_trip_set: v.trip_set ?? false, p_trip_id: v.trip_set && v.type !== "transfer" ? (v.trip_id ?? null) : null, p_trip_origin: v.trip_set && v.trip_id ? (v.trip_origin ?? null) : null,
    p_fx_set: v.fx_set ?? false, p_original_amount_minor: v.fx_set ? (v.original_amount_minor ?? null) : null, p_original_currency: v.fx_set ? (v.original_currency ?? null) : null,
    p_fx_rate: v.fx_set ? (v.fx_rate ?? null) : null, p_fx_rate_on: v.fx_set ? (v.fx_rate_on ?? null) : null, p_fx_source: v.fx_set && v.original_currency ? (v.fx_source ?? "auto") : null,
  });
  if (error) return fail(friendlyDbError(error));
  if (v.refund_set) {
    const r = await supabase.from("transactions").update({ refund_category_id: v.type === "income" ? (v.refund_category_id ?? null) : null }).eq("id", id);
    if (r.error) return fail(friendlyDbError(r.error));
  }
  return ok(data as Transaction);
}

/** Soft delete; rows are removed for good after 30 days (purge cron). */
export async function deleteTransaction(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function restoreTransaction(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("transactions").update({ deleted_at: null }).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Undo for a transaction that has only a client_id on this device (it may just have synced). */
export async function deleteByClientId(clientId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("client_id", clientId).is("deleted_at", null);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
