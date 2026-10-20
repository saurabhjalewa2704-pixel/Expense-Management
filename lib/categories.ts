import type { Category, CategoryKind, TxnRow } from "@/lib/types";

export interface CategoryTree {
  byId: Map<string, Category>;
  /** Live (non-archived) parents of a kind, in sort order. */
  parents: (kind: CategoryKind) => Category[];
  /** Live sub-categories of a parent, in sort order. */
  children: (parentId: string) => Category[];
  /** "Coffee & snacks", with its parent when useful: "Eating out › Coffee & snacks". */
  path: (id: string | null | undefined) => string;
  /** The top-level ancestor of a category (itself when it is a parent). */
  root: (id: string) => Category | undefined;
}

export function buildTree(all: readonly Category[]): CategoryTree {
  const byId = new Map(all.map((c) => [c.id, c]));
  const sorted = [...all].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const live = sorted.filter((c) => !c.archived_at);
  return {
    byId,
    parents: (kind) => live.filter((c) => c.kind === kind && !c.parent_id),
    children: (pid) => live.filter((c) => c.parent_id === pid),
    path: (id) => {
      const c = id ? byId.get(id) : undefined;
      if (!c) return "";
      const p = c.parent_id ? byId.get(c.parent_id) : undefined;
      return p ? `${p.name} › ${c.name}` : c.name;
    },
    root: (id) => {
      const c = byId.get(id);
      return c?.parent_id ? byId.get(c.parent_id) : c;
    },
  };
}

/** What a list row calls itself: the payee, else the category, else what kind of entry it is. */
export function rowTitle(r: Pick<TxnRow, "type" | "payee_name" | "category_name" | "counter_account_name" | "account_name" | "note">): string {
  if (r.type === "transfer") return `${r.account_name} → ${r.counter_account_name ?? "account"}`;
  if (r.type === "adjustment") return "Balance adjustment";
  return r.payee_name || r.category_name || "Untitled";
}

/** Second line of a list row: sub-category · account · time. */
export function rowSubtitle(r: TxnRow, time?: string): string {
  const parts: string[] = [];
  if (r.type === "transfer") parts.push("Transfer");
  else if (r.type === "adjustment") parts.push("Adjustment");
  else if (r.payee_name && r.category_name) parts.push(r.category_name);
  if (r.type !== "transfer") parts.push(r.account_name);
  if (r.pot_name) parts.push(`${r.pot_name} pot`);
  if (time) parts.push(time);
  return parts.join(" · ");
}
