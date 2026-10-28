"use server";
import { createHash, randomBytes } from "node:crypto";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { supabaseServer } from "@/lib/supabase/server";

/** CAP-08: a new capture token. The token itself is shown once; only its hash is stored. */
export async function createApiToken(name: string): Promise<ActionResult<{ id: string; token: string }>> {
  const n = name.trim();
  if (!n || n.length > 40) return fail("Give the token a name of up to 40 characters.");
  const token = `stl_${randomBytes(24).toString("hex")}`;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("api_tokens").insert({ name: n, token_hash: createHash("sha256").update(token).digest("hex") }).select("id").single();
  return error ? fail(friendlyDbError(error)) : ok({ id: (data as { id: string }).id, token });
}

export async function revokeApiToken(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
