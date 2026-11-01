"""
Sterling forecasting engine: REFERENCE IMPLEMENTATION (PRD §6.14).

Purpose: remove ambiguity. The production engine (TypeScript, /lib/forecast/) must reproduce the
golden outputs in ../fixtures/*.expected.json to the penny. Read this alongside the PRD; where they
disagree, the PRD wins and this file is a bug.

Conventions
- Money: integer pence. Intermediate maths uses Decimal; every amount is rounded half-even to the
  penny at the boundary of each named quantity (rate, P(d), components, totals).
- Dates: London-local `date` objects. "today" is the as-of date; it is NOT a completed day.
- Pure function: forecast(inputs) -> dict. No I/O, no clock, no randomness.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_EVEN
import calendar, math

D = Decimal
P0 = D("1")

# ---------------------------------------------------------------- parameters (defaults; §6.14.9 tunes k and half-life)
PARAMS = dict(
    k_base=7,              # credibility constant: weight on this month = n / (n + k_eff)
    k_min=3,
    half_life=60,          # recency weighting of history, in days
    window_days=365,       # max history window
    min_history_for_prior=3,
    dow_min_history=21,    # tracked history days before weekday profile is used
    dow_lambda=4,          # shrinkage strength for weekday multipliers (observations)
    pos_min_months=2,      # distinct months needed per month-position bucket
    pos_lambda=10,
    winsor_min_days=30,
    winsor_pct=0.97,
    ratio_min_expected=3000,   # £30: below this, R is not computed (too little expected spend so far)
    ratio_clamp=(D("0.4"), D("2.5")),
    gap_run=3,             # >= this many consecutive unconfirmed zero days = logging gap (not tracked)
    resid_cv_default=D("0.9"),   # daily coefficient of variation when history < 28 days
    ratio_sd_default=D("0.20"),  # month-ratio uncertainty when < 2 complete months
    z90=D("1.2816"),
)


def r2p(x) -> int:
    """round Decimal/number to integer pence, half-even"""
    return int(D(x).quantize(P0, rounding=ROUND_HALF_EVEN))


def month_bounds(d: date):
    last = calendar.monthrange(d.year, d.month)[1]
    return date(d.year, d.month, 1), date(d.year, d.month, last)


def pos_bucket(d: date) -> int:
    return 0 if d.day <= 10 else (1 if d.day <= 20 else 2)


# ---------------------------------------------------------------- inputs
@dataclass
class Day:
    """One London day of facts (from daily_spend_facts). Amounts in pence."""
    d: date
    discretionary: int = 0          # expenses excl. recurring, trip, one-off; linked refunds subtracted
    by_cat: dict = field(default_factory=dict)   # L1 -> discretionary pence
    recurring: int = 0
    trip: int = 0
    oneoff: int = 0
    has_activity: bool = True       # any transaction (any type) or a confirmed no-spend marker that day
    confirmed_zero: bool = False    # "Nothing to log" marker
    trip_day: bool = False          # inside a trip's dates


@dataclass
class Scheduled:
    d: date
    amount: int
    label: str
    kind: str = "bill"              # bill | bill_estimate | future_dated | likely_recurring | extra
    category: str | None = None
    varies: bool = False


@dataclass
class Trip:
    start: date
    end: date
    budget: int | None
    spent_to_date: int
    past_trip_daily_median: int | None = None


@dataclass
class Inputs:
    today: date
    tracking_started_on: date
    days: list                      # Day records from tracking start (or window start) to today inclusive
    spent_month_to_date: int        # all counted spend in the month so far (bills, trips, one-offs, refunds)
    spent_by_cat: dict = field(default_factory=dict)
    scheduled: list = field(default_factory=list)   # Scheduled items after "now" within the month
    trips: list = field(default_factory=list)
    categories: list = field(default_factory=list)  # L1 names to report (budgeted ones)
    params: dict = field(default_factory=dict)


# ---------------------------------------------------------------- tracked days
def tracked_days(days, start, end, p):
    """Days in [start, end] that count as evidence: on/after tracking start (handled by caller),
    not trip days, not inside a logging gap."""
    sel = [x for x in days if start <= x.d <= end]
    out, run = [], []
    for x in sel:
        unconfirmed_zero = (not x.has_activity) and not x.confirmed_zero
        if unconfirmed_zero:
            run.append(x)
            continue
        if run:
            if len(run) < p["gap_run"]:
                out.extend(run)   # short quiet spells are genuine zero days
            run = []
        out.append(x)
    if run and len(run) < p["gap_run"]:
        out.extend(run)
    return [x for x in out if not x.trip_day]


# ---------------------------------------------------------------- prior (history before the month)
def build_prior(days, month_start, tracking_start, p, value=lambda x: x.discretionary):
    win_start = max(tracking_start, month_start - timedelta(days=p["window_days"]))
    hist = tracked_days(days, win_start, month_start - timedelta(days=1), p)
    H = len(hist)
    if H < p["min_history_for_prior"]:
        return dict(H=H, mu=None, dow=[D(1)] * 7, pos=[D(1)] * 3, cap=None, hist=hist, dow_on=False, pos_on=False)
    vals = [D(value(x)) for x in hist]
    cap = None
    if H >= p["winsor_min_days"]:
        s = sorted(vals)
        idx = min(len(s) - 1, int(math.ceil(p["winsor_pct"] * len(s))) - 1)
        cap = s[idx]
        vals = [min(v, cap) for v in vals]
    ws = [D(0.5) ** (D((month_start - x.d).days) / D(p["half_life"])) for x in hist]
    W = sum(ws)
    mu = sum(w * v for w, v in zip(ws, vals)) / W
    # weekday profile
    dow = [D(1)] * 7
    dow_on = H >= p["dow_min_history"] and mu > 0
    if dow_on:
        raw = []
        for k in range(7):
            idx = [i for i, x in enumerate(hist) if x.d.weekday() == k]
            c = len(idx)
            if c == 0:
                raw.append(D(1)); continue
            m = (sum(ws[i] * vals[i] for i in idx) / sum(ws[i] for i in idx)) / mu
            raw.append(1 + (D(c) / (D(c) + p["dow_lambda"])) * (m - 1))
        avg = sum(raw) / 7
        dow = [r / avg for r in raw]
    # month-position profile
    pos = [D(1)] * 3
    months_per_bucket = [set(), set(), set()]
    count_per_bucket = [0, 0, 0]
    for x in hist:
        b = pos_bucket(x.d); months_per_bucket[b].add((x.d.year, x.d.month)); count_per_bucket[b] += 1
    pos_on = mu > 0 and all(len(m) >= p["pos_min_months"] and c >= 5 for m, c in zip(months_per_bucket, count_per_bucket))
    if pos_on:
        raw, wts = [], []
        for b in range(3):
            idx = [i for i, x in enumerate(hist) if pos_bucket(x.d) == b]
            # de-weekday the values before measuring position effect
            m = (sum(ws[i] * vals[i] / dow[hist[i].d.weekday()] for i in idx) / sum(ws[i] for i in idx)) / mu
            c = len(idx)
            raw.append(1 + (D(c) / (D(c) + p["pos_lambda"])) * (m - 1)); wts.append(D(c))
        avg = sum(r * w for r, w in zip(raw, wts)) / sum(wts)
        pos = [r / avg for r in raw]
    return dict(H=H, mu=mu, dow=dow, pos=pos, cap=cap, hist=hist, dow_on=dow_on, pos_on=pos_on)


def P_of(prior, d):
    return prior["mu"] * prior["dow"][d.weekday()] * prior["pos"][pos_bucket(d)]


# ---------------------------------------------------------------- the engine
def forecast(inp: Inputs, value=lambda x: x.discretionary, spent=None, scheduled=None, k_scale=D(1)):
    p = {**PARAMS, **inp.params}
    T = inp.today
    S, E = month_bounds(T)
    spent = inp.spent_month_to_date if spent is None else spent
    scheduled = inp.scheduled if scheduled is None else scheduled
    prior = build_prior(inp.days, S, inp.tracking_started_on, p, value)

    # evidence: completed tracked days this month (before today)
    ev = tracked_days(inp.days, max(S, inp.tracking_started_on), T - timedelta(days=1), p)
    n = len(ev)
    today_rec = next((x for x in inp.days if x.d == T), None)
    logged_today = value(today_rec) if today_rec else 0

    remaining = [S + timedelta(days=i) for i in range((S - S).days, (E - S).days + 1)]
    remaining = [d for d in remaining if d >= T]
    trip_days = {d for t in inp.trips for d in remaining if t.start <= d <= t.end}

    regime, w, R, Rstar, rate_note = None, D(0), None, D(1), ""
    if prior["mu"] is not None:
        caps = (lambda v: min(D(v), prior["cap"])) if prior["cap"] is not None else (lambda v: D(v))
        A = sum(caps(value(x)) for x in ev)
        Eexp = sum(P_of(prior, x.d) for x in ev)
        k_eff = max(D(p["k_min"]), D(p["k_base"]) * min(D(1), D(prior["H"]) / D(28))) * k_scale
        w = D(n) / (D(n) + k_eff) if n > 0 else D(0)
        if Eexp >= p["ratio_min_expected"] and n > 0:
            R = A / Eexp
            lo, hi = p["ratio_clamp"]
            Rstar = min(hi, max(lo, 1 + w * (R - 1)))
        regime = "history" if not prior["dow_on"] else ("history+weekday" if not prior["pos_on"] else "full")
        expect = lambda d: P_of(prior, d) * Rstar
    else:
        if n >= 3:
            rate = D(sum(value(x) for x in ev)) / D(n)
            regime, w = "this-month-only", D(1)
            expect = lambda d: rate
            k_eff = None
        else:
            return dict(point=None, floor=spent + sum(s.amount for s in scheduled), regime="insufficient",
                        message="Forecast available after 3 days of logging", n=n, H=prior["H"])

    # rest of month, discretionary
    rest = 0
    per_day = []
    for d in remaining:
        if d in trip_days:
            per_day.append((d, 0)); continue
        e = r2p(expect(d))
        if d == T:
            e = max(0, e - logged_today)
        per_day.append((d, e)); rest += e

    # trips overlapping the rest of the month
    trip_part = 0
    for t in inp.trips:
        days_in_month = [d for d in remaining if t.start <= d <= t.end and d > T]
        if T >= t.start and T <= t.end:
            days_in_month = [d for d in remaining if t.start <= d <= t.end and d >= T]
        if not days_in_month:
            continue
        trip_remaining_total = max(1, (t.end - max(T, t.start)).days + 1)
        if t.budget is not None:
            trip_part += r2p(D(max(0, t.budget - t.spent_to_date)) * D(len(days_in_month)) / D(trip_remaining_total))
        elif t.past_trip_daily_median is not None:
            trip_part += t.past_trip_daily_median * len(days_in_month)
        elif prior["mu"] is not None:
            trip_part += r2p(prior["mu"]) * len(days_in_month)

    sched = sum(s.amount for s in scheduled)
    point = spent + rest + sched + trip_part

    # range (analytic, deterministic)
    if prior["mu"] is not None and prior["H"] >= 28:
        hv = [D(value(x)) for x in prior["hist"]]
        Ps = [P_of(prior, x.d) for x in prior["hist"]]
        ratios = [h / q for h, q in zip(hv, Ps) if q > 0]
        if len(ratios) >= 2:
            mean_r = sum(ratios) / len(ratios)
            cv = (sum((r - mean_r) ** 2 for r in ratios) / (len(ratios) - 1)).sqrt()
        else:
            cv = p["resid_cv_default"]
    else:
        cv = p["resid_cv_default"]
    sd_R = p["ratio_sd_default"] * (1 - w) + D("0.05")
    if prior["mu"] is not None and prior["H"] < 28:
        sd_R = sd_R * (1 + D(7) / D(max(prior["H"], 1)))
    day_var = sum((D(e) * cv) ** 2 for _, e in per_day)
    lvl_var = (D(rest) * sd_R) ** 2
    vary_band = sum(D(s.amount) * D("0.2") for s in scheduled if s.varies)
    sd = (day_var + lvl_var).sqrt()
    low = max(spent + sched, r2p(D(point) - p["z90"] * sd - vary_band))
    high = r2p(D(point) + p["z90"] * sd + vary_band)

    # confidence (backtest-free version; production also uses backtest MAPE, §6.14.9)
    H = prior["H"]
    conf = "High" if H >= 90 and n >= 7 else ("Medium" if H >= 28 or n >= 10 else "Low")

    return dict(
        point=point, low=low, high=high, regime=regime, confidence=conf,
        components=dict(spent=spent, scheduled=sched, rest_of_month=rest, trips=trip_part),
        evidence=dict(n_completed_days=n, weight_this_month=float(round(w, 4)), ratio_actual_vs_usual=None if R is None else float(round(R, 4)),
                      ratio_used=float(round(Rstar, 4)), logged_today=logged_today),
        prior=dict(H=H, usual_per_day=None if prior["mu"] is None else r2p(prior["mu"]), weekday_profile=prior["dow_on"],
                   month_position_profile=prior["pos_on"], k_eff=None if prior["mu"] is None else float(round(max(D(p["k_min"]), D(p["k_base"]) * min(D(1), D(H) / D(28))), 4))),
        days_left=len(remaining),
    )


def forecast_with_categories(inp: Inputs):
    """Overall top-down; categories bottom-up, then scaled so they sum exactly to the overall rest-of-month."""
    overall = forecast(inp)
    if overall.get("point") is None or not inp.categories:
        return overall
    cats = {}
    raw_rest = {}
    p = {**PARAMS, **inp.params}
    S, _ = month_bounds(inp.today)
    for c in inp.categories:
        # sparse categories need more evidence before this month dominates: k scaled by 1/share of days with spend
        hist = tracked_days(inp.days, max(inp.tracking_started_on, S - timedelta(days=p["window_days"])), S - timedelta(days=1), p)
        rho = D(sum(1 for x in hist if x.by_cat.get(c, 0) > 0)) / D(len(hist)) if hist else D(0)
        k_scale = min(D(8), max(D(1), D(1) / rho)) if rho > 0 else D(8)
        f = forecast(inp, value=lambda x, c=c: x.by_cat.get(c, 0), spent=inp.spent_by_cat.get(c, 0),
                     scheduled=[s for s in inp.scheduled if s.category == c], k_scale=k_scale)
        raw_rest[c] = f["components"]["rest_of_month"] if f.get("point") is not None else 0
        cats[c] = f
    # "Everything else" = overall rest minus scaled budgeted rests; scale only if budgeted rests exceed overall
    total_raw = sum(raw_rest.values())
    over_rest = overall["components"]["rest_of_month"]
    scale = min(D(1), D(over_rest) / D(total_raw)) if total_raw > 0 else D(1)
    scaled = {c: D(v) * scale for c, v in raw_rest.items()}
    floors = {c: int(v) for c, v in scaled.items()}
    leftover = r2p(sum(scaled.values())) - sum(floors.values())
    for c in sorted(scaled, key=lambda c: -(scaled[c] - floors[c]))[:max(0, leftover)]:
        floors[c] += 1
    out = {}
    for c in inp.categories:
        sched_c = sum(s.amount for s in inp.scheduled if s.category == c)
        out[c] = dict(point=inp.spent_by_cat.get(c, 0) + floors[c] + sched_c, rest_of_month=floors[c],
                      weight_this_month=cats[c]["evidence"]["weight_this_month"] if cats[c].get("point") is not None else None)
    else_point = overall["point"] - sum(v["point"] for v in out.values())
    overall["categories"] = out
    overall["everything_else"] = else_point
    return overall
