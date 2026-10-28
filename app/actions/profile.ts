"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { supabaseServer } from "@/lib/supabase/server";

const Patch = z.object({
  display_name: z.string().trim().max(40).nullish(),
  tap_to_save: z.boolean(),
  ai_enabled: z.boolean(),
  ai_include_notes: z.boolean(),
  reminder_enabled: z.boolean(),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reminder_prompted: z.boolean(),
  bills_notify: z.boolean(),
  trip_notify: z.boolean(),
  lock_after_min: z.number().int().min(0).max(60).nullable(),
}).partial();

export async function updateProfile(patch: unknown): Promise<ActionResult> {
  const p = Patch.safeParse(patch);
  if (!p.success) return fail("Check the settings and try again.");
  const supabase = await supabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const { error } = await supabase.from("profiles").update(p.data).eq("id", u.user.id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function completeOnboarding(): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("onboarding_complete");
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** SET-05: the caller has typed DELETE; everything goes and the app returns to first run. */
export async function deleteAllData(confirmation: string): Promise<ActionResult> {
  if (confirmation !== "DELETE") return fail('Type DELETE to confirm.');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("delete_all_my_data");
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
