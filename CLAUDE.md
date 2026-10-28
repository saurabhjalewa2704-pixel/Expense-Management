# Sterling — working rules for Claude Code

Read PRD.md first (section 15 is the build order). Visual truth is design/mockups/*.html,
design/screenshots/*.png and design/tokens.css.

- Money is integer pence (bigint). Never use floats. Use /lib/money.ts.
- Never store derived balances; use the SQL functions in supabase/migrations (PRD §10.4).
- Balances only include rows with counts_in_balance = true. Anything dated before an account's opening date or last reconcile is already in the user's balance (PRD §6.2a). Analytics and trips ignore this flag.
- Before closing any milestone, walk the edge-case register (PRD §18): every EC- row needs a test named after its ID.
- Month boundaries and crons use Europe/London. occurred_on is the local date where the spend happened (PRD EC-D1), with the zone in occurred_tz.
- Don't introduce colours, radii or font sizes that aren't in design/tokens.css.
- Dark-only: there is no light theme or theme toggle. Never add `dark:` variants or a light palette.
- Mobile first: build and test at 390×844 before desktop.
- Every new table gets RLS policies plus a SQL test proving cross-user isolation.
- AI copy must pass the grounding validator (PRD §12.4); never show unvalidated model text.
- Record judgement calls in DECISIONS.md.
