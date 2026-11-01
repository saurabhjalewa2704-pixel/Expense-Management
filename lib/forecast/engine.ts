// The core of the engine (§6.14.4 to §6.14.12): one pure function from a plain input object to a `Forecast`. No I/O, no clock, no randomness.
import Decimal from "decimal.js";
import { addDays, daysInMonth, diffDays, monthEnd, monthStart } from "@/lib/dates";
import { DEFAULT_PARAMS } from "./params";
import { buildPrior, D, expectedOn, r2p, trackedDays, type Prior } from "./prior";
import type { Confidence, DayFact, EngineParams, Forecast, ForecastInput, ISO, Regime, ScheduledIn, TripIn } from "./types";

type Value = (x: DayFact) => number;
const ONE = D(1);

export interface CoreResult {
  point: number | null; low: number | null; high: number | null; regime: Regime; confidence: Confidence;
  components: Forecast["components"]; floor: number; n: number; w: Decimal; R: Decimal | null; Rstar: Decimal; loggedToday: number;
  prior: Prior; kEff: Decimal | null; perDay: { date: ISO; expected: number }[]; remainingDays: ISO[]; message?: string;
}

const sumAmounts = (xs: readonly { amount: number }[]) => xs.reduce((a, s) => a + s.amount, 0);

/** §6.14.9: what is still to be spent on trips this month. */
export function tripsStillToCome(trips: readonly TripIn[], remaining: readonly ISO[], today: ISO, mu: Decimal | null): number {
  let part = 0;
  for (const t of trips) {
    const inMonth = remaining.filter((d) => d >= t.start && d <= t.end && (today >= t.start && today <= t.end ? d >= today : d > today));
    if (!inMonth.length) continue;
    const totalLeft = Math.max(1, diffDays(t.end, today > t.start ? today : t.start) + 1);
    if (t.budget !== null) part += r2p(D(Math.max(0, t.budget - t.spent_to_date)).mul(inMonth.length).div(totalLeft));
    else if (t.past_trip_daily_median != null) part += t.past_trip_daily_median * inMonth.length;
    else if (mu !== null) part += r2p(mu) * inMonth.length;
  }
  return part;
}

/** Runs the model for one value series (overall discretionary, or one category's). */
export function runCore(inp: ForecastInput, o: { value?: Value; spent?: number; scheduled?: ScheduledIn[]; kScale?: Decimal; extras?: number } = {}): CoreResult {
  const p: EngineParams = { ...DEFAULT_PARAMS, ...inp.params };
  const value: Value = o.value ?? ((x) => x.discretionary);
  const T = inp.today;
  const S = inp.month ?? monthStart(T), E = monthEnd(S);
  const spent = o.spent ?? inp.spent_month_to_date;
  const scheduled = o.scheduled ?? inp.scheduled;
  const extras = o.extras ?? 0;
  const kScale = o.kScale ?? ONE;
  const future = S > T;                                         // a month that has not started: prior only
  const prior = buildPrior(inp.days, S, inp.tracking_started_on, p, value, inp.days);

  const trackFrom = inp.tracking_started_on > S ? inp.tracking_started_on : S;
  const ev = future ? [] : trackedDays(inp.days, trackFrom, addDays(T, -1), p);
  const n = ev.length;
  const todayRec = inp.days.find((x) => x.d === T);
  const loggedToday = future || !todayRec ? 0 : value(todayRec);

  const all: ISO[] = Array.from({ length: daysInMonth(S) }, (_, i) => addDays(S, i));
  const remaining = all.filter((d) => d >= T);
  const tripDays = new Set(remaining.filter((d) => inp.trips.some((t) => d >= t.start && d <= t.end)));
  const sched = sumAmounts(scheduled);
  const floor = spent + sched;
  const noExtras = { components: { spent, scheduled: sched, restOfMonth: 0, trips: 0, extras } };

  let regime: Regime, w = D(0), R: Decimal | null = null, Rstar = ONE, kEff: Decimal | null = null;
  let expect: (d: ISO) => Decimal;
  // a series with no spend in all its history has no usual to lean on; once it starts spending (3+ days) it runs this-month-only (EC-F22)
  const newSeries = !future && prior.mu !== null && prior.mu.isZero() && n >= 3 && ev.some((x) => value(x) > 0);
  const hasPrior = prior.mu !== null && !newSeries;
  if (hasPrior) {
    const caps = (v: number) => (prior.cap !== null ? Decimal.min(D(v), prior.cap) : D(v));
    if (!future) {
      const A = ev.reduce((a, x) => a.plus(caps(value(x))), D(0));
      const Eexp = ev.reduce((a, x) => a.plus(expectedOn(prior, x.d)), D(0));
      kEff = Decimal.max(p.k_min, D(p.k_base).mul(Decimal.min(1, D(prior.H).div(28)))).mul(kScale);
      w = n > 0 ? D(n).div(D(n).plus(kEff)) : D(0);
      if (Eexp.gte(p.ratio_min_expected) && n > 0) {
        R = A.div(Eexp);
        Rstar = Decimal.min(p.ratio_clamp[1], Decimal.max(p.ratio_clamp[0], ONE.plus(w.mul(R.minus(1)))));
      }
    } else kEff = Decimal.max(p.k_min, D(p.k_base).mul(Decimal.min(1, D(prior.H).div(28)))).mul(kScale);
    regime = future ? "prior-only" : prior.season !== null ? "full+season" : !prior.dowOn ? "history" : !prior.posOn ? "history+weekday" : "full";
    expect = (d) => expectedOn(prior, d).mul(Rstar);
  } else if (!future && n >= 3) {
    const rate = D(ev.reduce((a, x) => a + value(x), 0)).div(n);
    regime = "this-month-only"; w = ONE;
    expect = () => rate;
  } else {
    return {
      point: null, low: null, high: null, regime: "insufficient", confidence: "Low", ...noExtras, floor, n, w, R, Rstar, loggedToday, prior, kEff,
      perDay: [], remainingDays: remaining, message: "Forecast available after 3 days of logging",
    };
  }

  let rest = 0;
  const perDay: { date: ISO; expected: number }[] = [];
  for (const d of remaining) {
    if (tripDays.has(d)) { perDay.push({ date: d, expected: 0 }); continue; }
    let e = r2p(expect(d));
    if (d === T && !future) e = Math.max(0, e - loggedToday);
    perDay.push({ date: d, expected: e }); rest += e;
  }
  const trips = inp.scope === "exclude_trips" || inp.scope === "exclude_both" ? 0 : tripsStillToCome(inp.trips, remaining, T, prior.mu);
  const point = spent + rest + sched + trips + extras;

  // range (§6.14.11), analytic and deterministic
  let cv = D(p.resid_cv_default);
  if (prior.mu !== null && prior.H >= 28) {
    const ratios = prior.hist.map((x) => ({ h: D(value(x)), q: expectedOn(prior, x.d) })).filter((r) => r.q.gt(0)).map((r) => r.h.div(r.q));
    if (ratios.length >= 2) {
      const mean = ratios.reduce((a, b) => a.plus(b), D(0)).div(ratios.length);
      cv = ratios.reduce((a, r) => a.plus(r.minus(mean).pow(2)), D(0)).div(ratios.length - 1).sqrt();
    }
  }
  let sdR = D(p.ratio_sd_default).mul(ONE.minus(w)).plus("0.05");
  if (prior.mu !== null && prior.H < 28) sdR = sdR.mul(ONE.plus(D(7).div(Math.max(prior.H, 1))));
  const dayVar = perDay.reduce((a, x) => a.plus(D(x.expected).mul(cv).pow(2)), D(0));
  const lvlVar = D(rest).mul(sdR).pow(2);
  const vary = scheduled.filter((s) => s.varies).reduce((a, s) => a.plus(D(s.amount).mul("0.2")), D(0));
  const sd = dayVar.plus(lvlVar).sqrt();
  const low = Math.max(spent + sched, r2p(D(point).minus(D(p.z90).mul(sd)).minus(vary)));
  const high = r2p(D(point).plus(D(p.z90).mul(sd)).plus(vary));

  const H = prior.H;
  const mapeOk = (limit: number) => inp.backtest_mape == null || inp.backtest_mape <= limit;
  const confidence: Confidence = H >= 90 && n >= 7 && mapeOk(0.07) ? "High" : (H >= 28 || n >= 10) && mapeOk(0.15) ? "Medium" : "Low";
  return { point, low, high, regime, confidence, components: { spent, scheduled: sched, restOfMonth: rest, trips, extras }, floor, n, w, R, Rstar, loggedToday, prior, kEff, perDay, remainingDays: remaining };
}
