import { describe, expect, it } from "vitest";
import { decodePeriod, encodePeriod } from "@/lib/period-url";
import { shareSegments } from "@/components/charts/share-bar";

describe("period in the URL (?p=)", () => {
  it("round-trips month, quarter, year and custom periods", () => {
    for (const p of ["2026-10", "2026-Q4", "2026", "2026-10-01..2026-10-18"]) expect(encodePeriod(decodePeriod(p)!)).toBe(p);
    expect(decodePeriod("2026-10")).toEqual({ kind: "month", anchor: "2026-10-01" });
    expect(decodePeriod("2026-Q4")).toEqual({ kind: "quarter", anchor: "2026-10-01" });
  });
  it("rejects junk", () => {
    for (const p of [null, "", "2026-13", "2026-Q5", "abc", "2026-10-18..2026-10-01"]) expect(decodePeriod(p)).toBeNull();
  });
});

describe("share bar", () => {
  it("shows at most five segments and folds the rest into the last", () => {
    const parts = [60, 50, 40, 30, 20, 10, 5].map((n, i) => ({ key: String(i), label: `c${i}`, pence: n * 100 }));
    const segs = shareSegments(parts);
    expect(segs).toHaveLength(5);
    expect(segs.reduce((s, x) => s + x.pence, 0)).toBe(parts.reduce((s, x) => s + x.pence, 0));
    expect(segs[4]!.pence).toBe(3500);
  });
});
