import { describe, expect, it } from "vitest";
import { planDue, shouldAct, type EngineItem } from "@/lib/recurring-engine";

const item = (o: Partial<EngineItem> = {}): EngineItem => ({
  id: "i", frequency: "monthly", day_of_month: 27, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day",
  starts_on: "2026-10-27", ends_on: null, max_occurrences: null, next_due_on: "2026-10-27", ...o,
});

describe("the cron's plan", () => {
  it("acts from 06:00 London, whatever the hour of a later run", () => {
    expect(shouldAct(5)).toBe(false); expect(shouldAct(6)).toBe(true); expect(shouldAct(23)).toBe(true);
  });
  it("logs the due occurrence once, and nothing on a day before", () => {
    expect(planDue(item(), "2026-10-26").planned).toEqual([]);
    expect(planDue(item(), "2026-10-27").planned).toEqual([{ scheduled_on: "2026-10-27", due_on: "2026-10-27", next: "2026-11-27" }]);
  });
  it("catches up every missed occurrence with its original date, oldest first", () => {
    const p = planDue(item({ frequency: "weekly", weekday: 1, day_of_month: null, starts_on: "2026-10-05", next_due_on: "2026-10-05" }), "2026-10-27").planned;
    expect(p.map((x) => x.due_on)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(p[3]!.next).toBe("2026-11-02");
  });
  it("marks the last payment with next = null, and a spent rule as finished", () => {
    expect(planDue(item({ max_occurrences: 1 }), "2026-10-27").planned[0]!.next).toBeNull();
    const done = planDue(item({ ends_on: "2026-10-01", starts_on: "2026-01-27", next_due_on: "2026-10-27" }), "2026-10-27");
    expect(done).toEqual({ planned: [], finished: true });
  });
  it("a payment moved to the next working day waits for that day", () => {
    const r = item({ working_day_rule: "next_working_day", day_of_month: 1, starts_on: "2026-11-01", next_due_on: "2026-11-02" });
    expect(planDue(r, "2026-11-01").planned).toEqual([]);
    expect(planDue(r, "2026-11-02", []).planned).toEqual([{ scheduled_on: "2026-11-01", due_on: "2026-11-02", next: "2026-12-01" }]);
  });
});
