# Change request: redesign Add expense and category selection

**Date:** 21 October 2026 · **PRD version:** 1.2 · **Scope:** the add-expense flow only; everything else is unchanged.

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files. It contains:

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. Requirements CAP-01, CAP-01.1 and the new CAP-01.2 in §6.3 replace the old Quick Add sheet and category picker. The screen inventory (§5.3), MOB-03 and the M1 milestone are also updated. |
| `design/mockups/02-quick-add.html` | **Replaces** the old Quick Add mock-up: the full-screen Add expense screen. |
| `design/mockups/03-category-picker.html` | **Replaces** the old picker: Choose category, showing the whole hierarchy on one screen. |
| `design/mockups/03b-category-search.html` | **New:** search across both category levels. |
| `design/mockups/03c-discard.html` | **New:** closing with unsaved input. |
| `design/screenshots/` | PNG renders of the four screens above, at 2×. |

## What was wrong
1. Quick Add opened as a bottom sheet with no visible way to close it.
2. Suggestions and the picker only let you pick a top-level category (Eating out), not the specific sub-category (Coffee & snacks).

## What to build instead
Read PRD §6.3 CAP-01, CAP-01.1 and CAP-01.2 for the full rules and acceptance criteria. In short:

1. **Full-screen modal with a Close (✕) button**, top-left.
   - It does not use a bottom sheet or Vaul, and has no swipe-to-dismiss.
   - If something has been entered, closing asks "Discard this expense?" (Discard / Keep editing).
2. **Six "top category" tiles at the lowest level** (sub-category), with the parent shown as a caption.
   - They are ranked by use over the last 90 days and recomputed once a day, so the order stays stable.
   - Tapping a tile only selects it; the **Add** button saves.
   - A known payee pre-selects its category.
3. **"All categories ›" opens Choose category**, which lists **every parent with all its sub-categories at once**.
   - One tap on any row selects that category and returns to Add expense.
   - Each section ends with an "Other ‹parent›" row, which assigns the parent itself.
   - A sticky row of parent chips at the top jumps between sections.
   - Search matches both levels and shows each result's parent beneath it. A final row offers to create a new category.
4. A category picked from the full list that isn't in the top six **temporarily takes tile 6**, selected.

## Code changes to expect
- Remove the Vaul sheet wrapper from the add-expense flow. Build it as a route-level modal, for example an intercepting route `@modal/(.)add` or a portal with `role="dialog"` and `aria-modal="true"`. Manage focus: trap it inside the modal and return it to the ＋ button on close.
- Replace the suggestion scorer with `lib/topCategories.ts`: a 90-day frequency count, a daily cache in IndexedDB keyed by London date, and the cold-start list from CAP-01.1.
- Add a new `CategoryPicker` component made of a flat sectioned list, the jump strip and search. It reads the cached `categories` table, so it works offline.
- Drop the "Tap category to save" setting (`profiles.tap_to_save`) in a migration.

## Done when
- Every acceptance criterion under CAP-01, CAP-01.1 and CAP-01.2 passes in Playwright at 390 × 844.
- Visual check against `design/screenshots/02-quick-add.png`, `03-category-picker.png`, `03b-category-search.png` and `03c-discard.png`.
- The decision is recorded in `DECISIONS.md`: "21 Oct 2026 · Add expense is a full-screen modal; categories chosen at leaf level · owner feedback".
