# Sterling: forecasting engine PRD

| | |
|---|---|
| **Version** | 1.0 · 1 November 2026 |
| **Scope** | The forecasting engine only. Everything else in Sterling is already built and stays as it is. |
| **Replaces** | All existing forecast, pace and projection logic (the "80% this month / 20% history" weights and the median-based history). |
| **Ships with** | `forecast/reference/` (Python reference), `forecast/fixtures/` (golden tests G1–G9), `design/mockups/` and `design/screenshots/` (F1–F6) |
| **Priority** | Highest. Build before any other work. |

Section numbers (§6.14.x) match the master PRD, so references between documents still line up. IDs from the master PRD (BUD-, CASH-, REC-, NOT-, EC-D) refer to features that are already live in the app.

---

## 6.14 Forecasting engine (P0)

**Status:** this section **replaces BUD-05, BUD-05a (and its tests FC-1 to FC-10) and the CASH-06 formula**. Every forecast and projection in Sterling comes from this engine:
- the Home budget card;
- Budget detail and the category limits;
- the available-cash projection;
- the Analytics trend chart and Analytics › Budgets;
- Category detail;
- AI insight facts;
- alerts.

A reference implementation and golden fixtures are shipped with this PRD in `forecast/reference/` and `forecast/fixtures/`. The production engine must reproduce every `*.expected.json` to the penny. The screens it adds or changes are mocked up in F1–F6 (§6.14.20).

### 6.14.0 Why this was rewritten (owner feedback, 1 Nov 2026)

On 1 November the live app forecast £3,118.41 using "£22.05 × 80% + £47.44 × 20% = £27.13/day". That calculation had three faults:
1. **It trusted one day of November more than two weeks of October.** A single day is mostly noise. Weight on the current month must start at zero and grow as completed days accumulate.
2. **It used the median of daily spend.** Daily spend is skewed: many small days and a few big ones. A median systematically understates the month's total. The engine must use a (recency-weighted, winsorised) **mean** of daily spend.
3. **It didn't grow with the data.** History must be measured in **tracked days**, so a partial month (18–31 Oct) counts immediately. The window must expand automatically as more months are tracked, up to 12 months, with recent days weighted more.

Run on the owner's data, the new engine gives **£4,138.71** on 1 Nov (fixture G1). That is October's pace for the rest of November, with 0% weight on November so far.

### 6.14.1 Principles

1. **Decompose, then forecast each part with the right method.** Spending already done is a fact. Bills are known. Trips have plans. Only everyday ("discretionary") spending needs statistics.
2. **History is the starting point; this month earns trust.** The weight on this month = n ÷ (n + k), where n is the number of *completed* tracked days this month.
3. **Everything gets better with data.** Weekday patterns, payday effects and seasonality switch on only once there is enough history to estimate them, and they are shrunk towards neutral until then.
4. **Measure and tune.** The engine replays past months every night, measures its own error and tunes its two parameters within safe bounds.
5. **Honest uncertainty.** Every point forecast comes with a likely range and a confidence label. With too little data it says so, rather than inventing a number.
6. **Deterministic and explainable.** The same inputs always give the same output. Every number on screen can be broken down in the "Why this forecast?" sheet.
7. **One engine, one answer.** Category forecasts add up exactly to the overall forecast, and every screen shows the same figure.
8. **Money in pence.** Decimal arithmetic in between; round half-even at each named quantity; never floats.

### 6.14.2 What it produces

`getForecast({ scope, month, category?, asOf? })` → a `Forecast` (schema in §6.14.15) for:
- **scope:** `all` (default), `exclude_bills`, `exclude_trips` or `exclude_both`, matching the budget's "Covers" setting (BUD-01);
- **month:** any calendar month (pay-cycle windows later: the engine takes `[periodStart, periodEnd]`, so CASH-07 needs no rework);
- **category:** an L1 category, or omitted for overall;
- **asOf:** defaults to now (London date). Past dates are used by backtests (§6.14.13).

For a **past month** the engine returns `actual` (no forecast). For a **future month** it returns a prior-only forecast (regime `prior-only`), used by the Budget setup suggestion.

### 6.14.3 Definitions

| Term | Definition |
|---|---|
| **Today (T)** | The London date at `asOf`. Today is never a *completed* day. |
| **Completed day** | Any date before T. |
| **Tracked day** | A completed date on or after `profiles.tracking_started_on` that is not a trip day and not inside a logging gap. |
| **Logging gap** | A run of **3 or more consecutive** days with no transactions of any type and no "Nothing to log" marker (NOT-01). Such days are treated as *not tracked*, because the user probably wasn't logging. Shorter quiet runs, and days the user confirmed as no-spend, are genuine zero days. |
| **Trip day** | A date inside any trip's start and end. Excluded from the discretionary history and evidence: holidays aren't normal life. |
| **Discretionary spend (of a day)** | Expenses dated that day **excluding**: recurring payments (logged by Bills, `recurring_id` set), trip-tagged expenses, one-offs, transfers and adjustments. **Minus** refunds linked to an expense category (BUD-01). Expenses dated before tracking began are excluded automatically, because those days aren't tracked. |
| **One-off** | An expense above **max(£150, 5 × the median ticket of its L1 category)** over the prior 180 tracked days. With fewer than 10 tickets in that category, the threshold is £250. Auto-flagged with `is_one_off = true`, shown as a "One-off" chip on the transaction and in Activity, and overridable with a toggle on the expense (mock-up F5). One-offs count in *spent* but not in the pace. |
| **Spent (month to date)** | All counted spend in the month within scope: discretionary, bills, trips and one-offs, with linked refunds deducted. This is the same "spent" as BUD-04. |
| **H** | Number of tracked days in the history window before the month starts. |
| **n** | Number of tracked completed days in the current month so far (not counting today). |

### 6.14.4 The model

```
Forecast(month) = Spent so far
                + Scheduled still to come       (§6.14.8 — known amounts)
                + Rest-of-month discretionary   (§6.14.5–6.14.7 — statistical)
                + Trips still to come           (§6.14.9)
                + Planned extras                (§6.14.8 — user-entered)
```

Only the third line is statistical. Each line is shown separately in the "Why this forecast?" sheet.

### 6.14.5 History: the "usual" (prior)

**Window.** All tracked days from `max(tracking_started_on, monthStart − 365 days)` to the day before `monthStart`. The window **grows automatically** as the app is used: 14 days in early November for the owner, about 45 days in December, and so on, capped at 365.

**Usual daily spend (μ).** A **recency-weighted mean** of discretionary spend per tracked day.
- Each day is weighted by `0.5 ^ (age_in_days ÷ half_life)`. The default half-life is 60 days, tuned per §6.14.13.
- **Winsorising:** once H ≥ 30, each day's value is capped at the 97th percentile of the window before averaging, so one extraordinary day can't distort the usual.
- **Not the median.** The median of skewed daily spend understates the total.

**Weekday profile.** On once **H ≥ 21**.
- For each weekday: multiplier = (weighted mean on that weekday ÷ μ).
- Each multiplier is shrunk towards 1 with weight c ÷ (c + 4), where c is the number of observations of that weekday.
- The seven multipliers are then normalised to average 1.
- This captures, for example, "Saturdays are 2× a Tuesday".

**Month-position profile (payday effect).** On once each of three buckets (days 1–10, 11–20, 21–end) has data from **at least 2 different months and 5 or more days**.
- Each bucket's multiplier is measured on weekday-adjusted values, shrunk with c ÷ (c + 10), then normalised (count-weighted) to average 1.
- This captures, for example, "you spend 35% more in the last third of the month".

**Seasonality.** On once **13 or more months** of tracked history exist.
- Season factor = (last year's same-month daily mean ÷ last year's 12-month daily mean), shrunk 50% towards 1 and clamped to [0.7, 1.6].
- Applied to every day of the month.
- This captures, for example, December being higher.

**Expected spend for a day d:** `P(d) = μ × weekday(d) × position(d) × season`.

**How the history grows** (owner timeline, assuming daily use):

| When | H | What switches on |
|---|---|---|
| 1 Nov 2026 | 14 | Usual (mean of 18–31 Oct) |
| 1 Dec 2026 | ~44 | Weekday profile (H ≥ 21) |
| 1 Jan 2027 | ~75 | Month-position profile once 2 months cover each third |
| 1 Feb 2027 | ~105 | Full model; parameter tuning (§6.14.13) starts once 60+ tracked days and 2 complete months exist |
| 1 Dec 2027 | 365+ | Seasonality for December |

### 6.14.6 This month: evidence and credibility

```
A  = Σ discretionary on this month's tracked completed days (each day winsorised at the history cap, if any)
E  = Σ P(d) over the same days                        (what "usual" predicted for those days)
R  = A ÷ E                                            (this month is running R× usual; only if E ≥ £30)
w  = n ÷ (n + k_eff)                                  (credibility weight on this month; 0 when n = 0)
R* = 1 + w × (R − 1), clamped to [0.4, 2.5]           (the ratio actually applied to the rest of the month)
k_eff = max(3, k × min(1, H ÷ 28))                    (k default 7; tuned in §6.14.13)
```

- Using a **ratio**, not a plain daily rate, keeps weekday and payday effects intact. For example, a month that starts with two expensive weekends isn't mistaken for a hot month.
- **k_eff shrinks when history is thin.** A 14-day history is weak evidence, so this month earns trust sooner. With 90+ days of history, the month needs about a week to reach 50%.

**Weight on this month** (with k_eff = 7 for H ≥ 28; k_eff = 3.5 for the owner's H = 14):

| Completed days n | 0 | 1 | 3 | 7 | 14 | 21 | 28 |
|---|---|---|---|---|---|---|---|
| H ≥ 28 (k_eff 7) | **0%** | 13% | 30% | **50%** | 67% | 75% | 80% |
| H = 14 (k_eff 3.5) | **0%** | 22% | 46% | **67%** | 80% | 86% | 89% |

- **Today never counts as evidence,** because a part-day would bias the pace downwards. Yesterday does count. (Late logging is mitigated by the evening reminder and measured by backtests.)
- **Not enough expected spend:** if E < £30 (very early, or a very low spender), R isn't computed and R* = 1.
- **No history at all** (H < 3 tracked days): see the regimes in §6.14.12.

### 6.14.7 Rest of the month, day by day

For each remaining day d from T to monthEnd:
- **Trip day:** 0 (covered by §6.14.9).
- **Today:** `max(0, round(P(T) × R*) − discretionary already logged today)`.
- **Future day:** `round(P(d) × R*)`.

Rest-of-month discretionary = the sum of those days. On the **last day of the month**, only today's remainder is left (fixture G7). From the 1st of the next month, the closed month reports **actual** totals.

### 6.14.8 Known amounts (scheduled and planned)

| Component | Rule |
|---|---|
| **Bills** (§6.9) | Every occurrence due **after today** this month (or due today but not yet logged), after the weekend/bank-holiday shift. Excludes paused, skipped and ended rules. Exact amounts. |
| **Varying bills** | Amount = last confirmed occurrence (REC-04). Adds ±20% of the amount to the range (§6.14.11). |
| **Likely recurring** (detected, REC-07, not yet set up) | Included only if detection confidence ≥ 0.8 **and** its usual day hasn't passed. Shown as "Likely: Netflix £12.99 (not set up as a bill)". Can be dismissed. |
| **Future-dated transactions** (EC-D5) | Their exact amounts on their dates. |
| **Planned extras** (new) | Lines the user adds in the "Why this forecast?" sheet: "+ Add something you're planning" (for example "Christmas presents £300"). Each has an amount and an optional date and category. They apply to that month only and expire once the month closes. Matching later expenses are never deducted automatically. When a new expense's category or payee matches an open extra, Sterling asks once on that expense (mock-up F6): **"Yes, £X still to spend"** reduces the extra by the expense amount; **"Yes, that's all of it"** removes it; **"No"** dismisses the question for that expense. The user can also edit or delete extras in the Why sheet. Adding an extra shows the forecast before and after (mock-up F3). |

Bills and other scheduled items are **never** part of the discretionary pace, so they're never double-counted.

### 6.14.9 Trips

- Trip days are excluded from both history and evidence (§6.14.3), so holidays don't inflate "usual".
- For trip days **remaining** in the month:
  - **if the trip has a budget:** `max(0, trip budget − trip spent to date) × (trip days left in this month ÷ trip days left in total)`;
  - **else, if past trips exist:** the median on-trip daily spend of past trips × trip days left in this month;
  - **else:** μ × trip days left in this month, flagged "low confidence".
- **Home spending during the trip is assumed to pause.** Non-trip discretionary is 0 on trip days.
- **Scope:** with `exclude_trips`, this whole component (and trip spend in "spent") is removed.

### 6.14.10 Categories and reconciliation

- Each **budgeted L1 category** runs the same engine on its own daily series (weekday and position profiles come from its own history once it has 60+ non-zero days; otherwise it inherits the overall profiles).
- **Sparse categories need more evidence** before this month dominates. k is multiplied by 1 ÷ (share of history days with spend in that category), capped at 8×. For example, Entertainment, spent on 1 day in 8, uses 8 × k.
- **Reconciliation:**
  - The **overall** rest-of-month is computed top-down and is authoritative.
  - If the category rests add up to more than the overall rest, they're scaled down proportionally.
  - Pence are distributed by largest remainder.
  - **Everything else** = overall forecast − Σ budgeted category forecasts.
  - Invariant 10 (BUD) holds to the penny.

### 6.14.11 Range and confidence

**Range (p10–p90), deterministic.**
```
cv    = coefficient of variation of daily ratios (actual ÷ P(d)) in the history window (H ≥ 28), else 0.9
sd_R  = (0.20 × (1 − w) + 0.05) × (1 + 7/H when H < 28)          uncertainty about this month's level
Var   = Σ_remaining (expected_d × cv)²  +  (rest_of_month × sd_R)²
low   = max(spent + scheduled, point − 1.2816·√Var − Σ 20% of varying bills)
high  = point + 1.2816·√Var + Σ 20% of varying bills
```
The range **narrows naturally** as the month passes (fewer days left, and w grows).

**Confidence label:**
- **High:** H ≥ 90, n ≥ 7, **and** the backtest mean absolute % error for this day-of-month band is ≤ 7%.
- **Medium:** H ≥ 28 or n ≥ 10, and the backtest error is ≤ 15% (or no backtest yet).
- **Low:** otherwise.

**Display rules:**

| Confidence | Point shown as | Range |
|---|---|---|
| High | £4,901.89 (exact) | shown on tap |
| Medium | ≈ £4,900 (nearest £10) | shown under the figure |
| Low | ≈ £4,150 (nearest £50) with "Low confidence" | always shown |

### 6.14.12 Data-maturity regimes

| Regime | Condition | Behaviour | Fixture |
|---|---|---|---|
| `insufficient` | H < 3 **and** n < 3 | No point forecast. Show **"At least £X"** (spent + scheduled) and "Forecast available after 3 days of logging". The budget card shows the plan (BUD-03) instead. | G4 |
| `this-month-only` | H < 3, n ≥ 3 | Rate = this month's discretionary ÷ n, flat; w shown as 100%; Low confidence. | G5 |
| `history` | 3 ≤ H < 21 | μ only (no profiles); credibility blending with k_eff = max(3, 7 × min(1, H/28)). | G1–G3, G7 |
| `history+weekday` | H ≥ 21, position profile not yet active | Plus the weekday profile. | Unit test |
| `full` | Position profile active | Plus the payday/position effect. | G6, G8, G9 |
| `full+season` | 13+ months | Plus seasonality. | Unit test with synthetic data |
| `prior-only` | A future month | P(d) for every day + scheduled + planned extras; no evidence. | Unit test |
| `actual` | A past month | Actual totals; no range. | Unit test |

### 6.14.13 Self-calibration (getting more accurate with time)

**Nightly backtest** (cron 03:30 London):
- For each of the last 6 complete months with at least 20 tracked days, replay the engine **as it would have run** on every day of that month.
- **Point-in-time:** use only transactions with `occurred_on ≤ asOf` **and** `created_at ≤ asOf + 1 day`. This reproduces late logging honestly.
- Record `(month, day, point, low, high, actual_total)` in `forecast_backtest`.

**Metrics:**
- mean absolute percentage error (MAPE) by day-of-month band (1–7, 8–14, 15–21, 22–end);
- coverage of the p10–p90 range (target 80%);
- bias (mean signed error).

**Tuning:**
- Once **60+ tracked days and 2 complete months** exist, grid-search **k ∈ {3, 5, 7, 10, 14}** and **half-life ∈ {30, 60, 120}**.
- Minimise MAPE weighted 1 : 2 : 2 : 1 across the bands.
- Adopt a new pair only if it improves MAPE by **≥ 1 percentage point**. At most one change per 7 days.
- Store each change in `forecast_params` with the before and after metrics.

**Coverage correction:** if range coverage over the last 3 months is < 70% or > 90%, scale the range multiplier (default 1.2816) by ±10% per week, within [1.0, 2.0].

**Bias guard:** if bias exceeds ±5% in 3 consecutive months, raise a `forecast_bias` flag in Analytics › Budgets → Budget health ("Forecasts have been 6% low recently"). Parameters are **not** fudged to hide it; it signals a modelling gap to investigate.

**Visible accuracy:** the Budget health tile "Forecast accuracy ±4%" (BUD-11) reads from `forecast_backtest`. Before 2 complete months it shows "Learning: 2 months needed".

### 6.14.14 Recalculation, caching and performance

- **`daily_spend_facts`**, maintained by triggers on `transactions`, trips and categories: `(user_id, day, l1_category_id, discretionary_pence, recurring_pence, trip_pence, oneoff_pence, refund_linked_pence, txn_count, has_activity, confirmed_zero)`. Rebuilt for a user on category merge, trip date edits, one-off threshold changes and tracking-start changes.
- **The engine is a pure TypeScript module** (`/lib/forecast/`: `prior.ts`, `evidence.ts`, `scheduled.ts`, `trips.ts`, `range.ts`, `reconcile.ts`, `explain.ts`, `index.ts`). It takes a plain input object (the same shape as the fixture `*.input.json`) and returns the `Forecast`. It runs server-side in route handlers and server actions, and in the browser for optimistic updates.
- **One SQL RPC** feeds it: `forecast_inputs(p_month, p_scope, p_category)` returns facts, scheduled items, trips and params. This replaces the earlier `month_forecast()` SQL function, which is now a thin wrapper that calls the API for compatibility, or is removed.
- **Cache:** `forecast_cache (user_id, scope, month, category, as_of, data_version) → json`. `data_version` increments on any write that changes facts, bills, trips, extras or params, so the cache never serves stale numbers.
- **Snapshots:** `forecast_snapshots` stores one forecast per day per scope and category at 23:59 London time. It drives "forecast history" charts and alert de-duplication (BUD-10).
- **Performance budget:** under 30 ms per overall forecast with 365 days of facts, and under 120 ms for overall plus 12 categories. The nightly backtest takes under 5 s per user.

### 6.14.15 Output schema

```ts
type Forecast = {
  regime: 'insufficient'|'this-month-only'|'history'|'history+weekday'|'full'|'full+season'|'prior-only'|'actual';
  point: number | null;            // pence; null when insufficient
  floor: number;                   // spent + scheduled (always)
  low: number | null; high: number | null;
  confidence: 'High'|'Medium'|'Low';
  components: { spent: number; scheduled: number; restOfMonth: number; trips: number; extras: number };
  scheduledItems: { date: string; label: string; amount: number; kind: 'bill'|'bill_estimate'|'future_dated'|'likely_recurring'|'extra'; varies: boolean }[];
  evidence: { completedDays: number; weightThisMonth: number; ratioActual: number | null; ratioUsed: number; loggedToday: number };
  prior: { historyDays: number; historyFrom: string | null; historyTo: string | null; usualPerDay: number | null;
           weekdayProfile: boolean; monthPositionProfile: boolean; season: number | null; kEff: number | null; halfLife: number };
  daysLeft: number;
  perDay: { date: string; expected: number }[];       // drives the dashed forecast line
  categories?: Record<string, { point: number; restOfMonth: number; weightThisMonth: number }>;
  everythingElse?: number;
  explanation: string[];            // ready-to-render sentences for the Why sheet (§6.14.16)
  paramsVersion: string; dataVersion: number;
};
```

### 6.14.16 Explainability: "Why this forecast?" (mock-ups F1 and F2)

The sheet always shows four blocks, all populated from the `Forecast` object:
1. **The sum.** Spent so far · Bills still to come (listed, with "est." on varying bills) · Rest of the month (with the one-line method) · Trips · Planned extras → **Forecast** with its range and confidence.
2. **Your usual.**
   - "£61.14 a day, from 14 tracked days (18–31 Oct). Recent days count more."
   - Once the profiles are on: "Weekends usually 1.8× weekdays" and/or "The last third of the month runs 35% higher".
3. **This month so far.**
   - "Running 8% below usual over 7 days", or on day 1 "No full days yet".
   - "Weight on this month: 67%". A small bar shows how the weight grows over the month (0%, then about 50% after a week, rising towards 90%).
4. **Getting sharper.**
   - "Weekday patterns switch on after 21 tracked days (7 to go)".
   - "Accuracy checks start after 2 full months."

Below the blocks: **"+ Add something you're planning"** (planned extras, §6.14.8; sheet in mock-up F3), then a small line such as "Model tuned to your data on 9 Nov" when parameters changed in the last 30 days (EC-F29).

F1 shows the sheet on day 1 with a short history (the owner's real 1 Nov case, fixture G1). F2 shows it mid-month with a mature history (fixture G6): weekday chart, month-end effect, the one-off called out in "Spent so far", and "Getting sharper" items ticked off as they switch on.

**Home and Budget cards:** apply the display rules in §6.14.11. With regime `insufficient`, the Forecast tile reads "At least £1,686 · forecast after 3 days". Every state of the forecast figure, the accuracy tile and the "far above usual" insight is drawn in mock-up F4.

### 6.14.17 Edge cases

| ID | Situation | Expected behaviour |
|---|---|---|
| EC-F1 | Day 1 of the month (n = 0) | w = 0: the rest of the month is entirely from history, minus today's logged discretionary. **Never** a one-day pace. (G1) |
| EC-F2 | Last day of the month | Days left = 1 (today); only today's remainder is added. (G7) |
| EC-F3 | First day of the *next* month | The closed month shows Actual; the new month starts at w = 0. |
| EC-F4 | Tracking started mid-month (the owner's October) | Those days are tracked history from day one; days before tracking start are never history. |
| EC-F5 | Brand-new user, day 1–2 | Regime `insufficient`: "At least £X" plus a message. (G4) |
| EC-F6 | Brand-new user, day 3+ | `this-month-only` flat rate, Low confidence. (G5) |
| EC-F7 | User stops logging for a few days | A run of 3+ unconfirmed zero days is a logging gap and is excluded from history and evidence. (G9) |
| EC-F8 | Genuine no-spend days | Confirmed via "Nothing to log", or shorter than 3 days: counted as £0 days. |
| EC-F9 | Large one-off this month (sofa £899) | Counted in spent; excluded from pace and history; one-off chip shown; user can un-flag. (G6) |
| EC-F10 | One extraordinary day in history | Winsorised at the 97th percentile once H ≥ 30. |
| EC-F11 | Backdated expense added for last week | Facts update → `data_version` bumps → forecast recalculates; the snapshot for that day isn't rewritten (snapshots are history). |
| EC-F12 | Expense added after midnight for "yesterday" | Counts in yesterday's evidence at the next calculation. Backtests model late logging using `created_at`. |
| EC-F13 | Bill paused, skipped or ended mid-month | Removed from scheduled immediately. |
| EC-F14 | Varying bill | Last confirmed amount; ±20% added to the range. |
| EC-F15 | Bill due today but the 06:00 cron hasn't run yet | Included in scheduled; never counted twice once logged (keyed by occurrence id). |
| EC-F16 | Detected recurring payment that isn't set up | Included only at confidence ≥ 0.8, shown as "Likely", and dismissable. |
| EC-F17 | Future-dated transaction | Counted as scheduled on its date. |
| EC-F18 | Trip in progress or upcoming this month | Trip component per §6.14.9; trip days are 0 for home spending. (G8) |
| EC-F19 | Trip in the past | Its days are excluded from history; its spend counts in that month's actual. |
| EC-F20 | Budget scope excludes bills and/or trips | The engine runs in the same scope: spent, scheduled and components are all filtered consistently. |
| EC-F21 | Linked refund | Reduces that day's discretionary (it can make a day negative; the history mean handles this). Unlinked refunds are ignored. |
| EC-F22 | Category with no history (new category) | μ = 0 → rest 0; once it has 3+ days of spend this month, `this-month-only` for that category, with k × 8. |
| EC-F23 | Category merged | Facts rebuilt under the target; history continues seamlessly. |
| EC-F24 | Spending this month far above usual (R > 2.5) | R* is clamped at 2.5 and an insight is raised ("This month is running well above anything usual"), rather than an extreme forecast. |
| EC-F25 | Very low spender (E < £30 so far) | R* = 1; the forecast relies on history until more evidence exists. |
| EC-F26 | Month lengths 28–31, leap years | Computed from real calendar days. |
| EC-F27 | Time zones (expenses abroad) | Days use `occurred_on` (EC-D1); the month window uses London dates. |
| EC-F28 | Back-filled spend before tracking began | Not history (those days aren't tracked), but still counts in its own month's actual. |
| EC-F29 | Parameters change overnight (tuning) | The Why sheet notes "Model updated on 14 Jan: now uses a 30-day half-life". The `forecast_params` audit row is kept. |
| EC-F30 | Planned extra later matched by a real expense | Sterling asks once on that expense ("Was this part of 'Christmas presents'?", F6). It reduces or removes the extra only on the user's answer, never automatically. An extra reduced to £0 is removed. |
| EC-F31 | Large deposit or refund that isn't spending | Not spending, so it never affects the forecast. |
| EC-F32 | Pay-cycle months (later) | Same engine with a custom `[periodStart, periodEnd]`; position buckets measured as days since period start. |

### 6.14.18 Tests

1. **Golden fixtures** (`forecast/fixtures/`, inputs and expected outputs, to the penny):

| Fixture | Scenario | Key expectations |
|---|---|---|
| G1 | **Owner, 1 Nov:** 14 days of October history, no completed November days | w = 0%; usual £61.14/day; rest £1,812.15; point **£4,138.71**; range £3,174–£5,104; Low confidence |
| G2 | Owner, 8 Nov: 7 completed days running 8% below usual | w = 67%; R = 0.917 → R* = 0.945; point £4,029.78 |
| G3 | Owner, 22 Nov | w = 86%; point £4,124.25; range narrows to £3,911–£4,337 |
| G4 | New user, day 2 | No point; floor £1,685.99; message |
| G5 | New user, day 5 | this-month-only; point £2,752.99 |
| G6 | 5 months history, weekday and payday profiles, one-off excluded, varying bill, 4 categories | `full`, High; point £4,901.89; categories add up exactly with Everything else |
| G7 | Owner, last day | Rest = today's remainder only (£21.25) |
| G8 | Active trip with a £1,200 budget | Trip days excluded; trip component £900.00; point £5,474.15 |
| G9 | 5-day logging gap in history | H = 148 (gap excluded); point £4,890.18 |

2. **Property tests** (fast-check, 1,000 random months each):
   - point ≥ floor;
   - low ≤ point ≤ high;
   - w is non-decreasing in n, and w = 0 when n = 0;
   - Σ categories + Everything else = point;
   - adding a scheduled bill raises the point by exactly its amount;
   - adding a one-off doesn't change the rest of the month;
   - results are identical for identical inputs.
3. **Backtest harness tests** on synthetic users: flat, weekend-heavy, payday-spike, lumpy, sparse and holiday-heavy. Mid-month MAPE ≤ 10% for the flat and weekend profiles; p10–p90 coverage between 65% and 95%.
4. **Regression for the owner's bug:** with G1's inputs, the forecast must **not** equal £3,118.41, and `weightThisMonth` must be 0.
5. **Consistency (FC-9 retained):** the Home card, Budget detail, Available cash, trend chart and AI facts all show the same point for the same asOf.

### 6.14.19 Migration from the current implementation

1. Delete the existing pace/weights code and its "median" history. Keep nothing from BUD-05/05a.
2. Build `daily_spend_facts` (backfill from transactions), `forecast_cache`, `forecast_snapshots`, `forecast_backtest` and `forecast_params` (seeded with k = 7, half-life = 60). Add `is_one_off` (with `one_off_source: 'auto'|'user'`, so a user's choice is never overwritten by re-flagging), plus `planned_extras (id, user_id, month, label, amount_pence, on_date, category_id)` and `planned_extra_answers (transaction_id, extra_id, answer, answered_at)` so each expense is asked about at most once.
3. Port `/lib/forecast/` from the reference implementation and make every golden fixture pass. Then route all consumers through `getForecast()`.
4. Build the UI in mock-ups F1–F6: the Why sheet (both states), the planned-extra sheet, the forecast display states on every card, the one-off toggle and chip, and the planned-extra question.
5. Run the backtest once immediately after deploy, so accuracy metrics exist from day one where history allows.
6. Add the nightly backtest and tuning cron (03:30 London time).
7. Add to `DECISIONS.md`: "1 Nov 2026 · Forecast engine rebuilt per the forecasting engine PRD: credibility weight n/(n+k), mean not median, history in tracked days, self-tuning · owner request".

### 6.14.20 Mock-ups

Open the HTML files in `design/mockups/` in a browser (they are self-contained apart from the font); the PNGs in `design/screenshots/` are the same screens at 2×. Every number in them comes from the golden fixtures, so they double as visual test cases.

| # | Screen | Fixture | Shows |
|---|---|---|---|
| F1 | Why this forecast? · day 1 | G1 | Owner on 1 Nov: 0% weight on November, October's usual for the whole month, Low confidence, how the weight will grow, what switches on next |
| F2 | Why this forecast? · mid-month | G6 | Mature history on 12 Nov: High confidence, weekday chart, month-end effect, one-off excluded, 61% weight, +13% observed but +8% used |
| F3 | Something you're planning | G6 | Adding a £300 planned extra, with the forecast before and after |
| F4 | Forecast states | G1, G3, G4, G6, G7 | The forecast figure for each regime and confidence level, closed months, the accuracy tile, the "far above usual" insight |
| F5 | One-off expense | G6 | The auto-flagged £899 sofa: chip, toggle, why it was flagged, how it looks in Activity |
| F6 | Planned item match | — | The question asked when an expense matches a planned extra (EC-F30) |

Build to the visual system already in the app. The mock-ups use the app's existing tokens and components; no new colours, radii or type sizes are introduced.

### Definition of done

- G1–G9 match to the penny.
- The property tests, the backtest harness tests and the owner regression (§6.14.18 test 4) pass.
- EC-F1 to EC-F32 each have a test named after their ID.
- Every screen shows the same forecast for the same moment, all via `getForecast()`.
- F1–F6 are built and match the mock-ups at 390 × 844.
