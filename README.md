# Sterling

A personal expense tracker for one person, in pounds: log a spend in seconds, see what you can actually spend, and get a few honest sentences about your own numbers. A dark-only, mobile-first installable web app (PWA) with a desktop layout.

Next.js 16 on Vercel · Supabase (Postgres, Auth, RLS) · Claude API for the insight wording only. The full spec is [PRD.md](PRD.md); working rules are in [CLAUDE.md](CLAUDE.md); every judgement call is in [DECISIONS.md](DECISIONS.md).

## What is built

| Milestone | Scope |
| --- | --- |
| M0 | Auth (e-mailed code, single-user allow-list), app shell, PWA + offline shell, schema, RLS |
| M1 | Accounts, categories, Quick Add, offline outbox, Activity |
| M2 | Available cash (Home hero, detail, reconcile) |
| M3 | Analytics (pace, categories, waterfall, trend, rhythm, deep dive), desktop dashboard, CSV/JSON export |
| M4 | AI insights: facts from SQL, model wording, grounding validator, template fallback, digests, feedback |
| M4b | Evening reminder via Web Push |
| Update 2 | "New version available" banner for the installed app |
| Update 3 | One-off pots (e.g. a home purchase), kept out of monthly spend, analytics and insights |
| Update 4 | Ask Sterling: ask about your spending in plain English (Insights → Ask) |

Not built (P1, PRD §M5): natural-language entry, Shortcuts endpoint, recurring rules, budgets, other push types, Face ID lock, month-end outlook card.

## Set up (about 20 minutes)

1. **Supabase project.** Create one, then run `supabase/migrations/*.sql` in order (SQL editor, or `supabase db push`). Optional demo data: `supabase/seed.sql` (a signed-in user must exist first; it loads PRD Appendix A).
2. **Supabase → Authentication.**
   - Providers → Email: enable; **turn off "Allow new users to sign up"**.
   - Email templates → Magic Link / OTP: make the body show the code, e.g. `Your Sterling code is {{ .Token }}`.
   - Sessions: set the refresh-token / inactivity timeout to at least 30 days (AUTH-01).
3. **Environment variables** (Vercel → Project → Settings, and `.env.local` for local work; see `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_EMAIL`, `CRON_SECRET` (any long random string), `ANTHROPIC_API_KEY` (optional: without it insights are written from templates), `AI_MONTHLY_TOKEN_CAP`, and for reminders `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as the public key).
4. **Create yourself once.** Either `node scripts/bootstrap-owner.mjs` (reads the same variables; it refuses to create a second user), or with no terminal: Supabase → Authentication → Users → **Add user → Create new user**, your `ALLOWED_EMAIL`, a password, **Auto Confirm User** ticked. The database trigger creates your profile and categories either way.
   Sign in with that e-mail and password. The e-mailed-code option ("E-mail me a code instead") needs the template change in step 2, and on Supabase's built-in e-mail sender that may require custom SMTP.
5. **Deploy to Vercel**, then open the site on your iPhone in Safari → Share → **Add to Home Screen** and sign in from the installed app (reminders only work from there).

## Scheduled jobs

| Job | Route | How often | Notes |
| --- | --- | --- | --- |
| Insight digests | `/api/cron/digest` | daily 07:00 UTC (in `vercel.json`) | Acts on Mondays (weekly) and the 1st (monthly), once London time is 07:00 or later. Idempotent. |
| Housekeeping | `/api/cron/maintenance` | daily (in `vercel.json`) | Purges transactions deleted more than 30 days ago; also keeps a free Supabase project awake. |
| Bills | `/api/cron/recurring` | daily 06:00 UTC (in `vercel.json`); hourly is better | Logs every bill due on or before today that has no record yet, from 06:00 London time. A later or repeated run is harmless (it catches up and never double-logs), so the daily Vercel job works; an hourly `pg_cron` job (below) makes logging happen at about 6am all year. Also refreshes bank holidays on the 1st of the month. |
| Evening reminder | `/api/cron/nudge` | **every 15 minutes** | Vercel Hobby cannot do this. Use Vercel Pro, or Supabase `pg_cron` + `pg_net` below, or any scheduler that can send the bearer header. If you can only run it hourly, set `NUDGE_WINDOW_MIN=60`. |

All four expect `Authorization: Bearer $CRON_SECRET`. Vercel sends it automatically for jobs in `vercel.json` when `CRON_SECRET` is set.

```sql
-- Supabase SQL editor (enable the pg_cron and pg_net extensions first)
select cron.schedule('sterling-nudge', '*/15 * * * *', $$
  select net.http_get('https://YOUR-APP.vercel.app/api/cron/nudge',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'))
$$);

-- Bills, hourly (acts from 06:00 London; nothing happens before that, and re-runs are harmless)
select cron.schedule('sterling-bills', '0 * * * *', $$
  select net.http_get('https://YOUR-APP.vercel.app/api/cron/recurring',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'))
$$);
```

## Develop

```bash
npm install
cp .env.example .env.local        # fill in the Supabase values
npm run dev
```

## Test

No Docker is needed. `tests/harness` starts Postgres 16, PostgREST and a small GoTrue-compatible gateway (fixed sign-in code `123456`).

```bash
npm run stack:up          # once; STERLING_RESET=1 rebuilds the database after migration changes
npm test                  # unit tests (Vitest)
npm run test:sql          # RLS, cash-identity invariants, business rules, analytics, PRD Appendix A to the penny
bash scripts/e2e-prod.sh  # production build + Playwright at 390×844 (mobile) and 1440×1024 (desktop)
npx tsx scripts/ai-check.ts 20   # needs ANTHROPIC_API_KEY + Supabase env: the PRD §12.8 check against the real model
npx tsx scripts/ask-check.ts      # the same for Ask Sterling: nine sample questions, answers and tools printed
```

## What could not be verified here

These need a real account or device and are the owner's to check:

- **The real Claude output.** Everything around the model is tested (validator, retry, fallback, caps) with fake writers and, for Ask Sterling, a scripted stand-in model that drives the real tools; run `scripts/ai-check.ts` and `scripts/ask-check.ts` with your key.
- **Web Push on an iPhone.** iOS delivers push only to an installed Home Screen app and not to simulators. Subscription, the nudge rules and the service-worker handlers are tested with a stubbed push service.
- **Real Supabase Auth e-mail.** Tests use the local gateway; confirm the code e-mail template and sign-up setting in your project.
- **Safari/WebKit specifics** (keyboard behaviour, Face ID is not built). E2E runs on Chromium with an iPhone profile.
