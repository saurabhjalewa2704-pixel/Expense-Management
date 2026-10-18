import { describe, expect, it } from "vitest";
import { suggestCategories, type HistoryRow } from "@/lib/suggest";
import type { Category } from "@/lib/types";

const cat = (id: string, name: string, parent: string | null = null, sort = 0): Category => ({
  id, name, parent_id: parent, kind: "expense", icon: "circle", color: "stone", sort_order: sort, is_fixed: false, archived_at: null,
});
const cats: Category[] = [
  cat("groc", "Groceries", null, 1), cat("eat", "Eating out", null, 2), cat("tran", "Transport", null, 3), cat("shop", "Shopping", null, 4),
  cat("home", "Home", null, 5), cat("bills", "Bills", null, 6), cat("health", "Health", null, 7), cat("ent", "Entertainment", null, 8),
  cat("coffee", "Coffee & snacks", "eat", 1), cat("rest", "Restaurants", "eat", 2), cat("tfl", "TfL & rail", "tran", 1),
];
// 2026-10-19 is a Monday; 08:30 London (BST) = 07:30 UTC
const now = new Date("2026-10-19T07:30:00Z");
const today = "2026-10-19";
const at = (date: string, hhmmUtc: string) => `${date}T${hhmmUtc}:00Z`;
const row = (category_id: string, occurred_on: string, time = "12:00"): HistoryRow => ({ category_id, occurred_on, at: at(occurred_on, time) });
const filler = (n: number) => Array.from({ length: n }, (_, i) => row("groc", "2026-07-0" + ((i % 8) + 1), "17:00"));

describe("suggestCategories", () => {
  it("cold start: fewer than 20 transactions falls back to the default order", () => {
    const s = suggestCategories({ history: [row("coffee", "2026-10-18")], categories: cats, now, today });
    expect(s.map((x) => x.label)).toEqual(["Groceries", "Eating out", "Transport", "Shopping", "Home", "Bills"]);
  });

  it("pins the payee's learned category first, even on a cold start", () => {
    const s = suggestCategories({ history: [], categories: cats, now, today, payeeCategoryId: "coffee" });
    expect(s[0]).toEqual({ categoryId: "coffee", label: "Coffee & snacks" });
    expect(s.map((x) => x.label)).not.toContain("Eating out"); // same group, not repeated
    expect(s).toHaveLength(6);
  });

  it("ranks by time of day: a morning coffee habit leads at 08:30 on a Monday", () => {
    const morning = Array.from({ length: 12 }, (_, i) => row("coffee", `2026-10-${String(i + 1).padStart(2, "0")}`, "07:40"));
    const history = [...morning, ...Array.from({ length: 10 }, (_, i) => row("tfl", `2026-09-${String(i + 1).padStart(2, "0")}`, "17:30"))];
    const s = suggestCategories({ history, categories: cats, now, today });
    expect(s[0]!.label).toBe("Coffee & snacks"); // sub-category shown: used 12 times
    // and in the evening the commute leads instead
    const evening = suggestCategories({ history, categories: cats, now: new Date("2026-10-19T16:30:00Z"), today });
    expect(evening[0]!.label).toBe("TfL & rail");
  });

  it("shows the parent name until a sub-category has been used 3 times", () => {
    const two = [row("coffee", "2026-10-10", "07:40"), row("coffee", "2026-10-11", "07:40"), ...filler(20)];
    expect(suggestCategories({ history: two, categories: cats, now, today }).map((x) => x.label)).toContain("Eating out");
    const three = [...two, row("coffee", "2026-10-12", "07:40")];
    const labels = suggestCategories({ history: three, categories: cats, now, today }).map((x) => x.label);
    expect(labels).toContain("Coffee & snacks");
    expect(labels).not.toContain("Eating out");
  });

  it("ignores history older than 180 days", () => {
    const old = Array.from({ length: 30 }, () => row("health", "2026-01-05", "07:30"));
    const s = suggestCategories({ history: [...old, ...filler(5)], categories: cats, now, today });
    expect(s[0]!.label).not.toBe("Health");
  });

  it("never returns archived categories or duplicate groups", () => {
    const archived = cats.map((c) => (c.id === "groc" ? { ...c, archived_at: "2026-01-01" } : c));
    const s = suggestCategories({ history: filler(25), categories: archived, now, today });
    expect(s.map((x) => x.label)).not.toContain("Groceries");
    expect(new Set(s.map((x) => x.categoryId)).size).toBe(s.length);
  });
});
