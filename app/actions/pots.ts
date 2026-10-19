"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { MAX_PENCE } from "@/lib/money";
import { supabaseServer } from "@/lib/supabase/server";

const Pot = z.object({
  name: z.string().trim().min(1, "Give the pot a name.").max(40, "Keep the name under 40 characters."),
  target_pence: z.number().int().positive("A budget must be more than £0.").max(MAX_PENCE * 100).nullish(),
});

const friendly = (e: { code?: string; message?: string }) => (e.code === "23505" ? "You already have a pot with that name." : friendlyDbError(e));

export async function createPot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = Pot.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the pot.");
  const db = await supabaseServer();
  const { data, error } = await db.from("pots").insert({ name: p.data.name, target_pence: p.data.target_pence ?? null }).select("id").single();
  return error ? fail(friendly(error)) : ok({ id: (data as { id: string }).id });
}

export async function updatePot(id: string, input: unknown): Promise<ActionResult> {
  const p = Pot.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the pot.");
  const db = await supabaseServer();
  const { error } = await db.from("pots").update({ name: p.data.name, target_pence: p.data.target_pence ?? null }).eq("id", id);
  return error ? fail(friendly(error)) : ok(undefined);
}

/** A closed pot takes no new transactions but keeps its history (and can be reopened). */
export async function setPotClosed(id: string, closed: boolean): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("pots").update({ closed_at: closed ? new Date().toISOString() : null }).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Only an empty pot can be deleted; otherwise close it. */
export async function deletePot(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("pots").delete().eq("id", id);
  if (error?.code === "23503") return fail("This pot has transactions. Close it instead.");
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
