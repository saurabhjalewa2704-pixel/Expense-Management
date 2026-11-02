import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dueAlerts, type AlertKind, type AlertPrefs, type DueAlert, type SentAlert } from "@/lib/budget-alerts";
import { dayOfMonth, monthStart, type ISODate } from "@/lib/dates";
import { loadBudgetView } from "@/lib/forecast-data";
import { sendPush } from "@/lib/push-send";

/**
 * Sends the budget alerts that are due for one user (BUD-10), and takes the nightly forecast snapshot used for the accuracy tile (BUD-11).
 * `db` is a client that sees only this user's rows (the signed-in user's, or the owner's through the service key, as the other jobs do).
 */
export async function runBudgetAlerts(db: SupabaseClient, userId: string, today: ISODate, opts: { snapshot?: boolean; push?: SupabaseClient } = {}): Promise<{ sent: DueAlert[]; snapshot: boolean }> {
  const month = monthStart(today);
  const view = await loadBudgetView(db, month, today);
  if (!view) return { sent: [], snapshot: false };
  const { data: prof } = await db.from("profiles").select("budget_alert_forecast, budget_alert_pct80, budget_alert_reached").eq("id", userId).single();
  const p = (prof ?? {}) as Record<string, boolean | undefined>;
  const prefs: AlertPrefs = { forecast: p.budget_alert_forecast ?? true, pct80: p.budget_alert_pct80 ?? true, reached: p.budget_alert_reached ?? true };
  const { data: sentRows } = await db.from("budget_alerts_sent").select("category_id, kind, last_value_pence").eq("month", month);
  const due = dueAlerts(view, (sentRows ?? []) as SentAlert[], prefs, today);

  const pushDb = opts.push ?? db;
  const { data: subs } = due.length ? await pushDb.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId) : { data: [] };
  for (const a of due) {
    let ok = false;
    for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
      const r = await sendPush(s, { title: "Sterling", body: `${a.title}. ${a.body}`, url: a.url, tag: `budget-${a.kind}-${a.categoryId ?? "overall"}` });
      if (r.ok) ok = true;
      else if (r.gone) await pushDb.from("push_subscriptions").delete().eq("id", s.id);
    }
    // recorded even with no device to reach, so a later subscription does not receive a stale burst
    const row = { user_id: userId, month, category_id: a.categoryId, kind: a.kind as AlertKind, last_value_pence: a.value, sent_at: new Date().toISOString() };
    const existing = (sentRows ?? []).find((s) => (s as SentAlert).category_id === a.categoryId && (s as SentAlert).kind === a.kind);
    if (existing) await db.from("budget_alerts_sent").update({ last_value_pence: a.value, sent_at: row.sent_at }).eq("month", month).eq("kind", a.kind).is("category_id", a.categoryId);
    else await db.from("budget_alerts_sent").insert(row);
    void ok;
  }

  let snapshot = false;
  if (opts.snapshot) {
    const day = dayOfMonth(today);
    const rows = [view.overall, ...view.limits].filter((l) => l.forecast.available).map((l) => ({
      user_id: userId, month, day, category_id: l.categoryId, spent_pence: l.spent, forecast_pence: l.forecast.forecast, low_pence: l.forecast.low, high_pence: l.forecast.high,
      notes: null,
    }));
    for (const r of rows) {
      const q = db.from("budget_forecast_log").delete().eq("month", month).eq("day", day);
      await (r.category_id ? q.eq("category_id", r.category_id) : q.is("category_id", null));
    }
    if (rows.length) await db.from("budget_forecast_log").insert(rows);
    snapshot = rows.length > 0;
  }
  return { sent: due, snapshot };
}
