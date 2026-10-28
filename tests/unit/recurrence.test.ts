import { describe, expect, it } from "vitest";
import { describeRule, firstOccurrence, isWorkingDay, nextOccurrences, nextWorkingDay, ordinal, type RecurrenceRule } from "@/lib/recurrence";

const rule = (o: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly", day_of_month: 27, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day",
  starts_on: "2026-10-27", ends_on: null, max_occurrences: null, ...o,
});
const due = (r: RecurrenceRule, from: string, to: string, h?: string[]) => nextOccurrences(r, from, to, h).map((o) => o.due_on);
const BANK_HOLIDAYS = ["2026-12-25", "2026-12-28", "2027-01-01", "2027-03-26", "2027-03-29"];

describe("monthly", () => {
  it("falls on the chosen day of every month, from the first payment", () => {
    expect(due(rule(), "2026-01-01", "2027-01-31")).toEqual(["2026-10-27", "2026-11-27", "2026-12-27", "2027-01-27"]);
  });
  it("nothing before the first payment even if earlier days match", () => {
    expect(due(rule({ starts_on: "2026-10-28" }), "2026-10-01", "2026-10-31")).toEqual([]);
  });
  it("EC-D3 the 31st moves to the last day of shorter months (30 Nov, 31 Dec, 28 Feb 2027)", () => {
    expect(due(rule({ day_of_month: 31, starts_on: "2026-10-31" }), "2026-10-01", "2027-03-31"))
      .toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("leap years: the 29th lands on 29 Feb 2028 and 28 Feb 2027", () => {
    const r = rule({ day_of_month: 29, starts_on: "2027-01-29" });
    expect(due(r, "2027-02-01", "2027-02-28")).toEqual(["2027-02-28"]);
    expect(due(rule({ day_of_month: 29, starts_on: "2028-01-29" }), "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });
  it("'Last day' is always the month's final day", () => {
    const r = rule({ day_of_month: null, last_day: true, starts_on: "2028-01-31" });
    expect(due(r, "2028-01-01", "2028-04-30")).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });
});

describe("other frequencies", () => {
  it("quarterly steps three months from the first payment, clamping short months", () => {
    const r = rule({ frequency: "quarterly", day_of_month: 31, starts_on: "2026-01-31" });
    expect(due(r, "2026-01-01", "2027-01-31")).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
  });
  it("yearly on 29 February falls on 28 Feb in non-leap years", () => {
    const r = rule({ frequency: "yearly", day_of_month: 29, month_of_year: 2, starts_on: "2028-02-29" });
    expect(due(r, "2028-01-01", "2033-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29", "2033-02-28"]);
  });
  it("weekly lands on the chosen weekday, seven days apart across both 2026 clock changes", () => {
    const r = rule({ frequency: "weekly", weekday: 7, day_of_month: null, starts_on: "2026-03-22" });   // Sundays
    expect(due(r, "2026-03-22", "2026-04-12")).toEqual(["2026-03-22", "2026-03-29", "2026-04-05", "2026-04-12"]);    // 29 March: clocks go forward
    const r2 = rule({ frequency: "weekly", weekday: 7, day_of_month: null, starts_on: "2026-10-18" });
    expect(due(r2, "2026-10-18", "2026-11-08")).toEqual(["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"]);    // 25 October: clocks go back
  });
  it("weekly starts on the first matching weekday on or after the start", () => {
    expect(due(rule({ frequency: "weekly", weekday: 1, day_of_month: null, starts_on: "2026-10-27" }), "2026-10-01", "2026-11-10")).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("weekends and bank holidays", () => {
  const nwd = (o: Partial<RecurrenceRule>) => rule({ working_day_rule: "next_working_day", ...o });
  it("Sunday 1 Nov 2026 logs on Monday 2 Nov", () => {
    const o = nextOccurrences(nwd({ day_of_month: 1, starts_on: "2026-11-01" }), "2026-11-01", "2026-11-30");
    expect(o).toEqual([{ scheduled_on: "2026-11-01", due_on: "2026-11-02", n: 1 }]);
  });
  it("25 Dec 2026 logs on Tuesday 29 Dec (25 and 28 Dec are bank holidays, 26–27 a weekend)", () => {
    expect(due(nwd({ day_of_month: 25, starts_on: "2026-12-01" }), "2026-12-01", "2026-12-31", BANK_HOLIDAYS)).toEqual(["2026-12-29"]);
  });
  it("'On the day' ignores weekends and holidays", () => {
    expect(due(rule({ day_of_month: 25, starts_on: "2026-12-01" }), "2026-12-01", "2026-12-31", BANK_HOLIDAYS)).toEqual(["2026-12-25"]);
  });
  it("a payment moved out of the window is found in the next one, and idempotency uses the scheduled date", () => {
    const r = nwd({ day_of_month: 31, starts_on: "2026-10-31" });            // Sat 31 Oct → Mon 2 Nov
    expect(nextOccurrences(r, "2026-10-01", "2026-10-31")).toEqual([]);
    expect(nextOccurrences(r, "2026-11-01", "2026-11-05")).toEqual([{ scheduled_on: "2026-10-31", due_on: "2026-11-02", n: 1 }]);
  });
  it("working-day helpers", () => {
    expect(isWorkingDay("2026-11-02")).toBe(true);
    expect(isWorkingDay("2026-12-25", BANK_HOLIDAYS)).toBe(false);
    expect(nextWorkingDay("2026-12-25", BANK_HOLIDAYS)).toBe("2026-12-29");
    expect(nextWorkingDay("2026-11-03")).toBe("2026-11-03");
  });
});

describe("ends", () => {
  it("stops after an end date", () => {
    expect(due(rule({ ends_on: "2026-12-27" }), "2026-10-01", "2027-06-30")).toEqual(["2026-10-27", "2026-11-27", "2026-12-27"]);
  });
  it("stops after N payments and numbers them", () => {
    const o = nextOccurrences(rule({ max_occurrences: 3 }), "2026-01-01", "2027-06-30");
    expect(o.map((x) => [x.due_on, x.n])).toEqual([["2026-10-27", 1], ["2026-11-27", 2], ["2026-12-27", 3]]);
  });
  it("N counts from the start even when the window starts later", () => {
    expect(nextOccurrences(rule({ max_occurrences: 3 }), "2026-12-01", "2027-06-30").map((x) => x.n)).toEqual([3]);
  });
});

describe("helpers", () => {
  it("firstOccurrence", () => {
    expect(firstOccurrence(rule({ starts_on: "2026-10-01", day_of_month: 5 }), "2026-10-24")?.due_on).toBe("2026-11-05");
    expect(firstOccurrence(rule({ ends_on: "2026-11-01" }), "2026-11-02")).toBeNull();
  });
  it("wording", () => {
    expect(ordinal(1)).toBe("1st"); expect(ordinal(22)).toBe("22nd"); expect(ordinal(11)).toBe("11th"); expect(ordinal(27)).toBe("27th");
    expect(describeRule(rule({ day_of_month: 5 }))).toBe("Monthly on the 5th");
    expect(describeRule(rule({ last_day: true }))).toBe("Monthly on the last day");
    expect(describeRule(rule({ frequency: "quarterly" }))).toBe("Every 3 months on the 27th");
    expect(describeRule(rule({ frequency: "weekly", weekday: 1 }))).toBe("Weekly on Mondays");
    expect(describeRule(rule({ frequency: "yearly", day_of_month: 29, month_of_year: 2 }))).toBe("Yearly on 29 February");
  });
});
