// FORECASTING-ENGINE-PRD §6.14.18: the golden fixtures G1 to G9, to the penny.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forecast } from "@/lib/forecast/index";
import type { ForecastInput } from "@/lib/forecast/types";

const DIR = "forecast/fixtures";
const names = readdirSync(DIR).filter((f) => f.endsWith(".input.json")).map((f) => f.replace(".input.json", "")).sort();

describe("golden fixtures", () => {
  for (const name of names) {
    it(name, () => {
      const input = JSON.parse(readFileSync(`${DIR}/${name}.input.json`, "utf8")) as ForecastInput;
      const exp = JSON.parse(readFileSync(`${DIR}/${name}.expected.json`, "utf8"));
      const f = forecast(input);
      expect(f.regime).toBe(exp.regime);
      expect(f.point).toBe(exp.point);
      if (exp.point !== null) {
        expect(f.low).toBe(exp.low); expect(f.high).toBe(exp.high); expect(f.confidence).toBe(exp.confidence);
        expect(f.components.spent).toBe(exp.components.spent);
        expect(f.components.scheduled).toBe(exp.components.scheduled);
        expect(f.components.restOfMonth).toBe(exp.components.rest_of_month);
        expect(f.components.trips).toBe(exp.components.trips);
        expect(f.evidence.weightThisMonth).toBe(exp.evidence.weight_this_month);
        expect(f.evidence.completedDays).toBe(exp.evidence.n_completed_days);
        expect(f.evidence.ratioUsed).toBe(exp.evidence.ratio_used);
        expect(f.evidence.ratioActual).toBe(exp.evidence.ratio_actual_vs_usual);
        expect(f.evidence.loggedToday).toBe(exp.evidence.logged_today);
        expect(f.prior.usualPerDay).toBe(exp.prior.usual_per_day);
        expect(f.prior.historyDays).toBe(exp.prior.H);
        expect(f.prior.weekdayProfile).toBe(exp.prior.weekday_profile);
        expect(f.prior.monthPositionProfile).toBe(exp.prior.month_position_profile);
        expect(f.prior.kEff).toBe(exp.prior.k_eff);
        expect(f.daysLeft).toBe(exp.days_left);
        if (exp.categories) {
          for (const [c, v] of Object.entries(exp.categories as Record<string, { point: number; rest_of_month: number; weight_this_month: number | null }>)) {
            expect(f.categories![c]!.point, `${name} ${c} point`).toBe(v.point);
            expect(f.categories![c]!.restOfMonth, `${name} ${c} rest`).toBe(v.rest_of_month);
            expect(f.categories![c]!.weightThisMonth, `${name} ${c} weight`).toBe(v.weight_this_month);
          }
          expect(f.everythingElse).toBe(exp.everything_else);
        }
      } else {
        expect(f.floor).toBe(exp.floor);
      }
    });
  }
});

describe("performance (§6.14.14)", () => {
  it("overall plus four categories on 5 months of history in well under the 120 ms budget", () => {
    const input = JSON.parse(readFileSync(`${DIR}/G6-rich-mid-month.input.json`, "utf8")) as ForecastInput;
    forecast(input);                                           // warm the weight tables
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) forecast(input);
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(120);
  });
});

describe("display rules (§6.14.11, mock-up F4)", () => {
  it("High is exact, Medium is to the nearest £10, Low is to the nearest £50", async () => {
    const { displayPoint } = await import("@/lib/forecast/view");
    expect(displayPoint(490189, "High")).toEqual({ pence: 490189, approx: false });
    expect(displayPoint(412037, "Medium")).toEqual({ pence: 412000, approx: true });
    expect(displayPoint(413871, "Low")).toEqual({ pence: 415000, approx: true });
  });
});
