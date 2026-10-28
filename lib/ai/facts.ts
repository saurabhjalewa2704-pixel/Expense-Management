// The facts engine (PRD §12.2): everything a card may say is computed here, deterministically. The model narrates these
// numbers; it never calculates its own. Each fact pairs a raw value with a pre-formatted `display` the model quotes verbatim.
import type { SupabaseClient } from "@supabase/supabase-js";
import { average, projectMonth, weekdayAverages, WEEKDAY_NAMES, deltaFlag } from "@/lib/analytics";
import { addDays, addMonths, formatDayMonth, formatMonth, formatShort, monthEnd, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { formatGBP, medianPence, pctChange, type Pence } from "@/lib/money";
import { fetchDailySpend, fetchMonthlyTotals, fetchPace } from "@/lib/queries/fetchers";
import type { DailySpend, MonthPace } from "@/lib/types";
import type { Entity, Fact, Facts } from "./types";

export interface HistoryRow { category_id: string; name: string; icon: string; parent_id: string | null; current_pence: number; prior_pence: number[] }
export interface MonthTotal { month: ISODate; total_pence: number }
export interface FeedbackRow { card_type: string; card_key: string; action: "helpful" | "dismissed" | "opened" }

export interface FactsInput {
  today: ISODate;
  scope: Facts["scope"];
  period: Facts["period"];
  pace: MonthPace;
  projected: Pence | null;
  monthAvg: Pence;
  history: HistoryRow[];
  /** Full-month totals per category id, oldest first, ending at the period's month. */
  trends: Record<string, MonthTotal[]>;
  streaming?: { id: string; name: string; months: MonthTotal[] };
  newPayees: { payee_id: string; name: string; amount_pence: number; occurred_on: ISODate }[];
  big: { id: string; payee_name: string | null; category_name: string | null; amount_pence: number; occurred_on: ISODate; note?: string | null }[];
  weekdayAvg: Pence[];
  series: Pence[];
  feedback: FeedbackRow[];
}

export const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const money = (p: Pence) => formatGBP(p);
const whole = (p: Pence) => formatGBP(p, { whole: true });

export function assembleFacts(i: FactsInput): Facts {
  const facts: Fact[] = [];
  const entities: Entity[] = [];
  const add = (f: Fact) => facts.push(f);

  // ---- pace: month to date against last month at the same point ----
  const prevMonth = formatMonth(addMonths(monthStart(i.today), -1));
  const { spend_pence: spend, prev_spend_pence: prev } = i.pace;
  const gap = Math.abs(prev - spend);
  add({ key: "spend_mtd", label: `Spent so far this month (day ${i.pace.day_of_month} of ${i.pace.days_in_month})`, value_pence: spend, display: money(spend), series: i.series });
  add({ key: "spend_prev_same_point", label: `Spent by the same point in ${prevMonth}`, value_pence: prev, display: money(prev) });
  add({ key: "pace_gap", label: `Difference from ${prevMonth}'s pace`, value_pence: gap, display: whole(gap) });
  add({ key: "pace_dir", label: "Whether this month is under or over last month's pace", display: gap < 100 ? "level" : spend < prev ? "under" : "over" });
  add({ key: "prev_month_name", label: "Last month", display: prevMonth });
  if (i.projected !== null) add({ key: "projected_spend", label: "About what this month's spending will reach", value_pence: i.projected, display: whole(i.projected) });
  if (i.monthAvg > 0) add({ key: "month_avg", label: "Average monthly spend", value_pence: i.monthAvg, display: whole(i.monthAvg) });

  // ---- categories in the period, against their usual ----
  for (const r of i.history.filter((h) => h.current_pence > 0).slice(0, 6)) {
    const s = slug(r.name);
    entities.push({ id: r.category_id, kind: "category", name: r.name });
    add({ key: `cat:${s}:total`, label: `${r.name} spent in ${i.period.label}`, value_pence: r.current_pence, display: money(r.current_pence) });
    if (r.prior_pence.length >= 3) {
      const usual = medianPence(r.prior_pence);
      add({ key: `cat:${s}:usual`, label: `${r.name}: usual by this point (median of ${r.prior_pence.length} earlier periods)`, value_pence: usual, display: whole(usual) });
      const flag = deltaFlag(r.current_pence, usual);
      if (flag) add({ key: `cat:${s}:pct_over`, label: r.name, value: flag.pct, display: `${flag.pct}%` });
      const pct = pctChange(r.current_pence, usual);
      if (pct !== null && pct < -20 && usual - r.current_pence > 3000) add({ key: `cat:${s}:pct_under`, label: r.name, value: Math.abs(pct), display: `${Math.abs(pct)}%` });
    }
    if (r.prior_pence.length >= 5 && Math.min(...r.prior_pence) > 0 && r.current_pence < Math.min(...r.prior_pence)) {
      add({ key: `cat:${s}:low`, label: r.name, value: r.prior_pence.length, display: String(r.prior_pence.length) });
    }
    // rising for several months in a row (full months only)
    const months = i.trends[r.category_id];
    if (months && months.length >= 4) {
      let run = 1;
      for (let k = months.length - 1; k > 0 && months[k]!.total_pence > months[k - 1]!.total_pence; k--) run++;
      if (run >= 3) {
        add({ key: `cat:${s}:trend_len`, label: `${r.name} rising`, value: run, display: String(run) });
        add({ key: `cat:${s}:trend_first`, label: `${r.name} at the start of the run`, value_pence: months[months.length - run]!.total_pence, display: whole(months[months.length - run]!.total_pence) });
        add({ key: `cat:${s}:trend_last`, label: `${r.name} most recently`, value_pence: months.at(-1)!.total_pence, display: whole(months.at(-1)!.total_pence) });
      }
    }
  }

  // ---- subscriptions ----
  if (i.streaming && i.streaming.months.length >= 4) {
    const m = i.streaming.months, now = m.at(-1)!, then = m.at(-4)!;
    if (now.total_pence - then.total_pence >= 100) {
      entities.push({ id: i.streaming.id, kind: "category", name: i.streaming.name });
      add({ key: "streaming_now", label: `${i.streaming.name} a month`, value_pence: now.total_pence, display: money(now.total_pence) });
      add({ key: "streaming_delta", label: `Increase since ${formatMonth(then.month)}`, value_pence: now.total_pence - then.total_pence, display: money(now.total_pence - then.total_pence) });
      add({ key: "streaming_since", label: formatMonth(then.month), display: formatMonth(then.month) });
    }
  }

  // ---- first-time payees and the biggest single spends ----
  for (const p of i.newPayees.slice(0, 2)) {
    entities.push({ id: p.payee_id, kind: "payee", name: p.name });
    add({ key: `new:${slug(p.name)}:amount`, label: p.name, value_pence: p.amount_pence, display: money(p.amount_pence) });
  }
  i.big.slice(0, 3).forEach((b, n) => {
    const day = WEEKDAY_NAMES[weekdayIndex(b.occurred_on)]!.slice(0, -1);
    add({ key: `big:${n + 1}:amount`, label: `${b.payee_name ?? b.category_name ?? "A purchase"} on ${day}${b.note ? ` (note: ${b.note})` : ""}`, value_pence: b.amount_pence, display: money(b.amount_pence) });
  });

  // ---- weekday rhythm ----
  const top = Math.max(...i.weekdayAvg);
  if (top > 0) { const w = i.weekdayAvg.indexOf(top); add({ key: "weekday_top_avg", label: `${WEEKDAY_NAMES[w]} average spend`, value_pence: top, display: money(top) }); }

  // ---- what the user has told us ----
  const count = (type: string, action: string) => i.feedback.filter((f) => f.card_type === type && f.action === action).length;
  const preferences: string[] = [];
  for (const type of new Set(i.feedback.map((f) => f.card_type))) {
    const d = count(type, "dismissed"), h = count(type, "helpful");
    if (d) preferences.push(`The user dismissed ${d} "${type}" card${d === 1 ? "" : "s"} recently; do not repeat that topic.`);
    if (h) preferences.push(`The user found ${h} "${type}" card${h === 1 ? "" : "s"} helpful.`);
  }

  return { generated_on: i.today, scope: i.scope, period: i.period, facts, entities: dedupe(entities), preferences };
}

const dedupe = (es: Entity[]) => [...new Map(es.map((e) => [e.id, e])).values()];

/** Which period a digest covers (PRD §6.8): last full week, last full month, or the month so far. */
export function periodFor(scope: Facts["scope"], today: ISODate): { period: Facts["period"]; periods: number; step: string } {
  if (scope === "weekly") {
    const mon = addDays(today, -weekdayIndex(today));
    const from = addDays(mon, -7), to = addDays(mon, -1);
    return { period: { from, to, label: `last week (${formatDayMonth(from)} to ${formatDayMonth(to)})`, compare_label: "the previous four weeks" }, periods: 4, step: "7 days" };
  }
  if (scope === "monthly") {
    const from = monthStart(addMonths(today, -1));
    return { period: { from, to: monthEnd(from), label: formatMonth(from), compare_label: "the six months before" }, periods: 6, step: "1 month" };
  }
  return { period: { from: monthStart(today), to: today, label: `${formatMonth(today)} so far`, compare_label: "earlier months at the same point" }, periods: 6, step: "1 month" };
}

/** Fetch everything with the given client (the user's session, or the service role in cron) and assemble the facts. */
export async function buildFacts(db: SupabaseClient, o: { scope: Facts["scope"]; today: ISODate; includeNotes: boolean }): Promise<Facts> {
  const { period, periods, step } = periodFor(o.scope, o.today);
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  const [pace0, history, big, newPayeesRaw, monthlyTotals, daily6raw, periodDaily, feedback, trackingRow] = await Promise.all([
    fetchPace(db, o.today),
    rpc<HistoryRow[]>("category_period_history", { p_from: period.from, p_to: period.to, p_periods: periods, p_step: step }),
    rpc<FactsInput["big"]>("top_transactions", { p_from: period.from, p_to: period.to, p_limit: 3 }),
    rpc<{ payee_id: string; name: string; amount_pence: number; occurred_on: ISODate }[]>("new_payees", { p_from: period.from, p_to: period.to }),
    fetchMonthlyTotals(db, 12),
    fetchDailySpend(db, monthStart(addMonths(monthStart(o.today), -6)), o.today),
    fetchDailySpend(db, period.from, period.to, true),
    db.from("insight_feedback").select("card_type, card_key, action").order("created_at", { ascending: false }).limit(50).then((r) => (r.data ?? []) as FeedbackRow[]),
    db.from("profiles").select("tracking_started_on").limit(1).then((r) => ((r.data?.[0] as { tracking_started_on: ISODate | null } | undefined)?.tracking_started_on ?? null)),
  ]);

  // BAL-07: months before tracking began only hold what was back-filled, so they are never a baseline, pace comparison or average
  const trackStart = trackingRow as ISODate | null;
  const partial = (m: ISODate) => !!trackStart && m <= monthStart(trackStart);
  const daily6 = trackStart ? daily6raw.filter((d) => d.day >= trackStart) : daily6raw;
  const pace = partial(addMonths(monthStart(o.today), -1)) ? { ...pace0, prev_spend_pence: 0, prev_total_pence: 0 } : pace0;

  const thisMonth = monthStart(o.today);
  const monthSpend = monthlyTotals.find((t) => t.month === thisMonth)?.spend_pence ?? 0;
  const projected = o.scope === "adhoc" || o.scope === "weekly" ? projectMonth(daily6 as DailySpend[], o.today, monthSpend) : null;
  const complete = monthlyTotals.filter((t) => t.month < thisMonth && t.spend_pence > 0 && !partial(t.month)).map((t) => t.spend_pence);

  // monthly history for the top categories and the streaming sub-category, full months only
  const upTo = monthStart(period.to);
  const monthly = async (id: string) => (await rpc<{ month: ISODate; total_pence: number; txn_count: number }[]>("category_monthly", { p_category: id, p_months: 7 }))
    .filter((m) => m.month <= upTo && (o.scope === "monthly" || m.month < thisMonth || upTo < thisMonth)).map((m) => ({ month: m.month, total_pence: m.total_pence }));
  const topIds = history.filter((h) => h.current_pence > 0).slice(0, 6).map((h) => h.category_id);
  const trendRows = await Promise.all(topIds.map(async (id) => [id, await monthly(id)] as const));
  const { data: streamRow } = await db.from("categories").select("id,name").eq("name", "Streaming & apps").is("archived_at", null).limit(1);
  const stream = (streamRow as { id: string; name: string }[] | null)?.[0];

  let notes: Record<string, string | null> = {};
  if (o.includeNotes && big.length) {
    const { data } = await db.from("transactions").select("id,note").in("id", big.map((b) => b.id));
    notes = Object.fromEntries(((data ?? []) as { id: string; note: string | null }[]).map((r) => [r.id, r.note]));
  }

  const series = (await rpc<DailySpend[]>("daily_spend", { p_from: thisMonth, p_to: o.today, p_exclude_fixed: false })).map((d) => d.cumulative_pence);
  return assembleFacts({
    today: o.today, scope: o.scope, period, pace, projected, monthAvg: average(complete),
    history, trends: Object.fromEntries(trendRows), streaming: stream ? { id: stream.id, name: stream.name, months: await monthly(stream.id) } : undefined,
    newPayees: newPayeesRaw, big: big.map((b) => ({ ...b, note: notes[b.id] ?? null })),
    weekdayAvg: weekdayAverages((periodDaily as DailySpend[]).filter((d) => d.day <= o.today)), series, feedback,
  });
}
export { formatShort };
