import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, friendlyDbError, isRetryableDbError, ok, type ActionResult } from "@/lib/action";
import { TxnInput } from "@/lib/schemas/transaction";
import type { Transaction } from "@/lib/types";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the entry and try again.";

/** CAP-05: idempotent on (user_id, client_id), so the offline outbox can retry safely. */
export async function createTransactionWith(supabase: SupabaseClient, input: unknown): Promise<ActionResult<Transaction>> {
  const p = TxnInput.safeParse(input);
  if (!p.success) return fail(firstIssue(p.error));
  const v = p.data;
  const { data, error } = await supabase.rpc("create_transaction", {
    p_client_id: v.client_id, p_type: v.type, p_amount_pence: v.amount_pence, p_account_id: v.account_id,
    p_counter_account_id: v.type === "transfer" ? v.counter_account_id : null,
    p_category_id: v.type === "transfer" ? null : v.category_id,
    p_payee: v.type === "transfer" ? null : (v.payee ?? null), p_note: v.note ?? null, p_tags: v.tags,
    p_occurred_on: v.occurred_on, p_occurred_at: v.occurred_at ?? null, p_source: v.source,
    p_needs_review: false, p_account_manual: v.account_manual,
    p_pot_id: v.type === "transfer" ? null : (v.pot_id ?? null),
    p_counts_in_balance: v.counts_in_balance ?? null, p_counter_counts_in_balance: v.type === "transfer" ? (v.counter_counts_in_balance ?? null) : null,
    p_occurred_tz: v.occurred_tz ?? null,
    p_trip_id: v.type === "transfer" ? null : (v.trip_id ?? null), p_trip_origin: v.trip_id ? (v.trip_origin ?? null) : null, p_trip_untag: v.trip_untag ?? false,
    p_original_amount_minor: v.original_amount_minor ?? null, p_original_currency: v.original_currency ?? null, p_fx_rate: v.fx_rate ?? null,
    p_fx_rate_on: v.fx_rate_on ?? null, p_fx_source: v.original_currency ? (v.fx_source ?? "auto") : null,
  });
  // EC-C5: a session that expired while offline is not a failed entry: it stays queued and is sent, under the same client_id, once signed in again
  if (error) return fail(friendlyDbError(error), isRetryableDbError(error) || error.code === "28000");
  // BUD-01: link a refund to the category it reduces (idempotent, so a retried entry sets the same value again)
  if (v.type === "income" && v.refund_category_id) {
    const r = await supabase.from("transactions").update({ refund_category_id: v.refund_category_id }).eq("client_id", v.client_id);
    if (r.error) return fail(friendlyDbError(r.error), isRetryableDbError(r.error));
  }
  return ok(data as Transaction);
}
