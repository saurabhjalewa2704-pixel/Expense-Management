"use server";
// Planned extras (§6.14.8), the one-off flag (§6.14.3) and the planned-item question (EC-F30). Each is a plain write as the signed-in user.
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { monthStart } from "@/lib/dates";
import { supabaseServer } from "@/lib/supabase/server";

const Extra = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().trim().min(1, "Say what it is.").max(60),
  amount_pence: z.number().int().positive().max(99_999_999), on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), category_id: z.uuid().nullish(),
});

export async function addPlannedExtra(input: unknown): Promise<ActionResult> {
  const p = Extra.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the amounts.");
  const db = await supabaseServer();
  const { error } = await db.from("planned_extras").insert({ month: monthStart(p.data.month), label: p.data.label, amount_pence: p.data.amount_pence, on_date: p.data.on_date ?? null, category_id: p.data.category_id ?? null });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function updatePlannedExtra(id: string, input: unknown): Promise<ActionResult> {
  const p = Extra.partial().safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the amounts.");
  const db = await supabaseServer();
  const patch: Record<string, unknown> = {};
  if (p.data.label !== undefined) patch.label = p.data.label;
  if (p.data.amount_pence !== undefined) patch.amount_pence = p.data.amount_pence;
  if (p.data.on_date !== undefined) patch.on_date = p.data.on_date;
  if (p.data.category_id !== undefined) patch.category_id = p.data.category_id;
  const { error } = await db.from("planned_extras").update(patch).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function deletePlannedExtra(id: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("planned_extras").delete().eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** The owner's choice on the One-off switch. Their choice is never overwritten by the automatic flag. */
export async function setOneOff(transactionId: string, value: boolean): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("transactions").update({ is_one_off: value }).eq("id", transactionId);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** EC-F30: "Was this part of 'Christmas presents'?" Reduces or removes the extra only on the user's answer; asked once per expense. */
export async function answerPlannedExtra(transactionId: string, extraId: string, answer: "still_to_spend" | "all_of_it" | "no"): Promise<ActionResult> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const [{ data: tx }, { data: ex }] = await Promise.all([
    db.from("transactions").select("amount_pence").eq("id", transactionId).single(),
    db.from("planned_extras").select("amount_pence").eq("id", extraId).single(),
  ]);
  if (!tx || !ex) return fail("That planned item is gone.");
  const asked = await db.from("planned_extra_answers").insert({ transaction_id: transactionId, extra_id: extraId, answer });
  if (asked.error) return fail(friendlyDbError(asked.error));
  if (answer === "all_of_it") {
    const r = await db.from("planned_extras").delete().eq("id", extraId);
    if (r.error) return fail(friendlyDbError(r.error));
  } else if (answer === "still_to_spend") {
    const left = (ex as { amount_pence: number }).amount_pence - (tx as { amount_pence: number }).amount_pence;
    const r = left > 0 ? await db.from("planned_extras").update({ amount_pence: left }).eq("id", extraId) : await db.from("planned_extras").delete().eq("id", extraId);   // an extra reduced to £0 is removed
    if (r.error) return fail(friendlyDbError(r.error));
  }
  return ok(undefined);
}
