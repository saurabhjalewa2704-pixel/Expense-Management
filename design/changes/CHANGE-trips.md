# Change request: Trips

**Date:** 28 October 2026 · **PRD version:** 1.5 · **Scope:** a new MVP feature, plus small changes to Add expense, Analytics and Home.

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files.

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. It adds the new **§6.12 Trips** (TRIP-01 to TRIP-10, data model, ten acceptance criteria), **Appendix A.2** (USA trip seed data), milestone **M4d**, two cron jobs, the scope row and screen inventory S17–S23. All earlier changes (v1.2–v1.4) are included. |
| `design/mockups/17-trip-home.html` … `23-trip-bookings.html` | **New:** 7 screens: Home during a trip, Trips list, New trip, Trip overview, Trip expenses, Add expense in dollars, Attach earlier bookings. |
| `design/screenshots/` | PNG renders of the seven screens. |

## Decisions the owner confirmed
- **Tagging:** automatic during the trip dates, with a per-expense untag.
- **Pre-trip costs:** flights and hotels booked earlier can belong to the trip; they're shown as "Booked before".
- **Currency:** enter in local currency, converted to £ at the day's rate; both amounts are stored and £ stays editable.
- **Budget:** optional trip budget, with an optional per-category breakdown.

## What to build
Read PRD §6.12. In short:
1. **Trips:** name, country, currency, date range (no overlapping trips), optional stops (cities), optional budget, and an auto-add toggle.
2. **Auto-tagging:**
   - Expenses dated inside an active trip get `trip_id` automatically. A green trip chip in Add expense and the transaction editor untags or moves them.
   - Bills, transfers and income are never auto-tagged.
   - During a trip, the top-category tiles rank by that trip's usage.
3. **Earlier bookings:** after creating a trip, a sheet offers untagged travel expenses from the previous 180 days. They stay in the months they were paid.
4. **Foreign currency:**
   - Add expense opens in the trip currency with a live "≈ £" line; a currency chip switches to £.
   - Stored fields: `amount_pence` (the source of truth) plus `original_amount_minor`, `original_currency`, `fx_rate`, `fx_rate_on` and `fx_source`.
   - Rates come from Frankfurter (ECB), cached daily, with an optional card fee per account. Offline entries are recalculated on sync unless the £ amount was edited.
5. **Trip overview:**
   - a timeline;
   - spent vs budget (booked before / on the trip);
   - the daily allowance;
   - daily bars with a planned line;
   - by stop;
   - "Where it went" (sub-categories by default);
   - AI insights scoped to the trip, plus a wrap-up the day after it ends.
6. **Trip expenses tab:** grouped by day with stop names, then "Booked before"; £ with the original amount underneath; swipe to "Remove from trip".
7. **Monthly integration:**
   - Trip expenses count normally in every monthly figure.
   - **Norms exclude trip expenses.**
   - Analytics gets an "Exclude trips" switch.
8. **Home card:** shown during a trip, up to 14 days before it, and for 7 days after (wrap-up).

## Suggested build order
1. `/lib/fx.ts` and `/lib/tripMath.ts`, with unit tests. Use decimal.js and never floats; round half-even.
2. Migration (`btree_gist` for the no-overlap rule), RLS and SQL tests, then the new trip SQL functions and `p_exclude_trips`.
3. FX cron and client rate cache.
4. Auto-tagging in every capture path (manual, natural-language, Shortcuts, favourites) and the trip chip.
5. Trips list → New/Edit trip → Trip overview → Expenses tab → earlier-bookings sheet → Home card.
6. Trip insights and wrap-up, "Exclude trips", and norm exclusion.

## Done when
- All ten acceptance criteria in §6.12 pass against the Appendix A.2 seed.
- A visual check against the seven screenshots at 390 px.
- `DECISIONS.md`: "28 Oct 2026 · Trips added to MVP; auto-tag on, bookings attachable, local-currency entry with stored FX, optional budget · owner decisions".
