// MC-50.3 / EC-MC25: the review's AI summary is generated from the computed facts only, through the existing grounding validator; with AI off, no key or text that
// fails validation, there is no summary at all (the card is omitted) and nothing is ever shown unvalidated.
import { describe, expect, it } from "vitest";
import { monthSummaryFacts, writeMonthSummary } from "@/lib/ai/month-summary";
import type { CardWriter } from "@/lib/ai/writer";
import type { CloseSummary } from "@/lib/close/types";

const s: CloseSummary = {
  month: "2026-11-01", partial: false, days: 30, spent: 417812, income: 541240, kept: 123428, budget: 440000, covers: "all", budget_spent: 417812, budget_status: "within",
  everyday: 187025, bills_regular: 230787, usual_estimate: 183420, by_l1: { home: 222435, groc: 51240 }, limits: [{ category_id: "eat", limit: 40000, actual: 49875 }],
  forecasts: [], income_sources: ["Salary"], recurring_l1: {},
};
const facts = monthSummaryFacts(s, { home: "Home", groc: "Groceries", eat: "Eating out" }, "2026-12-01");
const card = (body: string) => ({ key: "k1", type: "win", severity: "positive", title: "November in brief", body, viz: "none", rank: 1 });
const writerOf = (cards: unknown[]): CardWriter => ({ model: "test", write: async () => ({ cards, inputTokens: 1, outputTokens: 1 }) });

describe("the month summary", () => {
  it("quotes only figures that are in the facts", () => {
    const shown = new Set(facts.facts.map((f) => f.display));
    expect(shown.has("£4,178.12")).toBe(true);
    expect(shown.has("£4,400.00")).toBe(true);
    expect(shown.has("£221.88")).toBe(true);                                           // under budget by
    expect(shown.has("£498.75") || shown.has("£98.75")).toBe(true);                    // the category that went over its limit
  });
  it("EC-MC25 AI off or no key: no summary", async () => {
    expect(await writeMonthSummary(null, facts)).toBeNull();
  });
  it("EC-MC25 text with a figure that is not in the facts fails validation: no summary", async () => {
    expect(await writeMonthSummary(writerOf([card("November came in £999.99 under budget.")]), facts)).toBeNull();
  });
  it("EC-MC25 a writer that throws, or returns nothing usable: no summary", async () => {
    expect(await writeMonthSummary({ model: "t", write: async () => { throw new Error("overloaded"); } }, facts)).toBeNull();
    expect(await writeMonthSummary(writerOf([{ nonsense: true }]), facts)).toBeNull();
  });
  it("grounded text passes and is shown", async () => {
    const ok = await writeMonthSummary(writerOf([card("November came in £221.88 under budget, with £4,178.12 spent and £1,870.25 of it everyday spending.")]), facts);
    expect(ok).toBe("November came in £221.88 under budget, with £4,178.12 spent and £1,870.25 of it everyday spending.");
  });
});
