# Sterling: Product Requirements Document

**A personal expense manager for one person, in pounds, designed to be used one-handed on an iPhone.**

| | |
|---|---|
| Version | 1.1 (dark-only; evening reminder in MVP) |
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
| J1 | "I just paid for something, so log it before I forget." | 3–8× per day | Quick Add sheet (mobile) |
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
| Recurring | n/a | Recurring income and bills (auto-post or remind) and subscription detection | Calendar of upcoming bills |
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
- **Settings** is reached from the avatar at the top right of Home. It holds Accounts, Categories, Recurring, Export, Security and About.

### 5.2 Desktop navigation (≥1024 px)
A left sidebar (Home, Activity, Analytics, Insights, Accounts, Categories, Settings) with a
persistent **"Add transaction"** button (keyboard shortcut `N`). Content uses a 12-column grid,
max-width 1360 px. Quick Add opens as a centred modal (480 px) rather than a sheet.

### 5.3 Screen inventory (each has a mock-up)

| ID | Screen | Mock-up file |
|---|---|---|
| S1 | Home | `01-home.html` |
| S2 | Quick Add sheet | `02-quick-add.html` |
| S3 | Category picker (sheet state) | `03-category-picker.html` |
| S4 | Activity | `04-activity.html` |
| S5 | Analytics (long scroll) | `05-analytics.html` |
| S6 | Insights (AI) | `06-insights.html` |
| S7 | Available cash detail | `07-available-cash.html` |
| S8 | Accounts | `08-accounts.html` |
| S9 | Categories + New category sheet | `09-categories.html` |
| S10 | Desktop dashboard | `10-desktop.html` |
| S11 | Evening reminder notification (lock screen, expanded with actions) | `11-reminder.html` |
| S12 | Settings → Reminders (toggle, time, week view) | `12-reminder-settings.html` |

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

**ACC-01 Create and edit an account (P0).** Fields: name (required, ≤40 chars), institution (optional free text), type (`current`, `savings`, `credit_card`, `cash`, `other`), current balance and as-of date (default today), and **"Counts towards available cash"** (default **on** for current, cash and credit card; **off** for savings). Credit card balances are entered as the amount owed and stored as a negative number.
- Accept: the balance after creation equals the entered balance exactly; credit card shows "−£1,184.73 owed".

**ACC-02 Default account (P0).** One account is the default for Quick Add. After 3 consecutive manual changes to the same other account, the default switches to that account silently, and Settings shows which account is the default.

**ACC-03 Archive (P0).** Archived accounts disappear from pickers and from the cash pool from the archive date onward. Historical transactions remain. An account can be archived only when its balance is £0, or the user confirms "write off remaining balance", which creates an adjustment.

**ACC-04 Account detail (P0).** Shows the balance, a 90-day balance sparkline, the transactions list filtered to the account, and Edit / Reconcile / Archive actions.

**ACC-05 Reconcile (P1, but schema in P0).** "What does your bank app say?" The user types the real balance; Sterling shows the difference and, on confirm, creates an `adjustment` transaction (type `adjustment`, signed) dated today with the note "Balance adjustment". Adjustments:
- *are* included in balances and available cash;
- are *excluded* from spend and income analytics (they are corrections, not behaviour);
- are listed in Activity with a distinct "Adjustment" label.
- Accept: after reconciling, the account balance equals the typed balance to the penny.

### 6.3 Capture: the most important feature

**Target:** median time to log an expense ≤ **5 seconds**, and **3 taps** for the common case
(＋ → amount → category = saved). The Quick Add sheet must open in under **100 ms** after
tapping ＋, so it must be pre-rendered and kept mounted, not lazily loaded.

**CAP-01 Quick Add sheet layout (P0).** See mock-up `03-quick-add.html`. From top to bottom:
1. Grab handle; segmented control **Expense · Income · Transfer** (Expense is the default; the sheet remembers nothing between opens except the account).
2. **Amount display**: large, tabular, `£` prefix, pence in a lighter weight. It starts at `£0` with a blinking caret.
3. **Payee field**: "Where?" placeholder, with autocomplete from the `payees` table (prefix and trigram match, ranked by use_count × recency).
4. **Smart category row**: six suggested category chips (section 6.3.1), followed by a "More" chip that opens the Category picker (S3).
5. **Meta row**: account chip (default account), date chip ("Today"; tap for Yesterday / pick a date), note chip.
6. **Custom numeric keypad**: 3×4 keys `1–9 . 0 ⌫`. Using our own keypad rather than the iOS keyboard keeps the sheet height fixed and the keys large (≥ 64 × 52 pt).
7. **Primary button**: "Add £12.80". It is disabled until the amount is greater than 0 and a category is chosen.

Behaviour:
- **Typing a payee that has history auto-selects its learned category and account**, so the common path is: ＋ → type amount → tap a suggested chip → Add. When the payee was auto-filled, tapping a category chip **is** the save action (setting: "Tap category to save", default on). This produces the 3-tap path.
- Amount entry: max 2 decimal places, max £999,999.99; a leading "." becomes "0."; ⌫ long-press clears.
- On save: the sheet closes, a toast reads "Added £12.80 · Coffee & snacks" with an **Undo** button (6 s), and the Home hero animates to its new value (count-down over 400 ms with an ease-out curve).
- Swipe-down dismisses; if an amount has been entered, ask "Discard this entry?" first.
- Accept: three taps log a coffee when the payee is known; the transaction appears in Activity and the hero updates without a page reload; Undo removes it completely (it is soft-deleted, then hard-deleted after 30 days).

**CAP-01.1 Smart category suggestions (P0).** Rank the user's categories for the six chips by a score computed client-side from the last 180 days:
```
score = 0.45·freq_same_hour_band (±2h) + 0.25·freq_same_weekday
      + 0.20·recency (exp decay, half-life 14 days) + 0.10·overall_freq
```
If the payee has a learned category, that category is pinned first. With fewer than 20 transactions recorded, fall back to the default order: Groceries, Eating out, Transport, Shopping, Home, Bills. Suggestions show the *sub-category* when the user has used it at least 3 times (for example "Coffee & snacks" rather than "Eating out").

**CAP-02 Income (P0).** Same sheet, **Income** segment. The chips show income categories (Salary, Bonus, Interest, Refund, Freelance, Gift, Other). The account defaults to the account that last received income. The button reads "Add income £…", and the amount renders in the positive colour.

**CAP-03 Transfer (P0).** **Transfer** segment: **From** and **To** account pickers, no category. Paying a credit card bill = transfer from current account → credit card. Transfers never count as spend or income.
- Accept: a £500 transfer from Monzo to Amex leaves available cash unchanged (both accounts are in the pool) and changes both account balances by £500.

**CAP-04 Edit and delete (P0).** Tapping any transaction opens the same sheet pre-filled. Delete is at the bottom (destructive, with confirm). Swipe-left on a row reveals Delete; swipe-right reveals Duplicate. Every edit updates `updated_at`; all figures recompute.

**CAP-05 Offline capture (P0).** Quick Add must work with no signal (for example on the Underground).
- Writes go to an IndexedDB **outbox** (Dexie) with a client-generated `client_id` (UUID v7). They are optimistically shown in all views, marked with a small "waiting to sync" glyph.
- Flush the outbox when the app comes back online (`online` event), when it regains focus (`visibilitychange`), and on launch. **Do not rely on the Background Sync API**, which iOS Safari does not support.
- The server upserts on `client_id` (unique), so retries are idempotent.
- Accept: in airplane mode, log 3 expenses, kill the app, reopen it online, and exactly 3 rows exist in Postgres.

**CAP-06 Natural-language entry (P1).** The payee field accepts free text such as `28.50 dishoom dinner amex yesterday`. A local parser runs first (regex for the amount, date words, and fuzzy match of account names and known payees). If confidence is below 0.8, call `/api/parse` (Claude Haiku, structured output; section 12.2) and pre-fill the sheet. **It never auto-saves**: the user always sees the filled form and taps Add.

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

**CASH-03 As-at any point in time (P0).** S7 has a date scrubber: drag along the month's available-cash line, or pick any past date, to see the figure **as at that moment**, with that month's equation. It is computed server-side via `cash_flow(from, to)`; it is never cached.

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
| AN-02 | **Where it went** | "What are the biggest categories?" | Horizontal bars, sorted by amount, top 8 plus "Everything else". Each row: icon, name, amount, share %, and a delta vs the 6-month average at the same point in the month (↑ 38% shown in caution colour if > +20% and > £30). Tap → sub-categories → transactions. |
| AN-03 | **Cash flow** | "How did opening cash become available cash?" | A waterfall: Opening → +Income → −top 4 categories → −Other → (±Set aside) → Available. This directly visualises the CASH-01 equation. |
| AN-04 | **12-month trend** | "Is my spending creeping up?" | Monthly spend bars for the last 12 months, the current month shown as actual plus a projected (hatched) section, a 12-month average reference line, and an income line overlay (toggle). |
| AN-05 | **Daily rhythm** | "Which days do I spend on?" | A calendar heatmap for the selected month (sequential single-hue ramp, 5 steps); weekday averages beneath. |
| AN-06 | **Top payees** | "Who do I pay most?" | A ranked list: payee, visits, total, average ticket. |
| AN-07 | **Category deep dive** | Opened from any category | A 12-month bar chart for that category, average ticket, frequency, top payees, sub-category split, and transactions. |
| AN-08 | **Compare periods** (P0) | "Oct vs Sep" or "2026 vs 2025" | A side-by-side table by category with absolute and percentage deltas, sorted by the largest absolute change. |
| AN-09 | **Savings rate** (P1) | "How much of my income do I keep?" | Monthly (income − spend) / income as a line, with a 3-month moving average. |
| AN-10 | **Budget vs actual** (P1) | "Am I inside my budgets?" | For each budgeted category: a progress bar plus pace marker; over-budget shown in caution colour. |

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

### 6.9 Recurring and budgets (P1)

**REC-01 Recurring rules.** These cover salary, rent, subscriptions and standing orders. Fields: the template transaction, frequency (weekly, monthly, yearly; interval n; day-of-month or "last working day"), start date, optional end date, and mode **Auto-post** (creates the transaction on the due date at 06:00 via cron) or **Remind** (a push notification plus an Inbox item to confirm).

**REC-02 Detection.** A nightly job finds candidates: the same payee, an amount within ±10%, an interval of 28–31 days (or 7, or 365) seen at least 3 times, and no existing rule. It surfaces "Looks like Netflix is monthly, £12.99. Track it?" in Insights.

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
**NOT-03 Recurring "Remind" items due (P1).**
**NOT-04 Anomaly alerts (P1).** As AI-05.

---

## 7. Mobile UX requirements

| ID | Requirement |
|---|---|
| MOB-01 | **Standalone PWA**: `display: standalone`, `theme_color` and `background_color` `#0C0D0C`, `apple-mobile-web-app-status-bar-style: black-translucent`, dark iOS splash screens, `apple-touch-icon` 180 px. Set `color-scheme: dark` on `:root` so form controls and scrollbars render dark. |
| MOB-02 | **Safe areas**: respect `env(safe-area-inset-*)`; the tab bar sits above the home indicator; sheets extend under it. |
| MOB-03 | **Bottom sheets** via **Vaul** (drag to dismiss, snap points, background scales to 0.94 with a rounded top, as in iOS). Quick Add, Category picker, filters, date picker and account picker are all sheets. |
| MOB-04 | **Touch targets ≥ 44 × 44 pt**; keypad keys ≥ 64 × 52 pt. |
| MOB-05 | **Gestures**: swipe rows (delete / duplicate), pull-to-refresh on Activity and Insights, long-press ＋ for favourites, horizontal swipe on Analytics period. |
| MOB-06 | **Motion**: spring transitions (stiffness 400, damping 34); the hero figure animates numerically; respect `prefers-reduced-motion`. |
| MOB-07 | **Haptics**: iOS Safari does not expose `navigator.vibrate`, so do not depend on it. Use it where supported (Android) and design so that nothing relies on it. |
| MOB-08 | **Performance**: first load ≤ 1.8 s on 4G (LCP); repeat launches render cached data instantly (TanStack Query persisted to IndexedDB, plus the service-worker app shell); interaction latency ≤ 100 ms. |
| MOB-09 | **Keyboard avoidance**: when a text field is focused in a sheet, the sheet resizes using `visualViewport`, so nothing hides behind the iOS keyboard. |
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
| Recurring post / remind (P1) | Daily 06:00 | `/api/cron/recurring` |
| Evening reminder (P0, NOT-01) | Every 15 min (or hourly); the handler checks the user's London reminder time | `/api/cron/nudge` |
| Recurring detection (P1) | Daily 03:00 | `/api/cron/recurring?detect=1` |

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
  tap_to_save      boolean not null default true,
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
  occurred_on        date not null,                       -- London local date, drives all reporting
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

create table recurring_rules (            -- P1
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  type               txn_type not null check (type in ('expense','income','transfer')),
  amount_pence       bigint not null check (amount_pence > 0),
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,
  category_id        uuid references categories,
  payee_id           uuid references payees,
  frequency          text not null check (frequency in ('weekly','monthly','yearly')),
  interval_n         smallint not null default 1,
  day_rule           text,                       -- e.g. 'dom:25', 'last_working_day'
  next_due_on        date not null,
  end_on             date,
  mode               text not null default 'remind' check (mode in ('auto','remind')),
  active             boolean not null default true
);

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

create function spend_by_category(p_from date, p_to date, p_parent uuid default null)
returns table (category_id uuid, name text, icon text, total_pence bigint, txn_count int,
               norm_pence bigint);    -- norm = median of prior 6 periods, same day offset

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
- Categories screen (CAT-03/04) and Category picker sheet.
- Quick Add sheet (CAP-01 to CAP-04) with payee memory and smart suggestions; Undo toast.
- Offline outbox (CAP-05).
- Activity list, search and filters (ACT-01 to ACT-03).
- **Done when:** the CAP-01 and CAP-05 acceptance criteria pass in Playwright (mobile viewport 390 × 844).

### M2: Available cash (1–2 days)
- SQL functions in section 10.4 with invariant tests.
- Home hero, equation, pace (CASH-02, CASH-05); S7 detail with scrubber (CASH-03, CASH-04).
- Reconcile (ACC-05).
- **Done when:** all five invariants pass; the hero matches the SQL to the penny after random edits.

### M3: Analytics (2–3 days)
- AN-01 to AN-08 with visx, finding titles, drill-downs, empty and loading states; desktop layout S10; exports.
- **Done when:** every chart renders against the seed data and matches the mock-ups; "View as table" exists for each.

### M4: AI insights (1–2 days)
- Facts engine, prompt, `emit_cards` tool, grounding validator, fallback templates, cron, feedback.
- **Done when:** 20 consecutive generations on seed data produce zero ungrounded numbers (validator log) and at least 3 cards each.

### M4b: Evening reminder (½–1 day)
- `push_subscriptions` table + RLS, VAPID keys, service-worker `push` / `notificationclick` handlers, in-context permission card, Settings → Reminders, `/api/cron/nudge`.
- **Done when:** NOT-01 acceptance criteria pass on an installed iPhone PWA (test on a real device; the iOS simulator does not deliver Web Push).

### M5: v1.1 (P1 backlog)
Natural-language entry, favourites, Shortcuts endpoint, recurring rules and detection, budgets,
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
- All dates: Europe/London. occurred_on is a London-local date.
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
| E2E | Playwright (iPhone 14 profile + desktop) | 3-tap capture; offline outbox; edit and undo; reconcile; create category; analytics drill-down; screenshot comparison against the dark mock-ups |
| Visual | Playwright screenshots vs mock-ups | Home, Quick Add, Analytics at 390 px; Desktop at 1440 px |

---

## 17. Assumptions and open questions

| # | Assumption (change it if wrong) |
|---|---|
| A1 | "Month" means the calendar month (1st to last day) for the owner's formula; pay-cycle months are P2. |
| A2 | Savings accounts are **out** of available cash by default (a per-account toggle). With everything toggled in, the formula is exactly "opening + income − spend". |
| A3 | Credit card spend reduces available cash at the moment of purchase; the card repayment is a transfer. |
| A4 | Rent, bills and salary are logged manually until recurring rules (P1) exist. |
| A5 | Instrument Sans is the brand typeface on every platform (not SF Pro), so web and iPhone look identical. |
| A6 | No receipt images in MVP, so no Storage bucket is needed until P2. |
| A7 | The app is dark-only on every device (owner's decision, 18 Oct 2026). |
| A8 | The evening reminder is in the MVP (owner's decision, 18 Oct 2026). It needs the app installed to the iPhone Home Screen. |

Open for the owner:
1. Do you want **pay-cycle months** (for example from payday to payday) promoted to MVP? It changes the "opening cash" date.
2. Should **savings transfers** show as "Set aside" in the equation (current design), or should savings simply be in the pool?


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

Use these exact figures in `supabase/seed.sql` so that visual tests can compare against the mock-ups.
