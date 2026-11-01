import "server-only";
// The nightly job (§6.14.13): replay the last six complete months point-in-time, store the errors, tune the parameters, and snapshot yesterday.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, addMonths, daysInMonth, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import { biasFlag, correctZ, metrics, replayRows, tune, type Replay } from "./backtest";
import { forecast } from "./index";
import { buildInput, fetchBillsData, fetchRawInput, spentFromFacts } from "./load";

const endOfDay = (d: ISODate) => `${addDays(d, 1)}T00:00:00Z`;   // everything logged by the end of `d` (and the small hours after): created_at ≤ asOf + 1 day

export async function runNightly(db: SupabaseClient, userId: string, today: ISODate, monthsBack = 6): Promise<{ months: number; rows: number; tuned: boolean; z: number }> {
  const thisMonth = monthStart(today);
  const bills = await fetchBillsData(db, thisMonth);
  const { data: prof } = await db.from("profiles").select("tracking_started_on").eq("id", userId).single();
  const track = (prof as { tracking_started_on: ISODate | null } | null)?.tracking_started_on;
  const replays: Replay[] = [];
  const months: ISODate[] = [];
  for (let k = 1; k <= monthsBack; k++) {
    const m = monthStart(addMonths(thisMonth, -k));
    if (track && track > addDays(m, 10)) continue;                       // needs at least ~20 tracked days
    months.push(m);
  }
  for (const m of months) {
    const full = await fetchRawInput(db, m, monthEnd(m));
    const actual = spentFromFacts(full.days, m, monthEnd(m), "all");
    for (let d = 1; d <= daysInMonth(m); d++) {
      const asOf = addDays(m, d - 1);
      const raw = await fetchRawInput(db, m, asOf, endOfDay(asOf));
      replays.push({ month: m, day: d, actual, input: buildInput(raw, { month: m, today: asOf, scope: "all", bills, useRecurringAfter: true }) });
    }
  }
  if (!replays.length) return { months: 0, rows: 0, tuned: false, z: 1.2816 };
  const { data: cur } = await db.from("forecast_params").select("k, half_life, z90, updated_at").eq("user_id", userId).maybeSingle();
  const params = { k: Number((cur as { k: number } | null)?.k ?? 7), half_life: Number((cur as { half_life: number } | null)?.half_life ?? 60), z: Number((cur as { z90: number } | null)?.z90 ?? 1.2816) };
  const rows = replayRows(replays, { k_base: params.k, half_life: params.half_life, z90: params.z });
  const rowsOut = rows.map((r) => ({ user_id: userId, month: r.month, day: r.day, point_pence: r.point, low_pence: r.low, high_pence: r.high, actual_pence: r.actual, params_version: `k${params.k}-h${params.half_life}` }));
  await db.from("forecast_backtest").upsert(rowsOut, { onConflict: "user_id,month,day" });

  // tuning: only with 60+ tracked days and 2 complete months, at most one change in 7 days
  const trackedDays = track ? Math.max(0, Math.round((Date.parse(today) - Date.parse(track)) / 86400000)) : 0;
  let tuned = false, z = params.z;
  const last = (cur as { updated_at: string } | null)?.updated_at;
  const recentlyChanged = last ? (Date.now() - Date.parse(last)) / 86400000 < 7 : false;
  if (trackedDays >= 60 && months.length >= 2 && !recentlyChanged) {
    const t = tune(replays, { k: params.k, half_life: params.half_life });
    const m = metrics(rows);
    z = correctZ(params.z, m.coverage);
    if (t.changed || z !== params.z) {
      await db.from("forecast_params").upsert({ user_id: userId, k: t.k, half_life: t.half_life, z90: z, version: `k${t.k}-h${t.half_life}`, updated_at: new Date().toISOString() });
      await db.from("forecast_param_log").insert({ user_id: userId, changed_on: today, k_before: params.k, k_after: t.k, half_life_before: params.half_life, half_life_after: t.half_life, z_before: params.z, z_after: z, mape_before: t.before, mape_after: t.after, note: biasFlag(rows)?.flag ? "forecast_bias" : null });
      tuned = true;
    }
  }

  // yesterday's snapshot (the forecast as it stood at the end of that day)
  const y = addDays(today, -1);
  const ym = monthStart(y);
  const raw = await fetchRawInput(db, ym, y, endOfDay(y));
  const f = forecast(buildInput(raw, { month: ym, today: y, scope: "all", bills }));
  await db.from("forecast_snapshots").upsert({ user_id: userId, day: y, scope: "all", category_id: null, point_pence: f.point, low_pence: f.low, high_pence: f.high, regime: f.regime, confidence: f.confidence }, { onConflict: "user_id,day,scope,category_id", ignoreDuplicates: true });
  return { months: months.length, rows: rowsOut.length, tuned, z };
}
