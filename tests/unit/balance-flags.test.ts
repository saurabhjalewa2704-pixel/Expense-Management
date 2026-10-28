import { describe, expect, it } from "vitest";
import { anchorOn, defaultCounts, flagKind, pendingFlags } from "@/lib/balance-flags";

const monzo = { opening_date: "2026-10-18", last_reconciled_on: null };
const reconciled = { opening_date: "2026-10-18", last_reconciled_on: "2026-11-01" };

describe("balance anchors (BAL-01..04)", () => {
  it("the anchor is the later of the opening date and the last reconcile", () => {
    expect(anchorOn(monzo)).toBe("2026-10-18");
    expect(anchorOn(reconciled)).toBe("2026-11-01");
    expect(anchorOn({ opening_date: "2026-10-18", last_reconciled_on: "2026-10-01" })).toBe("2026-10-18");
  });
  it("EC-A1 before the opening date: neutral", () => {
    expect(flagKind(monzo, "2026-07-14")).toBe("before_tracking");
    expect(defaultCounts(monzo, "2026-07-14")).toBe(false);
  });
  it("EC-A3 on the opening date: counts, with a toggle", () => {
    expect(flagKind(monzo, "2026-10-18")).toBe("on_opening");
    expect(defaultCounts(monzo, "2026-10-18")).toBe(true);
  });
  it("EC-A2 on or before the last reconcile: ask, and the default is 'already in the balance'", () => {
    expect(flagKind(reconciled, "2026-10-30")).toBe("before_reconcile");
    expect(flagKind(reconciled, "2026-11-01")).toBe("before_reconcile");
    expect(defaultCounts(reconciled, "2026-10-30")).toBe(false);
  });
  it("after the anchor: counts", () => {
    expect(flagKind(reconciled, "2026-11-02")).toBe("counts");
    expect(flagKind(monzo, "2026-10-20")).toBe("counts");
    expect(defaultCounts(monzo, "2026-10-20")).toBe(true);
  });
  it("EC-A4 each side of a transfer is judged against its own account", () => {
    const amex = { opening_date: "2026-11-01", last_reconciled_on: null };
    expect(pendingFlags("transfer", "2026-10-25", monzo, amex)).toEqual({ a: true, b: false });
    expect(pendingFlags("expense", "2026-10-25", monzo, undefined)).toEqual({ a: true, b: null });
  });
  it("an answer from the owner wins", () => {
    expect(pendingFlags("expense", "2026-10-30", reconciled, undefined, { a: true })).toEqual({ a: true, b: null });
  });
});
