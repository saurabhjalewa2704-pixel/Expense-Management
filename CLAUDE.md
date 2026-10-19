# Sterling — working rules for Claude Code

Read PRD.md first (section 15 is the build order). Visual truth is design/mockups/*.html,
design/screenshots/*.png and design/tokens.css.

- Money is integer pence (bigint). Never use floats. Use /lib/money.ts.
- Never store derived balances; use the SQL functions in supabase/migrations (PRD §10.4).
- All dates are Europe/London. occurred_on is a London-local date.
- Don't introduce colours, radii or font sizes that aren't in design/tokens.css.
- Dark-only: there is no light theme or theme toggle. Never add `dark:` variants or a light palette.
- Mobile first: build and test at 390×844 before desktop.
- Every new table gets RLS policies plus a SQL test proving cross-user isolation.
- AI copy must pass the grounding validator (PRD §12.4); never show unvalidated model text.
- Record judgement calls in DECISIONS.md.
