# Change request: past-dated entries must not move cash in hand, plus the full edge-case register

**Date:** 28 October 2026 · **PRD version:** 1.6

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files.

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. The changes are listed below. |
| `CLAUDE.md` | Two new standing rules: the balance-flag rule, and "walk §18 before closing a milestone". |
| `design/mockups/24-past-expense.html` | **New:** adding a July 2026 flight to the USA trip, before tracking began. |
| `design/mockups/25-reconciled-question.html` | **New:** an expense dated before the account's last reconcile. |
| `design/mockups/20-trip-detail.html`, `21-trip-expenses.html`, `23-trip-bookings.html` | **Updated:** the United booking is now dated 14 Jul 2026 and shows "Not in balance". The trip totals are unchanged. |
| `design/screenshots/` | PNG renders of the five screens above. |

## The owner's rule
"If I booked a flight in July, I should be able to add it, but it should not affect cash in hand. The opening balance is already reconciled with cash in hand."

The rule as specified: **a transaction moves a balance only if it is dated after the moment that balance was last set by the user**. That moment is the account's opening date or its last reconcile, whichever is later. It doesn't matter whether the transaction is logged today, in the future or in the past.

## What changed in the PRD
1. **New §6.2a: Balance anchors and past-dated entries (BAL-01 to BAL-08).**
   - New fields: `counts_in_balance` per transaction (and per transfer side), `balance_flag_source`, `accounts.last_reconciled_on`, `profiles.tracking_started_on`, and the view `account_anchors`.
   - The flag is set automatically by a `set_balance_flags()` trigger:
     - **before the opening date:** neutral, with an inline note;
     - **on the opening date:** counts, with an override toggle;
     - **before or on the last reconcile:** ask "Was this already in your balance?";
     - **after the anchor:** counts.
   - Balances, available cash and `cash_flow` use only flagged rows. **Analytics, trips and AI ignore the flag.**
   - Months before tracking start are "Partial" and excluded from norms. The available-cash scrubber stops at tracking start.
2. **Requirements amended to match:**
   - ACC-01 (the opening balance is as at the moment entered);
   - ACC-05 (reconcile sets the anchor);
   - CASH-01 and CASH-03;
   - REC-03 (bills due before tracking are neutral);
   - TRIP-04a (a trip chip opened from a trip is locked on, so any past date can be used);
   - TRIP-05 (bookings scan widened to **12 months**, since flights are often booked very early).
3. **§10.2a: one list of later schema additions** (`occurred_tz`, `is_reconcile`, `trip_stops.currency`, `category_redirects`), and **SQL invariants 7–9**.
4. **New §18: Edge-case register.** About 80 numbered cases across money, dates and time zones, accounts and balances, capture and sync, categories, bills, trips and currency, analytics and AI, and notifications, PWA and security. Each has the expected behaviour and a section reference. **Every EC- row needs a test named after its ID.** Several rows add small new behaviours; they are marked "(new)" in the Ref column.

## Build notes
- Implement `set_balance_flags()` as a BEFORE INSERT/UPDATE trigger, so every write path is covered: app, offline outbox, Shortcuts, Bills cron and trip bookings.
- Recompute auto flags when an account's opening date or balance changes, or when a reconcile happens. Never touch `'manual'` flags.
- The reconcile question appears in Add expense and in the transaction editor whenever the date or account puts a row on or before the anchor.

## Done when
- The BAL acceptance criteria (§6.2a) and invariants 7–9 pass.
- Every §18 row has a passing test.
- `DECISIONS.md`: "28 Oct 2026 · Balances are true as at entry; earlier-dated rows never move them · owner rule".
