# Decisions log

Record judgement calls here as: date · decision · reason.

## Foundations

- **2026-10-18 · Next.js 16, `proxy.ts`, Tailwind v4, React 19.** Latest stable versions at build time. Next 16 renamed `middleware.ts` to `proxy.ts`; the session gate lives there (`lib/supabase/proxy.ts`). The bundled docs in `node_modules/next/dist/docs` were used instead of memory.
- **2026-10-18 · Tailwind can only generate token values.** `app/globals.css` resets Tailwind's colour, radius, type-size and shadow scales (`--color-*: initial` etc.) and re-adds only what `design/tokens.css` defines, so an off-palette colour or size cannot be written by accident (CLAUDE.md rule). `design/tokens.css` is copied verbatim to `app/tokens.css`. Component CSS (`app/components.css`) is lifted from the mock-ups' shared stylesheet; the mock-up wins on appearance.
- **2026-10-18 · Instrument Sans is self-hosted** (`app/fonts`, OFL licence alongside) rather than fetched from Google at build time, so builds work offline and nothing third-party loads at runtime.
- **2026-10-18 · Money is an integer `number` of pence in TypeScript** (`lib/money.ts`), `bigint` in Postgres. PostgREST returns bigint as a JSON number and every figure is far below 2^53. `toPence` parses decimal strings without ever using a float; exports use `penceToDecimal`.
- **2026-10-18 · Sign-ups are disabled; the owner is created once** (`shouldCreateUser: false`). The allow-list is checked in the server action before any code is sent, and again in `proxy.ts`. This keeps the service-role key out of the request path (PRD §9.4: cron only).

## Data model

- **2026-10-18 · An account's opening balance is the balance at the *start* of `opening_date`, and no transaction may predate it** (trigger `transactions_guard`). With that rule every balance is `opening + Σ effects`, and a back-dated entry can never silently change a balance it was already reflected in. For an account created "today", log only what happens after setting it up; Reconcile corrects any drift.
- **2026-10-18 · `cash_flow().opening_pence` includes pool accounts that start inside the period**, at their opening balance. Otherwise the very first month would show "£0 opening + … = £x" and the equation would not add up. The identity `opening + income − spend + set aside + adjustments = closing` is tested over random data and invariant 5 (owner's formula) holds exactly when nothing else happens.
- **2026-10-18 · History on an archived account is frozen** (cannot be edited or deleted) and archiving requires a zero balance. Found by a failing invariant test: deleting the write-off after archiving would otherwise break the cash identity.
- **2026-10-18 · Category sibling uniqueness is a unique *index*** on `(user, kind, parent, lower(name))`. The PRD's table-level `unique (user_id, parent_id, name)` does not constrain top-level categories because NULL parents compare as distinct.
- **2026-10-18 · `list_transactions` always returns whole days.** A page is extended to the end of its last day so the per-day net in each header is never partial (keyset pagination would otherwise split a day across pages).
- **2026-10-18 · `month_pace` also returns last month's full total.** The Home pace bar is scaled to it (fill 60.9%, tick 67.8% in the mock-up come out exactly with September's £5,316.20).
- **2026-10-18 · "Today" for reconcile and archive adjustments is the user's London date, passed from the device**, not the database clock, consistent with every other date in the app and with offline use.
- **2026-10-18 · Payee memory, idempotent capture and default-account switching live in one RPC** (`create_transaction`), so a retried outbox flush cannot double-count a visit.

## Capture and offline

- **2026-10-18 · Quick Add is not force-mounted.** Keeping a Radix modal mounted while closed makes it call `hideOthers`, which marked the entire page `aria-hidden` (found via an E2E test). The sheet's state, data hooks and code stay mounted for the life of the shell; only its DOM mounts on tap. Measured on a production build: 22–44 ms from tap to painted (target < 100 ms), asserted in `03-capture.spec.ts`.
- **2026-10-18 · Pending outbox entries are *overlaid* on server data** (`lib/overlay.ts`) rather than patched into caches. An entry stops counting once the server accepted it *and* the query's data is newer than that moment, so the hero never double-counts or flickers back. The sync engine flushes before it refetches.
- **2026-10-18 · "Tap category to save" applies when the payee was auto-filled** (PRD wording). Without a remembered payee, a chip only selects, to avoid accidental saves while browsing categories.
- **2026-10-18 · The amount display uses one weight for pence** (as drawn in mock-up 02); the PRD text mentions a lighter pence. Appearance follows the mock-up.
- **2026-10-18 · TanStack Query `gcTime` is `Infinity`.** A finite 30 days overflows `setTimeout` (32-bit) and becomes 1 ms, which silently evicted every query. The persisted cache ages out by `maxAge`, and is revalidated whenever it is restored.
- **2026-10-18 · CSP `connect-src` is derived from `NEXT_PUBLIC_SUPABASE_URL`** (exact origin, not a wildcard), so it is right for hosted projects, custom domains and the local test stack.

## Testing

- **2026-10-18 · No Docker here, so the E2E stack is Postgres 16 + PostgREST + a small Supabase-compatible gateway** (`tests/harness`). It implements exactly the GoTrue endpoints the app calls (OTP, verify, refresh, user, admin) with a fixed test code. SQL tests run as plain `DO` blocks with `ASSERT` (pgTAP is not installed); they impersonate users through the same `request.jwt.claims` setting Supabase uses.
- **2026-10-18 · E2E runs at 390×844 on Chromium** (the installed browser) with the iPhone 14 device profile; the profile's own 664 px height includes Safari's toolbar, whereas the installed PWA gets the full screen. WebKit-specific behaviour (iOS keyboard, Web Push) needs a real device, as the PRD notes.
- **2026-10-18 · The demo seed reproduces Appendix A to the penny** and is asserted in `tests/sql/seed`. Where the mock-ups disagree with each other (Activity says 52 transactions in total; the cash screen says 52 spending + 2 income) the Activity figure was used.

## AI insights (M4)

- **2026-10-18 · The model never computes a number.** SQL functions produce the facts, the model only words them (tool `emit_cards`, forced `tool_choice`), and the validator then requires every £ figure and percentage in a card to equal a fact's `display` string exactly. A card that fails is dropped, the writer gets one retry with the list of failures, and if fewer than three cards survive the deterministic template cards (`lib/ai/fallback.ts`, grounded by construction) fill in. Ungrounded text is therefore never rendered. The model path could not be exercised here (no API key); the pipeline is unit-tested with fake writers and `scripts/ai-check.ts` runs the PRD's 20-generation check against the real API.
- **2026-10-18 · Two models, cheap by default.** `claude-sonnet-5-5` writes digests and `claude-haiku-5-5` is reserved for parsing (unused until P1 "Ask Sterling"). Ids live in one file, `lib/ai/models.ts`.
- **2026-10-18 · Token cap is checked, not estimated.** `AI_MONTHLY_TOKEN_CAP` (default 500,000) is compared with the sum of `insight_runs` tokens this London month before each call; at the cap the run uses templates and says so in `model`.
- **2026-10-18 · Ad-hoc refresh is limited to 10 per London day**, counted from `insight_runs`; so the limit survives restarts without extra tables.
- **2026-10-18 · One daily cron at 07:00 UTC serves both summer and winter.** Vercel cron is UTC-only and Hobby allows one run a day per path. 07:00 UTC is 08:00 London in summer and 07:00 in winter, and the handler acts on a Monday or the 1st once London time is 07:00 or later, idempotently per scope and period. The digest therefore lands at 07:00–08:00 London rather than exactly 07:00.
- **2026-10-18 · Dismissals are per card key, not per run.** Keys are stable (`anomaly:eating_out:2026-10`), so dismissing a card stays dismissed across refreshes within the period. Feedback also feeds the next generation as plain-sentence preferences (last 50).
- **2026-10-18 · Scope of tabs.** Digests cover completed periods (last week, last month); "So far" is the on-demand month-to-date refresh. The mock-up's "Month outlook" hero (CASH-06) and the "Ask about your money" bar (AI-04, "Ask Sterling") are P1 and are not built.
- **2026-10-18 · Test clock.** `STERLING_TEST_TODAY` pins the server's idea of "today" for the E2E run only (the demo data is dated to 18 Oct 2026). It is unset in production.

## Evening reminder (M4b)

- **2026-10-19 · The decision to send is a pure function** (`lib/nudge.ts`): in the user's London slot, not already sent today, nothing logged today, no "Nothing to log" marker. Copy switches to "It's been a few days…" when the newest transaction is 3+ days old. The cron route only gathers inputs and sends, so the rules are unit-tested without a clock or a push service.
- **2026-10-19 · The slot is a window, not an instant.** A run counts when London time is within `NUDGE_WINDOW_MIN` (default 15) after the reminder time, so a 15-minute cron cannot miss it and an hourly one (`NUDGE_WINDOW_MIN=60`) still works. `profiles.last_reminder_on` makes it at most one a day even if several runs fall inside the window, and it is set only after at least one device accepted the push.
- **2026-10-19 · A "Nothing to log" marker counts as a logged day** in the week view and silences that day's reminder. The notification action posts to `/api/no-spend` with the session cookie (same-origin, so no token ends up in the worker).
- **2026-10-19 · Turning the reminder off also unsubscribes this device**; the server stops sending from the next slot anyway because the cron selects only `reminder_enabled` profiles. Expired subscriptions (404/410) are deleted when a push fails.
- **2026-10-19 · The permission card hides itself where push is impossible** (desktop browsers without PushManager). On iOS Safari outside the installed app it stays visible and *Turn on* explains how to install first, rather than failing silently.
- **2026-10-19 · The demo seed marks the permission card as already answered** (`reminder_prompted = true`) so Home matches the mock-up; the reminder tests reset it.
- **2026-10-19 · Test seams, all inert in production:** `STERLING_PUSH_STUB=<file>` writes pushes to a file (an endpoint containing "gone" answers 410), and `?now=` on the nudge route works only when `STERLING_TEST_TODAY` is set.
- **2026-10-19 · The evening reminder needs a 15-minute scheduler, which Vercel Hobby lacks.** `vercel.json` carries the two daily jobs; the README gives a `pg_cron` + `pg_net` snippet for the nudge.

## Sign-in

- **2026-10-19 · E-mail + password is the default sign-in; the e-mailed code stays as an option.** The PRD chose codes because magic links break the installed iOS app, but codes need an e-mail template containing `{{ .Token }}`, and Supabase's built-in sender does not let you edit it (custom SMTP does). Passwords need no e-mail delivery and work in the installed app. The same allow-list applies before Supabase is called, wrong password and unknown e-mail give the same message, and Supabase's own rate limits apply. The user is created in the dashboard with Auto Confirm, so no sign-up path is exposed. The PRD's AUTH-01 acceptance ("e-mailed 6-digit code") still holds via the secondary option.

## One-off pots (update 3)

- **2026-10-19 · A pot is a flag on the transaction, not an account.** Money in a pot still leaves a real account, so balances and available cash include it. What a pot changes is classification: `pot_id` on a transaction takes it out of *usual spending*. Every analytic (category spend and its "usual" norm, daily rhythm, month pace, monthly totals, top payees, category history, new-payee and biggest-transaction facts) filters `pot_id is null` in SQL, so the AI facts and the charts cannot disagree and the insights pipeline needed no change.
- **2026-10-19 · The cash equation gets a fourth term instead of hiding the pot.** `cash_flow()` now returns `pot_pence` (net of pot income and expenses); `income`/`spend` are usual only. Opening + In − Out ± One-off ± Set aside ± Adjusted = Available still holds exactly (SQL invariant, unit tests, Home, Cash detail and the AN-03 waterfall all show the "One-off" step), so the hero is never unexplained.
- **2026-10-19 · Pots take expenses and income, never transfers.** A gift towards a deposit or a refund is as much a one-off as the stamp duty. A DB check enforces it, and the RPCs ignore a pot on a transfer.
- **2026-10-19 · A pot is closed, not archived, and only an empty pot can be deleted.** A closed pot takes no new transactions but its history stays editable and it can be reopened. `on delete restrict` stops a pot with history disappearing.
- **2026-10-19 · Ownership of a pot is checked by a trigger.** A foreign key does not prove the pot belongs to the same user, so `transactions_pot_guard` does (cross-user test in `05_pots.test.sql`).
- **2026-10-19 · Activity is a ledger, so it still shows pot transactions** (labelled "<pot> pot", filterable: everything / usual only / pots only / one pot). Its header totals split usual spend from the pots' net.
- **2026-10-19 · Quick-add suggestions ignore pot expenses**, so a £12,500 stamp-duty entry cannot skew the category ranking.
- **2026-10-19 · Not done:** pot totals are server figures; a pot expense still waiting in the offline outbox appears in the lists and the hero but not yet in that pot's own totals until it syncs.
