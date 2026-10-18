"use server";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { AccountInput } from "@/lib/schemas/account";
import { supabaseServer } from "@/lib/supabase/server";
import { todayLondon } from "@/lib/dates";
import type { Account, Transaction } from "@/lib/types";

export async function upsertAccount(input: unknown): Promise<ActionResult<Account>> {
  const p = AccountInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the account details.");
  const v = p.data;
  const supabase = await supabaseServer();
  if (v.id) {
    const { data, error } = await supabase.from("accounts")
      .update({ name: v.name, institution: v.institution ?? null, type: v.type, counts_as_cash: v.counts_as_cash })
      .eq("id", v.id).select().single();
    return error ? fail(friendlyDbError(error)) : ok(data as Account);
  }
  const { data: last } = await supabase.from("accounts").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sort = ((last?.[0] as { sort_order: number } | undefined)?.sort_order ?? 0) + 1;
  const { data, error } = await supabase.from("accounts").insert({
    name: v.name, institution: v.institution ?? null, type: v.type, counts_as_cash: v.counts_as_cash,
    opening_balance_pence: v.opening_balance_pence, opening_date: v.opening_date ?? todayLondon(), sort_order: sort,
  }).select().single();
  return error ? fail(friendlyDbError(error)) : ok(data as Account);
}

/** ACC-03: archive; a non-zero balance needs `writeOff`, which records an adjustment first. */
export async function archiveAccount(id: string, writeOff = false): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("archive_account", { p_account_id: id, p_write_off: writeOff });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** ACC-05: the typed balance becomes the truth; the difference is a signed adjustment dated today. */
export async function reconcileAccount(id: string, actualPence: number): Promise<ActionResult<Transaction | null>> {
  if (!Number.isSafeInteger(actualPence)) return fail("Enter a valid balance.");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("reconcile_account", { p_account_id: id, p_actual_pence: actualPence });
  return error ? fail(friendlyDbError(error)) : ok((data as Transaction | null) ?? null);
}

export async function setDefaultAccount(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_default_account", { p_account_id: id });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
