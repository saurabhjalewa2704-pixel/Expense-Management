import { describe, expect, it } from "vitest";
import { dailyChartMode, homeTripKind, tripClock, tripFigures, tripLength } from "@/lib/tripMath";

const USA = { start_on: "2027-03-06", end_on: "2027-03-20" };

describe("trip numbers (TRIP-07, Appendix A.2)", () => {
  it("the USA trip is 15 days and on 12 March it is day 7", () => {
    expect(tripLength(USA)).toBe(15);
    expect(tripClock(USA, "2027-03-12")).toMatchObject({ phase: "during", day: 7, daysLeftInclToday: 9 });
  });
  it("matches the mock-up: spent £3,561.51, £1,438.49 left, £169.32 plan, £157.33 actual, £159.83 allowance, £4,820.15 projected", () => {
    const f = tripFigures(USA, 500000, 246020, 110131, "2027-03-12");
    expect(f).toMatchObject({ spent: 356151, left: 143849, planPerDay: 16932, actualPerDay: 15733, allowance: 15983, projected: 482015, over: false });
  });
  it("EC-T14 no budget: no allowance, no plan, no left", () => {
    expect(tripFigures(USA, null, 246020, 110131, "2027-03-12")).toMatchObject({ budget: null, left: null, planPerDay: null, allowance: null, over: false });
  });
  it("EC-T13 over budget", () => {
    const f = tripFigures(USA, 300000, 246020, 110131, "2027-03-12");
    expect(f.over).toBe(true); expect(f.left).toBe(-56151);
  });
  it("before the trip nothing is spent per day; after it the projection is what was spent", () => {
    expect(tripFigures(USA, 500000, 246020, 0, "2027-03-01")).toMatchObject({ actualPerDay: 0, allowance: null, projected: 246020 + 0 });
    expect(tripFigures(USA, 500000, 246020, 400000, "2027-03-25")).toMatchObject({ projected: 646020, allowance: null });
  });
  it("TRIP-01 the Home card shows during, 14 days before and 7 days after", () => {
    expect(homeTripKind(USA, "2027-03-12")).toBe("now");
    expect(homeTripKind(USA, "2027-02-20")).toBe("upcoming");        // 14 days before 6 March
    expect(homeTripKind(USA, "2027-02-19")).toBeNull();
    expect(homeTripKind(USA, "2027-03-27")).toBe("wrapup");          // 7 days after 20 March
    expect(homeTripKind(USA, "2027-03-28")).toBeNull();
    expect(tripClock(USA, "2027-02-25").daysToStart).toBe(9);        // "USA in 9 days"
  });
  it("EC-T16 one-day trips hide the daily chart; trips over 60 days chart by week", () => {
    expect(dailyChartMode({ start_on: "2027-03-06", end_on: "2027-03-06" })).toBe("hidden");
    expect(dailyChartMode(USA)).toBe("daily");
    expect(dailyChartMode({ start_on: "2027-01-01", end_on: "2027-03-31" })).toBe("weekly");
  });
});
