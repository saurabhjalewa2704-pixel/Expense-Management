"use server";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { supabaseServer } from "@/lib/supabase/server";

export async function mergePayees(from: string, into: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("merge_payees", { p_from: from, p_into: into });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
