import { expect, test } from "@playwright/test";
import { fixClock, resetDb, signIn } from "./helpers";

// UX polish: a page must be able to scroll its last line clear of the tab bar. Screens that set their own bottom padding
// (48px, less than the tab bar's height) left the last card half hidden behind it with nothing left to scroll.
const SCREENS = ["/", "/cash", "/budget", "/budget/setup", "/analytics", "/settings", "/bills"];

test.describe("bottom clearance", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb({ seed: "budget" });
    await fixClock(page.context());
    await signIn(page);
    await page.clock.resume();
  });

  for (const route of SCREENS) {
    test(`the last line of ${route} scrolls clear of the tab bar`, async ({ page }) => {
      await page.goto(route);
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const gap = await page.evaluate(() => {
        const tab = document.querySelector(".tabbar") as HTMLElement;
        const tabTop = tab.getBoundingClientRect().top;
        let last = 0;
        for (const e of document.querySelectorAll("body *")) {
          if (tab.contains(e) || e.children.length > 0) continue;
          const cs = getComputedStyle(e);
          if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden" || e.closest("[role=status]")) continue;
          const r = (e as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) last = Math.max(last, r.bottom);
        }
        return tabTop - last;
      });
      expect(gap).toBeGreaterThanOrEqual(0);
    });
  }
});
