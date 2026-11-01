# Change request: Bills (recurring payments logged automatically)

**Date:** 25 October 2026 · **PRD version:** 1.4 · **Scope:** a new feature, promoted from v1.1 into the MVP.

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files.

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. **§6.9 Bills and recurring payments** (REC-01 to REC-09) replaces the old "Recurring rules" section. It includes the new data model, which replaces `recurring_rules`, ten acceptance criteria, and the new milestone **M4c**. It also updates the cron table, screen inventory, NOT-03 and assumption A4. All earlier changes (v1.2 add expense, v1.3 sub-category analytics) are still included. |
| `design/mockups/13-bills.html` | **New:** Bills overview with the month calendar. |
| `design/mockups/14-new-recurring.html` | **New:** New / Edit recurring payment. |
| `design/mockups/15-bill-detail.html` | **New:** Bill detail (a bill whose amount varies). |
| `design/mockups/16-bill-notification.html` | **New:** morning notifications. |
| `design/screenshots/` | PNG renders of the four screens. |

## What the owner asked for
"A place where I can set up recurring payments and the day of the month that they are charged. Each month, on that day, those transactions should be logged accordingly."

## What to build
Read PRD §6.9 for the full rules. In short:

1. **Bills screen**, opened from a card on Home, from Settings and from the desktop sidebar. It has:
   - a summary of this month's bills, logged vs to come;
   - a month calendar with dots on due days;
   - "Coming up" and "Logged this month" lists.
2. **New / Edit recurring payment.** Choose expense, income or transfer; amount (fixed or varies); payee; leaf category; account; frequency (monthly by default); **day of the month** (1–31 or Last day); first payment; end; weekend/bank-holiday rule; and auto-log vs remind.
3. **Auto-logging engine.** An hourly cron acts at 06:00–06:59 London time. It creates one ordinary transaction per due occurrence and is idempotent (unique per rule and scheduled date). It also:
   - catches up any missed days;
   - moves days 29–31 to the last day in short months;
   - optionally moves weekend and bank-holiday dates to the next working day (using the gov.uk bank holidays feed);
   - logs varying amounts as estimates to confirm.
4. **Bill detail.** Shows the next payment and offers Skip next, Pause and Edit. It also has a 6-payment history chart and Stop (which keeps past transactions).
5. **Notifications.** A morning summary of what was logged, a "confirm amount" notification for varying bills, and "due today" for remind-mode payments.
6. **Suggestions.** Repeating payees are detected and offered as one-tap bills.
7. **Duplicate guard.** Adding a manual expense to a payee that's billed automatically within ±3 days asks first.

## Suggested build order
1. **Start with tests.** Write `/lib/recurrence.ts` → `nextOccurrences(item, from, to)` and its unit tests first. They cover month-ends, leap years, quarterly, yearly on 29 Feb, weekly, the BST changes, and bank holidays. Everything else depends on this function.
2. Migration: `recurring_items`, `recurring_occurrences`, `bank_holidays`, `transactions.is_estimate`, RLS and SQL tests.
3. Cron engine `/api/cron/recurring` with idempotency and catch-up tests. Use a fake clock so the tests are deterministic.
4. UI: Bills overview → New/Edit form → Bill detail → Home card.
5. Notifications, then detection and suggestions, then the duplicate guard.

## Done when
- All ten acceptance criteria in §6.9 pass.
- A visual check against the four screenshots at 390 px.
- The decision is recorded in `DECISIONS.md`: "25 Oct 2026 · Bills promoted to MVP; occurrences auto-logged at 06:00 London · owner request".
