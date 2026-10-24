import { describe, expect, it } from "vitest";
import { buildWaterfall, categoryFinding, subcategoryFinding, leafLabel, averageTicket, deltaFlag, heatLevels, paceFinding, projectMonth, rhythmFinding, trendFinding, weekdayAverages } from "@/lib/analytics";
import { canStepForward, resolvePeriod, stepPeriod } from "@/lib/periods";
import type { CashFlow, CategorySpend, DailySpend } from "@/lib/types";

describe("periods", () => {
  const today = "2026-10-18";
  it("this month so far is compared with last month to the same day", () => {
    const p = resolvePeriod({ kind: "month", anchor: today }, today);
    expect(p).toMatchObject({ from: "2026-10-01", end: "2026-10-31", to: "2026-10-18", prevFrom: "2026-09-01", prevTo: "2026-09-18", prevEnd: "2026-09-30", label: "October 2026", prevLabel: "September", elapsed: 18, days: 31, isCurrent: true });
  });
  it("a finished month compares in full", () => {
    const p = resolvePeriod({ kind: "month", anchor: "2026-09-10" }, today);
    expect(p).toMatchObject({ to: "2026-09-30", prevTo: "2026-08-31", isCurrent: false });
  });
  it("a short previous month clamps (31 Mar vs February)", () => {
    expect(resolvePeriod({ kind: "month", anchor: "2026-03-31" }, "2026-03-31").prevTo).toBe("2026-02-28");
  });
  it("quarters, years and custom ranges", () => {
    expect(resolvePeriod({ kind: "quarter", anchor: today }, today)).toMatchObject({ from: "2026-10-01", end: "2026-12-31", prevFrom: "2026-07-01", prevTo: "2026-07-18", label: "Q4 2026" });
    expect(resolvePeriod({ kind: "year", anchor: today }, today)).toMatchObject({ from: "2026-01-01", to: "2026-10-18", prevFrom: "2025-01-01", prevTo: "2025-10-18", label: "2026" });
    const c = resolvePeriod({ kind: "custom", anchor: today, custom: { from: "2026-10-01", to: "2026-10-10" } }, today);
    expect(c).toMatchObject({ prevFrom: "2026-09-21", prevEnd: "2026-09-30", days: 10 });
  });
  it("steps with the arrows and stops at the present", () => {
    const m = stepPeriod({ kind: "month", anchor: "2026-10-18" }, -1);
    expect(m.anchor).toBe("2026-09-18");
    expect(canStepForward({ kind: "month", anchor: "2026-10-18" }, today)).toBe(false);
    expect(canStepForward(m, today)).toBe(true);
    expect(stepPeriod({ kind: "year", anchor: today }, -1).anchor).toBe("2025-10-18");
  });
});

describe("findings", () => {
  it("pace", () => {
    expect(paceFinding(323685, 360410, "September", true)).toBe("You're £367 under September's pace");
    expect(paceFinding(400000, 360410, "September", true)).toBe("You're £396 over September's pace");
    expect(paceFinding(0, 0, "September", false)).toBe("Your spending so far");
  });
  it("flags only more than +20% and more than £30", () => {
    expect(deltaFlag(31260, 22610)).toEqual({ pct: 38 });
    expect(deltaFlag(1500, 1000)).toBeNull();      // +50% but only £5
    expect(deltaFlag(11000, 10000)).toBeNull();    // +£10
    expect(deltaFlag(5000, null)).toBeNull();
  });
  it("names the biggest overshoot, else the top category", () => {
    const row = (name: string, t: number, n: number | null): CategorySpend => ({ category_id: name, name, icon: "x", color: "stone", parent_id: null, total_pence: t, txn_count: 1, norm_pence: n, parent_name: null, is_fixed: false, is_parent_direct: false, visits: 1 });
    expect(categoryFinding([row("Home", 181240, 180660), row("Eating out", 31260, 22610)], 212500)).toBe("Eating out is up 38% on your usual");
    expect(categoryFinding([row("Home", 181240, 180660)], 181240)).toBe("Home is where most of the money went");
  });
  it("names the sub-category with the biggest overshoot, else the top one's share of flexible spend", () => {
    const sub = (name: string, t: number, n: number | null, direct = false): CategorySpend => ({ category_id: name, name, icon: "x", color: "stone", parent_id: "p", total_pence: t, txn_count: 2, norm_pence: n, parent_name: "Eating out", is_fixed: false, is_parent_direct: direct, visits: 2 });
    expect(subcategoryFinding([sub("Supermarket", 31470, 29800), sub("Restaurants", 14250, 10500)])).toBe("Restaurants are up 36% on your usual");
    expect(subcategoryFinding([sub("Supermarket", 30000, 29800), sub("Restaurants", 10000, 10500)])).toBe("Supermarket is 75% of flexible spend");
    expect(leafLabel(sub("Eating out", 100, null, true))).toBe("Other eating out");
  });
  it("averages per transaction truncated to the penny (£312.60 over 21 is £14.88)", () => {
    expect(averageTicket(31260, 21)).toBe(1488);
    expect(averageTicket(0, 0)).toBe(0);
  });
  it("trend", () => {
    expect(trendFinding("October", 506200, 523500)).toBe("October is heading for £5,062, near your average");
    expect(trendFinding("October", 700000, 500000)).toBe("October is heading for £7,000, above your average");
  });
});

describe("waterfall (AN-03 is the CASH-01 equation)", () => {
  const flow: CashFlow = { opening_pence: 786240, income_pence: 14000, spend_pence: 323685, pot_pence: 0, set_aside_pence: 0, adjust_pence: 0, closing_pence: 476555 };
  const cats = [["Home", 181240], ["Groceries", 38625], ["Eating out", 31260], ["Transport", 21480], ["Shopping", 17890], ["Bills", 11843]].map(([name, total_pence]) => ({ name: name as string, total_pence: total_pence as number }));
  it("ends on the available cash with the right steps", () => {
    const { steps, base } = buildWaterfall(flow, cats);
    expect(steps.map((s) => s.label)).toEqual(["Opening", "Income", "Home", "Groceries", "Eating out", "Transport", "Other", "Available"]);
    expect(steps.find((s) => s.key === "other")!.value).toBe(-(323685 - 181240 - 38625 - 31260 - 21480));   // £510.80
    expect(steps[steps.length - 1]!.value).toBe(476555);
    expect(steps[steps.length - 1]!.to).toBe(flow.closing_pence);
    expect(base).toBe(400000);                       // "scale starts at £4,000"
  });
  it("copes with a brand-new owner: nothing yet is a valid, finite chart", () => {
    const empty: CashFlow = { opening_pence: 0, income_pence: 0, spend_pence: 0, pot_pence: 0, set_aside_pence: 0, adjust_pence: 0, closing_pence: 0 };
    const { steps, base } = buildWaterfall(empty, []);
    expect(base).toBe(0);
    expect(Number.isFinite(base)).toBe(true);
    expect(steps.map((s) => s.label)).toEqual(["Opening", "Available"]);
  });
  it("shows a one-off pot as its own step, so the chart still ends on available cash", () => {
    const withPot: CashFlow = { ...flow, pot_pence: -1050000, closing_pence: 476555 - 1050000 };
    const { steps } = buildWaterfall(withPot, cats);
    expect(steps.find((s) => s.key === "pot")).toMatchObject({ label: "One-off", kind: "down", value: -1050000 });
    expect(steps[steps.length - 1]!.value).toBe(withPot.closing_pence);
    expect(buildWaterfall(flow, cats).steps.map((s) => s.label)).not.toContain("One-off");
  });
  it("shows set aside and adjustments only when they exist", () => {
    const { steps } = buildWaterfall({ ...flow, set_aside_pence: -50000, adjust_pence: -1408, closing_pence: 476555 - 51408 }, cats);
    expect(steps.map((s) => s.label)).toContain("Set aside");
    expect(steps.map((s) => s.label)).toContain("Adjustments");
    expect(steps[steps.length - 1]!.value).toBe(476555 - 51408);
  });
});

describe("rhythm, heat, projection", () => {
  const day = (d: string, t: number): DailySpend => ({ day: d, total_pence: t, cumulative_pence: 0 });
  it("finds the biggest weekday", () => {
    const days = [day("2026-10-03", 20000), day("2026-10-10", 24000), day("2026-10-05", 1000), day("2026-10-06", 2000)];
    const a = weekdayAverages(days);
    expect(a[5]).toBe(22000);
    expect(rhythmFinding(a)).toEqual({ text: "Saturdays are your biggest day", weekday: 5 });
    expect(rhythmFinding([0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
  it("heat levels: zero is its own step, the rest are five steps", () => {
    const lv = heatLevels([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(lv[0]).toBe(0);
    expect(Math.min(...lv.slice(1))).toBe(1);
    expect(Math.max(...lv)).toBe(5);
    expect(heatLevels([0, 0])).toEqual([0, 0]);
  });
  it("projects the month: spend so far plus the median of what earlier months spent after this day", () => {
    const daily: DailySpend[] = [];
    for (const m of ["2026-09", "2026-08", "2026-07"]) {
      daily.push(day(`${m}-10`, 100000), day(`${m}-25`, m === "2026-09" ? 150000 : m === "2026-08" ? 200000 : 175000));
    }
    expect(projectMonth(daily, "2026-10-18", 323685)).toBe(323685 + 175000);
    expect(projectMonth([], "2026-10-18", 323685)).toBe(323685);
  });
});
