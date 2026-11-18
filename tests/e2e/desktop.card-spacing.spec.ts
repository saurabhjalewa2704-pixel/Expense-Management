import { expect, test } from "@playwright/test";
import { fixClock, resetDb, signIn } from "./helpers";
import { expectNoSidewaysOverflow, expectNoTouchingCards } from "./spacing";

// The same check as 32-card-spacing at the desktop width, where the cards sit in columns.
test("UI-SP-02 no two cards touch on the desktop screens", async ({ page }) => {
  test.setTimeout(200_000);
  await resetDb({ seed: "budget" });
  await fixClock(page.context());
  await signIn(page);
  await page.clock.resume();
  for (const route of ["/", "/activity", "/analytics", "/bills", "/budget", "/cash", "/insights", "/pots", "/settings", "/trips"]) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    await expectNoTouchingCards(page, `${route} (desktop)`, expect as never);
    await expectNoSidewaysOverflow(page, `${route} (desktop)`, expect as never);
  }
});
