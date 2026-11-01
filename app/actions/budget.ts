"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { addMonths, monthStart, todayLondon } from "@/lib/dates";
import { supabaseServer } from "@/lib/supabase/server";

const Pence = z.number().int().positive().max(99_999_999);
const Save = z.object({
  /** "this" applies from the 1st of this month (also to spend already logged); "next" from the 1st of next month (BUD-02). */
  from: z.enum(["this", "next"]),
  overall: z.object({ amount: Pence, covers: z.enum(["all", "exclude_bills", "exclude_trips", "exclude_both"]) }).nullable(),
  limits: z.array(z.object({ category_id: z.string().uuid(), amount: Pence, rollover: z.boolean() })).max(40),
  removed: z.array(z.string().uuid()).max(40),
});

/** BUD-01/02: write the overall budget and the limits that changed. Each is a dated change, so past months keep their amounts. */
export async function saveBudgets(input: unknown): Promise<ActionResult> {
  const p = Save.safeParse(input);
  if (!p.success) return fail("Check the amounts and try again.");
  const supabase = await supabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const thisMonth = monthStart(todayLondon());
  const from = p.data.from === "this" ? thisMonth : addMonths(thisMonth, 1);
  if (p.data.overall) {
    const { error } = await supabase.rpc("set_budget", { p_category: null, p_amount: p.data.overall.amount, p_from: from, p_rollover: false, p_covers: p.data.overall.covers });
    if (error) return fail(friendlyDbError(error));
  }
  for (const l of p.data.limits) {
    const { error } = await supabase.rpc("set_budget", { p_category: l.category_id, p_amount: l.amount, p_from: from, p_rollover: l.rollover, p_covers: "all" });
    if (error) return fail(friendlyDbError(error));
  }
  for (const id of p.data.removed) {
    const { error } = await supabase.rpc("remove_budget", { p_category: id, p_from: from });
    if (error) return fail(friendlyDbError(error));
  }
  return ok(undefined);
}

/** BUD-02 "Adjust this month only": a one-month amount that leaves the default alone. A null amount clears it. */
export async function setBudgetOverride(category: string | null, month: string, amount: number | null): Promise<ActionResult> {
  if (amount !== null && !Pence.safeParse(amount).success) return fail("Enter an amount above zero.");
  const supabase = await supabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const { error } = await supabase.rpc("set_budget_override", { p_category: category, p_month: monthStart(month), p_amount: amount });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
