# Sterling: Product Requirements Document

**A personal expense manager for one person, in pounds, designed to be used one-handed on an iPhone.**

| | |
|---|---|
| Version | 1.6 (balance anchors for past-dated entries; full edge-case register §18) |
| Date | 18 October 2026 |
| Owner | Saurabh (product owner and only user) |
| Builder | Claude Code |
| Stack | Next.js on Vercel · Supabase (Postgres, Auth, Storage, Edge) · Claude API |
| Mock-ups | `design/mockups/*.html` (11 screens) and the Sterling design canvas |

"Sterling" is a working name. Changing it touches only `app/manifest.ts`, the
`APP_NAME` constant and the wordmark, so it is cheap to rename later.

---

## 0. How Claude Code should use this document

1. Read sections 1–5 for intent and scope, then **section 15 (Build plan)** for the order of work.
2. Treat the **numbered requirements** (`CAP-03`, `CASH-02` …) as the contract. Every requirement has acceptance criteria; a milestone is done when all of its criteria pass.
3. Treat the **HTML mock-ups as the visual source of truth.** Lift the CSS custom properties in `design/tokens.css` verbatim into the Tailwind theme. Where a mock-up and this document disagree on *behaviour*, this document wins. Where they disagree on *appearance*, the mock-up wins.
4. **Money is integer pence, always.** No floats anywhere in storage, arithmetic or API payloads. Section 10.1 explains why.
5. **Never store a derived balance.** Balances and available cash are computed from transactions by the SQL functions in section 10.4. Editing a transaction from March must correct every figure after March, and caching would break that.
6. When something here is ambiguous, choose the option that makes **logging an expense faster** and note the choice in `DECISIONS.md`.
7. **Check the edge-case register (§18) before finishing any milestone.** Every `EC-` row is a requirement and needs at least one test named after its ID.

---

## 1. Product summary

### 1.1 The problem
Bank apps tell you what has already happened, one account at a time. They do not give you
one honest figure for "how much cash do I actually have this month", and they make no
judgement about whether this month is going well. Spreadsheets can do both, but logging a
£3.40 coffee into a spreadsheet on a phone is miserable, so the data rots within a fortnight.

### 1.2 The product
Sterling is a private, single-user money journal with three jobs:

1. **Capture**: logging a spend takes three taps and under five seconds, works offline, and learns your habits.
2. **Know**: one trustworthy number, *available cash*, explained by a simple equation you can audit:
   `Opening cash + Income − Spend = Available cash`.
3. **Understand**: reporting and AI insights that read like a sharp private banker's note, not a dashboard of pie charts.

### 1.3 Design principles (in priority order)
1. **Speed of capture beats richness of data.** Every optional field is skippable; defaults are learned.
2. **One number, explained.** The hero figure must always be traceable to the transactions behind it.
3. **Calm, not alarming.** Spending is shown in ink, not red. Colour is reserved for meaning (income, warnings).
4. **Thumb-first.** Primary actions live in the bottom 40% of the screen. Sheets beat new pages.
5. **Honest AI.** The AI narrates numbers that the system computed; it never invents them (section 12.4).
6. **Quiet luxury.** Apple-grade restraint: generous space, precise type, tabular figures, no decoration that carries no information.

---

## 2. Decisions already made

| Topic | Decision | Consequence |
|---|---|---|
| Data entry | **Manual only.** No bank feeds, no CSV import. | Capture UX is the most important part of the product. Accounts need a *reconcile* flow, because manual balances drift. |
| Users | **Single user.** | One `auth.users` row matters; RLS still scopes every row to `auth.uid()` (defence in depth, and future-proofing). No sharing, roles or households. |
| Currency | **GBP only.** | No FX tables. Format with `en-GB` / `£`. Foreign spending is entered in the pounds the card actually charged. |
| Available cash | **Opening cash + income − total spend of the month.** | Implemented exactly; see section 6.5 for the edge cases (transfers, credit cards, savings). |
| Appearance | **Dark mode only.** | One theme: no light theme, no System/Light/Dark setting. Tokens are defined once (section 14). |
| Platforms | Web and mobile, **mobile-optimised**. | Delivered as one installable **PWA** (Next.js on Vercel). No App Store app in v1 (section 9.6). |
| Infrastructure | Supabase + Vercel. | Postgres functions do the financial maths; Vercel route handlers do AI calls and cron. |

---

## 3. User and core jobs

**Primary user:** Saurabh, a London-based professional who pays mostly by card (one or more
current accounts plus a credit card), keeps some money in savings, travels, and wants a
calm, premium tool he enjoys opening. He uses it mostly on iPhone, and reviews trends on a
laptop now and then.

| # | Job to be done | Frequency | Primary surface |
|---|---|---|---|
| J1 | "I just paid for something, so log it before I forget." | 3–8× per day | Add expense screen (mobile) |
| J2 | "I got paid or refunded, so log the income." | 2–6× per month | Quick Add → Income |
| J3 | "How much can I actually spend?" | Daily | Home hero |
| J4 | "Am I spending more than usual, and on what?" | Weekly | Analytics, Insights |
| J5 | "Where did the money go this year?" | Monthly / quarterly | Analytics (web or mobile) |
| J6 | "My app balance doesn't match the bank, so fix it." | Weekly to monthly | Account → Reconcile |
| J7 | "Set up my own categories the way I think." | Occasionally | Settings → Categories |

---

## 4. Scope

Priority key: **P0** = MVP (must ship), **P1** = v1.1 (next), **P2** = later or nice to have.

| Area | P0, MVP | P1, v1.1 | P2, later |
|---|---|---|---|
| Accounts | Create, edit, archive; types; opening balance; include in cash pool; per-account balance | Reconcile flow with adjustment entries | Account icons and custom colours |
| Capture | Quick Add (expense / income / transfer), smart category suggestions, payee memory, offline queue, edit, delete with undo | Natural-language entry ("28.50 dishoom amex"), favourites (one-tap templates), iOS Shortcuts endpoint | Receipt photo → AI extraction; split a transaction across categories |
| Categories | 12 default parent categories with sub-categories; create, rename, re-icon, reorder, archive, merge | Category budgets | Category rules (payee → category automation beyond learning) |
| Available cash | Hero figure, equation breakdown, as-at any date, per-account contribution | Month-end projection | Pay-cycle months (for example the 25th to the 24th) |
| Activity | Grouped list, search, filters (category, account, type, date range, amount) | Bulk recategorise, tags | Saved filters |
| Analytics | Pace chart, category breakdown with drill-down, cash-flow waterfall, 12-month trend, daily heatmap, top payees, period compare | Budget vs actual, savings rate | PDF monthly statement |
| AI insights | Weekly and monthly digests (structured cards), on-demand refresh, feedback (helpful / dismiss) | "Ask Sterling" chat over your data; anomaly push alerts | Goal coaching |
| Bills & recurring | Recurring payments by day of month, auto-logged at 06:00 on the due day; bills calendar; detection suggestions (§6.9) | n/a | n/a |
| Trips | Trips with dates, stops and an optional budget; automatic tagging; earlier bookings; foreign-currency entry with conversion; trip overview, expenses, analytics and AI insights; "Exclude trips" in Analytics (§6.12) | Split trip costs with a companion | Shared trips |
| Platform | Installable PWA, dark-only UI, desktop layouts, email-code sign-in, **evening reminder notification** (NOT-01) | Face ID app lock (WebAuthn), other push notifications (NOT-02 to NOT-04), privacy blur | Capacitor iOS wrapper, widgets |
| Data | Export CSV / JSON | Scheduled backup e-mail | n/a |

### 4.1 Explicit non-goals
- Bank connections, Open Banking, or CSV import (a deliberate decision, not just deferred work).
- Multi-currency or FX.
- Investments, pensions, net-worth tracking beyond the accounts listed.
- Multiple users, sharing, or household splitting.
- Financial advice. The AI may observe and suggest behavioural changes ("eating out is up 38%"), but must never recommend financial products, investments or trades.

---

## 5. Information architecture

### 5.1 Mobile navigation (bottom tab bar, 5 slots)

```
┌──────────┬──────────┬────────┬───────────┬──────────┐
│  Home    │ Activity │   ＋   │ Analytics │ Insights │
└──────────┴──────────┴────────┴───────────┴──────────┘
```

- **Home**: available cash hero, month flow, pace, top insight, recent activity.
- **Activity**: every transaction, searchable and filterable.
- **＋** (centre, raised, ink-black disc): opens Quick Add as a bottom sheet from *any* tab. A long press opens Favourites (P1).
- **Analytics**: charts and reports.
- **Insights**: AI cards; "Ask Sterling" (P1) sits at the bottom of this tab.
- **Settings** is reached from the avatar at the top right of Home. It holds Accounts, Categories, Bills, Reminders, Export, Security and About.

### 5.2 Desktop navigation (≥1024 px)
A left sidebar (Home, Activity, Analytics, Insights, Accounts, Categories, Settings) with a
persistent **"Add transaction"** button (keyboard shortcut `N`). Content uses a 12-column grid,
max-width 1360 px. Quick Add opens as a centred modal (480 px) rather than a sheet.

### 5.3 Screen inventory (each has a mock-up)

| ID | Screen | Mock-up file |
|---|---|---|
| S1 | Home | `01-home.html` |
| S2 | Add expense (full-screen) | `02-quick-add.html` |
| S2a | Add expense: closing with unsaved input | `03c-discard.html` |
| S3 | Choose category (whole hierarchy) | `03-category-picker.html` |
| S3a | Choose category: search | `03b-category-search.html` |
| S4 | Activity | `04-activity.html` |
| S5 | Analytics (long scroll) | `05-analytics.html` |
| S5a | Analytics: Where it went, by category | `05a-analytics-categories.html` |
| S5b | Analytics: Where it went, by sub-category | `05b-analytics-subcategories.html` |
| S5c | Category detail (Eating out) | `05c-category-detail.html` |
| S6 | Insights (AI) | `06-insights.html` |
| S7 | Available cash detail | `07-available-cash.html` |
| S8 | Accounts | `08-accounts.html` |
| S9 | Categories + New category sheet | `09-categories.html` |
| S10 | Desktop dashboard | `10-desktop.html` |
| S11 | Evening reminder notification (lock screen, expanded with actions) | `11-reminder.html` |
| S12 | Settings → Reminders (toggle, time, week view) | `12-reminder-settings.html` |
| S13 | Bills: overview with month calendar | `13-bills.html` |
| S14 | New / Edit recurring payment | `14-new-recurring.html` |
| S15 | Bill detail (varying amount) | `15-bill-detail.html` |
| S16 | Bills logged: morning notifications | `16-bill-notification.html` |
| S17 | Home during a trip | `17-trip-home.html` |
| S18 | Trips list | `18-trips.html` |
| S19 | New / Edit trip | `19-new-trip.html` |
| S20 | Trip overview | `20-trip-detail.html` |
| S21 | Trip expenses | `21-trip-expenses.html` |
| S22 | Add expense on a trip (foreign currency) | `22-trip-add-expense.html` |
| S23 | Attach earlier bookings | `23-trip-bookings.html` |
| S24 | Add a past expense (before tracking began) | `24-past-expense.html` |
| S25 | Expense dated before a reconcile: question sheet | `25-reconciled-question.html` |

---

## 6. Functional requirements

### 6.1 Onboarding and authentication

**AUTH-01 Sign-in with an e-mailed 6-digit code (P0).**
Use Supabase Auth email OTP *codes*, not magic links. Magic links opened from Mail on iOS open
in Safari rather than in the installed PWA. The PWA has separate storage from Safari, so the user
would never actually get signed in. Codes avoid this entirely.
- Accept: entering the e-mail sends a code; a correct code signs in and lands on Home; a wrong code shows an inline error; sessions persist for at least 30 days on the installed PWA (refresh tokens).
- Accept: only the owner's e-mail can sign in. Disable public sign-ups in Supabase and set the allow-list via the env var `ALLOWED_EMAIL`, checked in a server action before the OTP is sent.

**AUTH-02 First-run setup (P0).** A three-step flow, every step skippable except step 1:
1. *Your accounts*: add at least one account, with name, type and current balance (as of today).
2. *Categories*: "We've set up 12 categories for you" preview, with the option to edit later.
3. *Install*: on iOS Safari, show the Add-to-Home-Screen instruction card (Share → Add to Home Screen). Detect with `navigator.standalone`.
- Accept: on completion a profile row exists, the default categories are seeded (section 10.5), and Home shows the correct available cash immediately.

**AUTH-03 App lock with Face ID (P1).** Register a WebAuthn platform credential (`@simplewebauthn/browser` + server verification in a route handler). When the app returns to the foreground after more than 5 minutes (configurable: 1, 5, 15 minutes or never), show a lock screen that requires Face ID. This lock sits on top of the Supabase session and does not replace it.

### 6.2 Accounts

**ACC-01 Create and edit an account (P0).** Fields: name (required, ≤40 chars), institution (optional free text), type (`current`, `savings`, `credit_card`, `cash`, `other`), current balance and as-of date (default today), and **"Counts towards available cash"** (default **on** for current, cash and credit card; **off** for savings). Credit card balances are entered as the amount owed and stored as a negative number. The as-of date becomes the account's `opening_date`: the balance is taken **as at the moment it is entered**, so anything dated earlier is already reflected in it (§6.2a).
- Accept: the balance after creation equals the entered balance exactly; credit card shows "−£1,184.73 owed".

**ACC-02 Default account (P0).** One account is the default for Quick Add. After 3 consecutive manual changes to the same other account, the default switches to that account silently, and Settings shows which account is the default.

**ACC-03 Archive (P0).** Archived accounts disappear from pickers and from the cash pool from the archive date onward. Historical transactions remain. An account can be archived only when its balance is £0, or the user confirms "write off remaining balance", which creates an adjustment.

**ACC-04 Account detail (P0).** Shows the balance, a 90-day balance sparkline, the transactions list filtered to the account, and Edit / Reconcile / Archive actions.

**ACC-05 Reconcile (P1, but schema in P0).** "What does your bank app say?" The user types the real balance; Sterling shows the difference and, on confirm, creates an `adjustment` transaction (type `adjustment`, signed) dated today with the note "Balance adjustment". Adjustments:
- *are* included in balances and available cash;
- are *excluded* from spend and income analytics (they are corrections, not behaviour);
- are listed in Activity with a distinct "Adjustment" label.
- The reconcile date becomes the account's **balance anchor** (BAL-01). It is stored in `accounts.last_reconciled_on`. The adjustment row, created only when there is a difference, carries `is_reconcile = true`. A £0 difference still updates the anchor (EC-A10).
- Accept: after reconciling, the account balance equals the typed balance to the penny.

### 6.2a Balance anchors and past-dated entries (P0)

**Owner's rule (28 Oct 2026).** You can record an expense from before you started using Sterling, such as a flight booked in July for a trip next March. It must **not** change cash in hand, because the opening balance already reflects it.

**The general principle:** a transaction changes a balance only if it happened *after* the moment that balance was last set by the user. It doesn't matter whether it's logged in the future or the past.

Mock-ups: `24-past-expense.html` (an expense before tracking began) and `25-reconciled-question.html` (an expense dated before a reconcile).

**BAL-01 Balance anchor.**
- Every account has a **balance anchor date**: the date on which the user last told Sterling the true balance.
- `anchor_on = max(accounts.opening_date, latest reconcile date for that account)`.
- `opening_date` is the "as of" date entered with the opening balance (ACC-01). A reconcile (ACC-05) sets a new anchor.
- **Tracking start** = the earliest `opening_date` across non-archived accounts. It is stored as `profiles.tracking_started_on` and maintained by a trigger.

**BAL-02 What counts in a balance.** Each transaction has `counts_in_balance` (plus `counter_counts_in_balance` for the receiving side of a transfer).
- **Only rows with the flag true** are used by `account_balances`, `available_cash` and `cash_flow`.
- **Analytics ignore the flag**, as do trips, category totals, budgets and AI facts. A July flight is real July spending even though it doesn't move today's cash.
- **Adjustments** always count in the balance.

**BAL-03 Setting the flag automatically** (when the transaction is created, or when its date, account or type changes):

| Transaction date vs the account's anchor | Flag | User sees |
|---|---|---|
| **Before `opening_date`** (before Sterling knew this account) | `false`, no question | Inline note in Add expense: "Before you started tracking (18 Oct). Your opening balances already include this, so it won't change available cash. It still counts in July's spending." (`24-past-expense.html`) |
| **On `opening_date`** | `true` | Add expense shows a small toggle, "Already included in my opening balance" (off by default). The opening balance is taken as at the moment it was entered, so earlier same-day spending is ambiguous. |
| **After `opening_date` but before or on the latest reconcile date** | Ask (`25-reconciled-question.html`) | "Was this already in your Monzo balance?" **Yes, it had already left my account** → `false` (default). **No, it was still pending** → `true`. |
| **After the anchor** | `true` | Nothing extra. |

- `balance_flag_source` records `'auto'` or `'manual'`.
- **Recalculating:** if the date, account or anchor later changes, auto flags are recomputed. Manual answers are kept, unless the transaction moves to a different account, in which case the question is asked again for that account.

**BAL-04 Transfers.** Each side is judged against its own account's anchor.
- Example: a transfer from Monzo (anchor 18 Oct) to Amex (anchor 1 Nov), dated 25 Oct. The Monzo side counts; the Amex side is asked about.
- Pre-tracking transfers on both sides are fully neutral.
- Transfers never affect analytics.

**BAL-05 Display.**
- Rows with `counts_in_balance = false` show a small "Not in balance" caption under the amount in Activity, trip lists and account detail. They are never hidden.
- The transaction editor shows a row "Affects balance: No · before tracking began" (or "· already in reconciled balance"), with a switch to override (sets `balance_flag_source = 'manual'`).

**BAL-06 Effects on available cash and its equation.**
- `cash_flow` counts only balance-affecting rows. The hero's "Out" can therefore differ from the month's Analytics spend.
- When the month contains non-balance spending, the Available cash screen (S7) shows a footnote: "£176.20 of July spending was paid before you started tracking. It's in Analytics, not in this figure."
- The available-cash scrubber (CASH-03) and the "as at" date picker **stop at tracking start**, with the message "Sterling started tracking on 18 Oct". There are no balances before that date.

**BAL-07 Effects on analytics and insights.**
- **Months before tracking start are partial.** They contain only what you chose to back-fill. Analytics shows them with a "Partial: before tracking" label, and they are **excluded from norms**, pace comparisons and AI anomaly baselines (the same treatment as trip spending in TRIP-09).
- **The month containing tracking start** counts towards norms only from its tracking-start day onwards.
- **Pace (CASH-05):** if the comparison month is partial, the pace bar shows "Not enough history yet" instead of a misleading comparison.

**BAL-08 Interaction with other features.**
- **Bills (§6.9):**
  - A recurring payment whose first occurrence falls before an account's `opening_date` (for example, rent due on the 1st when you start on the 18th) is logged with `counts_in_balance = false` and the caption "Already in your opening balance".
  - The catch-up prompt (REC-03) says this explicitly: "Rent was due on 1 Oct, before you started tracking. Log it for your records? It won't change your balance."
  - The cron never creates occurrences before `starts_on`.
- **Trips (§6.12):**
  - Past bookings can be added to a trip from the trip's **Add to ‹trip›** button, which opens Add expense with the trip chip **locked on** and any date allowed (TRIP-04a).
  - The earlier-bookings scan looks back **12 months** (TRIP-05).
  - FX for a past date uses that date's historical rate (Frankfurter provides history).
- **Refunds of pre-tracking purchases** are income received after tracking began. They count in the balance, and can be linked to the trip or category of the original.
- **Reconcile with past-dated items:** reconciling after back-filling never "double-corrects", because non-balance rows are excluded from the balance that the reconcile compares against.
- **Changing an account's opening date or balance** recomputes every auto flag for that account and shows how many changed ("3 earlier expenses now count in this balance").

**Data model additions.**
```sql
alter table transactions
  add column counts_in_balance         boolean not null default true,
  add column counter_counts_in_balance boolean,                       -- transfers only
  add column balance_flag_source       text not null default 'auto' check (balance_flag_source in ('auto','manual')),
  add constraint counter_flag_for_transfers check ((type = 'transfer') = (counter_counts_in_balance is not null));

alter table profiles add column tracking_started_on date;             -- maintained by trigger on accounts

alter table accounts add column last_reconciled_on date;            -- set by every reconcile, even with no difference

create view account_anchors as
  select id as account_id, greatest(opening_date, coalesce(last_reconciled_on, opening_date)) as anchor_on
  from accounts;
```

- The flag is set by a **BEFORE INSERT/UPDATE trigger** (`set_balance_flags()`) that applies BAL-03 and BAL-04 for `'auto'` rows. Clients may send `balance_flag_source = 'manual'` with an explicit value (the answer to the reconcile question).
- Every reconcile sets `accounts.last_reconciled_on`. The adjustment row (only when there is a difference) also carries `is_reconcile = true`, for display.

**Acceptance criteria.**
1. With tracking start 18 Oct 2026, adding "United £176.20, 14 Jul 2026" changes no account balance and no available cash at any date. It does appear in July spend by category, in USA's total, and in Activity with "Not in balance".
2. Adding a £42.80 Monzo expense dated 30 Oct, after a reconcile on 1 Nov, asks the question. "Yes" leaves the Monzo balance unchanged; "No" reduces it by £42.80.
3. An expense dated 20 Oct (after opening, no later reconcile) reduces available cash immediately.
4. Changing a past-dated expense's date to after the anchor flips an auto flag to true and changes the balance. A manual flag is kept.
5. The available-cash scrubber cannot go before tracking start.
6. July 2026 is labelled "Partial: before tracking" in Analytics and is excluded from norms. Norms for November use only data from 18 Oct onwards.
7. Rent due on 1 Oct, logged through the Bills catch-up, has `counts_in_balance = false`. Rent due on 1 Nov has `true`.
8. Invariants 7–9 (§10.4) pass.

### 6.3 Capture: the most important feature

**Target:** median time to log an expense ≤ **5 seconds**. Common case with a known payee:
＋ → amount → **Add** (the category is pre-selected). Otherwise: ＋ → amount → tile → Add, and any
sub-category not in the tiles is two taps away. The Add expense screen must appear in under
**100 ms** after tapping ＋, so it must be pre-rendered and kept mounted, not lazily loaded.

**CAP-01 Add expense screen (P0).** See mock-ups `02-quick-add.html` (screen), `03c-discard.html` (closing with unsaved input).

*Presentation.* Add expense is a **full-screen modal**, not a bottom sheet. It slides up over the current tab (280 ms spring) and is pre-mounted so it appears in under 100 ms. On desktop (≥1024 px) it is a centred 480 px modal with the same content.

*Closing.*
- A **Close (✕) button** sits top-left: 44 × 44 pt hit area, `aria-label="Close"`. `Esc` does the same on desktop, and so does the browser or Android back action.
- If nothing has been entered yet, Close dismisses immediately.
- If an amount, payee or note has been entered, Close shows an action sheet: "**Discard this expense?** £12.80 at Gail's Bakery hasn't been added yet." The options are **Discard** (destructive) and **Keep editing**.
- There is **no swipe-to-dismiss**, so a stray gesture can't lose an entry. On desktop, clicking the backdrop does nothing.

*Layout, top to bottom.*
1. **Top bar:** Close (✕) on the left, the title "New expense" centred. The title changes to "New income" or "New transfer" with the segment.
2. **Segmented control:** Expense · Income · Transfer. Expense is the default.
3. **Amount:** large tabular figure with a `£` prefix and a blinking caret; it starts at `£0`.
4. **Payee field:** placeholder "Where?", with autocomplete from `payees`. When the payee has history, it shows a "Remembered" tag.
5. **"Your top categories":** a section label, with an **All categories ›** link on the right (44 pt tall).
6. **Top-category grid:** 2 columns × 3 rows = **6 tiles** (CAP-01.1).
7. **Meta row:** chips for the account, date ("Today"; tap for Yesterday or a date picker) and note.
8. **Custom keypad:** 3 × 4 keys, `1–9 . 0 ⌫`, each at least 44 pt tall.
9. **Primary button:** "Add £12.80". It is disabled until the amount is greater than 0 and a category is selected.

*Tile anatomy.*
- **The tile shows the category's lowest level.** Its first line is the sub-category name in Body Medium, 14 px. Its second line names the parent in 12 px tertiary text ("Coffee & snacks" / "Eating out").
- If a transaction is assigned to a parent directly, the tile shows the parent name, with "General" as the caption.
- A 18 px line icon sits on the left. Long names truncate with an ellipsis; tiles never wrap.
- The selected tile is inverted (ink background, `on-ink` text) and has `aria-pressed="true"`.

*Behaviour.*
- **Tapping a tile selects it; it never saves.** Saving always happens with the Add button. There is no "tap category to save" shortcut, so nothing is saved by surprise.
- When the payee has a learned category, that category is **pre-selected**. The fastest path is then ＋ → type the amount → Add.
- When a category is chosen in **All categories** and it is not among the six tiles, it temporarily takes the **sixth slot**, selected, for this entry only.
- On save, the screen closes and a toast reads "Added £12.80 · Coffee & snacks" with **Undo** (6 s). The Home hero then animates to its new value.
- Amount rules: at most 2 decimal places, at most £999,999.99. A leading "." becomes "0.", and a long-press on ⌫ clears the amount.
- **Income:** the grid shows the top 6 income categories. They are single-level, so there is no caption, and "All categories" lists all income categories.
- **Transfer:** the grid and its label are replaced by **From** and **To** account pickers.

*Acceptance criteria.*
- ✕ is visible and works in every state.
- Discarding a dirty entry requires the confirmation; closing an empty one doesn't.
- Every tile shows a leaf-level name with its parent caption.
- A known payee pre-selects its category, and Add saves with no extra tap.
- Choosing "Pharmacy" from All categories shows a selected "Pharmacy / Health" tile in slot 6.

**CAP-01.1 Top categories (P0).** Replaces the earlier time-of-day scoring formula.
- **Ranking:** count expenses per `category_id` (leaf or parent, whichever the user actually assigned) over the **last 90 days**. Ties go to the most recently used. Archived categories are excluded.
- **Stable order:** the ranking is recomputed **once a day** (on first open after 04:00 London time) and cached. It does not reshuffle while you're using the app, so tiles stay where your thumb expects them.
- **Cold start (fewer than 20 expenses):** use Supermarket, Coffee & snacks, TfL & rail, Restaurants, Online & general, Takeaway & delivery. Fill any gaps from this list once some real categories rank.
- **Payee-learned category:** if it's already among the six, just select it. If it isn't, it takes slot 6 for this entry. The order never shifts.
- **Offline:** the ranking is computed client-side from cached transactions.

**CAP-01.2 All categories picker (P0).** See mock-ups `03-category-picker.html` and `03b-category-search.html`.

*Navigation.* Opened from "All categories ›", it **pushes** within the modal (slides in from the right). The top bar has **‹ Back** (returns with the selection unchanged), the title "Choose category", and **＋ New** on the right.

*The whole hierarchy on one screen.*
- Every parent appears as a section header: icon, name in 13 px caps, and a count.
- **All of its sub-categories are listed directly beneath**, so nothing needs expanding or drilling into.
- The last row of each section is "Other ‹parent›" (for example "Other eating out"). It assigns the **parent** category itself.
- **One tap on any row selects that category and returns** to Add expense, with that tile selected.
- Sections follow the user's `sort_order` from Settings → Categories, and sub-categories follow theirs.

*Jump strip.*
- Below the search field sits a sticky, horizontally scrolling row of parent chips.
- Tapping a chip scrolls its section to the top.
- The chip for the section in view is highlighted.

*Current selection.* It shows a check and medium weight. On open, the list scrolls so that row is visible, and its parent's chip is highlighted.

*Search.*
- The field reads "Search all N categories" and matches **both levels**. Matching is case- and accent-insensitive and accepts a word prefix or any substring.
- Results become a flat list: icon, the sub-category name with the matched characters in bold, and the parent beneath.
- If the query matches a parent's name, that parent's sub-categories and its "Other ‹parent›" row are listed.
- A final row reads **Create "‹query›"**. It opens New category (CAT-03) with the name pre-filled and a parent picker.
- With no matches, only the Create row shows.

*Creating.* Both ＋ New and Create open New category. After it's created, the new category is selected and the user returns straight to Add expense.

*Accessibility.* Rows are real `<button>`s. The selected row has `aria-current="true"`, section headers are `<h2>`, and the jump strip is a `nav` with `aria-label="Jump to category group"`.

*Acceptance criteria.*
- Any sub-category can be selected with **two taps** from Add expense: All categories → row.
- Typing "tax" shows Taxis (Transport) and Council tax (Home).
- Back leaves the earlier selection unchanged.
- The list works offline from the cached categories.

**CAP-02 Income (P0).** Same sheet, **Income** segment. The chips show income categories (Salary, Bonus, Interest, Refund, Freelance, Gift, Other). The account defaults to the account that last received income. The button reads "Add income £…", and the amount renders in the positive colour.

**CAP-03 Transfer (P0).** **Transfer** segment: **From** and **To** account pickers, no category. Paying a credit card bill = transfer from current account → credit card. Transfers never count as spend or income.
- Accept: a £500 transfer from Monzo to Amex leaves available cash unchanged (both accounts are in the pool) and changes both account balances by £500.

**CAP-04 Edit and delete (P0).** Tapping any transaction opens the same screen pre-filled, titled "Edit expense". Delete is at the bottom (destructive, with confirm). Swipe-left on a row reveals Delete; swipe-right reveals Duplicate. Every edit updates `updated_at`; all figures recompute.

**CAP-05 Offline capture (P0).** Quick Add must work with no signal (for example on the Underground).
- Writes go to an IndexedDB **outbox** (Dexie) with a client-generated `client_id` (UUID v7). They are optimistically shown in all views, marked with a small "waiting to sync" glyph.
- Flush the outbox when the app comes back online (`online` event), when it regains focus (`visibilitychange`), and on launch. **Do not rely on the Background Sync API**, which iOS Safari does not support.
- The server upserts on `client_id` (unique), so retries are idempotent.
- Accept: in airplane mode, log 3 expenses, kill the app, reopen it online, and exactly 3 rows exist in Postgres.

**CAP-06 Natural-language entry (P1).** The payee field accepts free text such as `28.50 dishoom dinner amex yesterday`. A local parser runs first (regex for the amount, date words, and fuzzy match of account names and known payees). If confidence is below 0.8, call `/api/parse` (Claude Haiku, structured output; section 12.2) and pre-fill the Add expense screen. **It never auto-saves**: the user always sees the filled form and taps Add.

**CAP-07 Favourites (P1).** Pin up to 8 templates (payee + category + account + optional amount). Long-press ＋ opens a favourites grid; tapping a favourite with an amount saves instantly with Undo, and tapping one without an amount opens Quick Add pre-filled.

**CAP-08 iOS Shortcuts capture endpoint (P1).** `POST /api/v1/capture` authenticated by a personal API token (Settings → Shortcuts → Create token; only a hash is stored). The body is `{amount, payee?, category?, account?, note?, occurred_at?}`. A downloadable Shortcut template is provided, which enables:
- "Hey Siri, log an expense" (dictated amount and payee);
- **Wallet tap automation**: the Shortcuts *Transaction* automation (iOS 17+) can pass the amount and merchant when an Apple Pay card is tapped, then call this endpoint. This is still manual capture, because it is the user's own device automation, but it removes typing almost entirely. Items arrive in an **Inbox** state (`needs_review = true`) with the category guessed from payee history, and the user confirms them with one tap.

**CAP-09 Receipt capture (P2).** Take a photo of a receipt, store it in Supabase Storage (private bucket `receipts/{user_id}/…`), extract amount, payee and date with Claude vision, and pre-fill Quick Add.

**CAP-10 Split (P2).** Split one payment across 2 to 5 categories. Children reference the parent; the parent's amount equals the sum of the children's.

### 6.4 Categories

**CAT-01 Two-level taxonomy (P0).** Parent categories plus optional sub-categories. **Exactly two levels; never deeper.** Expense transactions may be assigned to a parent *or* a sub-category; analytics roll sub-categories up into their parent. Income categories are a single level.

**CAT-02 Default taxonomy (P0).** It is seeded per user at sign-up, and the user owns these rows, so they can rename or delete them. The 12 expense parents fit a 4 × 3 grid on a phone:

| Parent | Sub-categories |
|---|---|
| **Home** | Rent & mortgage · Council tax · Energy · Water · Broadband & TV · Home insurance · Repairs & furnishing |
| **Groceries** | Supermarket · Specialist shops · Household supplies |
| **Eating out** | Restaurants · Takeaway & delivery · Coffee & snacks · Work lunches · Drinks |
| **Transport** | TfL & rail · Taxis · Fuel & charging · Parking & tolls · Car costs |
| **Shopping** | Clothing & shoes · Electronics · Homeware · Online & general |
| **Health** | Gym & fitness · Pharmacy · Medical & dental · Personal care |
| **Entertainment** | Streaming & apps · Events & culture · Hobbies · Books & media |
| **Travel** | Flights · Hotels · Holiday spending · Visas & insurance |
| **Bills** | Mobile · Insurance · Bank fees & interest · Professional fees |
| **Family & giving** | Gifts · Charity · Celebrations · Family support |
| **Learning** | Courses · Memberships · Subscriptions (professional) |
| **Other** | Cash withdrawals · Fees & fines · Miscellaneous |

Income: **Salary · Bonus · Freelance & consulting · Interest & dividends · Refunds · Gifts received · Other income**.

**CAT-03 Create a category (P0).** This is available from Settings → Categories → "New category", and inline from the Category picker ("+ New"). Fields: name (required, unique among its siblings), type (expense / income), parent (optional; only parents are allowed, which enforces two levels), icon (from a curated set of 48 line icons), and colour (from a curated set of 10 muted tones; no free colour picker, to keep charts coherent).
- Accept: a new category appears in the picker and the suggestion ranking immediately, and is selectable offline (because the categories list is cached).

**CAT-04 Edit, reorder, archive, merge (P0).**
- Reorder parents by drag (`sort_order`); the order drives the picker grid.
- **Archive** hides a category from pickers but keeps its history. It is allowed at any time.
- **Delete** is allowed only for a category with zero transactions; otherwise the UI offers **Merge into…**, which re-points all transactions (one SQL transaction), then archives the source.
- Moving a sub-category to another parent is allowed; moving a parent under another parent is not.

### 6.5 Available cash: the headline number

**Definition, as specified by the owner:**
> **Available cash = Opening cash + Income − Total spend of the month.**

**CASH-01 Cash pool (P0).** The *cash pool* is the set of accounts with `counts_as_cash = true`.
With the defaults (current accounts, cash and credit cards in the pool, savings out), the following
identity holds and is the implementation:

```
Available cash (at time t) = Σ balance(account, t) over pool accounts
```

Decomposed for the month containing t, which is what the UI shows:

```
Opening cash   = Σ pool balances at 00:00 on day 1 of the month (Europe/London)
+ Income       = Σ income into pool accounts, month start → t
− Spend        = Σ expenses from pool accounts, month start → t
± Set aside    = net transfers between pool and non-pool accounts (− when moved to savings)
± Adjustments  = reconcile corrections on pool accounts
= Available cash
```

Every line above counts **only balance-affecting transactions** (`counts_in_balance`, §6.2a). Expenses dated before an account's opening date or last reconcile are still real spending for Analytics and Trips, but they never move the balance, because the user-entered balance already includes them.

When every account is in the pool and there are no adjustments, the last two lines are zero and
this **reduces exactly to the owner's formula**. The extra lines exist only so the number never
silently disagrees with reality. They are hidden in the UI when zero.

Why this handles the awkward cases correctly:

| Situation | Effect on available cash | Why |
|---|---|---|
| £86.50 dinner on the Amex credit card | **−£86.50 immediately** | Card spend is committed cash; the card's balance goes more negative. |
| Paying the £1,184.73 Amex bill from Monzo | **No change** | It's a transfer within the pool; the spend was already counted when it happened. |
| Moving £500 to Marcus savings | **−£500**, shown as "Set aside" | The money left the pool, but it is *not* spend, so analytics ignore it. |
| Salary paid into Monzo | **+ salary** | Income. |
| Rent paid by standing order | **− rent** | It is spend, logged manually or by a recurring rule (P1). |

**CASH-02 Home hero (P0).** It shows the available cash right now, a one-line equation
(`£7,862.40 opening + £140.00 in − £3,236.85 out`), and the month pace (CASH-05). Tapping the hero opens S7.
- Accept: the figure equals `available_cash(now())` from SQL to the penny, it updates within 300 ms of any local change (optimistically) and reconciles against the server on sync.

**CASH-03 As-at any point in time (P0).** S7 has a date scrubber: drag along the month's available-cash line, or pick any past date, to see the figure **as at that moment**, with that month's equation. It is computed server-side via `cash_flow(from, to)`; it is never cached. The scrubber and date picker stop at **tracking start** (BAL-06).

**CASH-04 Per-account contribution (P0).** S7 lists the pool accounts and their balances (these sum to the hero), then "Not in available cash" (savings and similar) in a separate group.

**CASH-05 Pace (P0).** "£367 less than this point in September." This compares month-to-date spend with the previous month's spend up to the same day-of-month (or the last day, if that month is shorter). It is shown as a slim bar on Home: the filled track is this month's spend, and a tick marks where last month was.

**CASH-06 Month-end projection (P1).** Projected close = available now − projected remaining spend + expected recurring income before month end. Projected remaining discretionary spend = the median of the last 3 months' spend for the remaining days of month, *excluding* categories already "done" this month (rent, council tax and anything else flagged `fixed` by recurring detection). Show it as a dashed line on S7: "On track to close at about £2,940."

**CASH-07 Pay-cycle months (P2).** Setting `month_start_day` (1–28). Every "month" across the app then runs from that day. This is in the schema now; it is exposed in the UI later.

### 6.6 Activity

**ACT-01 List (P0).** It shows transactions grouped by day with sticky day headers that read "Today", "Yesterday", "Fri 16 Oct", plus the day's net total at the right. Each row shows the category icon tile, the payee (or the category name if there is no payee), the sub-category and account in small text, and the amount (spend in ink, income in positive green with "+"). It uses infinite scroll (keyset pagination on `(occurred_on, created_at, id)`).

**ACT-02 Search (P0).** One field searches payee, note and category name using `pg_trgm` similarity. Amount search: typing `12.80` matches amounts exactly; `>100` filters. Results come back in under 300 ms for 10,000 rows.

**ACT-03 Filters (P0).** Filter chips: Type, Category (multi-select, parent selects children), Account, Date range (This month, Last month, Last 90 days, This year, Custom), Amount range. The active filters show a total ("23 transactions · £612.40").

**ACT-04 Bulk actions (P1).** Long-press a row to enter selection mode, then choose Recategorise, Change account, Delete, or Add tag.

**ACT-05 Tags (P1).** Free-text tags (for example `#us-trip-2027`), autocomplete from previous tags, and a filter by tag. They are useful for trips and projects that span categories.

### 6.7 Analytics: "very posh" reporting

Every chart must follow these rules:
- a **finding title** (a sentence stating the insight, generated from data, for example "Eating out is up 38% on your usual"), with a quieter subtitle that gives the units and period;
- **one highlighted series** (ink) against context in grey; direct labels rather than legends; tabular figures;
- no pie charts with more than 3 slices, no 3D, no rainbow palettes;
- tapping any mark shows a tooltip, and tapping a category drills down to its sub-categories and then to its transactions;
- every chart has an empty state and a skeleton loading state;
- built with **visx**, animated with **Motion** (spring, 280 ms), and is designed for the dark theme only.

Period control at the top: **Month · Quarter · Year · Custom**, with arrows to step backwards and forwards. It defaults to the current month.

| ID | Chart | What it answers | Spec |
|---|---|---|---|
| AN-01 | **Spending pace** (signature chart) | "Am I ahead of or behind last month?" | Cumulative spend by day this month (ink, solid, ends at today with a dot and label) vs last month (grey, full month). The gap is annotated. On Year view it becomes this year vs last year. |
| AN-02 | **Where it went** | "What are the biggest categories, and the biggest sub-categories?" | Horizontal bars, sorted by amount, with a **Categories · Sub-categories** view switch (§6.7.1). Each row: icon, name, amount, and a marker for the usual amount by this point (the 6-period median at the same day offset). ↑ 38% is shown in caution colour if > +20% and > £30. Tap a category → Category detail (AN-07); tap a sub-category → Sub-category detail (AN-07b). |
| AN-03 | **Cash flow** | "How did opening cash become available cash?" | A waterfall: Opening → +Income → −top 4 categories → −Other → (±Set aside) → Available. This directly visualises the CASH-01 equation. |
| AN-04 | **12-month trend** | "Is my spending creeping up?" | Monthly spend bars for the last 12 months, the current month shown as actual plus a projected (hatched) section, a 12-month average reference line, and an income line overlay (toggle). |
| AN-05 | **Daily rhythm** | "Which days do I spend on?" | A calendar heatmap for the selected month (sequential single-hue ramp, 5 steps); weekday averages beneath. |
| AN-06 | **Top payees** | "Who do I pay most?" | A ranked list: payee, visits, total, average ticket. |
| AN-07 | **Category detail** | "Within Eating out, where did it go?" | Opened from any category row. Total vs usual, three stat tiles, a sub-category share bar and ranked list, a 6-month trend with sub-category filter chips, and top places. Full spec in §6.7.1. |
| AN-08 | **Compare periods** (P0) | "Oct vs Sep" or "2026 vs 2025" | A side-by-side table by category with absolute and percentage deltas, sorted by the largest absolute change. |
| AN-09 | **Savings rate** (P1) | "How much of my income do I keep?" | Monthly (income − spend) / income as a line, with a 3-month moving average. |
| AN-10 | **Budget vs actual** (P1) | "Am I inside my budgets?" | For each budgeted category: a progress bar plus pace marker; over-budget shown in caution colour. |

### 6.7.1 Sub-category analytics (P0)

The goal is to make sub-categories (L2) as easy to analyse as categories (L1), without adding a new tab or a new kind of chart. There are two entry points:

1. **A view switch inside "Where it went"** (AN-02), which answers "which sub-categories cost the most, across everything?"
2. **A Category detail screen** (AN-07), which answers "within Eating out, where did it go?"

Mock-ups: `05a-analytics-categories.html`, `05b-analytics-subcategories.html`, `05c-category-detail.html`. The full page is `05-analytics.html`, with the switch in place.

**AN-02a View switch.**
- The "Where it went" card gets a two-option segmented control, **Categories · Sub-categories**, directly under its subtitle. It defaults to Categories.
- The last choice is remembered on the device (`localStorage`, key `an.groupBy`, wrapped in try/catch).
- Switching changes only this card's list and its finding title. The period control, the other charts and the scroll position stay put.
- The switch animates the list with a 200 ms cross-fade. There is no layout jump: the card keeps its height until the new list has rendered.

**AN-02b Categories view.** Unchanged from AN-02, with these clarifications:
- **Fixed-cost parents** are categories whose sub-categories are all `is_fixed` (for example, Home). They collapse into one quiet summary row ("Home · fixed costs"), so they don't flatten the bars of everything else.
- Every row shows a chevron and opens **Category detail** (AN-07).
- Bars scale to the largest flexible category or its "usual" marker, whichever is bigger.

**AN-02c Sub-categories view.** A single flat ranking of **every sub-category across all parents**:
- Each row has three lines:
  - the icon, sub-category name, flag and amount;
  - a 12 px caption naming the parent (for example "Eating out");
  - a bar with the "usual by today" marker.
- **Ranking:** by amount, descending. It excludes fixed sub-categories (`is_fixed = true`).
- **Default length:** the top 8 rows. Below them, **Show all N sub-categories** expands the list inline (not on a new screen), and "Show fewer" collapses it again.
- **Fixed costs:** all fixed sub-categories collapse into one summary row at the bottom: "Fixed costs · 6", listing the first three names and "… and 3 more", plus the total. Tapping it expands those rows in place.
- **Spend assigned directly to a parent** appears as its own row named **"Other ‹parent›"** (for example "Other eating out"), the same wording as the category picker (CAP-01.2).
- **Flags:** the same rule as AN-02 (above usual by more than 20% and more than £30), applied per sub-category.
- **Finding title:** if any sub-category is flagged, the title names the one with the largest absolute overspend ("Restaurants are up 36% on your usual"). Otherwise it names the top sub-category and its share ("Supermarket is 24% of flexible spend").
- **Rows are tappable** and open **Sub-category detail** (AN-07b).
- **"Usual"** means the median of the six prior equivalent periods, measured at the same day offset. For Quarter and Year it uses prior quarters and prior years.

**AN-07 Category detail** (one screen per L1 category; replaces the earlier "Category deep dive" row).
- **Navigation:** pushed from Analytics, with the back label "Analytics". The period control in the header follows the Analytics period, and changing it here also changes it there.
- **Header:** the category icon, then "‹Category› · ‹period›", then the total in 34 px tabular type. Beneath that, a one-line comparison with a status dot: caution colour if flagged, positive if more than 20% under usual, otherwise neutral. For example: "38% above your usual £226 by this point".
- **Three stat tiles:** Transactions · Average per transaction · Share of all spend.
- **Card "Split by sub-category":**
  - The finding title, for example "Restaurants are almost half of it".
  - A **100% share bar** in a single hue, with shades by rank. It shows at most 5 segments; anything smaller is grouped into the last one.
  - A legend giving each segment's percentage.
  - Then the sub-category rows (AN-02c style), with the caption "‹visits› visits · avg ‹£›" instead of the parent name.
  - "Other ‹parent›" is included when it is non-zero.
- **Card "Monthly trend":**
  - The last 6 months as bars, the current month split into actual (in caution colour if the category is flagged, otherwise ink) and a hatched projected part.
  - The projection is the actual so far plus the median of the prior 3 months' spend in this category over the remaining days.
  - Value labels sit above the bars.
  - Filter chips show **All** plus the top 3 sub-categories, then "More…", which opens a list of the rest. Selecting a chip redraws the bars for that sub-category only.
  - The finding title compares the projection with the six-month range ("On course for your biggest month in six").
- **Top places:** the top 3 payees in this category for the period, each with its sub-category and visit count. "All N" opens Activity filtered to this category and period.
- **Empty state:** "No ‹Category› spending in ‹period›", with a link to the previous period.

**AN-07b Sub-category detail.** Uses the AN-07 template with these differences:
- The back label is the parent ("Eating out" when opened from Category detail, "Analytics" when opened from the Sub-categories view). The header caption reads "‹Sub-category› · ‹Parent›".
- There is no split card.
- The trend card has no chips.
- Top places shows up to 5 payees.

**Data.**
- `spend_by_category` gains a level parameter: `spend_by_category(p_from, p_to, p_parent uuid default null, p_level text default 'parent')`.
  - `'parent'` rolls sub-categories up to their L1 (the current behaviour).
  - `'leaf'` returns every category exactly as assigned. Rows assigned directly to a parent are returned with `is_parent_direct = true`, and the client labels them "Other ‹parent›".
- The returned columns gain `parent_id`, `parent_name`, `is_fixed`, `visits` (= `txn_count`) and `is_parent_direct`.
- New function `category_monthly(p_category uuid, p_months int default 6, p_include_children boolean default true) returns table (month date, total_pence bigint)`.
- Both are `security invoker`, so RLS applies.

**Acceptance criteria.**
- For any period, the sum of all sub-category rows (flexible, fixed and "Other ‹parent›") equals the L1 total for each parent and the overall spend. Add this as SQL invariant 6.
- The view switch persists across app restarts. Switching changes only the "Where it went" card.
- Any sub-category's detail is at most **two taps** from the Analytics tab: switch to Sub-categories, then tap the row.
- With the seed data, the Sub-categories view shows Supermarket first, Restaurants flagged at ↑ 36%, and Fixed costs · 6 = £1,910.83.
- Category detail for Eating out shows £312.60, 21 transactions, an average of £14.88, and a share bar summing to 100%.

**AN-11 Export (P0).** Export CSV (filtered Activity) and full JSON backup from Settings. **AN-12 (P2):** a monthly PDF statement generated server-side.

### 6.8 AI insights

**AI-01 Insight digests (P0).** The system generates a set of 3–6 **insight cards**:
- **weekly**, on Monday at 07:00 Europe/London, covering the previous Monday to Sunday plus month-to-date context;
- **monthly**, on the 1st at 07:00, covering the previous month;
- **on demand**, from the "Refresh" action (rate-limited to 10 per day).

Card types:

| Type | Example (it must cite computed facts) |
|---|---|
| `pace` | "You're £367 behind September's pace. On track to close October at about £2,940." |
| `anomaly` | "Eating out is running 38% above your 6-month norm: £312.60 so far vs about £226 by this point." |
| `trend` | "Groceries have risen for 4 months in a row, from £512 in June to £604 in September." |
| `subscription` | "Streaming & apps now total £41.97 a month, up £3.00 since July." |
| `new_payee` | "First time at Dishoom Kensington: £86.50." |
| `win` | "Transport is your lowest in 6 months: £214.80." |
| `suggestion` | "Two coffees a day on weekdays add up to about £140 a month. Halving it would free about £70." |

Each card has a title (≤ 70 chars), a body (≤ 220 chars), an optional `metric` (value and delta for the large figure), an optional `viz` hint (`spark`, `bar_compare`, or `none`; the client renders it from the facts, not from the AI), a link target (category / payee / screen), and a severity (`info`, `positive`, `caution`).

**AI-02 Home card (P0).** The highest-ranked undismissed card from the latest digest appears on Home. A "See all" link goes to Insights.

**AI-03 Feedback (P0).** Each card has Helpful / Dismiss controls (line-icon buttons with accessible labels). Feedback is stored, and the last 50 feedback items are passed to the next generation as preferences ("user dismissed 4 `suggestion` cards about coffee, so don't repeat").

**AI-04 Ask Sterling (P1).** A chat input at the bottom of Insights, with suggested prompts ("What did I spend on travel this year?", "Why is this month higher?"). It is implemented with Claude tool use over **read-only** functions (section 12.3), responses are streamed, every numeric answer shows a "Show transactions" chip, and conversations are not stored beyond the session unless the user pins an answer.

**AI-05 Anomaly alerts (P1).** Push a notification when a single transaction exceeds 3× the category's median ticket and is more than £100, or when a category passes 120% of its norm with more than 7 days of the month left.

**AI-06 Guardrails (P0).**
- No investment, credit or product recommendations; no moralising; British English; concise.
- Numbers must come only from the facts payload; this is validated mechanically (section 12.4).
- Notes are **excluded** from what is sent to the model by default (Settings toggle "Include notes in AI analysis").
- Show a small "Generated from your data" footnote, plus the generation date, on Insights.

### 6.9 Bills and recurring payments (P0; promoted from v1.1)

**Owner's brief:** "A place where I can set up recurring payments and the day of the month they are charged. Each month, on that day, the transaction should be logged accordingly."

Mock-ups:
- `13-bills.html`: Bills overview with calendar
- `14-new-recurring.html`: New recurring payment
- `15-bill-detail.html`: Bill detail
- `16-bill-notification.html`: Morning notifications

**Terms.** A *recurring payment* is a rule, for example "Netflix, £12.99, on the 27th of every month". An *occurrence* is one due date of that rule. On its due date, Sterling creates an ordinary transaction for the occurrence.

In the UI the screen is called **Bills**, but a recurring payment can be an expense, an income (for example salary) or a transfer (for example a monthly move to savings). Only expenses count in the "bills" totals.

**REC-01 Where it lives.**
- **Home:** a slim **Bills card** below the pace card: "Bills · £34.97 to come this month · Next: Spotify, Thu 22 Oct". Tapping it opens Bills.
  - The card is hidden until at least one recurring payment exists.
  - Before that, it is replaced by a one-time prompt: "Set up your regular bills so they log themselves".
- **Settings:** Settings → Bills also opens Bills.
- **Desktop:** a "Bills" item in the sidebar.
- **Mobile tab bar:** unchanged.

**REC-02 Bills overview** (`13-bills.html`).
- **Summary card:** "‹Month› bills · N payments", the total, and a two-part bar (logged vs to come) with both amounts and counts. Expenses only.
- **Month calendar:**
  - A 7-column grid, Monday first, with ‹ › to change month.
  - Each day shows up to 3 dots: filled grey = logged, hollow = due, green = transfer or income. More than 3 shows as "+".
  - Today is an inverted circle.
  - Tapping a day highlights it and scrolls the list to that day's items.
  - Future months show their projected occurrences, which is how you see the coming month's bills.
- **"Coming up":** occurrences from tomorrow to month end, in date order. Each row shows:
  - icon, payee, and a repeat glyph with "sub-category · account";
  - amount and weekday date;
  - an **EST** tag if the amount varies and is unconfirmed.
- **"Logged this month":** occurrences up to and including today, newest last. Tapping a row opens the transaction (CAP-04). Tapping the payee name opens Bill detail.
- **＋** opens New recurring payment (REC-03).
- **Empty state:** "No bills yet. Add rent, subscriptions or anything that repeats", with an Add button. Below it, a list of **suggestions** from detection (REC-07), each with one tap to add.

**REC-03 New / Edit recurring payment** (`14-new-recurring.html`).
- **Presentation:** a full-screen modal, the same pattern as Add expense. ✕ at the top left, with the discard confirmation if there are changes; **Save** at the top right, enabled once the form is valid.
- **Fields, in order:**
  1. **Type:** Expense · Income · Transfer.
  2. **Amount:** a large figure; tapping it opens the keypad sheet from CAP-01.
  3. **Payee:** with autocomplete. For Transfer this row becomes **To account**.
  4. **Category:** shows the leaf category. It opens Choose category (CAP-01.2). It is hidden for Transfer.
  5. **Account:** the paying account (for Transfer, **From account**).
  6. **Amount: Fixed · Varies.**
  7. **Repeats:** Monthly (default) · Every 3 months · Yearly · Weekly.
  8. **On day:**
     - **Monthly and Every 3 months:** an inline 1–31 day grid plus **Last day**. It defaults to today's date.
     - **Yearly:** a date picker (day and month).
     - **Weekly:** a weekday picker.
  9. **First payment:** auto-calculated as the next matching date on or after today. Editable; it must be today or later.
  10. **Ends:** Never (default) · On a date · After N payments. "After N" shows "Payment 7 of 10" in lists.
  11. **Weekends & bank holidays:** On the day (default) · Next working day. England & Wales bank holidays only.
  12. **Log automatically:** a toggle, on by default. Off = remind me to confirm instead (REC-05).
- **Plain-English summary** beneath the form, updated live, for example: "Sterling will log £12.99 to Netflix at 6am on the 27th of every month, starting Tue 27 Oct. In shorter months, days 29–31 move to the last day."
- **Catch-up prompt:** if the chosen day has already passed this month and First payment is moved back into the current month, ask: "Rent was due on the 1st. Log October's now?" The options are *Log it now* and *Start next month*. Sterling never backfills more than the current month. If that earlier due date is before the account's opening date, the prompt says so ("…before you started tracking. Log it for your records? It won't change your balance.") and the occurrence is logged with `counts_in_balance = false` (BAL-08).
- **Editing** applies to **future occurrences only**. Transactions already logged are never changed. To change a past one, edit that transaction.
- **Validation:** amount > 0; account required; category required for expense and income; From ≠ To for transfers.

**REC-04 Auto-logging engine (the core requirement).**
- **Schedule:** a cron job runs hourly (`/api/cron/recurring`). It acts only when London local time is **06:00–06:59**, so British Summer Time changes are handled correctly.
- **What it does:** for every active rule, it computes occurrences with `due_on ≤ today` that have no occurrence record yet. For each one, inside one database transaction, it:
  - creates the transaction (`source = 'recurring'`, `recurring_id`, `occurred_on = due_on`) and the occurrence record (`status = 'logged'`, or `'estimate'` if the amount varies);
  - updates `next_due_on`.
- **Idempotent:** `unique (item_id, scheduled_on)` on occurrences, so a re-run or retry never double-logs.
- **Catch-up:** if the job missed days (outage), the next run logs every missed occurrence with its original due date, then sends one summary notification.
- **Short months:** a monthly day of 29, 30 or 31 falls on the **last day** of shorter months (31 → 30 Nov, 28/29 Feb). "Last day" always means the month's final day.
- **Weekends & bank holidays:** with "Next working day", a due date on Saturday, Sunday or an England & Wales bank holiday moves forward to the next working day.
  - Bank holidays come from `https://www.gov.uk/bank-holidays.json`, cached in a `bank_holidays` table and refreshed monthly by the same cron.
  - If the fetch fails, the last cached list is used.
- **Varies:** logs the **amount of the last confirmed occurrence** (or the rule's amount the first time) as an **estimate**.
  - The transaction carries `is_estimate = true`, which shows an EST tag in Activity and Bills.
  - Confirming or changing the amount clears the flag.
- **Remind mode (Log automatically off):** creates an occurrence with `status = 'pending'` and **no transaction**. It appears at the top of Bills as "Due today, confirm?" with *Log £X* and *Skip* actions, and sends a notification.
- **Paused rules** generate nothing. On resume, nothing is backfilled for the paused period.
- **Ending:** after the end date or the Nth payment, the rule becomes inactive automatically and moves to an "Ended" section in Bills.
- **Archived accounts or categories:** if the account or category on a rule has been archived, the occurrence is created as `pending`, with the message "Account no longer active, choose another", instead of failing silently.
- **Offline phone:** irrelevant here, because logging happens on the server. The phone sees the new transactions on its next sync.

**REC-05 Notifications.** These use the push setup from NOT-01, and each one can be switched off in Settings → Reminders.
- **Morning summary** at the moment of logging: "2 bills logged today · £1,742.00", with a body listing the payees and amounts. Several occurrences on the same day go into one notification.
- **Variable amount:** "Octopus Energy logged: £48.40 (estimate)", with actions **Looks right** (confirms the amount) and **Change amount** (opens the transaction).
- **Remind mode:** "Netflix £12.99 is due today", with actions **Log it** and **Skip**.
- These replace NOT-03.

**REC-06 Bill detail** (`15-bill-detail.html`).
- **Header:** icon, payee, and "sub-category · parent · account".
- **Next payment card:**
  - the amount (≈ prefix if it varies), the date and "logged at 6am", and the rule in words ("Monthly on the 5th");
  - for varying amounts, a one-line explanation.
- **Actions:**
  - **Skip next:** marks that occurrence `skipped`. It can be undone until the due date.
  - **Pause / Resume.**
  - **Edit:** opens REC-03.
- **History chart:** the last 6 occurrences as bars, with the finding title (for example "October was your highest in six months") and the average.
- **History list:** each occurrence with its status (confirmed / estimate / skipped).
- **Stop this recurring payment:** destructive, with a confirmation. It keeps every logged transaction and stops future ones; the rule moves to "Ended". Deleting a rule completely is only possible from the Ended section.

**REC-07 Suggestions (detection).**
- A nightly job looks for repeating payments: the same payee, amounts within ±10%, an interval of 28–31 days (or 7, 89–92 or 365 days), seen at least 3 times, with no existing rule.
- Each suggestion is pre-filled: "Looks like Netflix is monthly, £12.99 on the 27th. Add to Bills?"
- Suggestions appear in the Bills empty state, at the bottom of Bills, and as an Insights card.
- Dismissed suggestions never return for that payee.

**REC-08 Avoiding duplicates with manual entry.**
- When the user logs an expense manually whose payee matches an active recurring payment that is due within ±3 days, Add expense shows: "Netflix is logged automatically on the 27th. Add this as well?" The options are *Add anyway* and *Cancel*.
- When a rule is created for a payee that has already been logged manually this month on or after the chosen day, the catch-up prompt (REC-03) is not shown.

**REC-09 Effects elsewhere.**
- **Logged occurrences are normal transactions.** They appear in Activity with a small repeat glyph, count towards available cash on their date, and appear in all analytics.
- **Month-end projection (CASH-06):** uses the remaining recurring occurrences of the month (expenses, income and transfers out of the pool) instead of guessing fixed costs. This makes the Insights "on track to close at" figure more accurate.
- The **Activity filter** gets a "Recurring" option.

**Data model.** This replaces `recurring_rules`.

```sql
create type recur_freq   as enum ('weekly','monthly','quarterly','yearly');
create type occur_status as enum ('logged','estimate','confirmed','pending','skipped');

create table recurring_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  type               txn_type not null check (type in ('expense','income','transfer')),
  amount_pence       bigint not null check (amount_pence > 0),
  amount_varies      boolean not null default false,
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,          -- transfers
  category_id        uuid references categories,
  payee_id           uuid references payees,
  note               text,
  frequency          recur_freq not null default 'monthly',
  day_of_month       smallint check (day_of_month between 1 and 31),  -- monthly/quarterly
  last_day           boolean not null default false,                   -- "Last day"
  weekday            smallint check (weekday between 1 and 7),         -- weekly (ISO)
  month_of_year      smallint check (month_of_year between 1 and 12),  -- yearly
  working_day_rule   text not null default 'on_day' check (working_day_rule in ('on_day','next_working_day')),
  starts_on          date not null,
  ends_on            date,
  max_occurrences    int,
  auto_log           boolean not null default true,
  paused_at          timestamptz,
  ended_at           timestamptz,
  next_due_on        date not null,                     -- maintained by the engine
  created_at         timestamptz not null default now(),
  check ( (type = 'transfer') = (counter_account_id is not null) ),
  check ( (type in ('expense','income')) = (category_id is not null) )
);

create table recurring_occurrences (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  item_id        uuid not null references recurring_items on delete cascade,
  due_on         date not null,                         -- after working-day adjustment
  scheduled_on   date not null,                         -- before adjustment
  status         occur_status not null,
  transaction_id uuid references transactions on delete set null,
  amount_pence   bigint not null,
  created_at     timestamptz not null default now(),
  unique (item_id, scheduled_on)
);

alter table transactions add column is_estimate boolean not null default false;
-- transactions.recurring_id now references recurring_items(id)

create table bank_holidays (day date primary key, title text not null);   -- England & Wales; read-only to users
```

- RLS uses the standard four policies on `recurring_items` and `recurring_occurrences`. `bank_holidays` is readable by any authenticated user and writable only by the service role.
- Pure function `nextOccurrences(item, from, to): Date[]` in `/lib/recurrence.ts`. It is used by the cron, the calendar (future months) and the projection, so all three agree.

**Acceptance criteria.**
1. A rule "Netflix £12.99 monthly on the 27th" creates exactly one transaction dated 27 Oct at about 06:00 London time. Re-running the cron the same day creates none.
2. A rule on the 31st logs on 30 Nov, 31 Dec and 28 Feb 2027.
3. With "Next working day", a payment scheduled for Sun 1 Nov 2026 logs on Mon 2 Nov. One scheduled for 25 Dec 2026 logs on Tue 29 Dec, because 25 and 28 Dec are bank holidays and 26–27 Dec are a weekend.
4. If the cron doesn't run for 3 days, the next run logs all the missed occurrences with their original dates and sends one summary notification.
5. A "Varies" rule logs the last confirmed amount with an EST tag. "Looks right" clears it; "Change amount" updates the transaction and becomes the next estimate.
6. Skip next, then the due date passes: no transaction is created and history shows "Skipped".
7. Pausing in October and resuming in December creates nothing for November.
8. Editing the amount on 20 Oct changes the 27 Oct occurrence but not the one logged on 27 Sep.
9. Stopping a rule keeps its past transactions; Activity still shows them with the repeat glyph.
10. Unit tests for `nextOccurrences` cover month-ends, leap years, quarterly, yearly on 29 Feb (→ 28 Feb in non-leap years), weekly, and the 29 Mar / 25 Oct 2026 clock changes.

### 6.9a Budgets (P1)

**BUD-01 Category budgets.** A monthly amount per parent category, with optional rollover of the unspent amount. Budget progress appears in AN-10 and on the category's deep dive, with a 90% warning in Insights.

### 6.10 Settings, privacy, data

- **SET-01** Profile: display name, month start day (P2), week starts Monday (fixed for the UK).
- **SET-02** Appearance: none. The app is dark-only, so there is no theme setting.
- **SET-07** Reminders (P0): evening reminder on/off and time (NOT-01).
- **SET-03** Privacy blur (P1): a toggle, also triggered by tapping the hero twice, that blurs all amounts until the next tap. Useful on the Tube.
- **SET-04** AI: enable or disable insights, include notes (off by default), clear AI history.
- **SET-05** Data: export CSV / JSON; delete all data (type "DELETE" to confirm, cascades everything).
- **SET-06** Security: app lock (P1), sign out everywhere, API tokens (P1).

### 6.11 Notifications

Web Push works on iOS 16.4+ only when the PWA is installed to the Home Screen. Permission is asked
**in context, never on first launch**: after the user's 3rd logged transaction, Home shows a one-time card
("Get a gentle reminder at 21:00 if you haven't logged anything?" · *Turn on* / *Not now*). *Turn on*
triggers the browser permission prompt (it must come from a tap, which iOS requires). It can also be
switched on later in Settings → Reminders. See mock-up S11.

**NOT-01 Evening reminder (P0).** Confirmed by the owner.
- Default **21:00 Europe/London**, adjustable in 15-minute steps from 18:00 to 23:00; on/off toggle.
- Sent **only if nothing was logged today** (London date, any type, including Shortcuts inbox items). If something was logged, stay silent.
- Copy: title "Sterling", body "Anything to log from today?" When nothing has been logged for 3 days in a row, the body changes to "It's been a few days. Two minutes to catch up?"
- Tapping the notification opens the app straight into Quick Add (`/?add=1`), with the date chip set to today.
- A notification action (where the platform supports actions) "Nothing to log" records a `no_spend` marker for the day, so streaks and analytics know it was a genuine zero-spend day rather than a missed one.
- At most one reminder per day. No reminder on a day the user already dismissed one with "Nothing to log".
- Implementation: `push_subscriptions` table (endpoint, p256dh, auth, user_agent, created_at; RLS); `web-push` library with VAPID keys; the service worker handles `push` and `notificationclick`. Delete a subscription when the push service returns 404/410.
- Scheduling: one cron invocation every 15 minutes (or hourly on plans that limit cron) checks whether it is the user's reminder slot in London time and whether today has any transactions. This keeps BST changes correct.
- Accept: with a transaction logged today, no push is sent at 21:00; with none, exactly one push arrives; tapping it opens Quick Add; turning the toggle off stops all reminders from the next slot.

**NOT-02 Weekly digest ready (P1).** Monday 07:00.
**NOT-03 Bills logged / due (P0).** See REC-05.
**NOT-04 Anomaly alerts (P1).** As AI-05.

### 6.12 Trips (P0)

**Owner's brief.** Create a trip with a start and end date and add expenses against it. Those expenses still count in the monthly figures, but each trip also has its own expense list, analytics and insights.

**Decisions confirmed with the owner (28 Oct 2026):**

| Topic | Decision |
|---|---|
| Tagging | **Automatic:** during a trip's dates, new expenses are tagged to it, and any single expense can be untagged. |
| Pre-trip costs | **Any date:** flights and hotels booked earlier can belong to the trip. The trip shows "Booked before" and "On the trip" separately. |
| Currency | **Enter in local currency:** Sterling converts to £ at that day's rate and stores both amounts. The £ figure stays editable so it can match the statement. |
| Budget | **Optional trip budget,** with an optional per-category breakdown. |

Mock-ups:
- `17-trip-home.html`: Home during a trip
- `18-trips.html`: Trips list
- `19-new-trip.html`: New trip
- `20-trip-detail.html`: Trip overview: budget, analytics, insights
- `21-trip-expenses.html`: Trip expenses
- `22-trip-add-expense.html`: Add expense on a trip, in dollars
- `23-trip-bookings.html`: Attach earlier bookings

The sample scenario is "USA", Sat 6 – Sat 20 Mar 2027, viewed on Fri 12 Mar (day 7 of 15), with a £5,000 budget. All the figures are in Appendix A.

**TRIP-01 Where it lives.**
- **Home trip card.** It sits between the hero and the pace card.
  - **During a trip** (`17-trip-home.html`): "On a trip · day 7 of 15", the trip name, the current stop, the daily allowance left, and spent vs budget.
  - **Up to 14 days before a trip starts:** "USA in 9 days", with "Add bookings" if none are attached.
  - **For 7 days after a trip ends:** "USA wrap-up ready".
  - At any other time the card is hidden. Tapping it opens the trip.
- **Settings → Trips** opens the Trips list (`18-trips.html`).
- **Desktop:** a "Trips" item in the sidebar.
- **Activity:** a **Trip** filter.
- **Analytics:** an "Exclude trips" switch (TRIP-09).

**TRIP-02 Trips list** (`18-trips.html`).
- **The current trip (or next upcoming) as a hero card:**
  - a status label (Now · day N of M / In N days);
  - the name, the stops and the dates;
  - a **timeline**: one segment per day, past days filled, a "now" marker, and stop names under their spans;
  - spent vs budget with a two-part bar (booked before / on the trip);
  - a currency chip.
- **Past trips:** a list of name, place · nights · month, and total. Sorted newest first.
- **＋** opens New trip.
- **Empty state:** "Plan a trip to keep its spending in one place", with a New trip button.

**TRIP-03 New / Edit trip** (`19-new-trip.html`). A full-screen modal with ✕ and **Create** (Save when editing). Fields:
1. **Name** (required, at most 30 characters).
2. **Where:** a country picker with search. It sets the default local currency.
3. **Local currency:** defaults from the country; any ISO 4217 currency can be chosen. If the currency is GBP, conversion is switched off for the trip.
4. **Dates:** a range calendar. Tap the start date, then the end date; the range is highlighted and the length shown ("15 days"). End must be on or after start. **Trips may not overlap**: show an inline error naming the clashing trip.
5. **Stops (optional):** name + date range, each inside the trip dates, not overlapping, at most 8. They drive "by stop" analytics, and the stop name appears on expense day headers. Any day not covered by a stop belongs to "Other".
6. **Budget (optional):** a £ amount. **Budget by category (optional):** £ amounts per parent category. The overall budget must be at least their sum; if it's left empty, it defaults to the sum.
7. **Add expenses automatically:** a toggle, on by default (TRIP-04).

A note explains that after creation Sterling will look for earlier bookings (TRIP-05).

**Editing dates.**
- Existing tags never change silently. If new dates leave tagged expenses outside the range, ask: "4 expenses are now outside the trip dates. *Keep them on the trip* / *Remove them*". Expenses with `trip_origin = 'booking'` are always kept.
- If new dates cover untagged expenses, offer: "Add 6 expenses from 21–22 Mar?"

**Deleting a trip** asks for confirmation. Its expenses stay as normal transactions; only the trip link is removed.

**TRIP-04 Automatic tagging.**
- **What gets tagged:** an **expense** whose `occurred_on` falls within an active trip's dates, when that trip's auto-add is on. `trip_id` is set when the expense is created, with `trip_origin = 'auto'`. This applies to manual entry, natural-language entry, Shortcuts capture and favourites.
- **What is never auto-tagged:**
  - **Bills** (logged by §6.9 recurring payments), so your rent never lands on a trip;
  - **transfers**;
  - **income.** Refunds can be tagged manually and then reduce the trip's spending.
- **Add expense shows a trip chip** (`22-trip-add-expense.html`): a green "USA ✕" chip with a pin icon, first in the meta row.
  - Tapping ✕ untags this expense only (`trip_id = null`).
  - Tapping the chip itself opens a picker: the trips around this date, plus "None".
  - **TRIP-04a Chip and dates.**
    - An **auto-tagged** chip follows the date: moving the date outside the trip removes it, and moving it back restores it.
    - A chip the user **set manually**, or one preset because Add expense was opened from the trip's **Add to ‹trip›** button, is **locked on**: any date is allowed, including months before the trip and before tracking began.
    - Dates before the trip start get `trip_origin = 'booking'`; others get `'manual'`.
    - Past-dated entries follow the balance rules in §6.2a (`24-past-expense.html`).
- **During a trip, the "top categories" tiles** (CAP-01.1) are ranked by **this trip's** usage. On the first day, they use the travel defaults: Restaurants, Coffee & snacks, Taxis, Events & culture, Other transport, Clothing & shoes. The label reads "Top on this trip".
- **Editing any existing transaction** shows the same trip chip. This is how a single expense is moved on or off a trip.

**TRIP-05 Bookings made before the trip.**
- **Sheet** (`23-trip-bookings.html`): "These travel expenses from the last 12 months look like they belong to USA".
- **When it appears:** right after the trip is created, and again (as a Home card prompt) 14 days before the start if nothing has been attached yet.
- **Candidates:** untagged expenses dated in the **12 months** before the start date (flights are often booked very early), in the categories Travel › Flights, Hotels, Visas & insurance (and any category the user marks as "Travel-like" in Settings). Expenses already linked to another trip are excluded.
- **Pre-selection:** candidates are pre-checked when the payee or note mentions the destination, a stop or an airport code. Otherwise they appear unchecked, like the easyJet LGW–EDI flight in the mock.
- Selected items get `trip_origin = 'booking'`.
- **They stay in the months they were paid** for monthly figures. This is explained in the sheet and on the trip (TRIP-09).
- **Also available:** "Add an existing expense" at the end of the trip's Expenses tab opens a searchable picker of all untagged expenses.

**TRIP-06 Foreign currency.**
- **On a trip with a non-GBP currency, Add expense opens in that currency**, for example "$48.60".
  - Beneath it, a live conversion line: "≈ £38.39 · 1 USD = 0.7900 GBP".
  - A **currency chip** switches between the trip currency and £ for this expense. Use £ when the statement amount is already known.
  - The Add button shows both: "Add $48.60 · £38.39".
- **Storage:** `amount_pence` (GBP) remains the single source of truth for every total in the app. The transaction also stores:
  - `original_amount_minor` and `original_currency` (ISO 4217; minor units follow the currency's exponent, so JPY has 0 decimals);
  - `fx_rate` (`numeric(18,8)`, GBP per 1 unit);
  - `fx_rate_on` (date);
  - `fx_source` (`'auto'` | `'manual'`).
- **Conversion:** `amount_pence = round_half_even(original_amount_minor × fx_rate × 100 / 10^exponent)`. This is computed in `/lib/fx.ts` using integer and decimal arithmetic only (decimal.js), never floats.
- **Rates:**
  - Daily reference rates come from the **Frankfurter API** (ECB rates, no key), fetched once a day by cron for the currencies of active and upcoming trips, and cached in `fx_rates (on, currency, gbp_per_unit)`.
  - Weekends and holidays use the latest earlier rate. The client caches the trip currency's last 30 days for offline use.
- **Card fees (optional):** an account field `fx_fee_bps` (for example 299 = 2.99%; 0 by default) is added on top of the rate. This makes the £ closer to what the card actually charges.
- **Offline:** entries use the latest cached rate and are marked `fx_source = 'auto'` with `fx_rate_on` set to the cached date. On sync, if a newer rate for the expense's date is available and the £ amount hasn't been edited manually, the £ amount is recalculated silently.
- **Correcting to the statement:** in the transaction editor, tapping the £ figure lets the user overwrite it (`fx_source = 'manual'`). The effective rate is then derived and shown ("effective 0.8012").
- **Display:**
  - Trip lists show £ as the main figure and the original amount underneath in tertiary text ("£38.39 / $48.60").
  - Activity shows the original amount only on foreign-currency rows.
  - All analytics use £.

**TRIP-07 Trip overview** (`20-trip-detail.html`). The header has a back button ("Trips") and an edit icon; the status label shows "Day 7 of 15 · New York"; then the name, stops and dates; then a two-tab switch, **Overview · Expenses (N)**.
- **Budget card:**
  - the timeline (TRIP-02) and spent vs budget, with the two-part bar and legend (Booked before £ / On the trip £);
  - an **allowance line** during the trip: "You can spend £159.83 a day for the next 9 days and stay on budget", where allowance = (budget − spent) ÷ days remaining including today;
  - before the trip it reads "£X planned per day once you arrive"; after it, "Finished £X under budget" or "£X over budget".
  - With no budget, the card shows the total, the on-trip daily average, and the split.
- **Daily spending chart:**
  - one bar per trip day, on-trip spending only (bookings excluded); future days are drawn as empty outlines;
  - bars are shaded by stop; a dashed **planned daily** line = (budget − booked before) ÷ trip days;
  - the finding title names the biggest day and its largest expense ("Thursday was your biggest day: Hamilton");
  - tapping a bar shows that day's expenses.
- **By stop:**
  - a row per stop with its total, days so far and £ a day, and a bar scaled to the largest stop;
  - future stops say "Upcoming";
  - the finding title names the priciest stop per day;
  - hidden when no stops are defined.
- **Where it went:**
  - the same component as Analytics AN-02, with the Categories · Sub-categories switch (default **Sub-categories** for trips, because trips are small);
  - each row's caption is "parent · % of trip"; top 7, then "Show all N" inline;
  - covers the whole trip, including bookings;
  - if category budgets exist, each row shows a budget marker and turns caution-coloured when over.
- **Insights:** 2–4 cards from the §12 pipeline, scoped to the trip (TRIP-08).
- **Footer explainer:** "Also in your monthly spending. £1,101.31 counts in March; £2,460.20 of bookings counted in December to February, when you paid."

**TRIP-08 Trip insights.** These use the same compute-then-narrate pipeline and grounding validator (§12.2–12.4), with a `trip` scope.
- **Facts payload:**
  - totals (booked / on-trip / by day / by stop / by category);
  - budget, plan per day, actual per day, allowance, and the projection (spent + actual-per-day × days left);
  - the biggest expenses;
  - the FX average;
  - comparisons with past trips (per day, by category).
- **Card types:**
  - `trip_pace`: on budget / at risk, with the projected finish;
  - `trip_mix`: largest share, for example food;
  - `trip_stop`: comparison between stops;
  - `trip_compare`: "Your priciest trip per day since Goa";
  - `trip_big`: a single large expense;
  - `trip_fx`: card fees paid, when `fx_fee_bps > 0`.
- **When generated:** each morning at 07:00 local time during the trip, after any trip edit (debounced 10 min), and as a **wrap-up** the day after the trip ends.
- **Wrap-up:** a push notification "USA wrap-up ready", plus a summary at the top of the trip: total, per day, vs budget, top 3 categories, best and priciest day, and comparison with past trips.
- Copy must use only facts from the payload. For example, "With no hotel to pay for, Chicago came to £107.52 a day" is allowed because the absence of hotel spend in Chicago is a computed fact.

**TRIP-09 Monthly figures and analytics.**
- **Trip expenses are ordinary transactions.** They count in available cash, monthly spending, Activity and all monthly analytics, in the month they were paid. Nothing is double-counted: a trip is a *view* over transactions, not a separate ledger.
- **Norms exclude trip expenses.** The "usual by now" medians (AN-02, AN-02c and the AI facts) are computed **without** trip-tagged transactions. Then a trip doesn't inflate future "usual" values, and normal months aren't flagged as low by comparison.
- **"Exclude trips" switch** in Analytics, next to the period control, off by default. When on, every Analytics chart for the period removes trip-tagged transactions, and the page shows a quiet banner: "Excluding USA (£1,101.31)".
- **Monthly AI insights mention the trip as context**, for example "March includes £1,101 of trip spending", rather than flagging trip categories as anomalies.

**TRIP-10 Trip expenses tab** (`21-trip-expenses.html`).
- **Search** within the trip.
- **Summary line:** count · total · total in local currency · average rate.
- **On-trip expenses grouped by day,** newest first. Each day header shows "‹Weekday date› · ‹stop› · £day total".
- **A final "Booked before the trip" group,** sorted by date.
- Rows follow the Activity style, plus the original amount under the £ figure. Swipe left on a row: **Remove from trip** (not delete), as well as the normal Delete.
- **"Add an existing expense"** at the end of the list.

**Data model.**

```sql
create table trips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null check (char_length(name) between 1 and 30),
  country_code    char(2),
  currency        char(3) not null default 'GBP',
  start_on        date not null,
  end_on          date not null check (end_on >= start_on),
  budget_pence    bigint check (budget_pence > 0),
  auto_tag        boolean not null default true,
  created_at      timestamptz not null default now(),
  exclude constraint trips_no_overlap using gist (user_id with =, daterange(start_on, end_on, '[]') with &&)
);   -- needs: create extension btree_gist;

create table trip_stops (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id  uuid not null references trips on delete cascade,
  name     text not null,
  start_on date not null,
  end_on   date not null,
  sort     smallint not null default 0
);   -- trigger: within trip dates, no overlap between stops of one trip

create table trip_category_budgets (
  trip_id      uuid not null references trips on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories,     -- parent categories only
  amount_pence bigint not null check (amount_pence > 0),
  primary key (trip_id, category_id)
);

alter table transactions
  add column trip_id               uuid references trips on delete set null,
  add column trip_origin           text check (trip_origin in ('auto','manual','booking')),
  add column original_amount_minor bigint,
  add column original_currency     char(3),
  add column fx_rate               numeric(18,8),
  add column fx_rate_on            date,
  add column fx_source             text check (fx_source in ('auto','manual')),
  add constraint fx_all_or_none check (
    (original_currency is null) = (original_amount_minor is null) and
    (original_currency is null) = (fx_rate is null));
create index txn_trip on transactions (user_id, trip_id, occurred_on) where trip_id is not null and deleted_at is null;

alter table accounts add column fx_fee_bps int not null default 0 check (fx_fee_bps between 0 and 1000);

create table fx_rates (on_date date, currency char(3), gbp_per_unit numeric(18,8) not null,
                       primary key (on_date, currency));   -- readable by authenticated users; written by cron only
```

- RLS: the standard four policies on `trips`, `trip_stops` and `trip_category_budgets`.
- **New SQL functions** (security invoker):
  - `trip_summary(p_trip)`: booked, on-trip, spent, budget, days, day N, plan per day, actual per day, allowance and projection.
  - `trip_by_day(p_trip)`
  - `trip_by_stop(p_trip)`
  - `trip_by_category(p_trip, p_level)`, reusing the `spend_by_category` logic.
- **Existing functions:** `spend_by_category`, `daily_spend` and `monthly_totals` gain `p_exclude_trips boolean default false`. The norm calculation always excludes trip-tagged rows.

**Acceptance criteria.**
1. With the USA trip active, a new £ or $ expense dated 12 Mar is tagged automatically. Untagging via the chip saves it with no trip. A bill logged on 12 Mar is never tagged.
2. A $48.60 entry with a cached rate of 0.7900 stores £38.39, `original_amount_minor = 4860` and `original_currency = 'USD'`. Editing £ to £39.10 sets `fx_source = 'manual'` and shows an effective rate of 0.8045.
3. Attaching the 5 bookings makes "Booked before" £2,460.20. December–February monthly totals are unchanged, and March includes only the £1,101.31 spent on the trip.
4. On 12 Mar, the overview shows spent £3,561.51 of £5,000, £1,438.49 left and £159.83 a day for 9 days. The daily chart has 7 filled bars and 8 empty ones; the planned line is at £169.32.
5. By stop: Chicago £322.57 (3 days), New York £778.74 (4 days so far), Miami Upcoming.
6. Creating a trip that overlaps USA is rejected with a message naming USA.
7. With "Exclude trips" on, March analytics drop exactly £1,101.31. Category norms for April are the same with or without the trip.
8. Every trip insight passes the grounding validator. The wrap-up arrives the day after the end date.
9. Deleting the trip leaves all 24 transactions intact, with `trip_id = null`.
10. Offline, a $ expense uses the last cached rate. After reconnecting, it's recalculated with the day's rate unless £ was edited.

---

## 7. Mobile UX requirements

| ID | Requirement |
|---|---|
| MOB-01 | **Standalone PWA**: `display: standalone`, `theme_color` and `background_color` `#0C0D0C`, `apple-mobile-web-app-status-bar-style: black-translucent`, dark iOS splash screens, `apple-touch-icon` 180 px. Set `color-scheme: dark` on `:root` so form controls and scrollbars render dark. |
| MOB-02 | **Safe areas**: respect `env(safe-area-inset-*)`; the tab bar sits above the home indicator; sheets extend under it. |
| MOB-03 | **Bottom sheets** via **Vaul** (drag to dismiss, snap points, background scales to 0.94 with a rounded top, as in iOS). Filters, date picker and account picker are sheets. **Add expense and Choose category are not sheets**: they are a full-screen modal with a Close button (CAP-01). |
| MOB-04 | **Touch targets ≥ 44 × 44 pt**; keypad keys ≥ 64 × 52 pt. |
| MOB-05 | **Gestures**: swipe rows (delete / duplicate), pull-to-refresh on Activity and Insights, long-press ＋ for favourites, horizontal swipe on Analytics period. |
| MOB-06 | **Motion**: spring transitions (stiffness 400, damping 34); the hero figure animates numerically; respect `prefers-reduced-motion`. |
| MOB-07 | **Haptics**: iOS Safari does not expose `navigator.vibrate`, so do not depend on it. Use it where supported (Android) and design so that nothing relies on it. |
| MOB-08 | **Performance**: first load ≤ 1.8 s on 4G (LCP); repeat launches render cached data instantly (TanStack Query persisted to IndexedDB, plus the service-worker app shell); interaction latency ≤ 100 ms. |
| MOB-09 | **Keyboard avoidance**: when a text field is focused in a sheet or in Add expense, the layout resizes using `visualViewport`, so nothing hides behind the iOS keyboard. |
| MOB-10 | **No horizontal scroll** anywhere at 375 px; layouts tested at 375, 390, 430 px. |
| MOB-11 | **Dynamic type**: rem-based type scale; layout survives 130% text size. |

## 8. Web and desktop requirements

- **WEB-01** Responsive breakpoints: `<640` phone (tab bar), `640–1023` tablet (tab bar, two-column analytics), `≥1024` desktop (sidebar).
- **WEB-02** The desktop dashboard (mock-up S10) has the hero and equation on the left, the pace chart across the centre, Insights in a right rail, and the recent transactions table below.
- **WEB-03** Keyboard shortcuts: `N` new transaction, `/` search, `G H` / `G A` / `G N` / `G I` go to Home / Activity / Analytics / Insights, `Esc` closes.
- **WEB-04** Tables on desktop: sortable columns, inline category edit, multi-select with Shift-click.

---

## 9. Technical architecture

### 9.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (latest stable), App Router, TypeScript strict** | Server Components for data reads; Server Actions for mutations; route handlers for AI, cron and the API. |
| Hosting | **Vercel** | Preview deployment per branch; env vars per environment; Vercel Cron for jobs. |
| Database | **Supabase Postgres** | All maths in SQL functions; RLS on every table; migrations via Supabase CLI. |
| Auth | **Supabase Auth** (email OTP) via `@supabase/ssr` | Cookies-based session for SSR; middleware refreshes the session. |
| Storage | Supabase Storage (private) | Receipts (P2) and exports. |
| UI | **Tailwind CSS v4** + **Radix primitives** + **Vaul** + **Motion** | Tokens from `design/tokens.css`. Use shadcn/ui only as unstyled scaffolding; restyle everything to the mock-ups. |
| Charts | **visx** | Full control is needed for the editorial chart style; avoid defaults-heavy chart libraries. |
| Data fetching | **TanStack Query v5** + IndexedDB persister | Optimistic updates for capture. |
| Offline | **Serwist** (service worker) + **Dexie** (outbox) | App shell precache; runtime cache for categories, accounts and the last 90 days of transactions. |
| Forms | react-hook-form + zod | Shared zod schemas between client and server (`/lib/schemas`). |
| Dates | date-fns + `@date-fns/tz` | All "month" boundaries computed in **Europe/London** (BST/GMT aware). |
| Money | `/lib/money.ts` | `toPence`, `formatGBP` (Intl.NumberFormat `en-GB`, GBP), and arithmetic on integers only. |
| AI | **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) | Server-side only; the key is never exposed to the client. |
| Font | **Instrument Sans** via `next/font/google` | Weights 400/500/600; `font-feature-settings: "tnum"` on all figures. |
| Icons | lucide-react (line, 1.75 stroke) | Curated subset of 48 for categories. |
| Testing | Vitest, Playwright, pgTAP (or SQL tests via the Supabase CLI) | Section 16. |

### 9.2 System diagram (logical)

```
iPhone (PWA)  ─┐                         ┌─ Supabase Postgres (RLS)
Desktop web   ─┼─ Next.js on Vercel ─────┤    tables · SQL functions · pg_cron (optional)
iOS Shortcuts ─┘   · Server Components   ├─ Supabase Auth (email OTP)
                   · Server Actions      ├─ Supabase Storage (receipts, exports)
                   · /api/* handlers ────┴─ Anthropic API (Claude Sonnet / Haiku)
                   · Vercel Cron → /api/cron/*
```

Reads: Server Components call Supabase with the user's session (RLS applies). Client-side
mutations go through Server Actions, which validate with zod and then call Supabase.
Analytics call SQL functions with `supabase.rpc()`.

### 9.3 Repository structure

```
/app
  (auth)/sign-in/page.tsx
  (app)/layout.tsx              ← tab bar / sidebar shell, QuickAdd provider (pre-mounted)
  (app)/page.tsx                ← Home
  (app)/activity/page.tsx
  (app)/analytics/page.tsx
  (app)/insights/page.tsx
  (app)/cash/page.tsx           ← Available cash detail
  (app)/settings/{accounts,categories,recurring,security,data}/page.tsx
  api/parse/route.ts            ← NL parse (Haiku)
  api/insights/route.ts         ← generate digest (Sonnet)
  api/ask/route.ts              ← Ask Sterling (P1, streaming)
  api/v1/capture/route.ts       ← Shortcuts endpoint (P1)
  api/cron/{digest,recurring,nudge}/route.ts
  manifest.ts
/components/{ui,capture,charts,cash,activity,insights}
/lib/{money.ts,dates.ts,supabase/,schemas/,ai/,suggest.ts,outbox.ts}
/supabase/migrations/*.sql
/supabase/seed.sql              ← default categories function + demo data (dev only)
/design/{tokens.css,mockups/*.html}
/tests/{unit,e2e,sql}
CLAUDE.md  DECISIONS.md  PRD.md
```

### 9.4 Environment variables

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + local | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) | Cron jobs only (iterates the single user); never imported into client code |
| `ANTHROPIC_API_KEY` | Vercel (server only) | AI |
| `AI_MONTHLY_TOKEN_CAP` | Vercel | Hard cap; above it, digests pause and the UI says so |
| `ALLOWED_EMAIL` | Vercel | Sign-in allow-list |
| `CRON_SECRET` | Vercel | Verifies cron requests (`Authorization: Bearer`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Vercel | Web Push for the evening reminder (P0) |

### 9.5 Scheduled jobs

| Job | Schedule (Europe/London) | Handler |
|---|---|---|
| Weekly digest | Mon 07:00 | `/api/cron/digest?scope=weekly` |
| Monthly digest | 1st 07:00 | `/api/cron/digest?scope=monthly` |
| Bills: log due occurrences (P0, REC-04) | Hourly; acts 06:00–06:59 London, monthly bank-holiday refresh | `/api/cron/recurring` |
| Evening reminder (P0, NOT-01) | Every 15 min (or hourly); the handler checks the user's London reminder time | `/api/cron/nudge` |
| Bills: suggestions (P0, REC-07) | Daily 03:00 | `/api/cron/recurring?detect=1` |
| FX rates for trip currencies (P0, TRIP-06) | Daily 05:00 London | `/api/cron/fx` |
| Trip insights + wrap-up (P0, TRIP-08) | Daily 07:00 London during and the day after a trip | `/api/cron/digest?scope=trip` |

Vercel Cron schedules are in UTC. Either schedule hourly and check the London local time inside
the handler (preferred, because it is correct across BST changes), or accept a one-hour drift.
On the Hobby plan, cron frequency is limited, so check current Vercel limits. A single daily
06:00 UTC job can dispatch the weekly and monthly digests by date if needed.

> **Supabase free tier note:** free projects pause after about a week without activity. Daily use prevents this; the daily cron call also keeps it awake. Consider the Pro plan for daily backups and point-in-time recovery, since this is financial history.

### 9.6 Why a PWA and not a native app (v1)
A PWA gives one codebase, instant deploys, and no App Store review, and iOS now supports
standalone mode, Web Push and Face ID via WebAuthn. Limits accepted: no home-screen widget, no
Siri intents (mitigated by the Shortcuts endpoint), and no haptics. If those become important,
wrap the same Next.js app with **Capacitor** (P2) rather than rewriting it.

---

## 10. Data model

### 10.1 Money rules
- Store **`bigint` pence**. £12.80 is stored as `1280`. Never use `numeric` in app code paths or `float` anywhere.
- `amount_pence` is **always positive** for expense, income and transfer; the direction comes from `type`. Only `adjustment` is signed.
- Format at the edge only: `new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`. Render the minus sign as a real minus (U+2212).

### 10.2 Schema (initial migration)

```sql
create extension if not exists pg_trgm;

create type account_type  as enum ('current','savings','credit_card','cash','other');
create type txn_type      as enum ('expense','income','transfer','adjustment');
create type category_kind as enum ('expense','income');
create type txn_source    as enum ('app','nl','shortcut','recurring','favourite','receipt');

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  display_name     text,
  month_start_day  smallint not null default 1 check (month_start_day between 1 and 28),
  timezone         text not null default 'Europe/London',
  ai_enabled       boolean not null default true,
  ai_include_notes boolean not null default false,
  lock_after_min   smallint default 5,
  reminder_enabled boolean not null default false,  -- NOT-01, set when push permission is granted
  reminder_time    time not null default '21:00',     -- London local, 15-min steps
  created_at       timestamptz not null default now()
);

create table accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users on delete cascade,
  name                  text not null check (char_length(name) between 1 and 40),
  institution           text,
  type                  account_type not null,
  opening_balance_pence bigint not null default 0,  -- signed; owed on a card = negative
  opening_date          date not null default current_date,
  counts_as_cash        boolean not null default true,
  is_default            boolean not null default false,
  sort_order            int not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now()
);
create unique index one_default_account on accounts(user_id) where is_default;

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id   uuid references categories on delete restrict,
  kind        category_kind not null,
  name        text not null check (char_length(name) between 1 and 32),
  icon        text not null default 'circle',
  color       text not null default 'stone',     -- token name, not hex
  sort_order  int not null default 0,
  is_fixed    boolean not null default false,    -- rent-like; used by projection
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, parent_id, name)
);
-- trigger: parent_id must reference a row whose parent_id is null and whose kind matches (two levels max)

create table payees (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  name                text not null,
  name_norm           text generated always as (lower(regexp_replace(name, '\s+', ' ', 'g'))) stored,
  default_category_id uuid references categories on delete set null,
  default_account_id  uuid references accounts on delete set null,
  use_count           int not null default 0,
  last_used_at        timestamptz,
  unique (user_id, name_norm)
);
create index payees_trgm on payees using gin (name_norm gin_trgm_ops);

create table transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  client_id          uuid not null,                       -- idempotency key from the outbox
  type               txn_type not null,
  amount_pence       bigint not null,
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,            -- transfers: destination
  category_id        uuid references categories,
  payee_id           uuid references payees on delete set null,
  note               text check (char_length(note) <= 280),
  tags               text[] not null default '{}',
  occurred_on        date not null,                       -- local date where it happened (EC-D1), drives all reporting
  occurred_at        timestamptz,                         -- optional precise time (suggestions)
  source             txn_source not null default 'app',
  recurring_id       uuid,
  needs_review       boolean not null default false,      -- Shortcuts inbox
  parent_id          uuid references transactions on delete cascade, -- splits (P2)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (user_id, client_id),
  check ( (type = 'adjustment' and amount_pence <> 0) or (type <> 'adjustment' and amount_pence > 0) ),
  check ( (type = 'transfer') = (counter_account_id is not null) ),
  check ( counter_account_id is distinct from account_id ),
  check ( (type in ('expense','income')) = (category_id is not null) )
);
create index txn_user_date   on transactions (user_id, occurred_on desc, created_at desc) where deleted_at is null;
create index txn_user_cat    on transactions (user_id, category_id, occurred_on) where deleted_at is null;
create index txn_user_acct   on transactions (user_id, account_id, occurred_on) where deleted_at is null;
create index txn_note_trgm   on transactions using gin (note gin_trgm_ops);

-- recurring_items, recurring_occurrences, bank_holidays: see §6.9 (Bills)

create table budgets (                    -- P1
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories,
  amount_pence bigint not null check (amount_pence > 0),
  rollover     boolean not null default false,
  starts_on    date not null,
  unique (user_id, category_id, starts_on)
);

create table insight_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  scope         text not null check (scope in ('weekly','monthly','adhoc')),
  period_start  date not null,
  period_end    date not null,
  facts         jsonb not null,                -- exactly what the model saw
  cards         jsonb not null,                -- validated output
  model         text not null,
  input_tokens  int, output_tokens int,
  created_at    timestamptz not null default now()
);

create table insight_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  run_id      uuid not null references insight_runs on delete cascade,
  card_key    text not null,
  card_type   text not null,
  action      text not null check (action in ('helpful','dismissed','opened')),
  created_at  timestamptz not null default now()
);

create table api_tokens (                 -- P1, Shortcuts
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  token_hash   text not null unique,          -- sha256; the plaintext is shown once
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table push_subscriptions (         -- NOT-01
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);

create table no_spend_days (              -- "Nothing to log" from the reminder
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
```

### 10.2a Later schema additions (one place to check)

These are in addition to §10.2 and the feature sections (§6.2a, §6.9, §6.12):

```sql
alter table transactions add column occurred_tz text;                              -- IANA zone where it happened (EC-D1)
alter table transactions add column is_reconcile boolean not null default false;   -- marks reconcile adjustments (display)
alter table trip_stops   add column currency char(3);                              -- per-stop default currency (EC-T7)
create table category_redirects (                                                   -- merged categories (EC-C4)
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_id uuid primary key, to_id uuid not null references categories, merged_at timestamptz not null default now());
```

### 10.3 Row-level security
Enable RLS on **every** table. Use the same four policies everywhere (generate them in the migration):

```sql
alter table <t> enable row level security;
create policy "<t>_select" on <t> for select using (user_id = auth.uid());
create policy "<t>_insert" on <t> for insert with check (user_id = auth.uid());
create policy "<t>_update" on <t> for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "<t>_delete" on <t> for delete using (user_id = auth.uid());
```
`profiles` uses `id = auth.uid()`. `insight_runs` inserts happen server-side with the user's
session (or the service role in cron, which sets `user_id` explicitly). A SQL test must prove that
a second user cannot read any row (section 16).

### 10.4 Financial functions (the single source of truth)

All functions are `language sql stable security invoker` (RLS applies) and take London dates.

```sql
-- Only rows with counts_in_balance = true (and counter_counts_in_balance for the receiving
-- side of a transfer) affect balances (§6.2a). Analytics functions ignore these flags.
-- Signed effect of one transaction on one account
--   expense: −amount on account_id
--   income:  +amount on account_id
--   transfer: −amount on account_id, +amount on counter_account_id
--   adjustment: +amount (signed) on account_id

create function account_balances(p_as_of date default (now() at time zone 'Europe/London')::date)
returns table (account_id uuid, name text, type account_type, counts_as_cash boolean, balance_pence bigint);

create function available_cash(p_as_of date default (now() at time zone 'Europe/London')::date)
returns bigint;   -- Σ balance over counts_as_cash accounts (non-archived at p_as_of)

create function cash_flow(p_from date, p_to date)
returns table (
  opening_pence    bigint,   -- available_cash(p_from - 1)
  income_pence     bigint,   -- income into pool accounts
  spend_pence      bigint,   -- expenses from pool accounts
  set_aside_pence  bigint,   -- net transfers pool ↔ non-pool (negative = moved out)
  adjust_pence     bigint,   -- adjustments on pool accounts
  closing_pence    bigint    -- must equal available_cash(p_to); assert in tests
);

create function spend_by_category(p_from date, p_to date, p_parent uuid default null,
                                  p_level text default 'parent')   -- 'parent' | 'leaf' (§6.7.1)
returns table (category_id uuid, name text, icon text, parent_id uuid, parent_name text,
               is_fixed boolean, is_parent_direct boolean, total_pence bigint, txn_count int,
               norm_pence bigint);    -- norm = median of prior 6 periods, same day offset

create function category_monthly(p_category uuid, p_months int default 6,
                                 p_include_children boolean default true)
returns table (month date, total_pence bigint);

create function daily_spend(p_from date, p_to date)
returns table (day date, total_pence bigint, cumulative_pence bigint);

create function monthly_totals(p_months int default 12)
returns table (month date, income_pence bigint, spend_pence bigint);

create function top_payees(p_from date, p_to date, p_limit int default 10)
returns table (payee_id uuid, name text, visits int, total_pence bigint, avg_pence bigint);
```

**Invariant tests (must pass in CI):**
1. `cash_flow(f,t).closing = available_cash(t)` for random date ranges over fixture data.
2. `Σ account_balances(t) over pool = available_cash(t)`.
3. Transfers inside the pool change no `cash_flow` totals.
4. Editing a transaction dated 3 months ago changes `available_cash(today)` by exactly the delta.
5. With all accounts in the pool and no adjustments, `closing = opening + income − spend` exactly (the owner's formula).
6. `Σ spend_by_category(f,t,p_level=>'leaf')` per parent equals that parent's `spend_by_category(f,t)` row, and the grand totals match (§6.7.1).
7. Inserting a transaction with `counts_in_balance = false` changes no `account_balances` or `available_cash` value at any date, and changes `spend_by_category` for its period by exactly its amount.
8. For every account, `account_balances(anchor_on)` equals the balance the user entered at that anchor (opening or reconcile), however many past-dated rows are added later.
9. Invariants 1 and 2 still hold with mixed flags. `Σ spend_by_category(f,t)` minus `cash_flow(f,t).spend` equals the sum of non-balance pool expenses in `[f,t]`.

### 10.5 Seeding
`create function seed_default_categories(p_user uuid)` inserts the section 6.4 taxonomy (with
icons, colours and `is_fixed = true` for Rent & mortgage, Council tax, Energy, Water,
Broadband & TV, Home insurance, Mobile and Insurance). It is called by an `after insert` trigger
on `profiles`, and the profile is created by a trigger on `auth.users`. `supabase/seed.sql` (dev
only) also inserts 6 months of realistic demo transactions, matching the mock-up figures, for
local development and visual QA.

---

## 11. API surface

| Kind | Name | Input → Output |
|---|---|---|
| Server Action | `createTransaction` | zod `TxnInput` (incl. `client_id`) → `Transaction`; upserts on `(user_id, client_id)`; updates payee memory |
| Server Action | `updateTransaction`, `deleteTransaction`, `restoreTransaction` | id + patch → `Transaction` |
| Server Action | `upsertAccount`, `archiveAccount`, `reconcileAccount` | → `Account` / adjustment `Transaction` |
| Server Action | `upsertCategory`, `reorderCategories`, `archiveCategory`, `mergeCategory` | → `Category` |
| RPC | `available_cash`, `cash_flow`, `account_balances`, `spend_by_category`, `daily_spend`, `monthly_totals`, `top_payees` | see section 10.4 |
| Route | `POST /api/parse` (P1) | `{ text }` → `{ amount_pence, payee, category_id, account_id, occurred_on, confidence }` |
| Route | `POST /api/insights` | `{ scope }` → `InsightRun` (rate-limited) |
| Route | `POST /api/ask` (P1) | `{ messages }` → SSE stream |
| Route | `POST /api/v1/capture` (P1) | Bearer token; body as CAP-08 → `201 { id }` |
| Route | `GET /api/cron/*` | `Authorization: Bearer $CRON_SECRET` |
| Route | `GET /api/export?format=csv|json` | Streams the file |

---

## 12. AI implementation

### 12.1 Models
- **Insight digests and Ask Sterling:** `claude-sonnet-5-5` (best reasoning per pound for narrative over numbers).
- **Natural-language parse and payee → category guesses:** `claude-haiku-5-5` (fast and cheap; latency matters inside Quick Add).
- Keep the model IDs in `/lib/ai/models.ts`. Check current model names and pricing at <https://docs.claude.com> before building, because model lists change.

### 12.2 Pipeline for digests: compute first, narrate second

```
1. FACTS (SQL + TS, deterministic)     2. NARRATE (Claude)          3. VALIDATE (TS)          4. STORE + RENDER
   • MTD by category vs 6-mo norm         • system prompt (12.3)       • zod schema parse        • insight_runs row
   • pace vs last month, projection      • facts JSON as input        • numeric grounding       • cards on Home/Insights
   • anomalies (z > 2 and Δ > £30)       • tool: emit_cards(schema)   • drop failing cards      • client renders viz from
   • new payees, recurring candidates                                  • ≥ 2 cards or fallback     facts, not from model text
   • biggest transactions, weekday mix
   • last 50 feedback items
```

The facts payload is plain JSON with **pre-formatted strings next to raw values**, for example
`{"key":"eatout_mtd","value_pence":31260,"display":"£312.60"}`. The model is told to quote
`display` values verbatim. This makes grounding checkable.

Send the model aggregates and payee names only: no account numbers (none are stored), no notes
unless the user enables them, and no e-mail address.

### 12.3 System prompt (initial; keep it in `/lib/ai/prompts.ts`)

```
You write short, sharp observations about one person's spending, for a private finance app called
Sterling. The reader is financially literate and busy. Write in British English. Be specific,
warm and calm; never preachy, never alarmist.

Rules:
- Use ONLY the facts provided. Every number you write must appear verbatim as a "display" value
  in the facts. Do not calculate new numbers; if a figure is not in the facts, do not mention it.
- No investment, credit, pension, tax or product advice. You may suggest behavioural changes.
- Prefer insight over description: say what changed, by how much, and why it might matter.
- Prioritise: (1) things that change the month's outcome, (2) unusual changes, (3) wins.
- Respect feedback: do not repeat card types or topics the user dismissed recently.
- Output 3–6 cards by calling emit_cards. Titles ≤ 70 characters, bodies ≤ 220 characters.
```

Use **tool use with a strict JSON schema** (`emit_cards`) to get structured output:

```ts
const Card = z.object({
  key: z.string(),                         // stable id, e.g. "anomaly:eating_out:2026-10"
  type: z.enum(['pace','anomaly','trend','subscription','new_payee','win','suggestion']),
  severity: z.enum(['info','positive','caution']),
  title: z.string().max(70),
  body: z.string().max(220),
  metric: z.object({ fact_key: z.string(), delta_fact_key: z.string().optional() }).optional(),
  viz: z.enum(['spark','bar_compare','none']).default('none'),
  link: z.object({ kind: z.enum(['category','payee','screen']), id: z.string() }).optional(),
  rank: z.number().int().min(1).max(6),
});
```

### 12.4 Grounding validator (non-negotiable)
Extract every currency figure and percentage from each card's title and body with a regex
(`£[\d,]+(\.\d{2})?`, `\d+(\.\d+)?%`). Each one must exactly match a `display` string in the
facts payload; otherwise **drop the card** and log it. If fewer than 2 cards survive, retry once
with the failure list appended. If that also fails, fall back to template cards rendered
from the facts (deterministic copy), so the screen is never empty.

### 12.5 Ask Sterling tools (P1, read-only)
`get_cash_flow(from,to)`, `get_spend_by_category(from,to,parent?)`, `list_transactions(filters, limit≤50)`,
`compare_periods(a_from,a_to,b_from,b_to)`, `get_top_payees(from,to)`. Each tool calls the
corresponding SQL function **with the user's session** (RLS still applies). There are no write
tools. Cap each turn at 6 tool calls and each session at 20 turns.

### 12.6 Cost control
Cache digests (one per scope per period); on-demand refresh is limited to 10 per day; enforce
`AI_MONTHLY_TOKEN_CAP` by summing `insight_runs` tokens; show usage in Settings → AI. Expected
usage for one person is small (a few digests a week plus occasional parses), but the cap protects
against loops.

### 12.7 Data handling
Requests go from Vercel server functions directly to the Anthropic API. Under Anthropic's
commercial API terms, inputs are not used for model training by default; confirm the current terms
before launch and record them in `DECISIONS.md`.

---

## 13. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | RLS on all tables (tested); service-role key only in cron handlers; CSP headers; rate limits on `/api/*` (Upstash or a simple Postgres counter); API tokens hashed; app lock (P1). |
| Privacy | No third-party analytics or trackers. Vercel Web Analytics is acceptable (cookieless), or nothing at all. Privacy blur (P1). |
| Reliability | Idempotent writes (`client_id`); outbox survives app kill; nightly backup via Supabase (Pro) or a scheduled JSON export to the owner's e-mail (P1). |
| Performance | See MOB-08. SQL functions under 50 ms for 10,000 transactions (indexes in section 10.2). |
| Accessibility | WCAG 2.2 AA: 4.5:1 text contrast, visible focus rings on web, VoiceOver labels on icon buttons, charts provide a table alternative ("View as table"). |
| Correctness | All money in integers; invariant tests (section 10.4) in CI; month boundaries in Europe/London (test the BST change weekends: 29 Mar and 25 Oct 2026). |
| Internationalisation | `en-GB` only; dates as "Sun 18 Oct"; week starts Monday. |

---

## 14. Design system (summary; the mock-ups are authoritative)

**Direction:** quiet luxury in the spirit of Apple's own apps: restraint, generous space,
precise type, graphite surfaces on a near-black ground, ivory primary actions. **Dark only.** **Signature move:**
the available-cash hero, a very large tabular figure with pence in a lighter, smaller weight, and
directly beneath it the plain-English equation that produces it.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0C0D0C` | App ground |
| `--surface` | `#18191A` | Cards, grouped lists, sheets |
| `--surface-2` | `#212224` | Inset fields, keypad keys, icon tiles |
| `--surface-3` | `#2A2B2D` | Segmented-control track, progress track |
| `--ink` | `#F3F2EE` | Primary text, spend, primary buttons, focus series |
| `--on-ink` | `#0C0D0C` | Text and icons on ink buttons and the inverted outlook card |
| `--ink-2` | `#A9AAA4` | Secondary text |
| `--ink-3` | `#8D8F89` | Tertiary text (≥ 13 px only) |
| `--rule` | `rgba(255,255,255,.08)` | Hairlines |
| `--positive` | `#4FC487` | Income, under pace |
| `--caution` | `#EE9A52` | Over norm or budget |
| `--danger` | `#F0645A` | Destructive actions only |
| `--chart-context` | `#3A3B3D` | Comparison series |

**Type:** Instrument Sans. Scale (px / line-height / tracking / weight):
Hero 64/1.0/−0.045em/600 (76 on the detail screen and desktop) · Large title 32/1.1/−0.03em/600 · Title 22/1.2/−0.02em/600 ·
Headline 17/1.3/−0.01em/600 · Body 17/1.35/0/400 · Callout 15/1.35/0/400 ·
Subhead 13/1.3/0/500 · Caption 12/1.3/+0.06em/600 uppercase (section labels).
**All figures use `font-variant-numeric: tabular-nums`.**

**Space:** 4-pt base; scale 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56. Screen gutter 20 px. Inner gaps are always smaller than outer gaps.
**Shape:** grouped cards 16 px radius; sheets 28 px top radius; chips fully rounded; keypad keys 14 px; icon tiles 10 px.
**Depth:** no shadows on resting cards (surface contrast does the grouping). Sheets sit on a 60% black scrim. Tab bar: 82% surface with a 20 px backdrop blur and a top hairline.
**Colour discipline:** spend is ink, never red. Green means income or doing well; amber means "look at this". Category icons are monochrome on `--surface-2` tiles. The 10 category colours (muted: stone, sage, moss, sky, slate, clay, sand, plum, rose, ochre) appear only in multi-series charts.

---

## 15. Build plan for Claude Code

Work in this order. Commit at the end of each milestone, with all tests green, and deploy a preview to Vercel.

### M0: Foundations (½ day)
- Next.js + TS strict + Tailwind v4 with tokens from `design/tokens.css`; Instrument Sans; dark-only theme (no `prefers-color-scheme` switching, no `dark:` variants needed).
- Supabase project; migrations for section 10.2 + RLS (section 10.3) + seed function (section 10.5); generated types (`supabase gen types`).
- Email OTP auth with `ALLOWED_EMAIL`; middleware; app shell with tab bar (mobile) and sidebar (desktop).
- PWA manifest, icons, Serwist app-shell precache.
- **Done when:** sign-in works on an iPhone installed PWA; RLS test passes; Lighthouse PWA installable.

### M1: Accounts, categories, capture (2–3 days)
- Accounts CRUD, first-run setup (AUTH-02).
- Categories screen (CAT-03/04) and the Choose category screen (CAP-01.2).
- Add expense screen (CAP-01 to CAP-04) with payee memory and top categories (CAP-01.1); Undo toast.
- Offline outbox (CAP-05).
- Activity list, search and filters (ACT-01 to ACT-03).
- **Done when:** the CAP-01 and CAP-05 acceptance criteria pass in Playwright (mobile viewport 390 × 844).

### M2: Available cash (1–2 days)
- SQL functions in section 10.4 with invariant tests.
- Home hero, equation, pace (CASH-02, CASH-05); S7 detail with scrubber (CASH-03, CASH-04).
- Reconcile (ACC-05) and balance anchors (§6.2a): the `set_balance_flags()` trigger, the reconcile question sheet, and invariants 7–9.
- **Done when:** all five invariants pass; the hero matches the SQL to the penny after random edits.

### M3: Analytics (2–3 days)
- AN-01 to AN-08 with visx, finding titles, drill-downs, empty and loading states; desktop layout S10; exports.
- Sub-category analytics (§6.7.1): view switch, Category detail and Sub-category detail screens.
- **Done when:** every chart renders against the seed data and matches the mock-ups; "View as table" exists for each.

### M4: AI insights (1–2 days)
- Facts engine, prompt, `emit_cards` tool, grounding validator, fallback templates, cron, feedback.
- **Done when:** 20 consecutive generations on seed data produce zero ungrounded numbers (validator log) and at least 3 cards each.

### M4b: Evening reminder (½–1 day)
- `push_subscriptions` table + RLS, VAPID keys, service-worker `push` / `notificationclick` handlers, in-context permission card, Settings → Reminders, `/api/cron/nudge`.
- **Done when:** NOT-01 acceptance criteria pass on an installed iPhone PWA (test on a real device; the iOS simulator does not deliver Web Push).

### M4c: Bills (2–3 days)
- `/lib/recurrence.ts` (`nextOccurrences`) with full unit tests first; then the migration (§6.9 data model), cron engine, Bills overview + calendar, New/Edit form, Bill detail, notifications, detection, Home card.
- **Done when:** all ten REC acceptance criteria pass, including the cron idempotency and catch-up tests.

### M4d: Trips (3–4 days)
- `/lib/fx.ts` with unit tests (rounding, currency exponents, fees) and `/lib/tripMath.ts` (allowance, plan, projection) first.
- Migration (§6.12 data model, `btree_gist`), FX cron, auto-tagging in every capture path, the trip chip in Add expense and the transaction editor, Trips list, New/Edit trip, Trip overview and Expenses, the earlier-bookings sheet, trip insights and wrap-up, the Home trip card, "Exclude trips" in Analytics, and norm exclusion.
- **Done when:** all ten TRIP acceptance criteria pass against the Appendix A trip seed.

### M5: v1.1 (P1 backlog)
Natural-language entry, favourites, Shortcuts endpoint, budgets,
other push notifications (NOT-02 to NOT-04), Face ID lock, privacy blur, Ask Sterling, month-end projection.

**MVP = M0–M4b**, which covers all six mandatory capabilities plus the evening reminder:

| Mandatory capability | Delivered by |
|---|---|
| 1. Log income across multiple accounts | ACC-01/02, CAP-02, CAP-03 |
| 2. Log expenses as easily as possible with detailed default categories | CAP-01, CAP-01.1, CAP-05, CAT-01/02 |
| 3. Create new categories | CAT-03, CAT-04 |
| 4. Posh reporting and visual analytics | AN-01 to AN-08, section 14 |
| 5. AI-based insights on spending | AI-01 to AI-03, AI-06, section 12 |
| 6. Available cash at any point in time | CASH-01 to CASH-05 |

### Suggested `CLAUDE.md` for the repo
```
- Money is integer pence (bigint). Never use floats. Use /lib/money.ts.
- Never store derived balances; use SQL functions in supabase/migrations.
- Month boundaries and crons: Europe/London. occurred_on = local date where it happened (EC-D1).
- Visual truth = design/mockups/*.html and design/tokens.css. Don't introduce new colours or radii.
- Mobile first: build and test at 390×844 before desktop.
- Every new table: RLS policies + a SQL test proving cross-user isolation.
- AI copy must pass the grounding validator; never show unvalidated model text.
- Record judgement calls in DECISIONS.md.
```

---

## 16. Testing strategy

| Layer | Tool | Must cover |
|---|---|---|
| Money and dates | Vitest | `toPence` edge cases ("0.1", "12.", "1,234.50"), formatting, BST month boundaries |
| Suggestions | Vitest | Ranking with fixed fixtures; payee-pinned behaviour; cold-start fallback |
| SQL | pgTAP / Supabase test | Invariants 1–5 (section 10.4); RLS isolation with two users; category depth trigger; merge |
| AI | Vitest | Grounding validator (accepts exact, rejects invented, rejects altered rounding); schema parse; fallback path |
| Edge cases | Vitest / SQL / Playwright, as fits | Every row in §18, one test per ID (`EC-A1 …`) |
| E2E | Playwright (iPhone 14 profile + desktop) | 3-tap capture; offline outbox; edit and undo; reconcile; create category; analytics drill-down; screenshot comparison against the dark mock-ups |
| Visual | Playwright screenshots vs mock-ups | Home, Quick Add, Analytics at 390 px; Desktop at 1440 px |

---

## 17. Assumptions and open questions

| # | Assumption (change it if wrong) |
|---|---|
| A1 | "Month" means the calendar month (1st to last day) for the owner's formula; pay-cycle months are P2. |
| A2 | Savings accounts are **out** of available cash by default (a per-account toggle). With everything toggled in, the formula is exactly "opening + income − spend". |
| A3 | Credit card spend reduces available cash at the moment of purchase; the card repayment is a transfer. |
| A4 | Rent, bills, subscriptions, salary and regular transfers are logged automatically by Bills (§6.9). Monthly rules use calendar days; days 29–31 fall back to the month's last day. |
| A5 | Instrument Sans is the brand typeface on every platform (not SF Pro), so web and iPhone look identical. |
| A6 | No receipt images in MVP, so no Storage bucket is needed until P2. |
| A7 | The app is dark-only on every device (owner's decision, 18 Oct 2026). |
| A8 | The evening reminder is in the MVP (owner's decision, 18 Oct 2026). It needs the app installed to the iPhone Home Screen. |
| A9 | An opening balance or reconciled balance is true **as at the moment it was entered**. Anything dated earlier is already inside it and never moves it again (owner's rule, 28 Oct 2026; §6.2a). |

Open for the owner:
1. Do you want **pay-cycle months** (for example from payday to payday) promoted to MVP? It changes the "opening cash" date.
2. Should **savings transfers** show as "Set aside" in the equation (current design), or should savings simply be in the pool?


## 18. Edge-case register

This is the single checklist of awkward situations and how Sterling must behave in each. Every row is a requirement. Where a row points to a section, that section has the detail; where it says "new", this register is the spec.

**For Claude Code:** turn each row into at least one automated test (unit, SQL or Playwright), named after the row's ID, for example `test('EC-A1 pre-tracking expense is balance-neutral')`. Add any new edge case you discover here in the same format.

### 18.1 Money and amounts

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-M1 | Amount typed as "0", ".", "12.", "1,234.5", or with more than 2 decimals | Keypad: leading "." becomes "0."; a third decimal digit is ignored; Add stays disabled at £0. Pasted text: commas are stripped and the value is parsed with `toPence`; invalid input shows "Enter an amount". | CAP-01, `/lib/money.ts` |
| EC-M2 | Amount over £999,999.99 | Further digits are ignored, with a short shake on the amount. | CAP-01 |
| EC-M3 | Negative amounts | Never typed. Money coming back is **income** (refund); corrections are adjustments. | §10.1 |
| EC-M4 | Rounding (FX, card fees, splits) | Half-even to the penny using decimal arithmetic; never floats. Split remainders (P2) go to the largest part. | TRIP-06 |
| EC-M5 | Available cash below zero (card debt larger than cash) | The hero shows −£ with a real minus sign, and the label changes to "Overdrawn by". The colour stays ink; a caution dot sits beside it. | CASH-02 (new) |
| EC-M6 | Very large figures (£1,000,000+) | The hero figure shrinks to fit one line (min 44 px); it never wraps or truncates. | §14 (new) |
| EC-M7 | Credit card in credit (overpaid) | Balance shown as "£x in credit" and counted as positive cash. | ACC-01 (new) |

### 18.2 Dates and time

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-D1 | Logging abroad, for example 20:00 in New York (01:00 London next day) | `occurred_on` defaults to the **device's local date**, which is the day you experienced. `occurred_tz` stores the IANA zone. Reporting uses `occurred_on`; month and cron boundaries use Europe/London. | (new) |
| EC-D2 | British Summer Time changes (29 Mar, 25 Oct 2026; 28 Mar, 31 Oct 2027) | Cron jobs check London local time on every hourly run, so jobs never run twice or get skipped. The reminder fires at 21:00 local time. | REC-04, NOT-01 |
| EC-D3 | Days 29–31, 29 Feb, last day of month | Moved to the month's last day; yearly 29 Feb → 28 Feb in non-leap years. | REC-04 |
| EC-D4 | Back-dating into a month whose insights were already generated | Totals recalculate immediately. Insight cards for that period are marked stale and regenerated on the next run. | §12 (new) |
| EC-D5 | Future-dated expense (for example, paying a deposit next week) | Allowed up to 12 months ahead. It doesn't affect balances until its date and appears in Activity under "Scheduled". The Bills calendar shows it as due. | (new) |
| EC-D6 | Device clock wrong | Server time is authoritative for `created_at`, crons and "today". `occurred_on` is whatever the user picked. | (new) |
| EC-D7 | Expense dated before tracking began | Doesn't affect balances; counts in analytics. Its month is marked partial. | BAL-03, BAL-07 |

### 18.3 Accounts and balances

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-A1 | Expense dated before the account's opening date (for example, a July flight) | `counts_in_balance = false` automatically, with an inline note. Still counts in July spend and in the trip. | BAL-03 |
| EC-A2 | Expense dated on or before the account's latest reconcile | Ask "Was this already in your ‹account› balance?" Default Yes = not in balance. | BAL-03 |
| EC-A3 | Expense dated on the opening date itself | Counts in the balance, with a toggle "Already included in my opening balance". | BAL-03 |
| EC-A4 | Transfer where each side has a different anchor | Each side is judged against its own account. | BAL-04 |
| EC-A5 | Account moved in or out of the cash pool | Applies to all dates: history is recomputed with current membership. S7 notes "Pool changed on ‹date›". | CASH-01 (new) |
| EC-A6 | Changing an account's opening balance or opening date | Recompute auto balance flags and show how many changed; manual flags are kept. | BAL-08 |
| EC-A7 | Deleting an account that has transactions | Not allowed; offer Archive. Accounts with no transactions can be deleted. | ACC-03 |
| EC-A8 | Archived account referenced by a bill, a favourite or the default account | Bill occurrences go to `pending` ("choose another account"). Favourites are hidden. The default switches to the most-used active account. | REC-04 (new for the others) |
| EC-A9 | Reconcile after back-filling past items | Non-balance rows are excluded from the balance being compared, so there is no double correction. | BAL-08 |
| EC-A10 | Reconciling to the same balance (no difference) | No adjustment is created, but `last_reconciled_on` is updated, so the anchor moves. | ACC-05 (new) |

### 18.4 Capture, editing and sync

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-C1 | Double tap on Add, or a network retry | `client_id` makes the write idempotent, and the button is disabled while saving. Exactly one row is created. | CAP-05 |
| EC-C2 | Offline for days, app killed | The outbox survives in IndexedDB. A persistent "3 waiting to sync" badge shows until flushed. | CAP-05 |
| EC-C3 | Same transaction edited on two devices | Last write wins by `updated_at`. The losing device shows "Updated on another device" and refreshes. | (new) |
| EC-C4 | Outbox item uses a category that was merged or archived meanwhile | Archived categories still accept writes (history matters). Merged categories redirect through `category_redirects (from_id, to_id)`. | CAT-04 (new) |
| EC-C5 | Session expires while offline | Queued writes are kept. After the user signs in again they are flushed under the same `client_id`s. | (new) |
| EC-C6 | Undo after the write has synced | A soft delete is sent; Undo restores it. Purged after 30 days. | CAP-01 |
| EC-C7 | Payee variants ("Gail's", "GAILS LTD") | Matched on `name_norm` and trigram similarity of at least 0.6; the user can merge payees in Settings. | §10.2 |
| EC-C8 | Transaction type changed (expense → income) | The category resets (income and expense categories are separate). The trip tag is removed, because income is never auto-tagged. Balance flags are recomputed. | CAP-04 (new) |
| EC-C9 | Closing Add expense with unsaved input | "Discard this expense?" sheet; closes immediately if nothing was entered. | CAP-01 |
| EC-C10 | Manual expense for a payee that Bills logs within ±3 days | Ask before adding a probable duplicate. | REC-08 |
| EC-C11 | iOS clears the app's local storage (Safari may evict website data) | The app re-hydrates from the server. Only unsynced outbox items are at risk; flush them aggressively (on focus and on every successful network call). | MOB-08 (new) |

### 18.5 Categories

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-K1 | Deleting a category with transactions | Not allowed; offer "Merge into…". | CAT-04 |
| EC-K2 | Merging a parent that has sub-categories | Its sub-categories move under the target parent. A name clash asks to "Combine" or "Keep both" (renamed "‹name› (2)"). | CAT-04 (new) |
| EC-K3 | Archived category among the top tiles | Hidden immediately; the next-ranked category fills the slot. | CAP-01.1 (new) |
| EC-K4 | Sibling names differing only by case ("coffee" vs "Coffee") | Rejected as duplicates (case-insensitive unique). | CAT-03 (new) |
| EC-K5 | Parent with no sub-categories | The picker shows the parent as a single row; tiles show it with the caption "General". | CAP-01.2 |
| EC-K6 | Spend assigned to a parent directly | Shown as "Other ‹parent›" in sub-category views. | §6.7.1 |

### 18.6 Bills (recurring payments)

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-B1 | Cron runs twice, or misses days | `unique (item_id, scheduled_on)`; catch-up logs each missed occurrence on its original date and sends one summary. | REC-04 |
| EC-B2 | Due on a weekend or bank holiday | "On the day" (default) or "Next working day" (England & Wales, gov.uk feed; cached fallback). | REC-04 |
| EC-B3 | Amount varies | Logs the last confirmed amount as an estimate (EST); confirm or change from the notification. | REC-04 |
| EC-B4 | Pause, then resume | No back-fill for the paused period. | REC-04 |
| EC-B5 | Skip next | That occurrence is `skipped`; can be undone until the due date. | REC-06 |
| EC-B6 | Edit amount or day mid-cycle | Affects future occurrences only; logged ones never change. | REC-03 |
| EC-B7 | First due date is before tracking began | Logged as "Already in your opening balance" (`counts_in_balance = false`). | BAL-08 |
| EC-B8 | Recurring transfer to savings | Logged as a transfer; shown as "Set aside" in the cash equation; excluded from bill totals. | REC-02 |
| EC-B9 | Bill dated during a trip | Never auto-tagged to the trip. | TRIP-04 |
| EC-B10 | Stop, then delete | Stop keeps history; full delete only from "Ended", and transactions are kept with the link removed. | REC-06 |

### 18.7 Trips and foreign currency

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-T1 | Overlapping trips | Blocked by an exclusion constraint, with a message naming the clashing trip. | TRIP-03 |
| EC-T2 | Trip dates edited so tagged expenses fall outside | Ask: keep or remove. Bookings are always kept. | TRIP-03 |
| EC-T3 | Booking made before tracking began (for example July) | Add from the trip; balance-neutral; counts in the trip and in July spend. | BAL-08, TRIP-04a |
| EC-T4 | Date changed to outside the trip on an *auto-tagged* expense | The chip is removed automatically. If the chip was set manually, or the expense was opened from "Add to ‹trip›", it stays (`trip_origin = 'manual'` or `'booking'`). | TRIP-04a |
| EC-T5 | Bills, transfers and income during a trip | Never auto-tagged; refunds can be tagged manually and reduce the trip total. | TRIP-04 |
| EC-T6 | Domestic trip (GBP) | No conversion UI; the currency chip is hidden. | TRIP-03 |
| EC-T7 | Several countries on one trip (US + Canada) | The trip currency is only the default; the currency chip can pick any currency for each expense. Stops may set their own default currency. | TRIP-06 (new) |
| EC-T8 | Zero- or three-decimal currencies (JPY, KWD) | Minor units follow the ISO 4217 exponent; the keypad hides "." for JPY. | TRIP-06 |
| EC-T9 | No exchange rate available (API down, unsupported currency) | Use the last cached rate. If there is none, ask for the £ amount, or a rate ("1 XXX = ? GBP"), before saving. | TRIP-06 (new) |
| EC-T10 | Past-dated foreign expense | Uses the historical rate for that date. | BAL-08 |
| EC-T11 | £ corrected to match the statement | `fx_source = 'manual'`; never recalculated; effective rate shown. | TRIP-06 |
| EC-T12 | Trip spans a month end | Each expense counts in its own month; the trip total is unaffected. | TRIP-09 |
| EC-T13 | Over budget | The bar turns caution; the allowance line reads "£x over budget"; the insight card switches to "at risk". | TRIP-07 |
| EC-T14 | No budget | The budget card shows the total, the on-trip daily average and the split, with no allowance. | TRIP-07 |
| EC-T15 | Days not covered by any stop | Grouped as "Other" in By stop. | TRIP-03 |
| EC-T16 | One-day trip, or trip longer than 60 days | One day: the daily chart is hidden. Over 60 days: the daily chart becomes weekly bars. | TRIP-07 (new) |
| EC-T17 | Trip deleted | Transactions are kept, with `trip_id = null`. | TRIP-03 |
| EC-T18 | Refund larger than a category's trip spend | The category shows net £0 with "net refund £x"; the trip total is reduced. | (new) |

### 18.8 Analytics and AI insights

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-N1 | Months before tracking began (back-filled) | Labelled "Partial: before tracking"; excluded from norms, pace and AI baselines. | BAL-07 |
| EC-N2 | Fewer than 3 prior complete periods | "Usual" markers and ↑ flags are hidden; the subtitle reads "Not enough history yet". | AN-02 (new) |
| EC-N3 | Trip spending | Excluded from norms; an "Exclude trips" switch is available. | TRIP-09 |
| EC-N4 | Empty period or category | An empty state with a link to the previous period; never a zero-height chart. | §6.7 |
| EC-N5 | Net-negative category (refunds) | The bar is clamped at 0 with a "net refund" label. | (new) |
| EC-N6 | AI monthly token cap reached, or the API is down | Template cards from facts; a quiet "AI summary paused" note. | §12.6 |
| EC-N7 | AI output fails grounding | The card is dropped; one retry; then template fallback. | §12.4 |
| EC-N8 | Fewer than 10 transactions in total | Insights hidden: "Log a few more days and insights will appear." | (new) |

### 18.9 Notifications, PWA and security

| ID | Situation | Expected behaviour | Ref |
|---|---|---|---|
| EC-P1 | App not installed to the Home Screen (iOS) | Push options are disabled, with an "Install Sterling to get reminders" card. | NOT-01 |
| EC-P2 | Notification permission denied | The toggle shows "Off in iPhone Settings" with steps; Sterling doesn't ask again. | NOT-01 (new) |
| EC-P3 | Push endpoint expired (404/410) | Subscription deleted; re-subscribe on next launch if permission is still granted. | NOT-01 |
| EC-P4 | Several devices subscribed | Send to all. The evening reminder checks "logged today" once, server-side. | NOT-01 |
| EC-P5 | Bills and the reminder on the same evening | The reminder treats auto-logged bills as **not** user activity, so it still nudges if nothing was logged manually. | NOT-01 (new) |
| EC-P6 | Shortcuts API token revoked or leaked | Revoking takes effect immediately (401); tokens are stored hashed; per-token rate limit of 60 per hour. | CAP-08 |
| EC-P7 | Second user tries to sign in | Blocked by `ALLOWED_EMAIL`; RLS proves isolation in tests. | AUTH-01 |
| EC-P8 | "Delete all data" | Cascades every user table, including push subscriptions, trips, bills, FX overrides and AI runs; signs out everywhere. | SET-05 |

---

## Appendix A: Sample data used in the mock-ups (Sun 18 Oct 2026)

| Item | Value |
|---|---|
| Opening cash, 1 Oct | £7,862.40 |
| Income, 1–18 Oct | £140.00 (refund £121.60, interest £18.40) |
| Spend, 1–18 Oct | £3,236.85 |
| **Available cash** | **£4,765.55** |
| Spend by this point in September | £3,604.10 (so £367.25 lower) |
| Pool accounts | Monzo £3,214.08 · HSBC £2,486.20 · Cash £250.00 · Amex −£1,184.73 (sum £4,765.55) |
| Outside pool | Marcus savings £12,400.00 |
| Categories MTD | Home £1,812.40 · Groceries £386.25 · Eating out £312.60 · Transport £214.80 · Shopping £178.90 · Bills £118.43 · Health £96.00 · Entertainment £74.97 · Family & giving £42.50 |
| Projected close | ≈ £2,940 (before salary) |
| Sub-categories MTD (seed) | Home: Rent & mortgage £1,600.00 (fixed), Council tax £142.00 (fixed), Energy £48.40 (fixed), Broadband & TV £22.00 (fixed) · Groceries: Supermarket £314.70, Specialist shops £48.90, Household supplies £22.65 · Eating out: Restaurants £142.50, Coffee & snacks £76.80, Takeaway & delivery £58.30, Work lunches £28.60, Drinks £6.40 · Transport: TfL & rail £142.60, Taxis £57.20, Parking & tolls £15.00 · Shopping: Online & general £98.40, Clothing & shoes £65.50, Homeware £15.00 · Bills: Mobile £36.00 (fixed), Insurance £62.43 (fixed), Bank fees & interest £20.00 · Health: Gym & fitness £75.00, Pharmacy £21.00 · Entertainment: Streaming & apps £41.97, Events & culture £33.00 · Family & giving: Gifts £42.50 |
| Sub-category usual by day 18 (seed) | Supermarket £298.00 · Specialist shops £43.00 · Household supplies £20.00 · Restaurants £105.00 · Coffee & snacks £54.00 · Takeaway & delivery £43.00 · Work lunches £19.00 · Drinks £5.00 · TfL & rail £178.00 · Taxis £58.00 · Parking & tolls £15.00 · Online & general £90.00 · Clothing & shoes £94.00 · Homeware £20.00 · Bank fees & interest £19.57 · Gym & fitness £75.00 · Pharmacy £13.00 · Streaming & apps £38.97 · Events & culture £32.03 · Gifts £55.00 (fixed sub-categories: usual = this month) |
| Eating out by month (seed) | May £218.40 · Jun £243.10 · Jul £331.20 · Aug £287.60 · Sep £264.10 · Oct £312.60 to date |

Use these exact figures in `supabase/seed.sql` so that visual tests can compare against the mock-ups.

### Appendix A.2: Trip seed ("USA", used by the Trips mock-ups and TRIP acceptance criteria)

| Item | Value |
|---|---|
| Trip | USA · United States · USD · Sat 6 – Sat 20 Mar 2027 (15 days) · budget £5,000 · auto-add on |
| Stops | Chicago 6–8 Mar · New York 9–15 Mar · Miami 16–20 Mar |
| "Today" for the mock-ups | Fri 12 Mar 2027 (day 7) · tracking start 18 Oct 2026 |
| FX rate (fixed for seed) | 1 USD = 0.7900 GBP; `fx_fee_bps = 0` |
| Booked before (GBP) | 2026-07-14 United (Flights) £176.20 **not in balance (before tracking)**; 2026-12-02 British Airways (Flights) £1,184.60; 2026-12-09 Aviva Travel (Visas & insurance) £38.90; 2027-01-14 The Hoxton Williamsburg (Hotels) £642.00; 2027-02-03 Kimpton Angler's (Hotels) £418.50 |
| On the trip (USD → GBP) | 2027-03-06 Uber (Taxis) $58.40 → £46.14; 2027-03-06 Au Cheval (Restaurants) $96.20 → £76.00; 2027-03-07 Art Institute of Chicago (Events & culture) $64.00 → £50.56; 2027-03-07 Lou Malnati's (Restaurants) $72.30 → £57.12; 2027-03-07 CTA Ventra (Other transport) $20.00 → £15.80; 2027-03-08 Gift for hosts (Gifts) $85.00 → £67.15; 2027-03-08 Intelligentsia (Coffee & snacks) $12.40 → £9.80; 2027-03-09 Uber (Taxis) $46.80 → £36.97; 2027-03-09 O'Hare Terminal 1 (Coffee & snacks) $24.50 → £19.36; 2027-03-09 Uber (Taxis) $68.90 → £54.43; 2027-03-10 Joe's Pizza (Restaurants) $18.00 → £14.22; 2027-03-10 MoMA (Events & culture) $60.00 → £47.40; 2027-03-10 OMNY (Other transport) $34.00 → £26.86; 2027-03-10 Carbone (Restaurants) $210.00 → £165.90; 2027-03-11 Russ & Daughters (Restaurants) $58.75 → £46.41; 2027-03-11 Uniqlo Fifth Avenue (Clothing & shoes) $142.60 → £112.65; 2027-03-11 Hamilton · Broadway (Events & culture) $289.00 → £228.31; 2027-03-12 Blue Bottle (Coffee & snacks) $11.80 → £9.32; 2027-03-12 Ess-a-Bagel (Restaurants) $21.40 → £16.91 |
| Totals | Booked £2,460.20 · on trip £1,101.31 ($1,394.05) · spent £3,561.51 · left £1,438.49 · plan £169.32/day · actual £157.33/day · allowance £159.83/day · projected £4,820.15 |
| Past trips (list only) | Lisbon Jun 2026 £1,240.80 · Edinburgh Aug 2025 £684.20 · Goa Dec 2024 £2,315.60 |
