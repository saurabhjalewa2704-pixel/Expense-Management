import { describe, expect, it } from "vitest";
import { ruleSentence } from "@/lib/recurrence-copy";
import type { RecurrenceRule } from "@/lib/recurrence";

const rule = (o: Partial<RecurrenceRule> = {}): RecurrenceRule => ({ frequency: "monthly", day_of_month: 27, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day", starts_on: "2026-10-27", ends_on: null, max_occurrences: null, ...o });
const base = { type: "expense" as const, amount_pence: 1299, amount_varies: false, auto_log: true, to: "Netflix", first: "2026-10-27", rule: rule() };

describe("the plain-English summary", () => {
  it("matches the mock-up for Netflix", () => {
    expect(ruleSentence(base)).toBe("Sterling will log £12.99 to Netflix at 6am on the 27th of every month, starting Tue 27 Oct.");
  });
  it("mentions what moves in shorter months, working days, estimates and ends", () => {
    const s = ruleSentence({ ...base, amount_varies: true, rule: rule({ day_of_month: 31, working_day_rule: "next_working_day", max_occurrences: 10 }) });
    expect(s).toContain("In shorter months, days 29–31 move to the last day.");
    expect(s).toContain("moves to the next working day");
    expect(s).toContain("logs your last amount as an estimate");
    expect(s).toContain("ends after 10 payments");
  });
  it("transfers, income, weekly, yearly, last day and remind mode", () => {
    expect(ruleSentence({ ...base, type: "transfer", from: "Monzo", to: "Marcus savings", amount_pence: 50000 })).toContain("move £500.00 from Monzo to Marcus savings");
    expect(ruleSentence({ ...base, type: "income", to: "Acme Ltd", rule: rule({ last_day: true, day_of_month: null }) })).toContain("log £12.99 from Acme Ltd at 6am on the last day of every month");
    expect(ruleSentence({ ...base, rule: rule({ frequency: "weekly", weekday: 1, day_of_month: null }) })).toContain("every Monday");
    expect(ruleSentence({ ...base, rule: rule({ frequency: "yearly", day_of_month: 29, month_of_year: 2 }) })).toContain("on 29 February every year");
    expect(ruleSentence({ ...base, auto_log: false })).toContain("Sterling will remind you at 6am");
  });
});
