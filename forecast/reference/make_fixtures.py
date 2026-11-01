"""Builds the golden fixtures (inputs + expected outputs) for the forecasting engine.
Inputs are stored in full in each *.input.json, so the TypeScript port never needs this generator."""
import json, pathlib, sys
from datetime import date, timedelta
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from forecast_reference import Inputs, Day, Scheduled, Trip, forecast, forecast_with_categories

OUT = pathlib.Path(__file__).resolve().parent.parent / "fixtures"
OUT.mkdir(exist_ok=True)


def lcg(seed):
    s = seed
    while True:
        s = (1103515245 * s + 12345) % (2 ** 31)
        yield s / 2 ** 31


def owner_october():
    # Owner's tracked Oct 18–31 discretionary (pence). Median £47.44, mean £61.45.
    vals = [4500, 0, 12880, 3890, 2230, 4988, 9150, 1250, 5640, 18760, 3120, 7425, 4210, 6980]
    return [Day(date(2026, 10, 18) + timedelta(days=i), discretionary=v, has_activity=True) for i, v in enumerate(vals)]


OWNER_BILLS = [("HBR", 2, 1399, False), ("O2", 7, 1800, False), ("Google One", 10, 159, False), ("Octopus Energy", 20, 6800, True),
               ("Anthropic", 23, 1800, False), ("iCloud", 25, 299, False), ("Fitbod", 27, 2895, False)]
NOV1_BILLS_LOGGED = 217504 - 2205   # rent etc. logged on 1 Nov (owner screenshot: spent £2,175.04 incl. £22.05 discretionary)


def owner_case(today, nov_disc):
    days = owner_october()
    for i, v in enumerate(nov_disc):
        d = date(2026, 11, 1) + timedelta(days=i)
        if d <= today:
            days.append(Day(d, discretionary=v, has_activity=True))
    spent = NOV1_BILLS_LOGGED + sum(v for i, v in enumerate(nov_disc) if date(2026, 11, 1) + timedelta(days=i) <= today)
    sched = []
    for name, dd, amt, varies in OWNER_BILLS:
        d = date(2026, 11, dd)
        if d <= today:
            spent += amt
        else:
            sched.append(Scheduled(d, amt, name, "bill_estimate" if varies else "bill", varies=varies))
    return Inputs(today=today, tracking_started_on=date(2026, 10, 18), days=days, spent_month_to_date=spent, scheduled=sched)


NOV_OWNER = [2205, 7340, 3120, 9860, 0, 11240, 5480, 6210, 2890, 14430, 4120, 3560, 8790, 0, 6640, 12150, 3980, 5220, 7710, 2460, 9930, 4410,
             6120, 3380, 15240, 7790, 2240, 5520, 8890, 4100]


def rich_history(start, end, seed=7, payday_boost=True):
    g = lcg(seed)
    base = {0: 3800, 1: 3400, 2: 3600, 3: 4200, 4: 6800, 5: 9200, 6: 7400}  # Mon..Sun pence
    days = []
    d = start
    while d <= end:
        b = base[d.weekday()]
        if payday_boost and d.day >= 21:
            b = int(b * 1.35)
        noise = 0.35 + 1.3 * next(g)
        v = int(b * noise)
        cats = {"Groceries": int(v * 0.42), "Eating out": int(v * 0.33), "Transport": int(v * 0.15)}
        cats["Other"] = v - sum(cats.values())
        days.append(Day(d, discretionary=v, by_cat=cats, has_activity=True))
        d += timedelta(days=1)
    return days


def case_rich(today, trip=None, gap=False):
    days = rich_history(date(2026, 6, 1), date(2026, 10, 31))
    if gap:
        for x in days:
            if date(2026, 9, 10) <= x.d <= date(2026, 9, 14):
                x.discretionary, x.by_cat, x.has_activity = 0, {}, False
    cur = rich_history(date(2026, 11, 1), today, seed=99)
    # November running ~15% hotter on eating out
    for x in cur:
        bump = int(x.by_cat["Eating out"] * 0.45)
        x.by_cat["Eating out"] += bump; x.discretionary += bump
        if trip and trip.start <= x.d <= trip.end:
            x.trip_day = True
    today_rec = cur[-1]
    today_rec.discretionary, today_rec.by_cat = 1840, {"Groceries": 0, "Eating out": 1840, "Transport": 0, "Other": 0}
    days += cur
    bills_logged = 160000 + 14200 + 7500 + 4840
    spent = bills_logged + sum(x.discretionary for x in cur if not x.trip_day) + 89900   # +£899 sofa one-off on 3 Nov
    spent_by_cat = {c: sum(x.by_cat.get(c, 0) for x in cur if not x.trip_day) for c in ["Groceries", "Eating out", "Transport"]}
    spent_by_cat["Entertainment"] = 299
    sched = [Scheduled(date(2026, 11, 22), 1299, "Spotify", category="Entertainment"),
             Scheduled(date(2026, 11, 24), 899, "Disney+", category="Entertainment"),
             Scheduled(date(2026, 11, 27), 1299, "Netflix", category="Entertainment"),
             Scheduled(date(2026, 11, 26), 4840, "Octopus Energy", kind="bill_estimate", varies=True)]
    sched = [s for s in sched if s.d > today]
    trips = []
    if trip:
        trips = [trip]
        spent += trip.spent_to_date
    return Inputs(today=today, tracking_started_on=date(2026, 6, 1), days=days, spent_month_to_date=spent, spent_by_cat=spent_by_cat,
                  scheduled=sched, trips=trips, categories=["Groceries", "Eating out", "Transport", "Entertainment"])


def new_user(today, vals):
    days = [Day(date(2026, 11, 1) + timedelta(days=i), discretionary=v) for i, v in enumerate(vals) if date(2026, 11, 1) + timedelta(days=i) <= today]
    return Inputs(today=today, tracking_started_on=date(2026, 11, 1), days=days, spent_month_to_date=160000 + sum(x.discretionary for x in days),
                  scheduled=[Scheduled(date(2026, 11, 27), 1299, "Netflix")])


CASES = {
    "G1-owner-1-nov": ("Owner on 1 Nov: 14 days of October history, no completed November days → 100% history", owner_case(date(2026, 11, 1), NOV_OWNER)),
    "G2-owner-8-nov": ("Owner on 8 Nov: 7 completed days, credibility weight rises", owner_case(date(2026, 11, 8), NOV_OWNER)),
    "G3-owner-22-nov": ("Owner on 22 Nov: 21 completed days; October + November evidence", owner_case(date(2026, 11, 22), NOV_OWNER)),
    "G4-new-user-day-2": ("Brand-new user, day 2: no forecast, floor only", new_user(date(2026, 11, 2), [3200, 4100])),
    "G5-new-user-day-5": ("Brand-new user, day 5: this-month-only rate", new_user(date(2026, 11, 5), [3200, 4100, 2600, 5300, 1200])),
    "G6-rich-mid-month": ("5 months history, weekday + payday profiles, categories, one-off excluded, varies bill", case_rich(date(2026, 11, 12))),
    "G7-owner-last-day": ("Owner on 30 Nov: last day, only the rest of today remains", owner_case(date(2026, 11, 30), NOV_OWNER)),
    "G8-rich-active-trip": ("Rich history, trip 20–27 Nov with £1,200 budget, £300 pre-paid, today 22 Nov", case_rich(date(2026, 11, 22), trip=Trip(date(2026, 11, 20), date(2026, 11, 27), 120000, 30000))),
    "G9-rich-logging-gap": ("Rich history with a 5-day logging gap (excluded from history)", case_rich(date(2026, 11, 12), gap=True)),
}


def enc(o):
    if isinstance(o, date): return o.isoformat()
    if hasattr(o, "__dict__"): return {k: enc(v) for k, v in o.__dict__.items()}
    if isinstance(o, list): return [enc(v) for v in o]
    if isinstance(o, dict): return {k: enc(v) for k, v in o.items()}
    return o


summary = []
for cid, (desc, inp) in CASES.items():
    res = forecast_with_categories(inp)
    (OUT / f"{cid}.input.json").write_text(json.dumps({"description": desc, **enc(inp)}, indent=1))
    (OUT / f"{cid}.expected.json").write_text(json.dumps(res, indent=1, default=str))
    summary.append((cid, res))
for cid, r in summary:
    if r.get("point") is None:
        print(f"{cid:24s} no point · floor {r['floor']/100:,.2f} · {r['message']}")
    else:
        c = r["components"]; e = r["evidence"]; pr = r["prior"]
        print(f"{cid:24s} point £{r['point']/100:,.2f}  range £{r['low']/100:,.0f}–£{r['high']/100:,.0f}  w={e['weight_this_month']:.0%}  R={e['ratio_actual_vs_usual']}  R*={e['ratio_used']}  usual/day=£{(pr['usual_per_day'] or 0)/100:.2f} H={pr['H']} dow={pr['weekday_profile']} pos={pr['month_position_profile']} rest=£{c['rest_of_month']/100:,.2f} {r['regime']} {r['confidence']}")
