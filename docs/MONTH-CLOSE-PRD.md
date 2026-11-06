# Sterling: month-end close PRD

| | |
|---|---|
| **Version** | 1.0 · 6 November 2026 |
| **Scope** | The month-end close only. Everything else in Sterling is already built and stays as it is. |
| **Ships with** | `design/mockups/MC01–MC11.html` and `design/screenshots/MC01–MC11.png` |
| **Build after** | Nothing. This has no dependency on unfinished work. |

This document only specifies what is new. Where the close uses something the app already has (accounts and balances, bills, budgets, the forecast, the "Nothing to log" marker, one-off flags, Quick Add), it says so and doesn't re-specify it. If any of those turns out to work differently in the codebase, follow the codebase, adapt the close to it, and record the decision in `DECISIONS.md`.

---

## 1. Why

Sterling is manual-entry only. Over a month, small errors build up without anyone noticing: a forgotten coffee, an estimated bill that was never confirmed, a duplicate tap, cash that went unrecorded. Every downstream number (available cash, analytics, budgets, the forecast's "usual") inherits those errors.

The month-end close is a short guided ritual on the 1st of each month. It finds the likely errors, lets the owner fix them in a tap or two, shows how the month went, and sets up the next one. It also turns each month into a **known-good record**: a snapshot that later changes are measured against.

### 1.1 Goals
1. **Accuracy:** after a close, every account balance matches the bank, every bill amount is confirmed, and every day is either logged or confirmed as a no-spend day.
2. **Speed:** a typical close takes about two minutes. Steps with nothing to check are skipped automatically.
3. **Closure:** a clear "November is closed" moment, with a review of the month worth reading.
4. **Better forecasts:** confirmed no-spend days, confirmed bills and one-off decisions feed straight into the forecast's history.

### 1.2 Non-goals
- Locking a month. Closed months stay editable; changes are tracked, not blocked.
- Bank connections or statement imports. The owner compares balances by looking at the banking app.
- Rollover of unspent budget, or any change to how budgets work.
- New analytics screens. The review lives inside the close flow.

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Closing month** | The calendar month being closed (Europe/London boundaries). It becomes closable at 00:00 London time on the 1st of the following month. |
| **Close** | One run through the flow for one month. Stored as a `month_closes` row. |
| **Step** | One of six screens: Missing days, Bills, Balances, Tidy up, Review, Next month. |
| **Item** | One thing to answer inside a step, such as a day, a bill or an account. |
| **Snapshot** | The month's figures, frozen at the moment of closing (§9). |
| **Status** | `open` → `in_progress` → `closed` / `closed_with_skips` / `closed_quick`. A closed month can be reopened. |
| **User-entered transaction** | Any transaction whose `source` is not `recurring`. Bills logged automatically don't count as the owner logging. |

---

## 3. Entry points and timing

**MC-01 Home card** (mock-up MC01, states in MC11).
- From the 1st, Home shows a card between the hero and Recent: "‹Month› is ready to close", one line saying what's waiting (for example "2 days with nothing logged, 2 bills to confirm, 4 balances"), the estimated time, and **Start** / **Later**.
- **Later** hides the card until 06:00 the next day.
- **In progress:** the card reads "Finish closing ‹Month›", with "N of 6 steps done. You stopped at ‹Step›", a 6-segment progress bar, and **Continue**.
- **After 14 days unclosed,** the card shrinks to a slim one-line row with the same tap target. It never disappears on its own and never closes a month automatically.
- **Closed:** the card disappears.

**MC-02 Other entry points.**
- **Analytics:** the month header shows a status chip (§10.3). Tapping "Open" on a past month starts its close.
- **Settings → Month close:** notification settings, the "Check savings" default, and a history of closes with their status. Each entry opens that month's review, read-only, with **Reopen**.
- **Notification tap:** opens the flow at the first unfinished step.

**MC-03 Estimated time.**
- 10 s per item in steps 1, 2 and 4, plus 15 s per account in step 3, plus 30 s for steps 5 and 6.
- Rounded to the nearest whole minute, with a minimum of 1. Shown as "About N min".

**MC-04 Availability.**
- A month can be closed only once it has ended. There is no early close.
- Eligible months run from the month tracking started to the previous month.
- **On first release,** only the most recent completed month is offered. Older months are recorded with status `open` but never prompted, so the owner isn't faced with a backlog on day one.

---

## 4. The flow framework

All steps share one shell (mock-ups MC03–MC09):
- **Header:** a close button (X), the title "Close ‹Month›" and "N of 6".
- **Progress bar:** six segments: done (ink), current (ink-2), not started (surface-3).
- **Body:** an eyebrow ("Step 2 · Bills"), a title stating the job in numbers ("Confirm 2 bills"), a one-sentence lead, then the items.
- **Footer:** a progress hint ("1 of 2 answered") and the primary button.

**MC-05 Overview** (mock-up MC02).
- Lists the six steps, each with a status: a count of what's waiting in caution colour, a green tick when done, or "Nothing to check" in ink-3.
- Any step can be opened from here. The primary button starts at the first unfinished step.

**MC-06 Navigation and saving.**
- **Every answer is saved immediately** to the server, through the existing offline outbox. Nothing is lost on leaving.
- **X** saves and exits. Back (or a swipe) goes to the previous step.
- **Continue** moves to the next unfinished step and is always enabled. Unanswered items are allowed, and the step is then marked `skipped`.
- **Resuming,** from any device, opens the first unfinished step.

**MC-07 Steps with nothing to do** are marked `nothing` and ticked automatically. They are passed over when moving forward, but can still be opened from the overview.

**MC-08 Live data.**
- Item lists are computed when the step opens and refreshed on return to it.
- Fixing something outside the flow, such as adding an expense through Quick Add, resolves the matching item automatically. For example, a missing day disappears once it has a transaction.

---

## 5. Step 1 · Missing days (mock-up MC03)

**MC-10 Which days are listed.**
- Days in the closing month, from the later of the month start and the tracking start date, up to the month end, that have:
  - no user-entered transaction of any type (expense, income or transfer); and
  - no existing "Nothing to log" marker.
- Trip days are included.

**MC-11 Each day item shows:**
- the date ("Thursday 5 November");
- a context line from the owner's typical spend for that weekday. It comes from the forecast's weekday profile when that profile is switched on, otherwise from "usual" per day: "you usually spend about £61 on a Thursday". If the forecast has no usual yet, the line just reads "Nothing logged".

**MC-12 Answers for a day.**
- **Nothing to log:** writes the same no-spend marker the evening reminder writes, with `source = 'close'`, and shows a green confirmation line.
- **Add expense:** opens Quick Add with the date set to that day. Once the item has a saved transaction it resolves, and Quick Add returns to the close.
- **I didn't log, can't remember** (shown under "More"): writes a `not_tracked` day marker (§11). That day is then excluded from the forecast's history and evidence instead of being treated as a £0 day. This needs one small change in the forecast engine (§12).

**MC-13 Runs of missing days.**
- Three or more consecutive missing days are shown as one item ("12–16 Nov · 5 days"), with **None of these, nothing spent**, **I wasn't tracking** and **Pick days**. **Pick days** expands the run into single days.
- If more than 15 days are missing, a banner leads the step: "Looks like you weren't logging for a while", with **Mark all as not tracked**.

---

## 6. Step 2 · Bills (mock-up MC04)

**MC-20 Which items are listed.** Occurrences of recurring payments with a due date in the closing month that are:
- (a) logged at an **estimated** amount and not yet confirmed (varying-amount bills, tagged EST); or
- (b) **awaiting confirmation**, because the rule's "log automatically" is off and the owner hasn't yet confirmed them.

Expenses only. Income and transfer rules aren't listed.

**MC-21 Estimated bill.**
- An amount field, pre-filled with the estimate and focused, labelled "Amount on your statement".
- **Confirm £X** updates the existing transaction's amount and marks the occurrence as confirmed. As the bills feature already does, the rule's "last confirmed amount" becomes the estimate for future occurrences, which the note under the list says.
- **Confirm later** leaves the item open.

**MC-22 Awaiting confirmation.**
- **It was paid** logs the transaction at the rule amount, dated on the due date (after any weekend or bank-holiday shift).
- **Different amount** opens the amount field, then logs it.
- **Didn't happen** marks the occurrence as skipped, and no transaction is created.

---

## 7. Step 3 · Balances (mock-ups MC05, MC06)

**MC-30 Which accounts.**
- Every active (non-archived) account that counts towards available cash.
- A **Check savings too** toggle adds accounts that don't count towards available cash. It is off by default and remembered in Settings.

**MC-31 What is compared.**
- The account's balance **now**, using the existing balance function at the current moment. This is not the month-end balance, because banking apps show today's balance.
- The lead says so: "Sterling's figures include everything logged up to now, 1 Dec included".
- **Credit cards** are shown and entered as an amount *owed* (positive), and stored negative, as elsewhere in the app.
- A footnote advises using the balance that includes pending payments when the bank shows two figures.

**MC-32 Answers for an account.**
- **Matches:** records a reconciliation with difference £0 and marks the account as checked today (MC-35).
- **Enter amount:** a numeric field. If the figure equals Sterling's, it's treated as a match. Otherwise the card shows "Sterling says" against "You counted / Your bank", the difference in a caution strip, and **Sort out the difference**.

**MC-33 Sorting out a difference** (sheet, mock-up MC06).
- The title states the difference in words: "Cash is £20.00 short" or "Monzo has £35.10 more than expected".
- The options depend on its direction:

| Option | Shown when | Creates |
|---|---|---|
| **I spent it and didn't log it** | The account is short (or a card owes more) | An **expense** for the difference. Category defaults to Other › Untracked cash for cash accounts and Other › Untracked for others (the sub-category is created if missing) and can be changed. Date: last day of the closing month (default) or today. `source = 'close'`. |
| **Money came in that I didn't log** | The account has more (or a card owes less) | An **income** transaction for the difference: category "Untracked income", with the same date choice. |
| **Just correct the balance** | Always | An **adjustment** transaction, using the existing adjustment type. It isn't spending or income and never appears in analytics, budgets or the forecast. Dated now. |
| **Let me look first** | Always | Opens Activity filtered to that account and the last 14 days. The item stays open. |

- If the difference is **£1.00 or less**, "Just correct the balance" is pre-selected.
- A note shows the result before saving: "After saving, Cash shows £160.00 and is marked as checked today".

**MC-34 Write order** (one database transaction):
1. Create the resolving transaction, with `counts_in_balance = true` set explicitly. It bridges Sterling's figure to the bank's, so it must count even when it is back-dated to the closing month.
2. Insert the `account_reconciliations` row.
3. Set the account's balance anchor (`last_reconciled_on`, and the timestamp if the app keeps one) to now.

**Post-condition:** the account's balance now equals the bank figure exactly. Fail the whole transaction if it doesn't.

**MC-35 After reconciling.** The existing balance-anchor rule applies: anything logged later with a date before this moment is already in the bank balance, so it gets `counts_in_balance = false` and doesn't move the balance again. MC06's note says this in plain words.

---

## 8. Step 4 · Tidy up (mock-up MC07)

Three kinds of item, shown in this order, with at most 10 in total (largest amounts first) and "Show N more" below them.

**MC-40 Possible duplicates.**
- Two or more user-entered expenses in the closing month on the **same account**, with the **same amount** and the **same normalised payee** (case-insensitive, whitespace collapsed). They must be **within 10 minutes** of each other, or on the same date when either has no time.
- Each pair or group is shown with the times. The options are **Delete the second** (or **Keep one** for a group) and **Both are real**.
- **Delete** uses the app's existing delete with undo.
- **Both are real** is remembered, so the same pair is never flagged again.

**MC-41 Large purchases not marked as one-offs.**
- Expenses of at least **max(£100, 3 × the median ticket of their L1 category** over the previous 180 days) that aren't already one-offs, recurring or trip-tagged.
- Shown with the line "Was this a one-off? One-offs still count as spending but don't raise your 'usual'". The options are **Mark as one-off** and **It's normal spending**.
- Either answer is recorded as the owner's choice (`one_off_source = 'user'`). An automatic re-flag never overrides it.

**MC-42 Automatic one-offs this month.**
- Expenses the app flagged as one-offs automatically are listed with **Keep as one-off** and **It's normal spending**.

---

## 9. Step 5 · Review (mock-up MC08)

Computed **live** from current data, so it reflects every fix made in steps 1–4. It is frozen into the snapshot at close (§10). Every figure comes from existing functions; the review adds no new calculations of balances or forecasts.

**MC-50 Sections, in order:**
1. **Spent:**
   - the month's total spend, a bar against the overall budget, "N% of £budget", and "£X under" or "£X over";
   - a status chip: **Within budget** or **Over budget**;
   - with no budget, the bar and chip are hidden and the line reads "£X against your usual of about £Y".
2. **Three tiles:**
   - **Money in:** income total, with a hint naming its main sources;
   - **Kept:** money in minus spend, with the percentage of money in. Hidden if money in is £0;
   - **Everyday:** discretionary spend, as the forecast defines it, with "±N% vs usual". "Usual" is the forecast's usual-per-day taken from its snapshot on the 1st of the closing month, × the tracked days in the month. Hidden in the first month.
3. **Summary:**
   - two or three sentences from the AI, generated only from the computed facts above and passed through the existing grounding validator;
   - if AI is off or the text fails validation, the section is omitted;
   - the flow never waits on it: render without it and insert it when it arrives.
4. **By category:**
   - every L1 category with spend, largest first, each with a bar;
   - categories with a monthly limit show the limit marker and "£X left of £Y" or "£X over its £Y limit" (in caution colour);
   - fixed categories made up only of recurring payments (such as Home) show a descriptive line instead of a bar;
   - the section header shows "Bills & regular £X".
5. **How good was the forecast?**
   - a headline sentence, then one row per **forecast snapshot** taken on the 1st, 8th, 15th and 22nd (the nearest earlier snapshot if one is missing): date, forecast, and error against the final total ("−0.9%");
   - hidden when no snapshots exist;
   - closing the month marks it final for the forecast's nightly backtest.

---

## 10. Step 6 · Next month, and closing (mock-ups MC09, MC10)

**MC-60 Budget.**
- Shows next month's overall budget, which carries over as it does today.
- Below it: **Bills already known**, the sum of next month's recurring expense occurrences (varying bills at their last confirmed amount), and **Left for everything else**, the budget minus those bills.
- **Keep £X** (pre-selected) or **Change**, which opens the existing budget editor for next month.

**MC-61 Category limits.**
- Lists only limits that were **over** in the closing month, with "Over by £X in ‹Month› · first time" or "· 2 months running".
- **Keep** (pre-selected) or **Change**.
- When a limit was over in **2 of the last 3 closed months**, a third option suggests a new figure: the average actual spend of those months, rounded up to the nearest £25.

**MC-62 Anything big next month?** A row that opens the existing "Something you're planning" sheet for **next month**. If planned items can currently only be added for the current month, allow next month as well.

**MC-63 Close ‹Month›** (the primary button).
- **Requires a connection.** Offline, the button is disabled with the hint "Connect to close the month".
- It writes the snapshot and sets the status:
  - `closed` if no step was skipped;
  - `closed_with_skips` otherwise, with the skipped steps listed. The overview and the history show "1 skipped", and those items can still be fixed later.
- It also records `closed_at` and the duration (from `started_at`, ignoring gaps of more than 10 minutes).

**MC-64 Done screen** (MC10).
- A green tick, "‹Month› is closed", and "£X spent · £Y under budget".
- A list of what was fixed:
  - days confirmed;
  - bills confirmed;
  - balances checked, with any money added;
  - items reviewed.
- Tiles for **Time taken**, **Months closed** (a running count) and **Next close** (date).
- The footnote: "You can still edit ‹Month›. Sterling will tell you if its totals change". The **Done** button returns to Home.

### 10.1 Snapshot (version 1)

```json
{
  "v": 1, "month": "2026-11-01", "closed_at": "…",
  "spent": 417812, "income": 541240, "kept": 123428,
  "budget": 440000, "budget_status": "within",
  "everyday": 187025, "usual_estimate": 183420,
  "by_l1": { "<category_id>": 222435, "…": 0 },
  "limits": [{ "category_id": "…", "limit": 40000, "actual": 49875 }],
  "forecasts": [{ "date": "2026-11-01", "point": 413871 }, "…"],
  "balances": [{ "account_id": "…", "sterling": 18000, "bank": 16000, "difference": -2000, "resolution": "untracked_spend", "transaction_id": "…" }],
  "fixes": { "days_no_spend": 2, "days_not_tracked": 0, "bills_confirmed": 2, "duplicates_removed": 0, "one_offs_changed": 0 },
  "skipped_steps": []
}
```
All amounts are integer pence.

### 10.2 Changes after closing

**MC-70 Editing a closed month.**
- Creating, editing or deleting a transaction dated in a closed month is always allowed. The editor shows a banner (MC11, state 5): "‹Month› is closed. Saving this changes its totals".
- On save, a database trigger sets `changed_since_close = true` and `last_changed_at`. This also applies to bills logged into a closed month by catch-up.

**MC-71 Seeing what changed.**
- The month's review, from Settings history or Analytics, shows "Changed since close" with:
  - the difference in total spend;
  - the categories that moved;
  - the transactions added, edited or deleted since `closed_at`.
- **Update the snapshot** re-takes it, keeps `closed_at`, increments `snapshot_rev` and clears the flag.

**MC-72 Reopening.**
- **Reopen ‹Month›** sets the status to `in_progress` and restarts at the overview.
- Previous answers stay as defaults, and items found anew appear as unanswered.
- Closing again replaces the snapshot and increments `reopened_count`.

### 10.3 Status chips (MC11, state 6)
| Chip | When |
|---|---|
| **Closed** (positive) | `closed` and unchanged since |
| **Changed since close · ±£X** (caution) | `changed_since_close = true` |
| **Closed, N skipped** (muted) | `closed_with_skips` |
| **Open** (muted) | A past month not yet closed |

Chips appear on the Analytics month header for past months, and in Settings → Month close history.

### 10.4 Several open months (MC11, state 3)
- Months close **oldest first**. The Home card reads "N months to close", with **Close ‹oldest›**.
- On the overview of an older month, while a newer month is also waiting, a secondary action **Close without review** closes it in one tap:
  - status `closed_quick`;
  - the snapshot is taken as it stands;
  - no answers are recorded.

### 10.5 First month (MC11, state 4)
If tracking started part-way through the month:
- the close covers tracking start to month end, and the card says so ("Tracked from 18 Oct, so this one covers 14 days");
- **Everyday vs usual**, the summary's comparison sentence and **How good was the forecast?** are hidden.

---

## 11. Notifications and settings

**MC-80 Notifications** (MC11, state 1). These use the existing web-push set-up and permission.

| When | Condition | Copy | Opens |
|---|---|---|---|
| 1st, 09:00 London (time adjustable) | A month is ready to close | "‹Month› is ready to close" · "Six quick checks, about N minutes." | Overview |
| 4th, 19:00 London | Close not finished | "‹Month› is still open" · "Two minutes now keeps ‹Next›'s numbers right." If started: "Finish closing ‹Month›" · "You stopped at ‹Step›." | First unfinished step |

At most two month-close notifications per month. None once the month is closed.

**MC-81 Settings → Month close.**
- Notifications on or off (default on when push is enabled), and the time on the 1st (07:00–21:00, in 30-minute steps).
- **Check savings too** default.
- **History:** a list of months with status chips, each opening its review.

---

## 12. Data model and server

New tables, each with RLS and an isolation test, following the existing pattern:

```sql
create type close_status as enum ('open','in_progress','closed','closed_with_skips','closed_quick');

create table month_closes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  month date not null check (extract(day from month) = 1),
  status close_status not null default 'open',
  step_state jsonb not null default '{}',    -- {"missing_days":"done","bills":"skipped",…}
  started_at timestamptz, closed_at timestamptz, duration_s int,
  snapshot jsonb, snapshot_rev int not null default 0,
  changed_since_close boolean not null default false, last_changed_at timestamptz,
  reopened_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

create type close_item as enum ('missing_day','missing_run','bill','balance','duplicate','large','one_off');

create table month_close_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  month date not null,
  item_type close_item not null,
  item_key text not null,                    -- date, occurrence id, account id, sorted txn ids…
  answer text not null,                      -- e.g. 'no_spend','paid','match','both_real'
  payload jsonb, answered_at timestamptz not null default now(),
  unique (user_id, month, item_type, item_key)
);

create type recon_resolution as enum ('match','untracked_spend','untracked_income','adjustment');

create table account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  as_at timestamptz not null default now(),
  sterling_balance bigint not null, bank_balance bigint not null,
  difference bigint generated always as (bank_balance - sterling_balance) stored,
  resolution recon_resolution not null,
  transaction_id uuid references transactions on delete set null,
  source text not null default 'close'
);
```

Changes to existing structures:
- `txn_source` gains the value `close`.
- The no-spend day marker gains a kind `not_tracked`, alongside the existing no-spend kind. Add a column or enum value, whichever fits the current table.
- `one_off_source` (`auto` | `user`) on transactions, if it doesn't already exist.
- **Forecast engine:** days marked `not_tracked` are treated as not tracked (excluded from history and evidence), exactly like days inside a logging gap. Add a unit test. The existing golden fixtures must still pass unchanged, since none of them contain this marker.
- A trigger on `transactions` (insert, update, delete) sets `changed_since_close` for closed months touched by the old or new `occurred_on`.

**Server functions** (RLS applies to each):
- `month_close_checks(p_month)` returns every step's items and counts in one call. Target under 300 ms with a year of data.
- `month_close_summary(p_month)` returns the review figures (§9), built from the existing functions.
- `reconcile_account(p_account, p_bank_balance, p_resolution, p_category, p_date)` does the transactional write in MC-34.
- `close_month(p_month)` builds the snapshot, sets the status and marks the month final for the backtest.
- **Crons:** add month-close notifications to the existing notification cron, run from 1st 09:00 and 4th 19:00 London time, using the user's configured time.

---

## 13. Edge cases

| ID | Case | Behaviour |
|---|---|---|
| EC-MC1 | Opening the close before the month ends | Not possible. The card, chip and notification only appear from 00:00 London on the 1st. |
| EC-MC2 | The 1st falls during BST or GMT changes | Month boundaries and crons use Europe/London, so it works as for every other cron. |
| EC-MC3 | A month with no transactions at all | Step 1 shows one run covering the whole month and the "not logging for a while" banner. Review shows £0 and hides tiles that need data. |
| EC-MC4 | A day with only an automatically logged bill | Still listed as missing (MC-10). |
| EC-MC5 | A missing day is fixed through Quick Add outside the flow | The item resolves the next time the step opens (MC-08). |
| EC-MC6 | A missing day with a transfer only | Not listed: a transfer is user-entered activity. |
| EC-MC7 | Days before tracking start | Never listed. |
| EC-MC8 | A varying bill whose statement hasn't arrived | **Confirm later**. The step is skipped; the month can close as `closed_with_skips`, and the bill stays an estimate. |
| EC-MC9 | A bill occurrence shifted into the next month by a weekend | It belongs to the month it's dated in, so it isn't listed for the closing month. |
| EC-MC10 | Paused or ended rules | Never listed. |
| EC-MC11 | An account opened after the closing month ended | Included in Balances, since it compares the balance now. |
| EC-MC12 | An account archived | Excluded. |
| EC-MC13 | A credit card in credit (Sterling or the bank shows a positive balance) | Entered as negative owed. The field accepts "−" and the copy switches to "in credit". |
| EC-MC14 | Difference ≤ £1.00 | "Just correct the balance" is pre-selected (MC-33). |
| EC-MC15 | The owner enters the bank figure, then logs a missed expense before saving | The comparison recomputes against the new Sterling balance. The difference may become £0, and the item resolves as a match. |
| EC-MC16 | A back-dated expense added after reconciling | `counts_in_balance = false` under the existing anchor rule; the balance doesn't move again (MC-35). |
| EC-MC17 | A resolving transaction dated in the closing month after the anchor | It is explicitly `counts_in_balance = true` (MC-34); the post-condition holds. |
| EC-MC18 | Reconciliation fails mid-way (network) | One database transaction: nothing is written, and the item shows an error with **Try again**. |
| EC-MC19 | Duplicates on different accounts | Not flagged. |
| EC-MC20 | A pair marked "Both are real" | Never flagged again, including after reopening. |
| EC-MC21 | Deleting a duplicate | Undo is available as elsewhere. If undone, the pair reappears. |
| EC-MC22 | A large purchase in a category with fewer than 5 past tickets | The threshold is £250. |
| EC-MC23 | A trip-tagged large purchase | Not listed: trips are already excluded from "usual". |
| EC-MC24 | No budget set | The review hides the budget bar and chip; step 6 shows "Set a budget for ‹Next›?", which opens the budget editor. |
| EC-MC25 | AI disabled or failing validation | The summary card is omitted (MC-50). |
| EC-MC26 | Missing forecast snapshots (for example, the app wasn't opened) | The nearest earlier snapshot is used, and dates with none are skipped. With none at all, the section is hidden. |
| EC-MC27 | Offline during the flow | Answers queue in the outbox and steps still work from cached data. **Close** is disabled until online (MC-63). |
| EC-MC28 | Two devices answering at once | Last write wins per item (unique key). The close itself is idempotent: a second `close_month` on a closed month returns the existing snapshot. |
| EC-MC29 | Editing a closed month | Allowed, with the banner; it sets `changed_since_close` (MC-70). |
| EC-MC30 | A bill catch-up logs into a closed month | Same as EC-MC29. No notification. |
| EC-MC31 | Reopening a month after the following month was closed | Allowed. Each month's snapshot is independent. |
| EC-MC32 | Several months open | Oldest first, with **Close without review** for older months (§10.4). |
| EC-MC33 | The first, partial month | §10.5. |
| EC-MC34 | Changing a category limit in step 6 | Applies from next month only. The closing month's snapshot keeps the limit it had. |
| EC-MC35 | Dismissing notifications (Later on Home) | The card returns at 06:00 the next day. Notifications follow MC-80 regardless. |

Every EC-MC row needs a test named after its ID.

---

## 14. Tests and definition of done

1. **Unit tests:**
   - item selection for each step, using the scenario in §15;
   - the duplicate and large-purchase rules;
   - the estimated-time formula;
   - snapshot building.
2. **Database tests:**
   - `reconcile_account` post-condition and rollback;
   - RLS isolation for the three new tables;
   - the changed-since-close trigger.
3. **Forecast test:** a `not_tracked` day is excluded from history; G1–G9 are unchanged.
4. **End-to-end test** (Playwright, 390 × 844): run the §15 scenario from the Home card to Done. Assert:
   - spend is **£4,178.12** and **£221.88 under** a £4,400 budget;
   - Cash ends at **£160.00**;
   - the snapshot matches §10.1.
5. **Visual check:** MC01–MC11 match the mock-ups, using the app's existing tokens and components. No new colours, radii or type sizes.

**Done when** all of the above pass, every EC-MC case has a test, and the owner can close a month in about two minutes on a phone.

---

## 15. Mock-up scenario (seed)

Closing **November 2026** on **Tue 1 Dec 2026**. These figures make the mock-ups and the end-to-end test agree.

| Item | Value |
|---|---|
| Missing days | Thu 5 Nov, Sat 14 Nov. Both answered **Nothing to log**. |
| Bills | Octopus Energy logged Fri 20 Nov at £68.00 (estimate), confirmed at **£71.36**. O2 £18.00 due Sat 7 Nov, awaiting confirmation, answered **It was paid**. |
| Balances (now) | Monzo £2,846.12 (match) · HSBC £4,102.55 (match) · Cash £180.00, counted £160.00, resolved as **I spent it**: £20.00 Other › Untracked cash, 30 Nov · Amex Gold £1,436.80 owed (match) · Marcus not checked |
| Available cash on Home before the close | £5,691.87 |
| Tidy up | Pret A Manger £4.20 twice, Tue 10 Nov 08:14 and 08:16, Monzo → **Both are real** · John Lewis £118.00, Wed 25 Nov, Shopping › Homeware, Amex → **It's normal spending** |
| Spent | **£4,178.12** = bills and regular £2,307.87 + everyday £1,870.25 |
| By L1 | Home £2,224.35 · Groceries £512.40 · Eating out £498.75 · Shopping £301.20 · Transport £286.30 · Family & giving £163.13 · Health £76.00 · Entertainment £64.00 · Bills £31.99 · Other £20.00 |
| Budget and limits | £4,400 overall (£221.88 under) · Groceries £750 · Eating out £400 (over by £98.75) · Shopping £350 · Transport £450 · Entertainment £150 |
| Money in | £5,412.40 (salary £5,380.00, interest £32.40) · kept £1,234.28 (23%) |
| Usual | £61.14/day × 30 = £1,834.20 → everyday +2% |
| Forecast snapshots | 1 Nov £4,138.71 (−0.9%) · 8 Nov £4,029.78 (−3.6%) · 15 Nov £4,026.01 (−3.6%) · 22 Nov £4,124.25 (−1.3%) |
| December | Budget £4,400 kept · bills already known £2,307.87 · left £2,092.13 · Eating out limit kept at £400 |
| Done screen | 1 min 52 s · months closed 1 · next close Fri 1 Jan |

---

## 16. Mock-ups

The HTML files in `design/mockups/` open in any browser; the PNGs in `design/screenshots/` are the same screens at 2×.

| # | Screen | Covers |
|---|---|---|
| MC01 | Home with the close card | MC-01 |
| MC02 | Overview | MC-05 |
| MC03 | Step 1 · Missing days | §5 |
| MC04 | Step 2 · Bills | §6 |
| MC05 | Step 3 · Balances | MC-30 to MC-32 |
| MC06 | Sort out a difference | MC-33 to MC-35 |
| MC07 | Step 4 · Tidy up | §8 |
| MC08 | Step 5 · Review | §9 |
| MC09 | Step 6 · December | MC-60 to MC-63 |
| MC10 | November is closed | MC-64 |
| MC11 | States board: notifications, in progress, several months, first month, editing a closed month, status chips | MC-01, §10.2–10.5, MC-80 |

## 17. Build order

1. Migrations: the three tables, the enum and column changes, the trigger, RLS and isolation tests.
2. `month_close_checks`, `reconcile_account`, `month_close_summary` and `close_month`, with tests.
3. The forecast change for `not_tracked`; re-run G1–G9.
4. The flow shell and steps 1–6 (MC02–MC10), then the Home card (MC01).
5. Closed-month banner, status chips, Settings history and reopen (MC11).
6. Notifications.
7. The end-to-end test using §15; walk the edge-case register.
8. Add to `DECISIONS.md`: "6 Nov 2026 · Month-end close added per MONTH-CLOSE-PRD.md · owner request".
