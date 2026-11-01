# Sterling: consolidated handover (PRD v1.7.1, 31 October 2026)

This pack replaces every earlier zip. It contains the complete, current specification and all 37 mock-ups.

## How to apply
1. Unzip at the repository root and let it overwrite `PRD.md`, `CLAUDE.md`, `design/tokens.css`, `design/mockups/` and `design/screenshots/`.
2. **Don't overwrite your own `DECISIONS.md`** if the build has already been recording decisions. Keep yours and ignore the copy in this pack.
3. Give Claude Code this prompt:

> Read HANDOVER.md, then PRD.md and CLAUDE.md. Compare the current codebase with the PRD and list what's missing or different, grouped by milestone (§15). Start with the forecast bug (changes/CHANGE-forecast-fix.md): write tests FC-1 to FC-10, confirm they fail, then fix. Then build milestone M4e (Budgets). After that, close any other gaps you found, oldest milestone first.

## What's new since the build started
| Change | PRD | Mock-ups | Note |
|---|---|---|---|
| **Forecast bug fix:** the forecast must never collapse to "spent so far". One forecast function for every screen, plus a "Why this forecast?" breakdown. | §6.13 BUD-05, BUD-05a | 32 | `changes/CHANGE-forecast-fix.md` |
| **Budgets:** a monthly budget, optional category limits, Home cards, Budget detail, Analytics › Budgets, alerts. | §6.13 | 26–31, plus updated 05, 05c, 06, 07, 10 | `changes/CHANGE-budgets.md` |
| Balance anchors: past-dated entries never move cash in hand. Plus the full edge-case register. | §6.2a, §18 | 24, 25, plus updated 20, 21, 23 | `changes/CHANGE-balance-anchors-and-edge-cases.md` |
| Trips | §6.12 | 17–23 | `changes/CHANGE-trips.md` |
| Bills (recurring payments) | §6.9 | 13–16 | `changes/CHANGE-bills.md` |
| Sub-category analytics | §6.7.1 | 05a–05c | `changes/CHANGE-subcategory-analytics.md` |
| Add expense redesign | §6.3 | 02, 03, 03b, 03c | `changes/CHANGE-add-expense.md` |

Each change note in `changes/` explains what changed and why. The PRD is the source of truth; where a change note and the PRD differ, follow the PRD.

## Figures changed by the forecast engine
Five earlier screens now take their projection from the shared engine:
- Projected close (Available cash, Insights, Desktop): **≈ £3,139** (was £2,940).
- October heading for: **£4,363** (was £5,062).
- Eating out forecast: **£542**.

The seed figures are in PRD Appendix A, A.2 and A.3.

## Mock-up index
| # | Screen | # | Screen |
|---|---|---|---|
| 01 | Home | 17 | Home during a trip |
| 02 | Add expense | 18 | Trips |
| 03 / 03b / 03c | Choose category · search · discard | 19 | New trip |
| 04 | Activity | 20 / 21 | Trip overview · expenses |
| 05 | Analytics (Spending) | 22 | Add expense on a trip ($) |
| 05a / 05b / 05c | By category · by sub-category · category detail | 23 | Earlier bookings |
| 06 | Insights | 24 | Past expense (before tracking) |
| 07 | Available cash | 25 | Expense before a reconcile |
| 08 | Accounts | 26 | Home with budgets |
| 09 | Categories · new | 27 | Budget detail |
| 10 | Desktop | 28 | Set up budgets |
| 11 / 12 | Evening reminder · settings | 29 | Edit a category limit |
| 13 | Bills | 30 | Analytics › Budgets |
| 14 | New recurring payment | 31 | Budget alerts |
| 15 / 16 | Bill detail · notifications | 32 | Why this forecast? |
