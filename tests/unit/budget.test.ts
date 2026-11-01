// PRD §6.13 against Appendix A.3: the Budget view built from the database's facts, to the penny. Also invariant 10 and the budget edge cases
// that are pure arithmetic (EC-G3, EC-G4, EC-G5, EC-G8 display, EC-G11).
import { describe, expect, it } from "vitest";
import { buildBudgetView, invariant10, poolFlowsToCome, type BudgetRow, type ScopeFacts } from "@/lib/budget";
import { projectedClose } from "@/lib/forecast";
import { dueAlerts } from "@/lib/budget-alerts";
import { budgetCards, budgetFacts } from "@/lib/ai/budget-facts";
import { validateCards } from "@/lib/ai/validator";
import type { Entity, Fact, Facts } from "@/lib/ai/types";
import type { Category, RecurringItem, RecurringOccurrence } from "@/lib/types";

const TODAY = "2026-10-18", MONTH = "2026-10-01";
const hist = (spec: [number, number][]) => spec.flatMap(([n, v]) => Array<number>(n).fill(v));
const OVERALL_HIST = hist([[12, 6000], [8, 7000], [2, 9200], [8, 10400], [2, 10500], [9, 14000]]);
// per-category late-month patterns (low days, median days, high days): medians 26 / 16 / 15 / 9 / 2.50
const catHist = (low: number, mid: number, high: number) => hist([[12, low], [10, mid], [19, high]]);

const facts = (o: Partial<ScopeFacts>): ScopeFacts => ({
  spent_pence: 0, recurring_logged_pence: 0, discretionary_pence: 0, discretionary_today_pence: 0, tracking_start: "2026-04-01", covers: "all",
  qualifying_months: ["2026-09-01", "2026-08-01", "2026-07-01"], history_daily: [], ...o,
});

const cats: Category[] = [
  ["g", "Groceries"], ["e", "Eating out"], ["t", "Transport"], ["s", "Shopping"], ["n", "Entertainment"], ["h", "Home"], ["b", "Bills"], ["f", "Health"],
].map(([id, name], i) => ({ id: id!, parent_id: null, kind: "expense", name: name!, icon: "x", color: "blue", sort_order: i, is_fixed: false, archived_at: null }) as unknown as Category);

const row = (id: string | null, amount: number, extra: Partial<BudgetRow> = {}): BudgetRow =>
  ({ category_id: id, base_pence: amount, override_pence: null, carried_pence: 0, amount_pence: amount, rollover: false, covers: "all", ...extra });
const ROWS = [row(null, 440000), row("g", 75000), row("e", 40000), row("t", 45000), row("s", 35000), row("n", 15000)];

const item = (id: string, cat: string, amt: number, dom: number, nextDue: string): RecurringItem => ({
  id, type: "expense", amount_pence: amt, amount_varies: false, account_id: "a", counter_account_id: null, category_id: cat, payee_id: null, note: null,
  frequency: "monthly", day_of_month: dom, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day", starts_on: "2026-04-01",
  ends_on: null, max_occurrences: null, auto_log: true, paused_at: null, ended_at: null, next_due_on: nextDue, created_at: "2026-04-01T00:00:00Z",
});
// A.3: eight logged bills (£1,988.82) and three to come (Spotify 22nd £12.99, Disney+ 24th £8.99, Netflix 27th £12.99)
const logged: [string, string, number, number][] = [
  ["rent", "h", 160000, 1], ["oct", "h", 4840, 3], ["three", "b", 3600, 4], ["hyper", "h", 2200, 5], ["gym", "f", 7500, 3], ["camden", "h", 14200, 7], ["admiral", "b", 6243, 8], ["icloud", "n", 299, 12],
];
const coming: [string, string, number, number][] = [["spotify", "n", 1299, 22], ["disney", "n", 899, 24], ["netflix", "n", 1299, 27]];
const ITEMS = [...logged.map(([id, c, a, d]) => item(id, c, a, d, "2026-11-" + String(d).padStart(2, "0"))), ...coming.map(([id, c, a, d]) => item(id, c, a, d, "2026-10-" + d))];
const OCCS: RecurringOccurrence[] = logged.map(([id, , a, d]) => ({
  id: "o-" + id, item_id: id, due_on: "2026-10-" + String(d).padStart(2, "0"), scheduled_on: "2026-10-" + String(d).padStart(2, "0"), status: "logged", transaction_id: "t-" + id, amount_pence: a,
}));

function a3() {
  return buildBudgetView({
    month: MONTH, today: TODAY, rows: ROWS, items: ITEMS, occurrences: OCCS, categories: cats,
    overall: facts({ spent_pence: 323685, recurring_logged_pence: 198882, discretionary_pence: 124803, discretionary_today_pence: 640, history_daily: OVERALL_HIST }),
    byCategory: {
      g: facts({ spent_pence: 38625, discretionary_pence: 38625, history_daily: catHist(2000, 2600, 3000) }),
      e: facts({ spent_pence: 31260, discretionary_pence: 31260, discretionary_today_pence: 640, history_daily: catHist(1000, 1600, 2000) }),
      t: facts({ spent_pence: 21480, discretionary_pence: 21480, history_daily: catHist(1000, 1500, 2000) }),
      s: facts({ spent_pence: 17890, discretionary_pence: 17890, history_daily: catHist(500, 900, 1200) }),
      n: facts({ spent_pence: 7497, recurring_logged_pence: 299, discretionary_pence: 7198, history_daily: catHist(0, 250, 400) }),
    },
  })!;
}

describe("Appendix A.3 on Sunday 18 October", () => {
  const v = a3();
  const by = (n: string) => v.limits.find((l) => l.name === n)!;

  it("BUD acceptance 1: the overall figures", () => {
    const o = v.overall;
    expect(o.amount).toBe(440000);
    expect(o.spent).toBe(323685);
    expect(o.left).toBe(116315);
    expect(o.pctSpent).toBe(74);
    expect(v.monthPct).toBe(58);
    expect(o.billsToCome).toBe(3497);
    expect(o.plan).toBe(336855);
    expect(o.againstPlan).toBe(13170);                        // £131.70 under plan
    expect(o.safePerDay).toBe(8058);
    expect(o.forecast.daysLeft).toBe(14);
    expect(o.forecast.expectedPerDay).toBe(7840);
    expect(o.forecast.forecast).toBe(436302);
    expect(o.forecast.low).toBe(410542);
    expect(o.forecast.high).toBe(473542);
    expect(o.headroom).toBe(3698);
    expect(o.status).toBe("tight");
    expect(o.forecast.degenerate).toBe(false);
  });

  it("BUD acceptance 2: the limits, riskiest first", () => {
    expect(v.limits.map((l) => l.name)).toEqual(["Eating out", "Entertainment", "Groceries", "Shopping", "Transport"]);
    expect(by("Eating out").variance).toBe(14168);
    expect(by("Entertainment").variance).toBe(754);
    expect(by("Groceries").variance).toBe(-3783);
  });

  it("A.3 limit table: expected per day, forecast, variance, status", () => {
    const rows: [string, number, number, number, string][] = [
      ["Groceries", 2328, 71217, -3783, "on_track"], ["Eating out", 1682, 54168, 14168, "over"], ["Transport", 1316, 39904, -5096, "on_track"],
      ["Shopping", 956, 31274, -3726, "on_track"], ["Entertainment", 340, 15754, 754, "over"],
    ];
    for (const [n, perDay, forecast, variance, status] of rows) {
      const l = by(n);
      expect([n, l.forecast.expectedPerDay, l.forecast.forecast, l.variance, l.status]).toEqual([n, perDay, forecast, variance, status]);
    }
  });

  it("A.3 Everything else", () => {
    const e = v.elsewhere;
    expect([e.amount, e.spent, e.forecast.forecast, e.variance, e.status]).toEqual([230000, 206933, 223985, -6015, "on_track"]);
  });

  it("invariant 10: the parts add up to the whole, to the penny", () => {
    expect(invariant10(v)).toEqual({ forecastsAddUp: true, variancesAddUp: true });
  });
});

describe("budget edge cases", () => {
  const base = { month: MONTH, today: TODAY, items: ITEMS, occurrences: OCCS, categories: cats };

  it("EC-G3: limits adding up to more than the budget leave Everything else at £0, and say by how much", () => {
    const rows = [row(null, 100000), row("g", 75000), row("e", 40000)];
    const v = buildBudgetView({ ...base, rows, overall: facts({ spent_pence: 50000, discretionary_pence: 40000, history_daily: OVERALL_HIST }),
      byCategory: { g: facts({ spent_pence: 30000, discretionary_pence: 30000, history_daily: catHist(1, 2, 3) }), e: facts({ spent_pence: 10000, discretionary_pence: 10000, history_daily: catHist(1, 2, 3) }) } })!;
    expect(v.elsewhere.amount).toBe(0);
    expect(v.limitsOverBy).toBe(15000);
    expect(invariant10(v)).toEqual({ forecastsAddUp: true, variancesAddUp: true });
  });

  it("EC-G11: already over the budget: negative left, safe to spend £0, status Over", () => {
    const v = buildBudgetView({ ...base, rows: [row(null, 300000)], overall: facts({ spent_pence: 323685, discretionary_pence: 124803, history_daily: OVERALL_HIST }), byCategory: {} })!;
    expect(v.overall.left).toBe(-23685);
    expect(v.overall.safePerDay).toBe(0);
    expect(v.overall.status).toBe("over");
  });

  it("EC-G8: a net refund shows £0 spent with a note", () => {
    const v = buildBudgetView({ ...base, rows: [row(null, 440000), row("e", 40000)], overall: facts({ spent_pence: 100000, discretionary_pence: 60000, history_daily: OVERALL_HIST }),
      byCategory: { e: facts({ spent_pence: -2000, discretionary_pence: -2000, history_daily: catHist(1, 2, 3) }) } })!;
    expect(v.limits[0]!.spentShown).toBe(0);
    expect(v.limits[0]!.netRefund).toBe(true);
  });

  it("EC-G6: fewer than two prior complete months: this month only, labelled Low confidence", () => {
    const v = buildBudgetView({ ...base, today: "2026-10-12", rows: [row(null, 440000)], overall: facts({ spent_pence: 200000, discretionary_pence: 36000, qualifying_months: ["2026-09-01"], history_daily: hist([[10, 5000]]) }), byCategory: {} })!;
    expect(v.overall.forecast.confidence).toBe("low");
    const none = buildBudgetView({ ...base, today: "2026-10-12", rows: [row(null, 440000)], overall: facts({ spent_pence: 200000, discretionary_pence: 36000, qualifying_months: [], history_daily: [] }), byCategory: {} })!;
    expect(none.overall.forecast.paceHist).toBeNull();
    expect(none.overall.forecast.wThis).toBe(10);
  });

  it("EC-G5: on day 4 the status is Early days unless spend is more than 10% over plan, and the forecast is low-confidence", () => {
    const early = buildBudgetView({ ...base, today: "2026-10-04", rows: [row(null, 440000)], overall: facts({ spent_pence: 170000, recurring_logged_pence: 170000, discretionary_pence: 4000, history_daily: OVERALL_HIST }), byCategory: {} })!;
    expect(early.overall.status).toBe("early");
    expect(early.overall.forecast.confidence).toBe("low");
    expect(early.overall.forecast.wThis).toBe(3);
  });

  it("EC-G4: a limit on Home sits on its bills' due days, so rent on the 1st does not flag it early", () => {
    const v = buildBudgetView({ ...base, rows: [row(null, 440000), row("h", 200000)], overall: facts({ spent_pence: 323685, discretionary_pence: 124803, history_daily: OVERALL_HIST }),
      byCategory: { h: facts({ spent_pence: 181240, recurring_logged_pence: 181240, discretionary_pence: 0, history_daily: catHist(0, 0, 0) }) } })!;
    const home = v.limits[0]!;
    expect(home.plan).toBeGreaterThanOrEqual(181240);                  // all of Home's bills are scheduled by the 18th
    expect(home.againstPlan).toBeGreaterThanOrEqual(0);
  });

  it("Exclude bills: the plan is a straight line and nothing is added for bills to come", () => {
    const v = buildBudgetView({ ...base, rows: [row(null, 440000, { covers: "exclude_bills" })], overall: facts({ covers: "exclude_bills", spent_pence: 124803, discretionary_pence: 124803, history_daily: OVERALL_HIST }), byCategory: {} })!;
    expect(v.overall.billsToCome).toBe(0);
    expect(v.overall.plan).toBe(Math.round((440000 * 18) / 31));
  });

  it("no budget, no view", () => {
    expect(buildBudgetView({ ...base, rows: [], overall: facts({}), byCategory: {} })).toBeNull();
  });
});

describe("CASH-06 projected close (Appendix A.3)", () => {
  it("available now − bills to come − the rest of the month − the £500 transfer to savings = £3,139.38", () => {
    const transfer: RecurringItem = { ...item("save", "n", 50000, 26, "2026-10-26"), type: "transfer", category_id: null, account_id: "pool", counter_account_id: "savings" };
    const flows = poolFlowsToCome([...ITEMS, transfer], OCCS, new Set(["pool"]), MONTH);
    expect(flows).toEqual({ transfersOut: 50000, incomeIn: 0 });
    const v = a3();
    expect(projectedClose(476555, v.overall.forecast, flows.transfersOut, flows.incomeIn)).toBe(313938);
  });
  it("no number when there is no forecast", () => {
    expect(projectedClose(100000, { available: false, closed: false, billsToCome: 0, remaining: 0 }, 0, 0)).toBeNull();
  });
});

describe("alerts (BUD-10)", () => {
  const prefs = { forecast: true, pct80: true, reached: true };
  it("A.3 on day 18: Eating out and Entertainment are heading over (Entertainment's £7.54 is under the £10 floor, so only Eating out), Groceries is under", () => {
    const due = dueAlerts(a3(), [], prefs, TODAY);
    const names = due.filter((d) => d.kind === "forecast_over").map((d) => d.name);
    expect(names).toEqual(["Eating out"]);
    expect(due.filter((d) => d.kind !== "forecast_over")).toEqual([]);                        // £312.60 of £400 is 78%: not yet 80%
  });
  it("EC-G14 flapping: one forecast alert per limit per month; it comes again only if the overspend grows by 50%", () => {
    const v = a3();
    const eat = v.limits.find((l) => l.name === "Eating out")!;
    const sent = [{ category_id: "e", kind: "forecast_over" as const, last_value_pence: eat.variance }];
    expect(dueAlerts(v, sent, prefs, TODAY).filter((d) => d.kind === "forecast_over")).toEqual([]);
    const grown = [{ category_id: "e", kind: "forecast_over" as const, last_value_pence: Math.floor(eat.variance / 1.6) }];
    expect(dueAlerts(v, grown, prefs, TODAY).filter((d) => d.kind === "forecast_over").map((d) => d.name)).toEqual(["Eating out"]);
  });
  it("no forecast alert before day 7", () => {
    const early = dueAlerts(a3(), [], prefs, "2026-10-05");
    expect(early.filter((d) => d.kind === "forecast_over")).toEqual([]);
  });
  it("switching a kind off silences it", () => {
    expect(dueAlerts(a3(), [], { forecast: false, pct80: false, reached: false }, TODAY)).toEqual([]);
  });
});

describe("budget insight cards (BUD-12)", () => {
  const facts: Fact[] = [], entities: Entity[] = [];
  budgetFacts(a3(), [{ categoryId: "n", name: "Entertainment", current: 15000, proposed: 17000, kind: "missed" }], (f) => facts.push(f), entities);
  const F: Facts = { generated_on: TODAY, scope: "adhoc", period: { from: MONTH, to: TODAY, label: "October so far", compare_label: "" }, facts, entities, preferences: [] };
  const cards = budgetCards(facts, entities, "2026-10");

  it("the riskiest limit, the overall pace and a suggestion, each from facts only", () => {
    expect(cards.map((c) => c.type)).toEqual(["budget_risk", "budget_pace", "budget_suggest"]);
    expect(cards[0]!.title).toBe("Eating out has £87.40 left for 14 days");
    expect(cards[0]!.body).toContain("£6.24 a day");
    expect(cards[0]!.body).toContain("£16.82 a day");
    expect(cards[0]!.body).toContain("£142 over the £400");
    expect(cards[1]!.title).toBe("The month is heading £37 under budget");
  });
  it("passes the grounding validator: no figure the facts do not hold", () => {
    const v = validateCards(cards, F);
    expect(v.dropped).toEqual([]);
    expect(v.valid).toHaveLength(3);
  });
  it("the suggestion changes nothing by itself: it only links to the limit with the amount filled in", () => {
    expect(cards[2]!.link).toEqual({ kind: "screen", id: "/budget/setup?limit=n&amount=17000" });
  });
});

describe("invariant 10 on random months (BUD acceptance 11)", () => {
  // a small deterministic generator, so a failure can be reproduced
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  it("Σ category forecasts + Everything else = the overall forecast, and Σ variances = forecast − budget, for 300 random months", () => {
    for (let k = 0; k < 300; k++) {
      const dom = 4 + rnd(26), today = `2026-10-${String(dom).padStart(2, "0")}`;
      const ids = ["g", "e", "t", "s", "n"].filter(() => rnd(3) > 0);
      const budget = 200000 + rnd(400000);
      const disc = (n: number) => rnd(n);
      const hist = (n: number) => Array.from({ length: 20 + rnd(25) }, () => rnd(n));
      const byCategory: Record<string, ScopeFacts> = {};
      for (const id of ids) { const d = disc(60000); byCategory[id] = facts({ spent_pence: d + rnd(3000), discretionary_pence: d, discretionary_today_pence: rnd(900), history_daily: hist(4000), qualifying_months: rnd(4) === 0 ? [] : ["2026-09-01", "2026-08-01", "2026-07-01"].slice(0, 1 + rnd(3)) }); }
      const spent = 100000 + rnd(300000);
      const v = buildBudgetView({
        month: MONTH, today, rows: [row(null, budget), ...ids.map((id) => row(id, 10000 + rnd(80000)))], items: ITEMS, occurrences: OCCS, categories: cats,
        overall: facts({ spent_pence: spent, discretionary_pence: spent - 20000, discretionary_today_pence: rnd(900), history_daily: hist(20000) }), byCategory,
      })!;
      expect(invariant10(v)).toEqual({ forecastsAddUp: true, variancesAddUp: true });
    }
  });
});
