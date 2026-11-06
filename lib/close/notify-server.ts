// MC-80: the month-close notifications, run from the existing notification cron (every 15 minutes). The first goes out on the 1st at the user's
// chosen time, the second on the 4th at 19:00 London if the month is still open: at most two a month, none once it is closed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { londonParts, type ISODate } from "@/lib/dates";
import { sendPush } from "@/lib/push-send";
import { supabaseAsUser } from "@/lib/supabase/server";
import { closeNotificationCopy, dueCloseNotification, estimateMinutes, balancesShown, firstUnfinishedStep, monthsToClose, stepCounts } from "./logic";
import { STEPS, type CloseChecks, type CloseState } from "./types";

export interface CloseNotifyResult { user: string; result: string; kind?: "ready" | "reminder"; sent?: number }

export async function runCloseNotifications(db: SupabaseClient, now: ReturnType<typeof londonParts>, windowMin: number): Promise<CloseNotifyResult[]> {
  const day = Number(now.date.slice(8));
  if (day !== 1 && day !== 4) return [];                                          // nothing to do on any other day
  const today = now.date as ISODate;
  const { data: profiles } = await db.from("profiles").select("id, close_notify, close_notify_time, close_check_savings").eq("close_notify", true).not("onboarded_at", "is", null);
  const out: CloseNotifyResult[] = [];
  for (const p of (profiles ?? []) as { id: string; close_notify: boolean; close_notify_time: string; close_check_savings: boolean }[]) {
    try {
      const udb = await supabaseAsUser(p.id);                                   // the SQL functions scope by the signed-in person
      const { data: st } = await udb.rpc("month_close_state", { p_today: today });
      const m = monthsToClose(st as CloseState)[0];
      if (!m) { out.push({ user: p.id, result: "nothing-to-close" }); continue; }
      const { data: flags } = await db.from("month_closes").select("notified_ready_at, notified_reminder_at").eq("user_id", p.id).eq("month", m.month).maybeSingle();
      const f = (flags ?? {}) as { notified_ready_at?: string | null; notified_reminder_at?: string | null };
      const kind = dueCloseNotification({
        londonDate: today, hour: now.hour, minute: now.minute, windowMin, notifyTime: (p.close_notify_time ?? "09:00").slice(0, 5), month: m,
        readySent: !!f.notified_ready_at, reminderSent: !!f.notified_reminder_at, enabled: p.close_notify,
      });
      if (!kind) { out.push({ user: p.id, result: "not-due" }); continue; }
      const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", p.id);
      if (!subs?.length) { out.push({ user: p.id, result: "no-subscriptions", kind }); continue; }
      const { data: checks } = await udb.rpc("month_close_checks", { p_month: m.month, p_today: today });
      const counts = stepCounts(checks as CloseChecks, p.close_check_savings);
      const minutes = estimateMinutes({ missing: counts.missing_days.open, bills: counts.bills.open, tidy: counts.tidy_up.open, accounts: balancesShown((checks as CloseChecks).balances, p.close_check_savings).length });
      const stopped = firstUnfinishedStep(m.step_state, counts);
      const copy = closeNotificationCopy(kind, m.month, m.status === "in_progress" && !!m.started_at, stopped ? STEPS.find((s) => s.key === stopped)!.title.replace("{next}", "next month") : null, minutes);
      let sent = 0;
      for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
        const r = await sendPush(s, { title: copy.title, body: copy.body, url: copy.url, tag: `month-close-${m.month}-${kind}` });
        if (r.ok) sent++; else if (r.gone) await db.from("push_subscriptions").delete().eq("id", s.id);
      }
      if (sent > 0) {
        await db.from("month_closes").upsert({ user_id: p.id, month: m.month }, { onConflict: "user_id,month", ignoreDuplicates: true });
        await db.from("month_closes").update(kind === "ready" ? { notified_ready_at: new Date().toISOString() } : { notified_reminder_at: new Date().toISOString() }).eq("user_id", p.id).eq("month", m.month);
      }
      out.push({ user: p.id, result: sent > 0 ? "sent" : "failed", kind, sent });
    } catch (e) {
      console.error("[nudge] month close", e);
      out.push({ user: p.id, result: `error: ${String(e)}` });
    }
  }
  return out;
}
