// The tools the model may call (PRD §12: the model never computes a number). Each one runs an existing SQL function as the
// signed-in user (RLS applies) and returns labelled figures, every one already formatted. The answer may quote only those.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addDays, weekdayIndex, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { fetchActivityPage, fetchBalances, fetchDailySpend, fetchMonthlyTotals, fetchPots, fetchSpendByCategory, fetchTopPayees, fetchTotals } from "@/lib/queries/fetchers";
import type { CatRow, ToolDef, ToolFact, ToolOutput } from "./types";

export interface AskCtx { db: SupabaseClient; today: ISODate; categories: CatRow[] }

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be YYYY-MM-DD");
const period = z.object({ from: iso, to: iso }).refine((p) => p.from <= p.to, "from must not be after to");
const cat = z.string().uuid().optional();
const pct = (n: number) => `${Math.round(n)}%`;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const range = (p: { from: string; to: string }) => `${p.from} to ${p.to}`;

const dateProp = { type: "string", description: "A date as YYYY-MM-DD (London)." };
const catProp = { type: "string", description: "A category id from the catalogue (a parent id includes its sub-categories). Optional." };
const periodProps = { from: dateProp, to: dateProp };

export const TOOL_DEFS: ToolDef[] = [
  { name: "spend_summary", description: "Total usual spending in a period (one-off pots excluded), with a breakdown by category (or by sub-category when a parent category is given).",
    input_schema: { type: "object", properties: { ...periodProps, category_id: catProp }, required: ["from", "to"] } },
  { name: "compare_periods", description: "Usual spending in two periods side by side, with the difference and the percentage change from the baseline to the current period. Optionally for one category.",
    input_schema: { type: "object", properties: { current_from: dateProp, current_to: dateProp, baseline_from: dateProp, baseline_to: dateProp, category_id: catProp }, required: ["current_from", "current_to", "baseline_from", "baseline_to"] } },
  { name: "monthly_totals", description: "Usual spending and income for each of the last N calendar months (the current month is partial), plus the average spending of the complete months.",
    input_schema: { type: "object", properties: { months: { type: "integer", minimum: 1, maximum: 24 } }, required: ["months"] } },
  { name: "top_payees", description: "Where the money went: payees ranked by total spent in a period, with visits and average. Optionally for one category.",
    input_schema: { type: "object", properties: { ...periodProps, category_id: catProp, limit: { type: "integer", minimum: 1, maximum: 15 } }, required: ["from", "to"] } },
  { name: "largest_transactions", description: "The biggest single purchases in a period (usual spending), largest first. Optionally for one category.",
    input_schema: { type: "object", properties: { ...periodProps, category_id: catProp, limit: { type: "integer", minimum: 1, maximum: 15 } }, required: ["from", "to"] } },
  { name: "find_transactions", description: "Transactions whose payee, category or tag matches a search word, newest first, with their total. One-off pots are left out unless include_pots is true.",
    input_schema: { type: "object", properties: { query: { type: "string" }, from: dateProp, to: dateProp, include_pots: { type: "boolean" } }, required: ["query"] } },
  { name: "spend_by_weekday", description: "Average usual spending on each day of the week over a period.",
    input_schema: { type: "object", properties: periodProps, required: ["from", "to"] } },
  { name: "cash_position", description: "Available cash today and the balance of each account.", input_schema: { type: "object", properties: {} } },
  { name: "pot_summary", description: "One-off pots (such as a home purchase): what each has cost, what came in, the net cost and any budget. Use this only when the user asks about a pot or a big one-off cost.", input_schema: { type: "object", properties: {} } },
];

const ids = (ctx: AskCtx, id?: string): string[] | undefined => {
  if (!id) return undefined;
  const c = ctx.categories.find((x) => x.id === id);
  if (!c) throw new Error("unknown category_id: use an id from the catalogue");
  return [id, ...ctx.categories.filter((x) => x.parent_id === id).map((x) => x.id)];
};
const catName = (ctx: AskCtx, id?: string) => (id ? ctx.categories.find((c) => c.id === id)?.name : undefined);
const fact = (label: string, display: string): ToolFact => ({ label, display });

export async function runTool(ctx: AskCtx, name: string, input: unknown): Promise<ToolOutput> {
  const { db } = ctx;
  switch (name) {
    case "spend_summary": {
      const a = period.extend({ category_id: cat }).parse(input);
      const totals = await fetchTotals(db, { from: a.from, to: a.to, types: ["expense"], categoryIds: ids(ctx, a.category_id), pot: "exclude" });
      const rows = (await fetchSpendByCategory(db, a.from, a.to, a.category_id ?? null)).slice(0, 8);
      const who = catName(ctx, a.category_id);
      const facts = [fact(`Total spent${who ? ` on ${who}` : ""}, ${range(a)} (usual spending)`, formatGBP(totals.spend_pence)), fact("Number of transactions", String(totals.txn_count))];
      for (const r of rows) {
        facts.push(fact(r.name, formatGBP(r.total_pence)));
        if (totals.spend_pence > 0 && !a.category_id) facts.push(fact(`${r.name} share of spending`, pct((r.total_pence * 100) / totals.spend_pence)));
      }
      return { facts, note: "One-off pots are not included." };
    }
    case "compare_periods": {
      const a = z.object({ current_from: iso, current_to: iso, baseline_from: iso, baseline_to: iso, category_id: cat }).parse(input);
      const f = (from: string, to: string) => fetchTotals(db, { from, to, types: ["expense"], categoryIds: ids(ctx, a.category_id), pot: "exclude" });
      const [cur, base] = await Promise.all([f(a.current_from, a.current_to), f(a.baseline_from, a.baseline_to)]);
      const diff = cur.spend_pence - base.spend_pence;
      const who = catName(ctx, a.category_id);
      const facts = [
        fact(`Current period spending${who ? ` on ${who}` : ""}, ${a.current_from} to ${a.current_to}`, formatGBP(cur.spend_pence)),
        fact(`Baseline spending${who ? ` on ${who}` : ""}, ${a.baseline_from} to ${a.baseline_to}`, formatGBP(base.spend_pence)),
        fact(`Difference (current is ${diff >= 0 ? "higher" : "lower"} than baseline)`, formatGBP(Math.abs(diff))),
      ];
      if (base.spend_pence > 0) facts.push(fact(`Percentage change from baseline (${diff >= 0 ? "increase" : "decrease"})`, pct((Math.abs(diff) * 100) / base.spend_pence)));
      return { facts, note: "Usual spending only; one-off pots are not included." };
    }
    case "monthly_totals": {
      const a = z.object({ months: z.number().int().min(1).max(24) }).parse(input);
      const rows = await fetchMonthlyTotals(db, a.months);
      const facts: ToolFact[] = [];
      for (const r of rows) {
        facts.push(fact(`${r.month.slice(0, 7)} spending${r.month.slice(0, 7) === ctx.today.slice(0, 7) ? " (month so far)" : ""}`, formatGBP(r.spend_pence)));
        facts.push(fact(`${r.month.slice(0, 7)} income`, formatGBP(r.income_pence)));
      }
      const complete = rows.filter((r) => r.month.slice(0, 7) !== ctx.today.slice(0, 7));
      if (complete.length) facts.push(fact(`Average monthly spending over the ${complete.length} complete month${complete.length === 1 ? "" : "s"}`, formatGBP(Math.round(complete.reduce((s, r) => s + r.spend_pence, 0) / complete.length))));
      return { facts, note: "Usual spending and income; one-off pots are not included." };
    }
    case "top_payees": {
      const a = period.extend({ category_id: cat, limit: z.number().int().min(1).max(15).optional() }).parse(input);
      const rows = await fetchTopPayees(db, a.from, a.to, a.limit ?? 8, a.category_id ?? null);
      const facts: ToolFact[] = [];
      for (const r of rows) {
        facts.push(fact(`${r.name} (${r.visits} visit${r.visits === 1 ? "" : "s"})`, formatGBP(r.total_pence)));
        facts.push(fact(`${r.name} average per visit`, formatGBP(r.avg_pence)));
      }
      return { facts, note: `Payees by spending, ${range(a)}.` };
    }
    case "largest_transactions": {
      const a = period.extend({ category_id: cat, limit: z.number().int().min(1).max(15).optional() }).parse(input);
      const { data, error } = await db.rpc("largest_transactions", { p_from: a.from, p_to: a.to, p_limit: a.limit ?? 5, p_category: a.category_id ?? null });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { payee_name: string | null; category_name: string | null; amount_pence: number; occurred_on: string }[];
      return { facts: rows.map((r) => fact(`${r.occurred_on} ${r.payee_name ?? r.category_name ?? "Purchase"}${r.payee_name && r.category_name ? ` (${r.category_name})` : ""}`, formatGBP(r.amount_pence))) };
    }
    case "find_transactions": {
      const a = z.object({ query: z.string().trim().min(1).max(60), from: iso.optional(), to: iso.optional(), include_pots: z.boolean().optional() }).parse(input);
      const filters = { q: a.query, from: a.from, to: a.to, types: ["expense"], pot: a.include_pots ? undefined : ("exclude" as const) };
      const [rows, totals] = await Promise.all([fetchActivityPage(db, filters, undefined, 12), fetchTotals(db, filters)]);
      const facts = [fact(`Total for "${a.query}"${a.from ? ` ${a.from} to ${a.to ?? ctx.today}` : ""}`, formatGBP(totals.spend_pence + (a.include_pots ? -totals.pot_pence : 0))), fact("Number of matching transactions", String(totals.txn_count))];
      for (const r of rows.slice(0, 12)) facts.push(fact(`${r.occurred_on} ${r.payee_name ?? r.category_name ?? "Purchase"}${r.pot_name ? ` (in ${r.pot_name} pot)` : ""}`, formatGBP(r.amount_pence)));
      return { facts, note: rows.length >= 12 ? "Only the newest transactions are listed; the total covers all matches." : undefined };
    }
    case "spend_by_weekday": {
      const a = period.parse(input);
      if (addDays(a.from, 800) < a.to) throw new Error("choose a period of at most about two years");
      const days = await fetchDailySpend(db, a.from, a.to, false);
      const sum = new Array<number>(7).fill(0), n = new Array<number>(7).fill(0);
      for (const d of days) { const i = weekdayIndex(d.day); sum[i]! += d.total_pence; n[i]! += 1; }
      return { facts: WEEKDAYS.map((w, i) => fact(`Average spending on a ${w}`, formatGBP(n[i] ? Math.round(sum[i]! / n[i]!) : 0))), note: `Usual spending, ${range(a)}.` };
    }
    case "cash_position": {
      const rows = await fetchBalances(db, ctx.today);
      const facts = [fact("Available cash today", formatGBP(rows.filter((r) => r.counts_as_cash).reduce((s, r) => s + r.balance_pence, 0)))];
      for (const r of rows) facts.push(fact(`${r.name} balance${r.counts_as_cash ? "" : " (not in available cash)"}`, formatGBP(r.balance_pence)));
      return { facts };
    }
    case "pot_summary": {
      const pots = await fetchPots(db);
      const facts: ToolFact[] = [];
      for (const p of pots) {
        facts.push(fact(`${p.name}: spent`, formatGBP(p.spent_pence)));
        if (p.received_pence > 0) facts.push(fact(`${p.name}: received`, formatGBP(p.received_pence)));
        facts.push(fact(`${p.name}: net cost`, formatGBP(p.net_pence)));
        if (p.target_pence) {
          facts.push(fact(`${p.name}: budget`, formatGBP(p.target_pence)));
          facts.push(fact(`${p.name}: ${p.target_pence - p.net_pence >= 0 ? "left of budget" : "over budget"}`, formatGBP(Math.abs(p.target_pence - p.net_pence))));
        }
      }
      return { facts, note: pots.length ? "These are one-off pots, kept out of usual spending." : "The user has no one-off pots yet." };
    }
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}
