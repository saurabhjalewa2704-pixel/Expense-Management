# Change request: Budgets (monthly budget + category limits, with one shared forecast engine)

**Date:** 31 October 2026 · **PRD version:** 1.7 · **Scope:** a new MVP feature. It touches Home, Analytics, Insights, Available cash and the desktop dashboard.

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files.

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. Changes:<br>• New **§6.13 Budgets** (BUD-01 to BUD-12, data model, 11 acceptance criteria).<br>• **CASH-06 promoted to P0** on the shared engine.<br>• AN-10 now points to Analytics › Budgets.<br>• Edge cases **§18.10 (EC-G1 to EC-G14)**.<br>• **Appendix A.3** budget seed.<br>• Milestone **M4e**.<br>• Screens S26–S31.<br>Everything from v1.2–v1.6 is still included. |
| `design/mockups/26-…31-*.html` | **New:** Home with budgets, Budget detail, Setup, the limit sheet, Analytics › Budgets, and alerts. |
| `design/mockups/05-analytics.html`, `05c-category-detail.html`, `06-insights.html`, `07-available-cash.html`, `10-desktop.html` | **Updated:** month-end projections now come from the shared engine. Projected close is ≈ £3,139 (was £2,940); October spend is heading for £4,363 (was £5,062); Eating out's forecast is £542. |
| `design/screenshots/` | PNG renders of all of the above. |

## What the owner asked for
- A monthly overall budget, plus optional monthly limits on chosen L1 categories.
- Spending tracked as usual.
- Home shows how the month is going against the budget and the limits, with % left, forecast and anything else that supports decisions.
- Budget capabilities added to Analytics.

## Key design decisions (all in §6.13)
1. **Plan, not a straight line.** "Where should I be today" puts bills on their due days and spreads the rest evenly. So 74% spent on day 18 can correctly read "£132 under plan" in a month that front-loads rent.
2. **One forecast engine for the whole app** (`/lib/forecast.ts` + SQL `month_forecast`).
   - Forecast = spent + scheduled bills + a blended discretionary run-rate: this month's pace plus the median of the prior 3 months for the remaining days, with weights that shift through the month.
   - It gives a likely range and excludes trips, one-offs and partial months from the run-rate.
   - Available cash, the trend chart and AI insights now use this engine too, so the app never shows two different forecasts.
3. **Decision tools:** safe to spend per day after bills; a what-if table (month-end at different daily spends); a status (On track / Tight / Over); and the riskiest limit called out by an AI "Watch" card.
4. **Category limits** are optional and L1 only. Unlimited categories are grouped as **Everything else** (budget − Σ limits).
5. **Effective-dated budgets**, a one-month override, optional per-limit rollover, and linked refunds.
6. **Analytics › Budgets tab:** a variance chart (forecast vs limit), a limit/spent/forecast table, 6-month history against the budget, and budget-health tiles.
7. **Alerts:** an early warning when a limit is forecast to go over (from day 7, more than 5% and more than £10), at 80%, and when a limit is reached. At most one of each per limit per month.

## Suggested build order
1. `/lib/forecast.ts` and `month_forecast` SQL with unit tests (weights by day band, range, cold start, one-off exclusion, trips, partial months). Then switch CASH-06, the trend chart and AI facts to it.
2. Migration (`budgets`, `budget_overrides`, `budget_forecast_log`, `budget_alerts_sent`, `refund_category_id`, `is_one_off`), RLS and SQL tests, `budget_for_month`, `budget_status`, `budget_history`, and invariant 10.
3. Home cards → Budget detail → Setup → limit sheet → Analytics › Budgets → alerts → AI card types → desktop placement.

## Done when
- BUD acceptance criteria 1–11 pass against Appendix A.3.
- EC-G1 to EC-G14 pass.
- A visual check against the screenshots at 390 px.
- `DECISIONS.md`: "31 Oct 2026 · Budgets added to MVP; plan-based pace; single forecast engine shared with CASH-06 · owner request".
