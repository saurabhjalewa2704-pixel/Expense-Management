// PRD §6.13 on top of the forecasting engine (FORECASTING-ENGINE-PRD §6.14): the Budget view built from fixture G6, invariant 10, the budget edge
// cases that are arithmetic, CASH-06, alerts and the insight cards. Every forecast figure here comes from forecast(); nothing is projected in the test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { budgetCards, budgetFacts } from "@/lib/ai/budget-facts";
import type { Entity, Fact, Facts } from "@/lib/ai/types";
import { validateCards } from "@/lib/ai/validator";
import { dueAlerts } from "@/lib/budget-alerts";
import { buildBudgetView, invariant10, poolFlowsToCome, type BudgetRow } from "@/lib/budget";
import { forecast } from "@/lib/forecast/index";
import { projectedClose } from "@/lib/forecast/measures";
import { fcView } from "@/lib/forecast/view";
import type { ForecastInput } from "@/lib/forecast/types";
import type { Category, RecurringItem, RecurringOccurrence } from "@/lib/types";

const G6 = JSON.parse(readFileSync("forecast/fixtures/G6-rich-mid-month.input.json", "utf8")) as ForecastInput;
const TODAY = G6.today, MONTH = "2026-11-01";
const NAMES = ["Groceries", "Eating out", "Transport", "Entertainment", "Home", "Bills"];
const cats: Category[] = NAMES.map((n, i) => ({ id: n, parent_id: null, kind: "expense", name: n, icon: "x", color: "sage", sort_order: i, is_fixed: false, archived_at: null }) as unknown as Category);
const row = (id: string | null, amount: number, extra: Partial<BudgetRow> = {}): BudgetRow => ({ category_id: id, base_pence: amount, override_pence: null, carried_pence: 0, amount_pence: amount, rollover: false, covers: "all", ...extra });
const ROWS = [row(null, 500000), row("Groceries", 80000), row("Eating out", 70000), row("Transport", 30000), row("Entertainment", 5000)];

const item = (id: string, cat: string, amt: number, dom: number): RecurringItem => ({
  id, type: "expense", amount_pence: amt, amount_varies: false, account_id: "a", counter_account_id: null, category_id: cat, payee_id: null, note: null, frequency: "monthly", day_of_month: dom,
  last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day", starts_on: "2026-06-01", ends_on: null, max_occurrences: null, auto_log: true, paused_at: null,
  ended_at: null, next_due_on: `2026-11-${String(dom).padStart(2, "0")}`, created_at: "2026-06-01T00:00:00Z",
});
const ITEMS = [item("rent", "Home", 150000, 1), item("spotify", "Entertainment", 1299, 22), item("disney", "Entertainment", 899, 24), item("netflix", "Entertainment", 1299, 27)];
const OCCS: RecurringOccurrence[] = [{ id: "o1", item_id: "rent", due_on: "2026-11-01", scheduled_on: "2026-11-01", status: "logged", transaction_id: "t1", amount_pence: 150000 }];

const view = (input: ForecastInput = G6, rows = ROWS, today = TODAY) =>
  buildBudgetView({ month: MONTH, today, rows, forecast: forecast(input), items: ITEMS, occurrences: OCCS, categories: cats })!;

describe("the Budget view on the engine's answer (fixture G6, 12 Nov)", () => {
  const v = view();
  it("overall figures come straight from the forecast", () => {
    expect(v.overall.forecast.forecast).toBe(490189);
    expect(v.overall.spent).toBe(345419);
    expect(v.overall.left).toBe(500000 - 345419);
    expect(v.overall.forecast.low).toBe(461574);
    expect(v.overall.forecast.high).toBe(518804);
    expect(v.overall.headroom).toBe(500000 - 490189);
    expect(v.overall.status).toBe("tight");              // 98% of the budget
  });
  it("limits carry the engine's category forecasts, most at risk first", () => {
    const f = forecast(G6);
    for (const l of v.limits) expect(l.forecast.forecast).toBe(f.categories![l.name]!.point);
    const ratios = v.limits.map((l) => l.forecast.forecast / l.amount);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
  });
  it("Everything else is the overall less the limits (BUD-01)", () => {
    expect(v.elsewhere.forecast.forecast).toBe(forecast(G6).everythingElse);
    expect(v.elsewhere.amount).toBe(500000 - (80000 + 70000 + 30000 + 5000));
  });
  it("invariant 10: the parts add up to the whole, to the penny", () => {
    expect(invariant10(v)).toEqual({ forecastsAddUp: true, variancesAddUp: true });
  });
  it("what-ifs end where the forecast does at the usual pace", () => {
    expect(v.whatIfs.find((w) => w.key === "usual")!.monthEnd).toBe(490189);
    expect(v.whatIfs).toHaveLength(4);
  });
});

describe("budget edge cases that are arithmetic", () => {
  it("EC-G3: limits adding up to more than the budget leave Everything else at £0, and say by how much", () => {
    const v = view(G6, [row(null, 100000), row("Groceries", 75000), row("Eating out", 40000)]);
    expect(v.elsewhere.amount).toBe(0);
    expect(v.limitsOverBy).toBe(15000);
    expect(invariant10(v)).toEqual({ forecastsAddUp: true, variancesAddUp: true });
  });
  it("EC-G11: already over the budget: negative left, safe to spend £0, status Over", () => {
    const v = view(G6, [row(null, 300000)]);
    expect(v.overall.left).toBe(300000 - 345419);
    expect(v.overall.safePerDay).toBe(0);
    expect(v.overall.status).toBe("over");
  });
  it("EC-G8: a net refund shows £0 spent with a note", () => {
    const input = { ...G6, spent_by_cat: { ...G6.spent_by_cat, Transport: -2000 } };
    const l = view(input).limits.find((x) => x.name === "Transport")!;
    expect(l.spentShown).toBe(0);
    expect(l.netRefund).toBe(true);
  });
  it("EC-G5: in the first week the status is Early days unless spend is more than 10% over plan", () => {
    const early = { ...G6, today: "2026-11-04", days: G6.days.filter((d) => d.d <= "2026-11-04"), spent_month_to_date: 160000 + 5000 };
    const v = view(early, [row(null, 500000)], "2026-11-04");
    expect(v.overall.status).toBe("early");
  });
  it("no budget, no view", () => {
    expect(buildBudgetView({ month: MONTH, today: TODAY, rows: [], forecast: forecast(G6), items: ITEMS, occurrences: OCCS, categories: cats })).toBeNull();
  });
  it("Exclude bills: the plan is a straight line", () => {
    const v = view({ ...G6, scope: "exclude_bills" }, [row(null, 500000, { covers: "exclude_bills" })]);
    expect(v.overall.plan).toBe(Math.round((500000 * 12) / 30));
  });
});

describe("CASH-06 projected close", () => {
  it("available now − everything still to be spent − the transfer to savings", () => {
    const transfer: RecurringItem = { ...item("save", "Home", 50000, 26), type: "transfer", category_id: null, account_id: "pool", counter_account_id: "savings" };
    const flows = poolFlowsToCome([...ITEMS, transfer], OCCS, new Set(["pool"]), MONTH);
    expect(flows).toEqual({ transfersOut: 50000, incomeIn: 0 });
    const f = fcView(forecast(G6), TODAY);
    expect(projectedClose(400000, f, flows.transfersOut, flows.incomeIn)).toBe(400000 - (490189 - 345419) - 50000);
  });
  it("no number when there is no forecast", () => {
    const f = fcView(forecast({ ...G6, days: [], tracking_started_on: TODAY, spent_month_to_date: 5000 }), TODAY);
    expect(f.available).toBe(false);
    expect(projectedClose(100000, f, 0, 0)).toBeNull();
  });
});

describe("alerts (BUD-10)", () => {
  const prefs = { forecast: true, pct80: true, reached: true };
  const hot = () => view({ ...G6, spent_by_cat: { ...G6.spent_by_cat, "Eating out": 66000 }, spent_month_to_date: G6.spent_month_to_date + 36000 });
  it("a limit forecast well over fires once, from day 7", () => {
    const v = hot();
    const due = dueAlerts(v, [], prefs, TODAY).filter((d) => d.kind === "forecast_over");
    expect(due.map((d) => d.name)).toContain("Eating out");
    expect(dueAlerts(v, [], prefs, "2026-11-05").filter((d) => d.kind === "forecast_over")).toEqual([]);
  });
  it("EC-G14 flapping: one forecast alert per limit per month; it returns only if the overspend grows by 50%", () => {
    const v = hot();
    const l = v.limits.find((x) => x.name === "Eating out")!;
    const sent = [{ category_id: "Eating out", kind: "forecast_over" as const, last_value_pence: l.variance }];
    expect(dueAlerts(v, sent, prefs, TODAY).filter((d) => d.kind === "forecast_over" && d.name === "Eating out")).toEqual([]);
    const grown = [{ category_id: "Eating out", kind: "forecast_over" as const, last_value_pence: Math.floor(l.variance / 1.6) }];
    expect(dueAlerts(v, grown, prefs, TODAY).some((d) => d.kind === "forecast_over" && d.name === "Eating out")).toBe(true);
  });
  it("switching a kind off silences it", () => {
    expect(dueAlerts(hot(), [], { forecast: false, pct80: false, reached: false }, TODAY)).toEqual([]);
  });
});

describe("budget insight cards (BUD-12)", () => {
  const facts: Fact[] = [], entities: Entity[] = [];
  const v = view({ ...G6, spent_by_cat: { ...G6.spent_by_cat, "Eating out": 66000 }, spent_month_to_date: G6.spent_month_to_date + 36000 });
  budgetFacts(v, [{ categoryId: "Entertainment", name: "Entertainment", current: 5000, proposed: 7000, kind: "missed" }], (f) => facts.push(f), entities);
  const F: Facts = { generated_on: TODAY, scope: "adhoc", period: { from: MONTH, to: TODAY, label: "November so far", compare_label: "" }, facts, entities, preferences: [] };
  const cards = budgetCards(facts, entities, "2026-11");
  it("only grounded cards, from facts: the riskiest limit, the overall pace and a suggestion", () => {
    expect(cards.map((c) => c.type)).toContain("budget_risk");
    expect(cards.map((c) => c.type)).toContain("budget_pace");
    expect(cards.map((c) => c.type)).toContain("budget_suggest");
    const r = validateCards(cards, F);
    expect(r.dropped).toEqual([]);
  });
  it("the suggestion changes nothing by itself", () => {
    expect(cards.find((c) => c.type === "budget_suggest")!.link).toEqual({ kind: "screen", id: "/budget/setup?limit=Entertainment&amount=7000" });
  });
});

describe("invariant 10 on random months (BUD acceptance 11)", () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  it("Σ category forecasts + Everything else = the overall forecast, and Σ variances = forecast − budget, for 300 random months", () => {
    for (let k = 0; k < 300; k++) {
      const day = 2 + rnd(27);
      const today = `2026-11-${String(day).padStart(2, "0")}`;
      const input: ForecastInput = { ...G6, today, days: G6.days.filter((d) => d.d <= today), spent_month_to_date: G6.spent_month_to_date + rnd(50000) };
      const rows = [row(null, 200000 + rnd(400000)), ...["Groceries", "Eating out", "Transport", "Entertainment"].filter(() => rnd(3) > 0).map((c) => row(c, 5000 + rnd(80000)))];
      expect(invariant10(view(input, rows, today))).toEqual({ forecastsAddUp: true, variancesAddUp: true });
    }
  }, 120_000);
});
