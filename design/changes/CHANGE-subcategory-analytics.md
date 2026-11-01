# Change request: sub-category (L2) analytics

**Date:** 24 October 2026 · **PRD version:** 1.3 · **Scope:** Analytics only; everything else is unchanged.

## How to apply this pack
Unzip this pack at the repository root and let it overwrite existing files.

| File | What it is |
|---|---|
| `PRD.md` | Updated PRD. It adds the new **§6.7.1 Sub-category analytics**, updates the AN-02 and AN-07 rows, and extends `spend_by_category` in §10.4. It also adds invariant 6 and sub-category seed figures to Appendix A. It still contains the v1.2 add-expense changes. |
| `design/mockups/05-analytics.html` | **Replaces** the old Analytics page: the "Where it went" card now has the view switch. |
| `design/mockups/05a-analytics-categories.html` | **New:** "Where it went" by category (the default view). |
| `design/mockups/05b-analytics-subcategories.html` | **New:** "Where it went" by sub-category. |
| `design/mockups/05c-category-detail.html` | **New:** the Category detail screen (Eating out). |
| `design/screenshots/` | PNG renders of the four screens above. |

## What the owner asked for
Analytics currently breaks spending down only by L1 category, and that should stay. He also wants to see spending across **L2 sub-categories**, without making the page cumbersome.

## What to build
Read PRD §6.7.1 for the full rules and acceptance criteria. In short:

1. **A "Categories · Sub-categories" segmented switch inside the "Where it went" card.** It adds no new tab and no new chart type, and the device remembers the last choice.
   - **Categories:** the current view. Every row now opens Category detail.
   - **Sub-categories:** one ranked list of every sub-category across all parents. It shows the top 8 with their parent as a caption. "Show all N" expands it inline, fixed costs collapse into a single summary row, and the same "usual by now" markers and ↑ flags apply.
2. **Category detail** opens from any category row, with these parts:
   - the total compared with usual;
   - three stat tiles;
   - a 100% share bar plus a ranked list of its sub-categories;
   - a 6-month trend with filter chips for each sub-category;
   - the top places.
3. **Sub-category detail** uses the same template, without the split card.

## Code changes to expect
- **SQL:** add `p_level` (`'parent'` or `'leaf'`) to `spend_by_category`, plus the new columns. Add `category_monthly()` and invariant test 6.
- **Components:**
  - Reuse the existing category bar row for L1.
  - Add a three-line `SubcategoryRow`: name and flag; parent or visits caption; bar.
  - Add a `ShareBar` and a `MonthlyBars` component (visx), with the projected portion hatched.
- **Routes:** `/analytics/category/[id]` and `/analytics/subcategory/[id]`, both reading the Analytics period from the URL (`?p=2026-10`).

## Done when
- All acceptance criteria in §6.7.1 pass.
- Invariant 6 passes in CI.
- A visual check against the four screenshots at 390 px.
