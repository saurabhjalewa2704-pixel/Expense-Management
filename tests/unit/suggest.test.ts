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
    expect(s.map((x) => x.label)).toEqual(["Groceries", "Coffee & snacks", "TfL & rail", "Shopping", "Home", "Bills"]);   // the first sub-category of each group
    expect(s[1]).toMatchObject({ categoryId: "coffee", parentLabel: "Eating out" });
  });

  it("pins the payee's learned category first, even on a cold start", () => {
    const s = suggestCategories({ history: [], categories: cats, now, today, payeeCategoryId: "coffee" });
    expect(s[0]).toEqual({ categoryId: "coffee", label: "Coffee & snacks", parentLabel: "Eating out" });
    expect(s.filter((x) => x.categoryId === "coffee")).toHaveLength(1);   // not repeated when the cold-start list reaches it too
    expect(s).toHaveLength(6);
  });

  it("ranks by time of day: a morning coffee habit leads at 08:30 on a Monday", () => {
    const morning = Array.from({ length: 12 }, (_, i) => row("coffee", `2026-10-${String(i + 1).padStart(2, "0")}`, "07:40"));
    const history = [...morning, ...Array.from({ length: 10 }, (_, i) => row("tfl", `2026-09-${String(i + 1).padStart(2, "0")}`, "17:30"))];
    const s = suggestCategories({ history, categories: cats, now, today });
    expect(s[0]!.label).toBe("Coffee & snacks"); // the sub-category itself, with its parent beside it
    // and in the evening the commute leads instead
    const evening = suggestCategories({ history, categories: cats, now: new Date("2026-10-19T16:30:00Z"), today });
    expect(evening[0]!.label).toBe("TfL & rail");
  });

  it("ranks the lowest level used, so two sub-categories of one parent can both lead", () => {
    const history = [
      ...Array.from({ length: 8 }, (_, i) => row("coffee", `2026-10-${String(i + 1).padStart(2, "0")}`, "07:40")),
      ...Array.from({ length: 6 }, (_, i) => row("rest", `2026-10-${String(i + 1).padStart(2, "0")}`, "07:50")),
      ...filler(10),
    ];
    const s = suggestCategories({ history, categories: cats, now, today });
    expect(s.slice(0, 2).map((x) => x.label).sort()).toEqual(["Coffee & snacks", "Restaurants"]);
    expect(s.slice(0, 2).every((x) => x.parentLabel === "Eating out")).toBe(true);
  });

  it("a category used directly (not a sub-category) has no parent label", () => {
    const s = suggestCategories({ history: filler(25), categories: cats, now, today });
    expect(s[0]).toMatchObject({ label: "Groceries" });
    expect(s[0]!.parentLabel).toBeUndefined();
  });

  it("ignores history older than 180 days", () => {
    const old = Array.from({ length: 30 }, () => row("health", "2026-01-05", "07:30"));
    const s = suggestCategories({ history: [...old, ...filler(5)], categories: cats, now, today });
    expect(s[0]!.label).not.toBe("Health");
  });

  it("never returns archived categories or duplicates", () => {
    const archived = cats.map((c) => (c.id === "groc" ? { ...c, archived_at: "2026-01-01" } : c));
    const s = suggestCategories({ history: filler(25), categories: archived, now, today });
    expect(s.map((x) => x.label)).not.toContain("Groceries");
    expect(new Set(s.map((x) => x.categoryId)).size).toBe(s.length);
  });
});
