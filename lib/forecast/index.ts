// getForecast() (§6.14.2): the one place a month-end figure is made. `forecast(input)` is the pure engine; `getForecast` in ./load loads its inputs.
import { daysInMonth, monthEnd, monthStart } from "@/lib/dates";
import { runCore } from "./engine";
import { explain } from "./explain";
import { DEFAULT_PARAMS } from "./params";
import { reconcileCategories } from "./reconcile";
import { r2p } from "./prior";
import type { Forecast, ForecastInput } from "./types";

export * from "./types";
export { DEFAULT_PARAMS } from "./params";

const round4 = (x: { toDecimalPlaces: (n: number) => { toString(): string } }) => Number(x.toDecimalPlaces(4).toString());

export function forecast(inp: ForecastInput): Forecast {
  const S = inp.month ?? monthStart(inp.today), E = monthEnd(S);
  const p = { ...DEFAULT_PARAMS, ...inp.params };
  const closedMonth = E < inp.today;
  const base = { paramsVersion: inp.params_version ?? "default", dataVersion: inp.data_version ?? 0 };
  const items = [...inp.scheduled, ...(inp.planned_extras ?? []).map((e) => ({ d: e.d ?? E, amount: e.amount, label: e.label, kind: "extra" as const, category: e.category ?? null, varies: false }))]
    .sort((a, b) => a.d.localeCompare(b.d)).map((s) => ({ date: s.d, label: s.label, amount: s.amount, kind: s.kind, varies: s.varies }));
  const detail = { weekdayMultipliers: null as number[] | null, positionMultipliers: null as number[] | null, nextSwitch: [] as string[], oneOffs: (inp.one_offs ?? []).map(({ id, d, amount, label }) => ({ id, d, amount, label })), monthStart: S, monthEnd: E, closed: closedMonth };

  if (closedMonth) {                                            // EC-F3: a closed month is what happened
    const spent = inp.spent_month_to_date;
    return {
      regime: "actual", point: spent, floor: spent, low: null, high: null, confidence: "High",
      components: { spent, scheduled: 0, restOfMonth: 0, trips: 0, extras: 0 }, scheduledItems: [],
      evidence: { completedDays: daysInMonth(S), weightThisMonth: 1, ratioActual: null, ratioUsed: 1, loggedToday: 0 },
      prior: { historyDays: 0, historyFrom: null, historyTo: null, usualPerDay: null, weekdayProfile: false, monthPositionProfile: false, season: null, kEff: null, halfLife: p.half_life },
      daysLeft: 0, perDay: [], explanation: [], ...base, detail,
    };
  }
  const extrasTotal = (inp.planned_extras ?? []).reduce((a, e) => a + e.amount, 0);
  const core = runCore(inp, { extras: extrasTotal });
  const ex = explain(inp, core);
  detail.weekdayMultipliers = ex.weekday; detail.positionMultipliers = ex.position; detail.nextSwitch = ex.nextSwitch;
  const cats = reconcileCategories(inp, core);
  const pr = core.prior;
  const f: Forecast = {
    regime: core.regime, point: core.point, floor: core.floor, low: core.low, high: core.high, confidence: core.confidence,
    components: core.components, scheduledItems: items,
    evidence: { completedDays: core.n, weightThisMonth: round4(core.w), ratioActual: core.R === null ? null : round4(core.R), ratioUsed: round4(core.Rstar), loggedToday: core.loggedToday },
    prior: {
      historyDays: pr.H, historyFrom: pr.histFrom, historyTo: pr.histTo, usualPerDay: pr.mu === null ? null : r2p(pr.mu), weekdayProfile: pr.dowOn, monthPositionProfile: pr.posOn,
      season: pr.season === null ? null : round4(pr.season), kEff: pr.mu === null || core.kEff === null ? null : round4(core.kEff), halfLife: p.half_life,
    },
    daysLeft: core.remainingDays.length, perDay: core.perDay, explanation: ex.sentences, ...base, detail,
  };
  if (core.message) f.message = core.message;
  if (cats) { f.categories = cats.categories; f.everythingElse = cats.everythingElse; }
  return f;
}
