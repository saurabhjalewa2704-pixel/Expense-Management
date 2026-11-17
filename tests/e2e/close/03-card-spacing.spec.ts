import { expect, test } from "@playwright/test";
import { startClose } from "../helpers";
import { expectNoTouchingCards } from "../spacing";

// UX: no two cards touch on Home (with the close card), the month-close flow and its settings.
test("UI-SP-04 no two cards touch on the month-close screens", async ({ page }) => {
  test.setTimeout(200_000);
  await startClose(page);
  for (const route of ["/", "/close/2026-11", "/close/2026-11/missing-days", "/close/2026-11/bills", "/close/2026-11/balances", "/close/2026-11/tidy-up", "/close/2026-11/review", "/close/2026-11/next-month", "/settings/month-close"]) {
    await page.goto(route);
    await page.waitForTimeout(1800);
    await expectNoTouchingCards(page, route, expect as never);
  }
});
