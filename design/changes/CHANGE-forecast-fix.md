# Bug fix: the forecast always equals what's already been spent

**Date:** 31 October 2026 · **PRD version:** 1.7.1 · **Priority:** fix before anything else.

## Symptom (reported by the owner)
"It always says October is heading for the same amount which is already spent."

## Root causes to check in the current code
1. **History counted as £0.** Months with no data (tracking only started on 18 Oct) are averaged in as zero, so the "rest of month" term comes out at £0.
2. **Pace diluted.** The daily pace is divided by every day of the month instead of the days actually tracked.
3. **Missing remaining-days term.** "Rest of month" is missing, or `days_left` is computed as 0.
4. **More than one projection.** The trend chart, available cash and budgets each calculate their own projection instead of calling one function.

## What to do
1. Read **PRD §6.13 BUD-05 and the new BUD-05a**.
2. Implement `month_forecast()` (SQL) and `/lib/forecast.ts` exactly as specified. Delete every other projection calculation (`grep -ri "project\|forecast" app lib supabase`) and route all callers through it: AN-04 trend chart, CASH-06 available cash, budgets, category detail and AI facts.
3. Add the **"Why this forecast?"** sheet (`design/mockups/32-forecast-why.html`). Tapping any forecast figure opens it.
4. Add the owner-only debug endpoint `/api/debug/forecast`.
5. Write tests **FC-1 to FC-10 first**, confirm they fail on the current code, then fix until they pass.

## Done when
- FC-1 to FC-10 pass, including FC-1 (the owner's real situation: tracking started 18 Oct, forecast > spent on 25 Oct) and FC-3 (last day of the month).
- The forecast on the Home budget card, Available cash, the Analytics trend chart and the AI insights is identical (FC-9).
- `DECISIONS.md`: "31 Oct 2026 · One forecast function; missing history excluded, never zero; pace over tracked days · owner bug".
