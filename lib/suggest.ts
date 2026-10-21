// CAP-01.1 smart category suggestions: ranked client-side from the last 180 days, over the categories actually used (the
// lowest level of the hierarchy: "Coffee & snacks", not "Eating out"), each with its parent for context.
//   score = 0.45·freq_same_hour_band(±2h) + 0.25·freq_same_weekday + 0.20·recency(half-life 14 d) + 0.10·overall_freq
import { diffDays, londonParts, type ISODate } from "@/lib/dates";
import type { Category } from "@/lib/types";

export interface HistoryRow {
  category_id: string;
  occurred_on: ISODate;
  /** Precise time of day when known, else created_at. */
  at: string;
}

/** A category to offer: its own name, and its parent's name when it is a sub-category. */
export interface Suggestion { categoryId: string; label: string; parentLabel?: string }

export const COLD_START_MIN = 20;
export const COLD_START_ORDER = ["Groceries", "Eating out", "Transport", "Shopping", "Home", "Bills"];
const HALF_LIFE_DAYS = 14;
const WINDOW_DAYS = 180;

const hourDistance = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 24 - d); };

export interface SuggestInput {
  history: readonly HistoryRow[];
  categories: readonly Category[];
  now: Date;
  today: ISODate;
  /** The payee's learned category (pinned first), when the payee has history. */
  payeeCategoryId?: string | null;
  count?: number;
}

export function suggestCategories({ history, categories, now, today, payeeCategoryId, count = 6 }: SuggestInput): Suggestion[] {
  const live = categories.filter((c) => c.kind === "expense" && !c.archived_at);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (categoryId: string | null | undefined) => {
    if (!categoryId || seen.has(categoryId)) return;
    const c = byId.get(categoryId);
    if (!c || c.archived_at || c.kind !== "expense") return;
    seen.add(categoryId);
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    out.push({ categoryId, label: c.name, parentLabel: parent?.name });
  };

  push(payeeCategoryId);

  if (history.length < COLD_START_MIN) {
    // not enough history to rank: the first sub-category of each usual group (or the group itself when it has none)
    const firstOf = (parent: Category) => live.find((x) => x.parent_id === parent.id) ?? parent;
    for (const name of COLD_START_ORDER) {
      const p = live.find((x) => !x.parent_id && x.name === name);
      if (p) push(firstOf(p).id);
    }
    for (const p of live.filter((x) => !x.parent_id)) push(firstOf(p).id);
    return out.slice(0, count);
  }

  const rows = history.filter((h) => diffDays(today, h.occurred_on) <= WINDOW_DAYS && diffDays(today, h.occurred_on) >= 0);
  const nowParts = londonParts(now);
  const hourRows = rows.filter((h) => hourDistance(londonParts(new Date(h.at)).hour, nowParts.hour) <= 2);
  const weekdayRows = rows.filter((h) => londonParts(new Date(`${h.occurred_on}T12:00:00Z`)).weekday === nowParts.weekday);

  const tally = (list: readonly HistoryRow[]) => {
    const m = new Map<string, number>();
    for (const h of list) m.set(h.category_id, (m.get(h.category_id) ?? 0) + 1);
    return m;
  };
  const hour = tally(hourRows), weekday = tally(weekdayRows), overall = tally(rows);
  const lastUse = new Map<string, number>();
  for (const h of rows) lastUse.set(h.category_id, Math.min(lastUse.get(h.category_id) ?? Infinity, diffDays(today, h.occurred_on)));

  const share = (m: Map<string, number>, total: number, id: string) => (total === 0 ? 0 : (m.get(id) ?? 0) / total);
  const scored = live.filter((c) => overall.has(c.id)).map((c) => {
    const recency = lastUse.has(c.id) ? Math.pow(0.5, lastUse.get(c.id)! / HALF_LIFE_DAYS) : 0;
    const score = 0.45 * share(hour, hourRows.length, c.id) + 0.25 * share(weekday, weekdayRows.length, c.id)
      + 0.2 * recency + 0.1 * share(overall, rows.length, c.id);
    return { c, score };
  }).sort((a, b) => b.score - a.score || a.c.sort_order - b.c.sort_order);

  for (const { c } of scored) { if (out.length >= count) break; push(c.id); }
  // fewer than `count` categories have been used recently: top up with the usual groups' first sub-categories
  if (out.length < count) {
    for (const name of COLD_START_ORDER) {
      const p = live.find((x) => !x.parent_id && x.name === name);
      if (p) push((live.find((x) => x.parent_id === p.id) ?? p).id);
    }
  }
  return out.slice(0, count);
}
