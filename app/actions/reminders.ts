"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { sendPush } from "@/lib/push-send";
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

/**
 * "Send a test notification" (Settings → Reminders): sends one push to this person's registered devices right now and says plainly why
 * it could not, so a reminder that never arrives can be diagnosed in seconds instead of waiting for the evening slot.
 */
export async function sendTestReminder(): Promise<ActionResult<{ sent: number }>> {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return fail("Please sign in again.");
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", u.user.id);
  if (!subs?.length) return fail("This phone isn't registered for notifications. Switch the evening reminder off and on again.");
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, STERLING_PUSH_STUB } = process.env;
  if (!STERLING_PUSH_STUB && !(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)) {
    return fail("The server has no push keys yet. Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel and redeploy.");
  }
  let sent = 0, gone = 0, status: number | undefined;
  for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const r = await sendPush(s, { title: "Sterling", body: "Test notification. Reminders are working on this phone.", url: "/settings/reminders", tag: "test" });
    if (r.ok) sent++;
    else if (r.gone) { gone++; await db.from("push_subscriptions").delete().eq("id", s.id); }
    else status = r.status;
  }
  if (sent > 0) return ok({ sent });
  if (gone > 0) return fail("This phone's registration has expired. Switch the evening reminder off and on again.");
  if (status === 403 || status === 401) return fail(`The push service refused it (${status}). The keys in Vercel don't match the ones this app was built with: check NEXT_PUBLIC_VAPID_PUBLIC_KEY equals VAPID_PUBLIC_KEY, redeploy, then switch the reminder off and on again.`);
  return fail(`The push service didn't accept it${status ? ` (status ${status})` : ""}. Check VAPID_SUBJECT is "mailto:" followed by an email address.`);
}
