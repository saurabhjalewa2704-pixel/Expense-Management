// PRD §6.13 BUD-12: the facts behind the four budget cards. Every figure comes from the forecast engine's BudgetView; nothing is calculated here.
import type { BudgetView, LimitView } from "@/lib/budget";
import { formatGBP, type Pence } from "@/lib/money";
import { slug } from "./facts";
import type { Card, Entity, Fact } from "./types";

const whole = (p: Pence) => formatGBP(p, { whole: true });
const money = (p: Pence) => formatGBP(p);

/** A proposed new amount for a limit that was missed, or beaten by a wide margin, three months running. */
export interface BudgetSuggestion { categoryId: string; name: string; current: Pence; proposed: Pence; kind: "missed" | "beaten" }

export function budgetFacts(v: BudgetView, suggestions: readonly BudgetSuggestion[], add: (f: Fact) => void, entities: Entity[]): void {
  const o = v.overall, f = o.forecast;
  if (v.closed) return;
  add({ key: "budget_amount", label: "The monthly budget", value_pence: o.amount, display: whole(o.amount) });
  add({ key: "budget_left", label: "Left of the monthly budget", value_pence: Math.abs(o.left), display: money(Math.abs(o.left)) });
  add({ key: "budget_status", label: "Where the month is heading against the budget", display: o.status === "on_track" ? "On track" : o.status === "tight" ? "Tight" : o.status === "over" ? "Over" : "Early days" });
  if (f.available) {
    add({ key: "budget_forecast", label: "Forecast spend at month end", value_pence: f.forecast, display: whole(f.forecast) });
    add({ key: "budget_gap", label: "How far the forecast is from the budget", value_pence: Math.abs(o.variance), display: whole(Math.abs(o.variance)) });
    add({ key: "budget_dir", label: "Whether the forecast finishes under or over the budget", display: o.variance > 0 ? "over" : "under" });
    add({ key: "budget_safe_per_day", label: "Safe to spend per day to stay on budget", value_pence: o.safePerDay, display: money(o.safePerDay) });
    add({ key: "budget_usual_per_day", label: "Your usual daily pace", value_pence: f.expectedPerDay, display: money(f.expectedPerDay) });
  }
  for (const l of v.limits) {
    if (!l.categoryId) continue;
    const s = slug(l.name);
    entities.push({ id: l.categoryId, kind: "category", name: l.name });
    add({ key: `limit:${s}:amount`, label: `${l.name} limit`, value_pence: l.amount, display: whole(l.amount) });
    add({ key: `limit:${s}:spent`, label: `${l.name} spent this month`, value_pence: l.spentShown, display: money(l.spentShown) });
    if (!l.forecast.available) continue;
    const free = Math.max(0, l.left - l.billsToCome);
    add({ key: `limit:${s}:left`, label: `${l.name} left this month`, value_pence: Math.max(0, l.left), display: money(Math.max(0, l.left)) });
    add({ key: `limit:${s}:days_left`, label: "Days left including today", display: String(l.forecast.daysLeft) });
    add({ key: `limit:${s}:safe_per_day`, label: `${l.name} you can spend a day`, value_pence: Math.floor(free / l.forecast.daysLeft), display: money(Math.floor(free / l.forecast.daysLeft)) });
    add({ key: `limit:${s}:usual_per_day`, label: `${l.name} usual daily pace`, value_pence: l.forecast.expectedPerDay, display: money(l.forecast.expectedPerDay) });
    add({ key: `limit:${s}:${l.variance > 0 ? "over" : "under"}`, label: `${l.name} forecast ${l.variance > 0 ? "over" : "under"} its limit`, value_pence: Math.abs(l.variance), display: whole(Math.abs(l.variance)) });
  }
  for (const g of suggestions) {
    const s = slug(g.name);
    entities.push({ id: g.categoryId, kind: "category", name: g.name });
    add({ key: `suggest:${s}:current`, label: `${g.name} limit now`, value_pence: g.current, display: whole(g.current) });
    add({ key: `suggest:${s}:proposed`, label: `A new ${g.name} limit`, value_pence: g.proposed, display: whole(g.proposed) });
    add({ key: `suggest:${s}:kind`, label: `Whether ${g.name} was missed or beaten`, display: g.kind });
  }
}

/** Template cards straight from those facts, so they are grounded by construction (used when there is no model or its cards fail validation). */
export function budgetCards(facts: readonly Fact[], entities: readonly Entity[], month: string): Card[] {
  const by = new Map(facts.map((f) => [f.key, f]));
  const get = (k: string) => by.get(k);
  const cat = (name: string) => entities.find((e) => e.kind === "category" && e.name === name);
  const cards: Omit<Card, "rank">[] = [];
  const risky = facts.filter((f) => f.key.endsWith(":over") && f.key.startsWith("limit:"));
  const top = risky.sort((a, b) => (b.value_pence ?? 0) - (a.value_pence ?? 0))[0];
  if (top) {
    const s = top.key.split(":")[1]!, name = top.label.replace(/ forecast over its limit$/, "");
    const left = get(`limit:${s}:left`), days = get(`limit:${s}:days_left`), per = get(`limit:${s}:safe_per_day`), usual = get(`limit:${s}:usual_per_day`), amt = get(`limit:${s}:amount`);
    if (left && days && per && usual && amt) {
      const e = cat(name);
      cards.push({
        key: `budget_risk:${s}:${month}`, type: "budget_risk", severity: "caution", viz: "none",
        title: `${name} has ${left.display} left for ${days.display} days`, body: `That’s ${per.display} a day. Your usual pace is ${usual.display} a day, which would finish ${top.display} over the ${amt.display} limit.`,
        metric: { fact_key: `limit:${s}:left` }, link: e ? { kind: "category", id: e.id } : { kind: "screen", id: "/budget" },
      });
    }
  }
  const win = facts.find((f) => f.key.endsWith(":under") && f.key.startsWith("limit:") && (f.value_pence ?? 0) >= 2000);
  if (win && !top) {
    const s = win.key.split(":")[1]!, name = win.label.replace(/ forecast under its limit$/, ""), amt = get(`limit:${s}:amount`), e = cat(name);
    if (amt) cards.push({ key: `budget_win:${s}:${month}`, type: "budget_win", severity: "positive", viz: "none", title: `${name} is on course to finish ${win.display} under its limit`, body: `The ${amt.display} limit looks comfortable this month.`, metric: { fact_key: `limit:${s}:amount` }, link: e ? { kind: "category", id: e.id } : { kind: "screen", id: "/budget" } });
  }
  const status = get("budget_status"), fc = get("budget_forecast"), gap = get("budget_gap"), dir = get("budget_dir"), safe = get("budget_safe_per_day"), amount = get("budget_amount");
  if (status && fc && gap && dir && safe && amount && status.display !== "Early days") {
    cards.push({
      key: `budget_pace:${month}`, type: "budget_pace", severity: dir.display === "over" ? "caution" : status.display === "Tight" ? "caution" : "positive", viz: "none",
      title: dir.display === "over" ? `The month is heading ${gap.display} over budget` : `The month is heading ${gap.display} under budget`,
      body: `Forecast ${fc.display} against ${amount.display}. Spending ${safe.display} a day keeps you on budget.`,
      metric: { fact_key: "budget_forecast" }, link: { kind: "screen", id: "/budget" },
    });
  }
  const sg = facts.find((f) => f.key.startsWith("suggest:") && f.key.endsWith(":proposed"));
  if (sg) {
    const s = sg.key.split(":")[1]!, cur = get(`suggest:${s}:current`), kind = get(`suggest:${s}:kind`);
    const name = sg.label.replace(/^A new /, "").replace(/ limit$/, ""), e = cat(name);
    if (cur && kind) {
      cards.push({
        key: `budget_suggest:${s}:${month}`, type: "budget_suggest", severity: "info", viz: "none",
        title: `Try a ${sg.display} ${name} limit`, body: kind.display === "missed" ? `You’ve gone past the ${cur.display} limit three months running. Nothing changes unless you accept.` : `You’ve finished well under the ${cur.display} limit three months running. Nothing changes unless you accept.`,
        metric: { fact_key: `suggest:${s}:proposed` }, link: e ? { kind: "screen", id: `/budget/setup?limit=${e.id}&amount=${sg.value_pence}` } : { kind: "screen", id: "/budget/setup" },
      });
    }
  }
  return cards.map((c, i) => ({ ...c, rank: i + 1 }));
}
