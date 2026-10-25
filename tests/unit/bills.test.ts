import { describe, expect, it } from "vitest";
import { billsIn, dotsByDay, summariseMonth, toComeThisMonth } from "@/lib/bills";
import type { RecurringItem, RecurringOccurrence } from "@/lib/types";

const item = (o: Partial<RecurringItem> & { id: string }): RecurringItem => ({
  type: "expense", amount_pence: 1299, amount_varies: false, account_id: "a", counter_account_id: null, category_id: "c", payee_id: "p", note: null,
  frequency: "monthly", day_of_month: 27, last_day: false, weekday: null, month_of_year: null, working_day_rule: "on_day",
  starts_on: "2026-01-27", ends_on: null, max_occurrences: null, auto_log: true, paused_at: null, ended_at: null, next_due_on: "2026-10-27", created_at: "", ...o,
});
const occ = (id: string, item_id: string, due: string, status: RecurringOccurrence["status"] = "logged", amount = 1299): RecurringOccurrence =>
  ({ id, item_id, due_on: due, scheduled_on: due, status, transaction_id: "t" + id, amount_pence: amount });

const NETFLIX = item({ id: "netflix" });
const SPOTIFY = item({ id: "spotify", day_of_month: 22, next_due_on: "2026-10-22", amount_pence: 1299 });
const RENT = item({ id: "rent", day_of_month: 1, amount_pence: 160000, next_due_on: "2026-11-01" });
const SAVE = item({ id: "save", type: "transfer", day_of_month: 26, amount_pence: 50000, category_id: null, counter_account_id: "m", next_due_on: "2026-10-26" });
const oct = [occ("o1", "rent", "2026-10-01", "logged", 160000)];

describe("billsIn", () => {
  it("shows recorded occurrences and projects the rest from each rule's next date", () => {
    const rows = billsIn([NETFLIX, SPOTIFY, RENT, SAVE], oct, "2026-10-01", "2026-10-31");
    expect(rows.map((r) => [r.item.id, r.due_on, r.state])).toEqual([
      ["rent", "2026-10-01", "logged"], ["spotify", "2026-10-22", "due"], ["save", "2026-10-26", "due"], ["netflix", "2026-10-27", "due"],
    ]);
  });
  it("a future month is all projection; a past month is only what was recorded (no backfilling)", () => {
    expect(billsIn([NETFLIX, RENT], oct, "2026-11-01", "2026-11-30").map((r) => [r.item.id, r.due_on])).toEqual([["rent", "2026-11-01"], ["netflix", "2026-11-27"]]);
    expect(billsIn([NETFLIX], [], "2026-09-01", "2026-09-30")).toEqual([]);
  });
  it("paused and ended rules project nothing; a recorded skip is kept but not counted", () => {
    expect(billsIn([{ ...NETFLIX, paused_at: "x" }, { ...SPOTIFY, ended_at: "x" }], [], "2026-10-01", "2026-12-31")).toEqual([]);
    const rows = billsIn([NETFLIX], [occ("s", "netflix", "2026-10-27", "skipped")], "2026-10-01", "2026-10-31");
    expect(rows.map((r) => r.state)).toEqual(["skipped"]);
  });
  it("numbers payments for rules with a count", () => {
    const rows = billsIn([item({ id: "x", max_occurrences: 10, starts_on: "2026-04-27", next_due_on: "2026-10-27" })], [], "2026-10-01", "2026-10-31");
    expect(rows[0]!.n).toBe(7);
  });
});

describe("month summary", () => {
  const rows = billsIn([NETFLIX, SPOTIFY, RENT, SAVE], [...oct, occ("o2", "spotify", "2026-09-22")], "2026-10-01", "2026-10-31");
  it("totals expenses only, logged against to come", () => {
    expect(summariseMonth(rows)).toEqual({ count: 3, total: 160000 + 1299 + 1299, loggedCount: 1, logged: 160000, toComeCount: 2, toCome: 2598, transferToCome: 50000, incomeToCome: 0 });
  });
  it("dots: filled for logged, hollow for due, a third kind for transfers and income", () => {
    const d = dotsByDay(rows);
    expect(d.get("2026-10-01")).toEqual({ logged: 1, due: 0, other: 0 });
    expect(d.get("2026-10-22")).toEqual({ logged: 0, due: 1, other: 0 });
    expect(d.get("2026-10-26")).toEqual({ logged: 0, due: 0, other: 1 });
  });
  it("the Home card: what is left this month and what is next", () => {
    const c = toComeThisMonth([NETFLIX, SPOTIFY, RENT, SAVE], oct, "2026-10-18");
    expect(c.pence).toBe(2598); expect(c.count).toBe(2); expect(c.next?.item.id).toBe("spotify");
  });
});
