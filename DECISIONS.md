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
