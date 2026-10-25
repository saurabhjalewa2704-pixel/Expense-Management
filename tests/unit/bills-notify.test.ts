import { describe, expect, it } from "vitest";
import { buildBillPushes, type LoggedBill } from "@/lib/bills-notify";

const row = (o: Partial<LoggedBill>): LoggedBill => ({ occurrenceId: "o", itemId: "i", transactionId: "t", name: "Rent", type: "expense", amount: 160000, due_on: "2026-11-01", status: "logged", blocked: false, ...o });

describe("bill notifications", () => {
  it("several on one day go into one summary", () => {
    const p = buildBillPushes([row({}), row({ name: "Kingston Council", amount: 14200 })], "2026-11-01");
    expect(p).toHaveLength(1);
    expect(p[0]!.title).toBe("2 bills logged today · £1,742.00");
    expect(p[0]!.body).toBe("Rent £1,600.00 · Kingston Council £142.00");
  });
  it("a catch-up after missed days is still one summary, with the original dates", () => {
    const p = buildBillPushes([row({ due_on: "2026-11-01" }), row({ name: "Gym", amount: 7500, due_on: "2026-11-03" }), row({ name: "Octopus", amount: 100, due_on: "2026-11-04" })], "2026-11-04");
    expect(p).toHaveLength(1);
    expect(p[0]!.title).toBe("3 bills logged · £1,676.00");
    expect(p[0]!.body).toContain("Rent £1,600.00 (1 Nov)");
    expect(p[0]!.body).toContain("Octopus £1.00");
  });
  it("an estimate gets its own notification with Looks right / Change amount", () => {
    const p = buildBillPushes([row({ name: "Octopus Energy", amount: 4840, status: "estimate", occurrenceId: "o9" })], "2026-11-05");
    expect(p).toEqual([expect.objectContaining({
      title: "Octopus Energy logged: £48.40 (estimate)", body: "This bill varies. Check the amount once it’s been taken.",
      actions: [{ action: "confirm", title: "Looks right" }, { action: "change", title: "Change amount" }], data: expect.objectContaining({ occurrence: "o9" }),
    })]);
  });
  it("remind mode asks to log or skip; a blocked one says why", () => {
    const [a] = buildBillPushes([row({ name: "Netflix", amount: 1299, status: "pending" })], "2026-11-27");
    expect(a!.title).toBe("Netflix £12.99 is due today");
    expect(a!.actions?.map((x) => x.action)).toEqual(["log", "skip"]);
    const [b] = buildBillPushes([row({ name: "Netflix", amount: 1299, status: "pending", blocked: true })], "2026-11-27");
    expect(b!.body).toBe("Account no longer active, choose another.");
    expect(b!.actions).toBeUndefined();
  });
  it("nothing logged, nothing sent", () => { expect(buildBillPushes([], "2026-11-01")).toEqual([]); });
});
