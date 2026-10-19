"use server";
import { fail, friendlyDbError, isRetryableDbError, ok, type ActionResult } from "@/lib/action";
import { TxnEdit, TxnInput } from "@/lib/schemas/transaction";
import { supabaseServer } from "@/lib/supabase/server";
import type { Transaction } from "@/lib/types";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the entry and try again.";

/** CAP-05: idempotent on (user_id, client_id), so the offline outbox can retry safely. */
export async function createTransaction(input: unknown): Promise<ActionResult<Transaction>> {
  const p = TxnInput.safeParse(input);
  if (!p.success) return fail(firstIssue(p.error));
  const v = p.data;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_transaction", {
    p_client_id: v.client_id, p_type: v.type, p_amount_pence: v.amount_pence, p_account_id: v.account_id,
    p_counter_account_id: v.type === "transfer" ? v.counter_account_id : null,
    p_category_id: v.type === "transfer" ? null : v.category_id,
    p_payee: v.type === "transfer" ? null : (v.payee ?? null), p_note: v.note ?? null, p_tags: v.tags,
    p_occurred_on: v.occurred_on, p_occurred_at: v.occurred_at ?? null, p_source: v.source,
    p_needs_review: false, p_account_manual: v.account_manual,
  });
  if (error) return fail(friendlyDbError(error), isRetryableDbError(error));
  return ok(data as Transaction);
}

export async function updateTransaction(id: string, input: unknown): Promise<ActionResult<Transaction>> {
  const p = TxnEdit.safeParse(input);
  if (!p.success) return fail(firstIssue(p.error));
  const v = p.data;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_transaction", {
    p_id: id, p_type: v.type, p_amount_pence: v.amount_pence, p_account_id: v.account_id,
    p_counter_account_id: v.type === "transfer" ? v.counter_account_id : null,
    p_category_id: v.type === "transfer" ? null : v.category_id,
    p_payee: v.type === "transfer" ? null : (v.payee ?? null), p_note: v.note ?? null, p_tags: v.tags,
    p_occurred_on: v.occurred_on, p_occurred_at: v.occurred_at ?? null,
  });
  if (error) return fail(friendlyDbError(error));
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
