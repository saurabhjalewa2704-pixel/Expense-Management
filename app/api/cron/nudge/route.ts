import { NextResponse, type NextRequest } from "next/server";
import { londonParts, type ISODate } from "@/lib/dates";
import { cronSecret } from "@/lib/env";
import { decideNudge } from "@/lib/nudge";
import { sendPush } from "@/lib/push-send";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Profile { id: string; reminder_time: string; last_reminder_on: ISODate | null }

/**
 * NOT-01. Call every 15 minutes (pg_cron + pg_net, or an external scheduler); it acts only inside each user's London slot, so
 * BST changes are handled by construction. `NUDGE_WINDOW_MIN` (default 15) must match the call interval: set 60 for an hourly cron.
 * In test mode (STERLING_TEST_TODAY set) `?now=<ISO instant>` replaces the clock.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const override = process.env.STERLING_TEST_TODAY ? req.nextUrl.searchParams.get("now") : null;
  const now = londonParts(override ? new Date(override) : Date.now());
  const windowMin = Number(process.env.NUDGE_WINDOW_MIN ?? 15);
  const db = supabaseService();
  const { data: profiles } = await db.from("profiles").select("id, reminder_time, last_reminder_on").eq("reminder_enabled", true);
  const out: { user: string; result: string; sent?: number; removed?: number }[] = [];

  for (const p of (profiles ?? []) as Profile[]) {
    const [{ count: today }, { data: last }, { data: ns }, { data: subs }] = await Promise.all([
      db.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("occurred_on", now.date).is("deleted_at", null),
      db.from("transactions").select("occurred_on").eq("user_id", p.id).is("deleted_at", null).order("occurred_on", { ascending: false }).limit(1),
      db.from("no_spend_days").select("day").eq("user_id", p.id).eq("day", now.date),
      db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", p.id),
    ]);
    const decision = decideNudge({
      today: now.date, hour: now.hour, minute: now.minute, reminderTime: p.reminder_time, windowMin, lastReminderOn: p.last_reminder_on,
      loggedToday: (today ?? 0) > 0, noSpendToday: (ns?.length ?? 0) > 0, lastTxnOn: ((last?.[0] as { occurred_on: ISODate } | undefined)?.occurred_on) ?? null,
    });
    if (!decision.send) { out.push({ user: p.id, result: decision.reason }); continue; }
    if (!subs?.length) { out.push({ user: p.id, result: "no-subscriptions" }); continue; }

    let sent = 0, removed = 0;
    for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
      const r = await sendPush(s, { title: "Sterling", body: decision.body, url: "/?add=1" });
      if (r.ok) { sent++; await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id); }
      else if (r.gone) { removed++; await db.from("push_subscriptions").delete().eq("id", s.id); }
      else console.error("[nudge] push failed", r.status);
    }
    if (sent > 0) await db.from("profiles").update({ last_reminder_on: now.date }).eq("id", p.id);   // at most one a day
    out.push({ user: p.id, result: sent > 0 ? "sent" : "failed", sent, removed });
  }
  return NextResponse.json({ london: now, results: out });
}
