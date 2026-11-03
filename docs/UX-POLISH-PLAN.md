# Sterling — UX polish plan

Status: **APPROVED and implemented on branch `claude/ux-polish-plan`** (see the outcome table at the end and `DECISIONS.md` › UX polish pass). Open questions were resolved on my best judgement, as you asked.
Audit date: 3 Nov 2026 · Viewport: 390×844 (iPhone, dark-only) · Routes captured: 21 · Skills used: `improve-animations`, `find-animation-opportunities`, `mobile-native`, `apple-design`, `break-ui` (installed from `emilkowalski/skills`; `write-swift` and `animate-expo` excluded).

## 0. Ground rules for every item below

These come from your brief and from `CLAUDE.md`. Every item has been written to fit them; any that can't is marked **DECISION**.

| Rule | How the plan respects it |
|---|---|
| No colours, radii or font sizes outside `design/tokens.css` | Nothing here adds a colour, radius or size. Press states use opacity / `scale()` only. Off-token sizes found in the audit are *reported* (§6), not silently "fixed". |
| Dark-only | No `dark:` variants, no light palette, no theme toggle. |
| Numbers and layouts stay as they are | No figure, formula, copy or box geometry changes. Item **P1-9** is the one exception (a real overlap bug) and is flagged. Touch-target fixes use invisible hit-area expansion (padding/`::after`), so the *visual* box is unchanged. |
| Forecast / money rules | Nothing touches `getForecast()`, `lib/money.ts` or SQL. |

**Decision needed from you — motion tokens.** `design/tokens.css` has one motion token (`--spring: cubic-bezier(.2,.8,.2,1)`) and no duration or "ease-out" tokens. The plan wants three shared values so animations stop being ad-hoc. Proposal: define them in `app/globals.css` (not `design/tokens.css`, which stays a verbatim copy):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* enter / press-release */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* sheets */
--dur-press: 160ms;  --dur-ui: 200ms;
```

These are timing curves, not colours/radii/sizes, so they don't break your stated rule — but they are *new tokens*, so I'm asking first. If you say no, I reuse `--spring` and literal `160ms` / `200ms` only.

---

## 1. What the audit found (headline)

1. **The app has no press feedback at all.** `app/components.css` contains zero `transition` and zero `:active` rules. Buttons, chips, rows, tabs, keypad keys and the FAB all feel inert on tap. This is the single largest "feels like a web page, not an app" gap.
2. **Touch targets are widely under 44×44.** The 36×36 `.icon-btn` appears in every screen header; chips are 34–36px; segmented controls 36px; many text links are 18–20px high; switches are 51×31.
3. **Motion that exists is inconsistent.** Seven different timings/curves (`160ms ease`, `200ms var(--spring)`, `280ms var(--spring)`, `spring duration .28`, `180ms ease-out`, `220ms`, `320ms ease-in-out`). Two animate `width` (layout property).
4. **One real layout bug:** on `/cash` the "Available cash" label overlaps the "‹ Home" back link.
5. **Mobile-native basics are mostly right** (dvh, safe areas, `viewport-fit=cover`, 16px+ inputs, tap-highlight off, `overscroll-behavior`) but there is no `touch-action: manipulation`, no hover gating, and no `user-select` control on UI chrome.
6. **Break-ui:** layouts hold at most sizes; weak spots are long payee/category names in 2-line rows, 7-figure amounts in the hero and keypad, and the tab bar covering the last row on scroll (needs bottom padding verified).

---

## 2. Prioritised plan

Severity: **P1** = do first, high leverage, low risk · **P2** = worthwhile · **P3** = polish / optional.
Effort: S < 1h, M 1–3h, L > 3h. Every item lists its *verify* step.

### P1 — High leverage

| # | Item | Skill | Evidence | Fix | Effort | Verify |
|---|---|---|---|---|---|---|
| **P1-1** | **Press feedback on everything tappable** | apple-design, improve-animations | `app/components.css` has no `transition`/`:active`. Scan: every interactive element on all 21 routes has zero transition. | One shared rule for `button`, `a`, `.chip`, `.tab`, `.tab-add`, `.key`, `.icon-btn`, `.seg > *`, list-row buttons: `:active{transform:scale(.97)}` (FAB `.96`) with `transition: transform var(--dur-press) var(--ease-out)`. Rows that are full-width get **opacity .7** instead of scale (scaling a 350px row looks wrong). Never `transition: all`. | S | Tap each control at 390×844; press must show on pointer-down, release must ease back, interrupted press must not jump. |
| **P1-2** | **`touch-action: manipulation` + no tap delay / double-tap zoom** | mobile-native | No `touch-action` anywhere except two chart SVGs and the drag grip. | Add once on `button, a, [role=button], .chip, .key, .tab, label, input, select`. | S | Double-tap a key on iOS Safari: no zoom, no 300ms lag. |
| **P1-3** | **Hit areas ≥ 44×44 without changing visuals** | mobile-native, apple-design | `.icon-btn` 36×36 (all headers), `.period .icon-btn` 32×32, `.back` 88×39, `.chip` 36 / `.meta .chip` 34 / `.chip-row .chip` 34, `.seg` 36, text links "All" 32×18, "See all" 44×20, "Range … · Why?" 175×18, "Projected close" row 318×18, switch 51×31, bare inputs ~23px. Analytics has 52 small targets. | Keep visual size; add `position:relative` + `::after{content:"";position:absolute;inset:-4px -4px}` (or `min-height:44px` with matching negative margin) so the *tappable* box is ≥44. For 18–20px text links, add vertical padding with an equal negative margin so line layout is unchanged. Switch: wrap with 44px-high hit area. | M | Playwright re-run of the target scan: zero interactive elements < 44 in either dimension (exceptions listed in §4). |
| **P1-4** | **Gate any hover styling** | mobile-native | No `:hover` exists today, but `.seg > *{cursor:pointer}` and desktop modal hint at desktop use. | Rule for the implementation: any future/added hover goes in `@media (hover:hover) and (pointer:fine)`. Add nothing hover-y on touch. | S | Grep: no bare `:hover`. |
| **P1-5** | **Sheet open/close curve and duration** | improve-animations, apple-design | Vaul sheets use library defaults; desktop modal uses `fade-in 160ms ease-out` / `modal-in 220ms var(--spring)` with `scale(.98)`. | Set Vaul content transition to `var(--ease-drawer)` at ~500ms open, ~300ms close via `globals.css` (`.vaul-content`, `[data-vaul-overlay]`); scrim fade 200ms ease-out. Desktop modal: keep scale ≥ .95, add `transform-origin:center`. | S | Open/close Add-expense, Why, limit and covers sheets; drag-to-dismiss must track 1:1 and be interruptible mid-open. |
| **P1-6** | **Toast + banner enter/exit** | improve-animations | `toast-in` has an enter only (no exit); 8px translate, no easing token. | Add exit (opacity + 8px, 150ms ease-in), use `--ease-out` on enter. | S | Trigger a save toast, dismiss, rapid double trigger. |
| **P1-7** | **Chart bars animate `width`** | improve-animations | `components/charts/subcategory-row.tsx:23`, `category-bars.tsx:35` (`transition: width 280ms var(--spring)`), `waterfall-chart.tsx:21` (`motion.div` width). Layout property → jank on low-end phones. | Switch to `transform: scaleX()` with `transform-origin:left` (bar track unchanged). Numbers and final size identical. | M | Visual diff of final state = identical; Chrome perf trace shows no layout during animation. |
| **P1-8** | **Reduced motion keeps meaning** | improve-animations | `globals.css:81` collapses all durations to .001ms (good) but also removes colour/opacity cross-fades. | Keep the global rule; add `@media (prefers-reduced-motion: reduce)` exception so *opacity and background-colour* transitions (switch, press opacity) still run at ~100ms. Movement stays off. | S | Toggle OS reduced-motion: press and switch still show state, nothing slides. |
| **P1-9** | **`/cash` header overlap (bug)** | break-ui | `components/cash/cash-screen.tsx:57-59`: `PageHeader title=""` renders an empty `h1.large-title`, then `.hero` uses `marginTop:-26` to claw the space back; at 390×844 with the 44px safe-top the "Available cash" label lands on top of "‹ Home". Seen in screenshot `cash.png`. | Preferred: add `PageHeader` support for a title-less header (render no `h1`) and drop the `-26px` hack so the hero sits directly under the 44px navbar. **This moves the hero down by roughly 8–12px — the only layout change in the plan, and it exists to remove an overlap.** | S | Screenshot at 390×844: label clear of back link; figure and chart unchanged. e2e: add `EC-` style regression asserting the two bounding boxes don't intersect. |

### P2 — Worth doing

| # | Item | Skill | Evidence | Fix | Effort |
|---|---|---|---|---|---|
| **P2-1** | One motion vocabulary | improve-animations | Seven different timings (see §1.3). | Replace literals with the §0 tokens: switch bg 160ms → `--dur-press`; knob 200ms; trip swipe 200ms; `pane-in` 180ms; `gb-in` 200ms; `shake` 320ms (keep, it's a rejection cue). | S |
| **P2-2** | Spring for gesture-driven things only | apple-design | Charts use `{type:"spring", duration:0.28, bounce:0}` — fine. Switch knob and swipe-row use CSS curves. | Keep CSS curves for CSS; where `motion` is already used, standardise on `{type:"spring", duration:.5, bounce:.2}` for sheets/drag and `bounce:0` for data. Don't add springs to non-gesture UI. | S |
| **P2-3** | Swipe row: release velocity | apple-design | `trip-expenses.tsx:29` snaps with a fixed 200ms regardless of drag speed; no velocity carry-over. | Use release velocity to choose open/closed (threshold ≈ 0.11 px/ms *or* > 50% travel) and `transition` from the dragged position. | M |
| **P2-4** | Tab-bar active-state change | improve-animations | `.tab.active` flips colour instantly. | 120ms colour transition on `.tab` icon/label only. Page switch itself stays instant (high-frequency, keep none). | S |
| **P2-5** | Scroll containment | mobile-native | `body{overscroll-behavior-y:none}` and `.vaul-body{overscroll-behavior:contain}` exist. Not on inner scrollers: `.chip-row`, `.chips.nowrap`, wheel/pickers. | Add `overscroll-behavior-x: contain` on horizontal chip rows so a sideways swipe at the end doesn't trigger iOS back-swipe. | S |
| **P2-6** | `user-select` on chrome | mobile-native | No `user-select` rules; long-press on keypad keys / tab labels can select text and show the callout. | `user-select:none; -webkit-touch-callout:none` on `.key`, `.tab`, `.tab-add`, `.chip`, `.seg > *`. Leave amounts, notes and payee text selectable. | S |
| **P2-7** | Long-text resilience | break-ui | Clipped/ellipsised text on Home rows, Activity rows and Settings row subtitles ("A monthly amount, limits on categorie…", "Rent, subscriptions and anything that r…", "Merge payees that were spelt differently"). Truncation is currently *silent*. | Where the full text carries meaning (Settings subtitles) allow 2 lines (`-webkit-line-clamp:2`) — **changes row heights → DECISION**; otherwise keep ellipsis and add `title`/accessible name with the full string. | S–M |
| **P2-8** | Huge-number handling | break-ui | Hero uses `--t-hero` 64px. £1,000,000.00+ (schema allows bigint pence) and negative values like `−£1,184.73` are untested at hero size. | Add a fit-to-width step (reduce *within existing tokens*: 64 → 32 `--t-large`) when the string exceeds the box. No new sizes. Numbers unchanged. | M |
| **P2-9** | Empty / one / many | break-ui | Empty states exist on Pots, Trips, Insights ("Nothing here yet"). Not verified: Activity with 0 rows, with 1 row, with 1,000+; Categories with 0 sub-categories; Payees with 1 and 1,000. | Seed worst-case data in a throw-away DB (dev only) and screenshot each. Fix only what breaks. Activity list at 1,000+ rows: confirm it virtualises or paginates. | M |
| **P2-10** | Insights suggestion chips overflow | break-ui | `/insights` and `/activity` show horizontal overflow (chip rows). Intentional scroll rows, but the right edge hard-clips ("Cor…"). | Reuse the existing `.chips.fade` mask (`components.css:186`) on both so the clip reads as "scrolls". | S |

### P3 — Polish / only if time

| # | Item | Notes |
|---|---|---|
| **P3-1** | Skeleton shimmer 1.4s linear | Fine; add `will-change` only if a trace shows jank. |
| **P3-2** | Number tick (`useAnimatedNumber`) | Already respects reduced motion. Keep to first load of a screen only; don't re-tick on every query refetch (high frequency). |
| **P3-3** | Off-token font sizes | See §6. Cosmetic cleanup, **needs your decision**. |
| **P3-4** | Pull-to-refresh | Native iOS PWA has none; Insights has a refresh icon. Don't add. |
| **P3-5** | Haptics (`navigator.vibrate`) | Not supported on iOS Safari. Skip. |

---

## 3. Animation opportunities (find-animation-opportunities)

Each passed the four-question gate (frequency, purpose, speed < 300ms, function). Max seven.

| # | Where | Animation | Frequency / purpose | Spec |
|---|---|---|---|---|
| 1 | All tappables | Press scale/opacity | Constant; confirms the tap landed | = **P1-1**, 160ms ease-out |
| 2 | Add-expense **save** | Row inserted into Today list fades/slides 8px in | Several/day; shows where the item went | `translateY(8px)+opacity`, 200ms `--ease-out`, only the new row |
| 3 | Switch | Already animated; add press-stretch of knob (+2px width while held) | Rare; tactile | 120ms; transform only |
| 4 | Budget progress ring/bar on Home | First paint fill from 0 → value | Once per session; shows "spent vs plan" | `scaleX` 400ms `--ease-out`; skip on refetch |
| 5 | Category picker drill-in | Already `pane-in` 180ms ease-out | Several/day | Keep; just retime to token |
| 6 | Sheet content stagger | Rows inside Why / limit sheets 30–50ms apart | Rare; helps reading order | Max 6 rows, opacity+4px, 200ms |
| 7 | Amount **shake** on over-limit | Already exists (`shake`, 320ms) | Rare error cue | Keep as-is |

**Rejected by design (do not animate):** tab switching, list scrolling, keypad digit entry (100+/day), Activity row appearance on filter change, chart scrubbing label, pull of the numbers in the hero on every refetch, anything `scale(0)`, anything > 300ms outside sheets.

---

## 4. Mobile-native checklist (mobile-native)

| Check | State today | Action |
|---|---|---|
| `viewport-fit=cover`, themeColor, `colorScheme: dark` | ✅ `app/layout.tsx` | none |
| Safe areas (`--safe-top` 44, `--safe-bottom` 30, tab bar) | ✅ `components.css:root` | Verify tab bar doesn't cover last list row on every screen (screenshots show content running under it when scrolled — expected, but confirm bottom padding ≥ `--tabbar-h`). |
| `100dvh` | ✅ body; vaul `96dvh` | none |
| Inputs ≥ 16px (no iOS zoom) | ✅ none under 16px | none |
| Tap highlight off | ✅ `button`, `a` | Extend to `[role=button]`, `label`, `.chip`. |
| `touch-action: manipulation` | ❌ | **P1-2** |
| Hit areas ≥ 44 | ❌ many | **P1-3** |
| Hover gating | n/a today | **P1-4** |
| `overscroll-behavior` | ◐ body + vaul | **P2-5** |
| `user-select` on chrome | ❌ | **P2-6** |
| Keyboard avoidance (amount / note fields while keyboard up) | not tested | Test on hardware: Add-expense note field, search fields. Use `visualViewport` if the sticky Save bar is hidden. |

**Allowed exceptions to the 44px rule** (documented, not fixed): inline text links inside a sentence (e.g. "Why?" within a caption) get the invisible padding but won't visually grow; month-calendar day numbers are 44px cells already.

---

## 5. Apple-design checklist

| Principle | Today | Action |
|---|---|---|
| Respond on pointer-down | ❌ no visual response until navigation | **P1-1** (CSS `:active` fires on touch-down) |
| 1:1 tracking | ✅ chart scrubbers, vaul drag, swipe row | keep |
| Interruptible | ✅ vaul; ◐ CSS keyframes (`pane-in`, `gb-in`, `toast-in` can't be interrupted) | prefer `transition` over keyframes for state changes; keep keyframes for mount only |
| Momentum / release velocity | ❌ swipe row | **P2-3** |
| Springs for gestures | ◐ | **P2-2** |
| Restraint | ✅ app is already calm | do not add decorative motion; §3 rejected list |

---

## 6. Off-token font sizes (report only)

Counts of inline `fontSize` in `components/` and `app/` (TSX): 17 (39), 13 (33), 15 (20), **14 (19)**, 12 (9), **11 (8)**, **19 (7)**, 16 (5), 24 (4), 28 (3), 34 (2), 26 (2), 22 (2), 21 (2), 20 (2), 52, 44, 40, 30 (1 each); CSS also has `10px` (`.tab`) and `.seg > * 14px`.

`design/tokens.css` sizes: **64, 32, 22, 17, 17, 15, 13, 12**. So 10, 11, 14, 16, 19, 20, 21, 24, 26, 28, 30, 34, 40, 44, 52 are not tokens (some are probably intentional display sizes from the mockups — e.g. keypad 26px, hero 76px/xl figure).

**Recommendation:** do **not** change these in this pass. Mapping 14 → 15 or 11 → 12 would alter wrapping and the "layouts stay as they are" rule. I'd list each occurrence with file:line in a follow-up appendix and you decide per size whether it's a mockup-sanctioned size (add to tokens) or drift (snap). **DECISION: leave / audit appendix / snap.**

---

## 7. Break-ui worst-case matrix

Method: seed throw-away data in the scratch test DB only (never committed), screenshot at 390×844, report first, fix after approval. Dev-only toggle not needed — data seeding is enough.

| Case | Screens | Expected failure modes | Status |
|---|---|---|---|
| 60-char payee, 60-char category name, 200-char note | Activity row, Add expense, Payees, Categories, Insights | row overflow, 3-line wrap pushing amount off-screen | to run |
| £9,999,999.99 expense / income; −£1,000,000 balance | Home hero, Cash hero, Activity amount, keypad | hero clipping, "£" super-script collision | to run (P2-8) |
| Zero accounts, zero txns, zero budgets | Home, Cash, Analytics, Budgets | empty-state copy, chart with 0 points | partial — Pots/Trips/Insights empty states verified in screenshots |
| One transaction only | Activity, Analytics, Cash chart | single-point chart, "vs last month" with no prior data | to run |
| 1,000+ transactions in a month | Activity, Analytics | scroll perf, list virtualisation | to run |
| 50 categories / 200 payees | Categories, picker, Payees | picker height, search | to run |
| Budget set to £0 / £1 / 99,999 | Budget detail | ring/bar division by zero, "NaN%" | to run |
| Reduced motion + large text (iOS Dynamic Type max) | all | clipping at xxxLarge | to run — Dynamic Type may need `rem`; **out of scope unless you want it** |
| Offline | all | already has `/offline`; verify skeletons don't spin forever | to run |

---

## 8. Recommended execution order

1. **Batch A — foundations (P1-1, P1-2, P1-4, P1-8, P2-6)**: one CSS block in `components.css`/`globals.css`. Almost no TSX. Biggest feel improvement.
2. **Batch B — targets and the bug (P1-3, P1-9, P2-10)**: touch hit areas, `/cash` overlap, chip fade.
3. **Batch C — sheets & toasts (P1-5, P1-6, P2-1, P2-2)**: motion tokens, retime existing animations.
4. **Batch D — charts (P1-7)**: `scaleX` bars.
5. **Batch E — break-ui sweep (P2-7, P2-8, P2-9)**: seed, screenshot, fix what breaks.
6. **Batch F — gestures (P2-3, P2-4, §3 #2/#4/#6)**.

Each batch: separate branch/PR, desktop (≥1024) regression check, `npm run typecheck && npm run lint && npm test`, Playwright suite, plus 390×844 screenshots before/after. Judgement calls go in `DECISIONS.md`.

**Tests per CLAUDE.md:** this pass touches no EC- behaviour. I'll add (a) a Playwright "tap-target ≥44px" scan as a regression test, (b) a "no overlapping header/hero" box test for `/cash`, (c) a reduced-motion test asserting no transform animation runs.

---

## 9. Decisions I need from you

1. **Motion tokens in `app/globals.css`** — yes (recommended) / no, reuse `--spring` + literals.
2. **P1-9 `/cash`** — OK to move the hero ~8–12px down to remove the overlap?
3. **P2-7** — allow 2-line Settings subtitles (taller rows), or keep ellipsis + accessible name only?
4. **§6 off-token sizes** — leave / audit appendix / snap.
5. **Dynamic Type** — in scope or not?
6. **Commit `.claude/skills/` and `skills-lock.json`?** They're currently untracked. Recommended: commit `skills-lock.json` only and keep `.claude/skills/` out of git (or commit both if you want the skills available in every cloud session).

Nothing will be implemented until you approve (or edit) this plan.


---

## 10. Outcome (after implementation)

| Item | Result |
|---|---|
| P1-1 press feedback | Done (shared CSS block) |
| P1-2 `touch-action` | Done |
| P1-3 hit areas ≥ 44 | Done for controls; tap-target scan went from ~170 under-44 targets to about 45 across 21 routes. Remaining ones are the documented exceptions (inputs inside 48px fields, two Save buttons, a few full-width text rows) |
| P1-4 hover gating | No hover styles exist; nothing added |
| P1-5 sheet curve | **Plan was wrong:** Vaul already uses 500ms `cubic-bezier(0.32,0.72,0,1)`. Left alone; desktop modal retimed with an exit |
| P1-6 toast exit | Done (150ms) |
| P1-7 bars | Done (`clip-path` / `scaleX`) |
| P1-8 reduced motion | Done (movement off, opacity and colour kept) |
| P1-9 `/cash` overlap | Done |
| P2-1 / P2-2 timings | Switch, swipe row, `pane-in`, `gb-in`, toast and modal now use the tokens |
| P2-3 swipe velocity | Done (0.11 px/ms) |
| P2-4 tab colour | Done (160ms) |
| P2-5 overscroll-x | Done |
| P2-6 user-select | Done |
| P2-7 subtitles | Decided: keep ellipsis |
| P2-8 big figures | Already handled by `figureSize` |
| P2-9 break-ui data sweep | Partly done; see the PR notes |
| P2-10 chip fade | Decided against (see DECISIONS.md) |
| §3 #2, #4, #6 | Deferred |
