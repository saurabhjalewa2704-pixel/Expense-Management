# Forecasting engine: reference implementation and golden fixtures

The spec is `FORECASTING-ENGINE-PRD.md` at the root of this pack (§6.14). This folder removes any room for interpretation.

| Path | What it is |
|---|---|
| `reference/forecast_reference.py` | Python reference for the core maths: tracked days and logging gaps, the recency-weighted winsorised "usual", weekday and month-position profiles, credibility blending, day-by-day rest of month, today and last-day handling, scheduled items, trips, the analytic range, category forecasts with sparsity-scaled k, and reconciliation. |
| `reference/make_fixtures.py` | Regenerates the fixtures (`python3 reference/make_fixtures.py`). |
| `fixtures/G*.input.json` | Complete inputs for each scenario: daily facts, scheduled items, trips, spent. |
| `fixtures/G*.expected.json` | Expected outputs. The TypeScript engine must match `point`, `low`, `high`, `components.*`, `evidence.weight_this_month` (4 dp), `prior.usual_per_day`, `regime` and the category points **exactly**. |

**Field names:** the fixtures use snake_case and the TypeScript `Forecast` type uses camelCase (§6.14.15). Map them one-to-one; for example, `rest_of_month` → `restOfMonth`.

**Not in the reference** (specified in the PRD only, and covered by unit tests Claude Code writes):
- seasonality (§6.14.5);
- planned extras and likely-recurring items (§6.14.8);
- backtest and tuning (§6.14.13);
- confidence using backtest error (the reference uses the history- and days-only rule);
- explanation sentences and `perDay` output.

**If the reference and the PRD disagree, the PRD wins.** Record the discrepancy in DECISIONS.md and fix the reference.

**Owner's real case (G1):** on 1 Nov 2026 the old engine gave £3,118.41. The new one gives **£4,138.71**: October's usual of £61.14/day for all 30 remaining days, minus the £22.05 already spent today, with 0% weight on November.
