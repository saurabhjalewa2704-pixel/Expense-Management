"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { supabaseServer } from "@/lib/supabase/server";

const Sub = z.object({ endpoint: z.url().max(2048), p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(256), user_agent: z.string().max(400).nullish() });

export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const p = Sub.safeParse(input);
  if (!p.success) return fail("This device couldn't be registered for reminders.");
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const { error } = await db.from("push_subscriptions").upsert({ ...p.data, user_id: u.user.id }, { onConflict: "endpoint" });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
