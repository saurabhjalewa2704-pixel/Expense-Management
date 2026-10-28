import { describe, expect, it } from "vitest";
import { assembleFacts, type FactsInput } from "@/lib/ai/facts";
import { narrate } from "@/lib/ai/generate";
import { validateCards } from "@/lib/ai/validator";
import type { CardWriter } from "@/lib/ai/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryBars } from "@/components/charts/category-bars";
import { cashLabel, figureSize } from "@/components/money";
import { isRetryableDbError } from "@/lib/action";
import { leafLabel } from "@/lib/analytics";
import { dateInZone, londonParts } from "@/lib/dates";
import { toPence, pressKey, MAX_PENCE } from "@/lib/money";
import { TxnInput } from "@/lib/schemas/transaction";
import { nextOccurrences } from "@/lib/recurrence";
import { suggestCategories } from "@/lib/suggest";
import type { Category } from "@/lib/types";

// The edge-case register (PRD §18), the rows that are pure functions. The test names start with the row's ID.

describe("money entry and display", () => {
  it("EC-M2 digits past £999,999.99 are ignored", () => {
    expect(pressKey("999999.99", "1")).toBe("999999.99");
    expect(pressKey("99999", "9")).toBe("999999");
    expect(pressKey("999999", "9")).toBe("999999");
    expect(toPence("999999.99")).toBe(MAX_PENCE);
  });
  it("EC-M3 a negative amount can never be typed or parsed", () => {
    expect(pressKey("", "-")).toBe("");
    expect(pressKey("12", "-")).toBe("12");
    const u = "11111111-1111-4111-8111-111111111111";
    expect(TxnInput.safeParse({ client_id: u, type: "expense", amount_pence: -500, account_id: u, category_id: u, occurred_on: "2026-10-18" }).success).toBe(false);
  });
  it("EC-M5 below zero the hero says Overdrawn by", () => {
    expect(cashLabel(-1)).toBe("Overdrawn by");
    expect(cashLabel(0)).toBe("Available cash");
    expect(cashLabel(500)).toBe("Available cash");
  });
  it("EC-M6 very large figures shrink to one line and never below 44px", () => {
    expect(figureSize(5, 64)).toBe(64);
    expect(figureSize(9, 64)).toBeLessThan(64);
    expect(figureSize(30, 64)).toBe(44);
  });
});

describe("dates", () => {
  it("EC-D1 20:00 in New York is already the next day in London, and the logged day is the one lived", () => {
    const at = new Date("2027-03-13T01:00:00Z");
    expect(dateInZone("America/New_York", at)).toBe("2027-03-12");
    expect(londonParts(at).date).toBe("2027-03-13");
    expect(dateInZone("Not/AZone", at)).toBe("2027-03-13");                       // an unknown zone falls back to London
  });
  it("EC-D2 London time follows the clock change: 01:00Z is 02:00 on 28 Mar 2027 and 00:30Z is 01:30 on 31 Oct 2027", () => {
    expect(londonParts(new Date("2027-03-28T00:59:00Z"))).toMatchObject({ hour: 0, minute: 59 });
    expect(londonParts(new Date("2027-03-28T01:00:00Z"))).toMatchObject({ hour: 2, minute: 0 });
    expect(londonParts(new Date("2027-10-31T00:30:00Z"))).toMatchObject({ hour: 1, minute: 30 });
    expect(londonParts(new Date("2027-10-31T01:30:00Z"))).toMatchObject({ hour: 1, minute: 30 });          // the repeated hour
    expect(londonParts(new Date("2026-10-25T20:00:00Z")).hour).toBe(20);                                    // 21:00 reminders are 21:00 local either side
    expect(londonParts(new Date("2026-10-24T20:00:00Z")).hour).toBe(21);
  });
  it("EC-D3 the 31st, 29 Feb and the last day land on the month's end", () => {
    const rule = { frequency: "monthly", day_of_month: 31, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day", starts_on: "2027-01-31", ends_on: null, max_occurrences: null } as const;
    expect(nextOccurrences(rule, "2027-01-01", "2027-04-30").map((o) => o.scheduled_on)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    const leap = { ...rule, frequency: "yearly", day_of_month: 29, month_of_year: 2, starts_on: "2027-01-01" } as const;
    expect(nextOccurrences(leap, "2027-01-01", "2028-12-31").map((o) => o.scheduled_on)).toEqual(["2027-02-28", "2028-02-29"]);
  });
});

describe("categories", () => {
  const cat = (id: string, name: string, parent_id: string | null = null, archived = false): Category => ({ id, name, parent_id, kind: "expense", icon: "circle", color: "stone", sort_order: 1, is_fixed: false, archived_at: archived ? "2026-01-01" : null });
  const cats = [cat("pets", "Pets"), cat("home", "Home"), cat("rent", "Rent", "home"), cat("old", "Old", "home", true)];
  it("EC-K3 an archived category is not offered as a top tile, and the next one fills the slot", () => {
    const out = suggestCategories({ history: [], categories: cats, now: new Date("2026-10-18"), today: "2026-10-18", payeeCategoryId: "old" });
    expect(out.map((s) => s.categoryId)).not.toContain("old");
    expect(out.length).toBeGreaterThan(0);
  });
  it("EC-K5 a parent with no sub-categories is a tile captioned General", () => {
    const out = suggestCategories({ history: [], categories: cats, now: new Date("2026-10-18"), today: "2026-10-18", payeeCategoryId: "pets" });
    expect(out.find((s) => s.categoryId === "pets")?.parentLabel).toBe("General");
    expect(out.find((s) => s.categoryId === "rent")?.parentLabel).toBe("Home");
  });
});

describe("insights", () => {
  const base: FactsInput = {
    today: "2026-10-18", scope: "adhoc", period: { from: "2026-10-01", to: "2026-10-18", label: "October so far", compare_label: "earlier months" },
    pace: { month_start: "2026-10-01", day_of_month: 18, days_in_month: 31, spend_pence: 323685, prev_spend_pence: 360410, prev_label_day: 18, prev_total_pence: 531620 },
    projected: 506200, monthAvg: 534926, history: [], trends: {}, newPayees: [], big: [], weekdayAvg: [], series: [], feedback: [],
  };
  const facts = assembleFacts(base);
  const bad: CardWriter = { model: "fake", write: async () => ({ cards: [{ key: "x", type: "pace", severity: "info", title: "You spent £1,234.56", body: "That is 99% more", viz: "none", rank: 1 }], inputTokens: 1, outputTokens: 1 }) };
  it("EC-N7 a card with an ungrounded figure is dropped, the writer gets one retry, then the template takes over", async () => {
    let calls = 0;
    const n = await narrate(facts, { ...bad, write: async (f, r) => { calls++; return bad.write(f, r); } });
    expect(calls).toBe(2);
    expect(n.usedFallback).toBe(true);
    expect(validateCards(n.cards, facts).dropped).toEqual([]);
    expect(n.cards.every((c) => c.title !== "You spent £1,234.56")).toBe(true);
  });
  it("EC-N6 with no model (token cap reached, or the API down) the template cards stand in", async () => {
    const down: CardWriter = { model: "fake", write: async () => { throw new Error("503"); } };
    const n = await narrate(facts, down);
    expect(n.usedFallback).toBe(true);
    expect(n.cards.length).toBeGreaterThanOrEqual(1);
    expect(validateCards(n.cards, facts).dropped).toEqual([]);
  });
});

describe("more register rows", () => {
  it("EC-C5 a session that expired while offline is not a failed entry: it is kept and retried under the same client_id", () => {
    expect(isRetryableDbError({ code: "28000" })).toBe(true);
    expect(isRetryableDbError({ code: "PGRST301" })).toBe(true);
    expect(isRetryableDbError({ code: "23514" })).toBe(false);                   // a real refusal is shown to the owner instead
  });
  it("EC-K6 spend assigned to a parent directly reads Other ‹parent› in sub-category views", () => {
    expect(leafLabel({ name: "Eating out", is_parent_direct: true })).toBe("Other eating out");
    expect(leafLabel({ name: "Restaurants", is_parent_direct: false })).toBe("Restaurants");
  });
  it("EC-N5 a net-negative category is drawn at zero with a net refund label", () => {
    const row = { category_id: "c", name: "Shopping", icon: "shopping-bag", color: "stone" as const, parent_id: null, total_pence: -2500, txn_count: 2, norm_pence: null, parent_name: null, is_fixed: false, is_parent_direct: false, visits: 2 };
    const html = renderToStaticMarkup(CategoryBars({ rows: [row], fixedIds: new Set(), showUsual: false, href: () => "/x", total: 10000 }));
    expect(html).toContain("net refund £25.00");
    expect(html).toContain("width:0%");
  });
});
