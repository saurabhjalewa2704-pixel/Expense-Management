// §6.14.10: categories run the same engine on their own series (sparse ones need more evidence), then are reconciled to the overall rest of month.
import Decimal from "decimal.js";
import { addDays, monthStart } from "@/lib/dates";
import { runCore, type CoreResult } from "./engine";
import { DEFAULT_PARAMS } from "./params";
import { D, r2p, trackedDays } from "./prior";
import type { Forecast, ForecastInput } from "./types";

const round4 = (x: Decimal) => Number(x.toDecimalPlaces(4).toString());

export function reconcileCategories(inp: ForecastInput, overall: CoreResult): { categories: NonNullable<Forecast["categories"]>; everythingElse: number } | null {
  const cats = inp.categories ?? [];
  if (overall.point === null || cats.length === 0) return null;
  const p = { ...DEFAULT_PARAMS, ...inp.params };
  const S = inp.month ?? monthStart(inp.today);
  const histStart = inp.tracking_started_on > addDays(S, -p.window_days) ? inp.tracking_started_on : addDays(S, -p.window_days);
  const hist = trackedDays(inp.days, histStart, addDays(S, -1), p);
  const rawRest: Record<string, number> = {}, core: Record<string, CoreResult> = {};
  for (const c of cats) {
    const rho = hist.length ? D(hist.filter((x) => (x.by_cat[c] ?? 0) > 0).length).div(hist.length) : D(0);
    const kScale = rho.gt(0) ? Decimal.min(8, Decimal.max(1, D(1).div(rho))) : D(8);
    const extrasC = (inp.planned_extras ?? []).filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0);
    const f = runCore(inp, { value: (x) => x.by_cat[c] ?? 0, spent: inp.spent_by_cat?.[c] ?? 0, scheduled: inp.scheduled.filter((s) => s.category === c), kScale, extras: extrasC });
    core[c] = f;
    rawRest[c] = f.point !== null ? f.components.restOfMonth : 0;
  }
  const totalRaw = Object.values(rawRest).reduce((a, b) => a + b, 0);
  const overRest = overall.components.restOfMonth;
  const scale = totalRaw > 0 ? (D(overRest).div(totalRaw).lt(1) ? D(overRest).div(totalRaw) : D(1)) : D(1);
  const scaled: Record<string, Decimal> = {}, floors: Record<string, number> = {};
  for (const c of cats) { scaled[c] = D(rawRest[c]!).mul(scale); floors[c] = Math.trunc(scaled[c]!.toNumber()); }
  const leftover = r2p(cats.reduce((a, c) => a.plus(scaled[c]!), D(0))) - cats.reduce((a, c) => a + floors[c]!, 0);
  const order = [...cats].sort((a, b) => scaled[b]!.minus(floors[b]!).cmp(scaled[a]!.minus(floors[a]!)));       // stable: largest remainder first
  for (const c of order.slice(0, Math.max(0, leftover))) floors[c]!++;
  const out: NonNullable<Forecast["categories"]> = {};
  let sum = 0;
  for (const c of cats) {
    const schedC = inp.scheduled.filter((s) => s.category === c).reduce((a, s) => a + s.amount, 0);
    const extrasC = (inp.planned_extras ?? []).filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0);
    const point = (inp.spent_by_cat?.[c] ?? 0) + floors[c]! + schedC + extrasC;
    out[c] = { point, restOfMonth: floors[c]!, weightThisMonth: core[c]!.point !== null ? round4(core[c]!.w) : null, spent: inp.spent_by_cat?.[c] ?? 0, scheduled: schedC };
    sum += point;
  }
  return { categories: out, everythingElse: overall.point - sum };
}
