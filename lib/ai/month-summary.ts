// The month-close review's summary (MONTH-CLOSE-PRD MC-50.3): two or three sentences from the computed facts only, through the existing writer and the
// grounding validator (§12.4). Text that does not pass is never shown; with AI off or no key there is no summary and the flow never waits for it.
import type { CloseSummary } from "@/lib/close/types";
import { monthName } from "@/lib/close/logic";
import { addDays, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import type { CardWriter } from "./writer";
import { validateCards } from "./validator";
import { Card, type Fact, type Facts } from "./types";

const money = (p: number) => formatGBP(p);
const whole = (p: number) => formatGBP(p, { whole: true });

/** Every figure the model may quote, each with the exact string to use. */
export function monthSummaryFacts(s: CloseSummary, names: Record<string, string>, today: ISODate): Facts {
  const facts: Fact[] = [];
  const add = (key: string, label: string, display: string, value_pence?: number) => facts.push({ key, label, display, value_pence });
  add("spent", `Spent in ${monthName(s.month)}`, money(s.spent), s.spent);
  add("spent_whole", `Spent in ${monthName(s.month)}, to the pound`, whole(s.spent), s.spent);
  add("income", "Money in", money(s.income), s.income);
  add("kept", "Kept (money in minus spend)", money(s.kept), s.kept);
  if (s.budget !== null && s.budget_spent !== null) {
    const diff = s.budget - s.budget_spent;
    add("budget", "The month's budget", money(s.budget), s.budget);
    add("budget_diff", diff >= 0 ? "Under budget by" : "Over budget by", money(Math.abs(diff)), Math.abs(diff));
  }
  add("everyday", "Everyday spending (what the forecast calls discretionary)", money(s.everyday), s.everyday);
  if (s.usual_estimate !== null) {
    add("usual", "Everyday spending you would usually expect", money(s.usual_estimate), s.usual_estimate);
    add("usual_pct", "Everyday spending against usual", `${Math.abs(Math.round(((s.everyday - s.usual_estimate) / s.usual_estimate) * 100))}%`);
  }
  for (const l of s.limits) if (l.actual > l.limit) add(`over_${l.category_id}`, `${names[l.category_id] ?? "A category"} was over its limit by`, money(l.actual - l.limit), l.actual - l.limit);
  const top = Object.entries(s.by_l1).sort((a, b) => b[1] - a[1]).slice(0, 3);
  top.forEach(([id, v], i) => add(`cat_${i}`, `${names[id] ?? "A category"} spending`, money(v), v));
  return {
    generated_on: today, scope: "monthly", period: { from: s.month, to: addDays(s.month, 27), label: monthName(s.month), compare_label: "your usual" },
    facts, entities: [], preferences: ["Write two or three plain sentences about how the month went, using only the figures given."],
  };
}

/** The summary text, or null. */
export async function writeMonthSummary(writer: CardWriter | null, facts: Facts): Promise<string | null> {
  if (!writer) return null;
  try {
    const res = await writer.write(facts);
    const cards = res.cards.map((c) => Card.safeParse(c)).filter((p) => p.success).map((p) => p.data!);
    const { valid } = validateCards(cards, facts);
    if (!valid.length) return null;
    const text = valid.slice(0, 2).map((c) => c.body.trim().replace(/\.?$/, ".")).join(" ");
    return text.length > 8 ? text : null;
  } catch {
    return null;
  }
}
