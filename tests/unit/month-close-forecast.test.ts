// Month close: a day marked "not tracked" ("I didn't log, can't remember") is not evidence for the forecast, like a day inside a logging gap,
// where a confirmed "Nothing to log" day is a genuine £0 day that stays in the history.
import { describe, expect, it } from "vitest";
import { forecast } from "@/lib/forecast/index";
import { DEFAULT_PARAMS } from "@/lib/forecast/params";
import { trackedDays } from "@/lib/forecast/prior";
import { day, input, series } from "./forecast-helpers";

const base = () => series("2026-08-01", "2026-10-31", () => 6000);

describe("not_tracked days (month close)", () => {
  it("are excluded from the evidence, a confirmed £0 day is kept", () => {
    const days = base().map((x) => (x.d === "2026-10-10" ? { ...x, discretionary: 0, has_activity: false, not_tracked: true } : x.d === "2026-10-11" ? { ...x, discretionary: 0, has_activity: false, confirmed_zero: true } : x));
    const kept = trackedDays(days, "2026-10-01", "2026-10-31", DEFAULT_PARAMS).map((x) => x.d);
    expect(kept).not.toContain("2026-10-10");
    expect(kept).toContain("2026-10-11");
    expect(kept).toHaveLength(30);
  });

  it("do not pull the usual down as £0 days would", () => {
    const zero = (n: boolean) => base().map((x) => (x.d >= "2026-10-10" && x.d <= "2026-10-12" ? { ...x, discretionary: 0, has_activity: false, not_tracked: n, confirmed_zero: false } : x));
    const a = forecast(input({ today: "2026-11-01", track: "2026-08-01", days: zero(true) }));
    const b = forecast(input({ today: "2026-11-01", track: "2026-08-01", days: zero(false) }));
    // three quiet days with no marker are a logging gap (excluded) too, so compare against the same days confirmed as £0
    const c = forecast(input({ today: "2026-11-01", track: "2026-08-01", days: base().map((x) => (x.d >= "2026-10-10" && x.d <= "2026-10-12" ? { ...x, discretionary: 0, has_activity: false, confirmed_zero: true } : x)) }));
    expect(a.prior.usualPerDay).toBe(b.prior.usualPerDay);               // a gap and not-tracked days are the same thing
    expect(a.prior.historyDays).toBe(c.prior.historyDays - 3);
    expect(a.prior.usualPerDay!).toBeGreaterThan(c.prior.usualPerDay!);   // confirmed £0 days lower the usual; not-tracked days do not
  });

  it("two not-tracked days between busy days (too short to be a gap) are still excluded", () => {
    const days = base().map((x) => (x.d === "2026-10-10" || x.d === "2026-10-11" ? { ...x, discretionary: 0, has_activity: false, not_tracked: true } : x));
    const f = forecast(input({ today: "2026-11-01", track: "2026-08-01", days }));
    const g = forecast(input({ today: "2026-11-01", track: "2026-08-01", days: base() }));
    expect(f.prior.historyDays).toBe(g.prior.historyDays - 2);
    expect(day("2026-10-10", 0).not_tracked).toBeUndefined();
  });
});
