"use server";
import { checkAnthropic } from "@/lib/ai/diagnose";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { tokenCap, tokensUsedThisMonth } from "@/lib/ai/server";
import { supabaseServer } from "@/lib/supabase/server";

const Feedback = z.object({ run_id: z.uuid(), card_key: z.string().min(1).max(80), card_type: z.string().min(1).max(30), action: z.enum(["helpful", "dismissed", "opened"]) });

/** AI-03: Helpful / Dismiss. The last 50 are passed to the next generation as preferences. */
export async function submitFeedback(input: unknown): Promise<ActionResult> {
  const p = Feedback.safeParse(input);
  if (!p.success) return fail("Invalid feedback.");
  const db = await supabaseServer();
  const { error } = await db.from("insight_feedback").insert(p.data);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** SET-04: clear AI history (insight runs and the feedback on them). */
export async function clearAiHistory(): Promise<ActionResult> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const runs = await db.from("insight_runs").delete().eq("user_id", u.user.id);
  if (runs.error) return fail(friendlyDbError(runs.error));
  const asks = await db.from("ask_turns").delete().eq("user_id", u.user.id);
  return asks.error ? fail(friendlyDbError(asks.error)) : ok(undefined);
}

/** Settings → AI: tokens used this month against the cap (PRD §12.6). */
export async function getAiUsage(): Promise<ActionResult<{ used: number; cap: number; live: boolean }>> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  return ok({ used: await tokensUsedThisMonth(db, u.user.id), cap: tokenCap(), live: !!process.env.ANTHROPIC_API_KEY });
}

/** Settings → AI: "Check the connection": is the key set, and does each model answer? */
export async function checkAiConnection(): Promise<ActionResult<Awaited<ReturnType<typeof checkAnthropic>>>> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  return ok(await checkAnthropic());
}
