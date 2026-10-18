// CAP-01.1 smart category suggestions: ranked client-side from the last 180 days.
//   score = 0.45·freq_same_hour_band(±2h) + 0.25·freq_same_weekday + 0.20·recency(half-life 14 d) + 0.10·overall_freq
// The ranking is over parent categories; each chip shows the user's own sub-category once it has been used 3+ times.
import { diffDays, londonParts, type ISODate } from "@/lib/dates";
import type { Category } from "@/lib/types";

export interface HistoryRow {
  category_id: string;
  occurred_on: ISODate;
  /** Precise time of day when known, else created_at. */
  at: string;
}

export interface Suggestion { categoryId: string; label: string }

export const COLD_START_MIN = 20;
export const COLD_START_ORDER = ["Groceries", "Eating out", "Transport", "Shopping", "Home", "Bills"];
const HALF_LIFE_DAYS = 14;
const WINDOW_DAYS = 180;
const SUB_MIN_USES = 3;

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
  const parentOf = (id: string) => { const c = byId.get(id); return c?.parent_id ?? c?.id; };
  const labelOf = (id: string) => byId.get(id)?.name ?? "";

  const rows = history.filter((h) => diffDays(today, h.occurred_on) <= WINDOW_DAYS && diffDays(today, h.occurred_on) >= 0);
  const out: Suggestion[] = [];
  const seen = new Set<string>(); // by parent, so the chips never repeat a group
  const push = (categoryId: string | null | undefined, label?: string) => {
    if (!categoryId) return;
    const root = parentOf(categoryId);
    const c = byId.get(categoryId);
    if (!root || !c || c.archived_at || c.kind !== "expense" || seen.has(root)) return;
    seen.add(root);
    out.push({ categoryId, label: label ?? c.name });
  };

  push(payeeCategoryId);

  if (history.length < COLD_START_MIN) {
    for (const name of COLD_START_ORDER) {
      const c = live.find((x) => !x.parent_id && x.name === name);
      if (c) push(c.id);
    }
    for (const c of live.filter((x) => !x.parent_id)) push(c.id);
    return out.slice(0, count);
  }

  const nowParts = londonParts(now);
  const hourRows = rows.filter((h) => hourDistance(londonParts(new Date(h.at)).hour, nowParts.hour) <= 2);
  const weekdayRows = rows.filter((h) => londonParts(new Date(`${h.occurred_on}T12:00:00Z`)).weekday === nowParts.weekday);

  const tally = (list: readonly HistoryRow[]) => {
    const m = new Map<string, number>();
    for (const h of list) { const r = parentOf(h.category_id); if (r) m.set(r, (m.get(r) ?? 0) + 1); }
    return m;
  };
  const hour = tally(hourRows), weekday = tally(weekdayRows), overall = tally(rows);
  const lastUse = new Map<string, number>();
  for (const h of rows) { const r = parentOf(h.category_id); if (r) lastUse.set(r, Math.min(lastUse.get(r) ?? Infinity, diffDays(today, h.occurred_on))); }

  const share = (m: Map<string, number>, total: number, id: string) => (total === 0 ? 0 : (m.get(id) ?? 0) / total);
  const scored = live.filter((c) => !c.parent_id).map((c) => {
    const recency = lastUse.has(c.id) ? Math.pow(0.5, lastUse.get(c.id)! / HALF_LIFE_DAYS) : 0;
    const score = 0.45 * share(hour, hourRows.length, c.id) + 0.25 * share(weekday, weekdayRows.length, c.id)
      + 0.2 * recency + 0.1 * share(overall, rows.length, c.id);
    return { c, score };
  }).sort((a, b) => b.score - a.score || a.c.sort_order - b.c.sort_order);

  // The sub-category to show for a parent: the most used one, once it has 3+ uses.
  const subUses = new Map<string, number>();
  for (const h of rows) subUses.set(h.category_id, (subUses.get(h.category_id) ?? 0) + 1);
  const bestSub = (parentId: string) => {
    let best: Category | undefined, n = 0;
    for (const c of live.filter((x) => x.parent_id === parentId)) {
      const u = subUses.get(c.id) ?? 0;
      if (u >= SUB_MIN_USES && u > n) { best = c; n = u; }
    }
    return best;
  };

  for (const { c } of scored) {
    if (out.length >= count) break;
    const sub = bestSub(c.id);
    push(sub?.id ?? c.id, sub ? labelOf(sub.id) : c.name);
  }
  return out.slice(0, count);
}
