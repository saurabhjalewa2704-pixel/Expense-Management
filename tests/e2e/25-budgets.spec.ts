import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, openAdd, startBudget, startDemo } from "./helpers";

// PRD §6.13 acceptance criteria against Appendix A.3 (Sun 18 Oct 2026).
test.describe("budgets (BUD acceptance, FC-9, CASH-06)", () => {
  const POINT = 433869;                                       // the forecasting engine's answer on this seed (a regression anchor; every screen must agree with /api/debug/forecast)
  test("BUD-1/2 Home: the budget card and the three limits most at risk", async ({ page }) => {
    await startBudget(page);
    const card = page.getByTestId("budget-card");
    await expect(card.getByTestId("budget-left")).toHaveText("£1,163.15");
    await expect(card).toContainText("left of £4,400");
    await expect(page.getByTestId("budget-sub")).toContainText("74% spent · 58% of the month gone · £132 under plan");
    await expect(card.getByTestId("safe-to-spend")).toContainText("£80.58");
    await expect(card.getByTestId("safe-to-spend")).toContainText("for 14 days, after bills");
    const j = await (await page.request.get("/api/debug/forecast?month=2026-10")).json();
    expect(j.forecast.point).toBe(POINT);
    await expect(card.getByTestId("forecast-figure")).toHaveText("£4,339");          // High confidence: exact (to the pound on this card)
    await expect(card.getByTestId("forecast-kpi")).toContainText("£61 headroom");
    await expect(card.getByTestId("budget-status")).toHaveText("Tight");
    const rows = page.getByTestId("limits-card").getByTestId("limit-row");
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(rows.nth(i)).toContainText(/Forecast £\d+ (over|under)/);
    await page.screenshot({ path: "tests/e2e/shots/budget-home.png", fullPage: true });
  });

  test("BUD-3 Why this forecast? adds up to the forecast, and says how it was made (§6.14.16)", async ({ page }) => {
    await startBudget(page);
    await page.getByTestId("forecast-kpi").click();
    const body = page.getByTestId("why-body");
    await expect(page.getByTestId("why-confidence")).toHaveText("High confidence");
    await expect(page.getByTestId("why-headline")).toHaveText("£4,338.69");
    await expect(page.getByTestId("why-range")).toContainText("likely £4,041–£4,636");
    await expect(page.getByTestId("why-sum")).toContainText("£3,236.85");
    await expect(body).toContainText("Spotify 22nd · Disney+ 24th · Netflix 27th");
    await expect(body).toContainText("+£34.97");
    await expect(page.getByTestId("why-forecast")).toHaveText("£4,338.69");
    await expect(page.getByTestId("why-usual")).toContainText("£80.61 a day");
    await expect(page.getByTestId("why-weekday")).toBeVisible();
    await expect(page.getByTestId("why-weight")).toHaveText("71%");
    await expect(page.getByTestId("why-sharper")).toContainText("Weekday pattern is on.");
    await expect(page.getByTestId("add-extra")).toBeVisible();
    await page.screenshot({ path: "tests/e2e/shots/forecast-why.png", fullPage: true });
  });

  test("F3 / EC-F30 a planned extra adds to the forecast, and is asked about once when a spend matches it", async ({ page }) => {
    await startBudget(page);
    await page.getByTestId("forecast-kpi").click();
    await page.getByTestId("add-extra").click();
    await page.getByTestId("extra-amount").fill("300");
    await page.getByTestId("extra-label").fill("Christmas presents");
    await expect(page.getByTestId("extra-after")).toHaveText("£4,638.69");
    await page.getByTestId("extra-save").click();
    await expect(page.getByTestId("why-forecast")).toHaveText("£4,638.69");
    await expect(page.getByTestId("why-extras")).toContainText("Christmas presents");
    const j = await (await page.request.get("/api/debug/forecast?month=2026-10")).json();
    expect(j.forecast.point).toBe(POINT + 30000);
    expect(j.forecast.components.extras).toBe(30000);
  });

  test("BUD-4..6 Budget detail: tiles, what-ifs, limits and the watch card", async ({ page }) => {
    await startBudget(page);
    await page.goto("/budget");
    await expect(page.getByTestId("budget-month")).toHaveText("October 2026");
    await expect(page.getByTestId("budget-left")).toHaveText("£1,163.15");
    await expect(page.getByTestId("forecast-title")).toHaveText("On course to finish £61 under budget");
    await expect(page.getByTestId("tile-safe")).toContainText("£80.58/day");
    await expect(page.getByTestId("tile-usual")).toContainText("£76.21/day");
    await expect(page.getByTestId("tile-plan")).toContainText("£131.70 under");
    await expect(page.getByTestId("tile-bills")).toContainText("£34.97");
    await expect(page.getByTestId("whatif-low")).toContainText("£4,105");
    await expect(page.getByTestId("whatif-safe")).toContainText("£4,394");
    await expect(page.getByTestId("whatif-usual")).toContainText("£4,339");
    await expect(page.getByTestId("limits-list").getByTestId("limit-row")).toHaveCount(6);        // five limits and Everything else
    await expect(page.getByTestId("forecast-chart")).toBeVisible();
    await page.screenshot({ path: "tests/e2e/shots/budget-detail.png", fullPage: true });
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByTestId("budget-month")).toHaveText("September 2026");
    await expect(page.getByTestId("budget-none")).toBeVisible();        // no budget existed in September
  });

  test("CASH-06 Available cash shows the projected close, ≈ £3,164 (available now less everything the engine still expects, less the £500 transfer)", async ({ page }) => {
    await startBudget(page);
    await page.goto("/cash");
    await expect(page.getByTestId("projected-close")).toContainText("≈ £3,164");
    await expect(page.getByTestId("cash-projection")).toBeVisible();
    await page.goto("/insights");
    await expect(page.getByTestId("month-outlook")).toContainText("On track to close October at about £3,164");
  });

  test("FC-9 the trend chart, Budget card and Available cash show one forecast", async ({ page, request }) => {
    await startBudget(page);
    await page.goto("/analytics");
    await page.getByTestId("trend-why").click();
    await expect(page.getByTestId("why-forecast")).toHaveText("£4,338.69");           // the same figure as the Home card, Budget detail and Available cash
  });

  test("Setup: a new budget with a limit, saved from the screen", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByTestId("budget-prompt")).toBeVisible();
    await expect(page.getByTestId("pace")).toBeVisible();                 // the pace card stays until a budget exists
    await page.getByTestId("budget-prompt").click();
    await page.getByTestId("budget-amount").fill("4400");
    await page.getByTestId("setup-limit").filter({ hasText: "Groceries" }).click();
    await page.getByTestId("limit-amount").fill("750");
    await page.getByTestId("limit-save").click();
    await page.getByTestId("setup-limit").filter({ hasText: "Eating out" }).click();
    await page.getByTestId("limit-amount").fill("400");
    await page.getByTestId("limit-save").click();
    await expect(page.getByTestId("limits-total")).toHaveText("£1,150");
    await expect(page.getByTestId("left-else")).toHaveText("£3,250");
    await page.getByTestId("budget-save").click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByTestId("limits-list").getByTestId("limit-row")).toHaveCount(3);
    const rows = await sql<{ category_id: string | null; amount_pence: string }>("select category_id, amount_pence from budgets order by amount_pence desc");
    expect(rows.map((r) => r.amount_pence)).toEqual(["440000", "75000", "40000"]);
    await page.goto("/");
    await expect(page.getByTestId("budget-card")).toBeVisible();
    await expect(page.getByTestId("pace")).toHaveCount(0);                // the budget card replaces the pace card
  });

  test("EC-G3 limits adding to more than the budget warn, and still save", async ({ page }) => {
    await startDemo(page);
    await page.goto("/budget/setup");
    await page.getByTestId("budget-amount").fill("500");
    await page.getByTestId("setup-limit").filter({ hasText: "Groceries" }).click();
    await page.getByTestId("limit-amount").fill("750");
    await page.getByTestId("limit-save").click();
    await expect(page.getByTestId("limits-warning")).toContainText("£250.00 more than your monthly budget");
    await expect(page.getByTestId("left-else")).toHaveText("£0");
    await page.getByTestId("budget-save").click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByTestId("limits-warning")).toBeVisible();
  });

  test("BUD-11 Analytics › Budgets: variance, table, history and health", async ({ page }) => {
    await startBudget(page);
    await page.goto("/analytics");
    await page.getByTestId("tab-budgets").click();
    await expect(page.getByTestId("abudget-month")).toHaveText("October 2026");
    const rows = page.getByTestId("var-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(5)).toContainText("Everything else");
    await expect(page.getByTestId("variance-net")).toContainText("Net −£61");                  // forecast £4,339 against £4,400
    const table = page.getByTestId("budget-table");
    await expect(table).toContainText("£3,237 spent, £4,339 forecast");
    await expect(table).toContainText("£2,300");
    await expect(table.getByRole("row").last()).toContainText("£4,339");
    await expect(page.getByTestId("budget-history")).toContainText("could be your first month within £4,400");
    await expect(page.getByTestId("health-track")).toContainText("of 5");
    await expect(page.getByTestId("health-accuracy")).toHaveText("Learning");                  // no nightly backtests yet: "2 full months needed"
    await page.screenshot({ path: "tests/e2e/shots/analytics-budgets.png", fullPage: true });
  });

  test("BUD-12 Category detail shows the limit and the forecast", async ({ page }) => {
    await startBudget(page);
    const id = (await sql<{ id: string }>("select id from categories where name = 'Eating out' and parent_id is null"))[0]!.id;
    await page.goto(`/analytics/category/${id}`);
    await expect(page.getByTestId("detail-limit")).toContainText(/£312\.60 of £400 · forecast £\d+/);
    await expect(page.getByTestId("limit-line")).toHaveCount(1);
  });

  test("EC-G8 a refund linked to a category reduces its spend", async ({ page }) => {
    await startBudget(page);
    await page.goto("/");
    await openAdd(page);
    await page.getByRole("tab", { name: "Income" }).click();
    await page.getByText("Refunds", { exact: true }).first().click();
    await page.getByTestId("refund-for").locator("select").selectOption({ label: "Eating out" });
    await amountKeys(page, "20");
    await page.getByRole("button", { name: /^Add income/ }).click();
    await expect.poll(async () => (await sql("select 1 from transactions where refund_category_id is not null")).length).toBe(1);
    await page.goto("/budget");
    await expect(page.getByTestId("limits-list").getByTestId("limit-row").filter({ hasText: "Eating out" })).toContainText("£292.60");
  });

  test("BUD-10 the alert check records one forecast alert per limit, and not a second", async ({ page, request }) => {
    await startBudget(page);
    const first = await page.request.post("/api/budget/check");
    expect(first.ok()).toBe(true);
    const sent = (await first.json()).sent as { kind: string; name: string }[];
    expect(sent.every((a) => ["forecast_over", "pct80", "reached"].includes(a.kind))).toBe(true);
    const again = await (await page.request.post("/api/budget/check")).json();
    expect(again.sent).toEqual([]);                                                          // once per kind, limit and month
    expect((await sql("select 1 from budget_alerts_sent")).length).toBe(sent.length);
  });

  test("LAYOUT the budget screens fit the 390px screen and keep the mock-up's arrangement", async ({ page }) => {
    await startBudget(page);
    const overflow = async (name: string) => {
      const bad = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        return [...document.querySelectorAll<HTMLElement>("main *, .scroll *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); }).map((e) => e.tagName + "." + e.className).slice(0, 5);
      });
      expect(bad, `${name}: elements outside the screen`).toEqual([]);
    };
    // Setup (mock-up 28): close button left, title centred, a pill-sized Save on the right; each limit is name + usual on the left and the amount or "Add limit" on the right
    await page.goto("/budget/setup");
    await expect(page.getByTestId("limits-setup")).toBeVisible();
    const save = (await page.getByTestId("budget-save").boundingBox())!;
    expect(save.width).toBeLessThan(110);
    expect(save.x + save.width).toBeGreaterThan(330);
    const title = (await page.getByText("Budgets", { exact: true }).first().boundingBox())!;
    expect(Math.abs(title.x + title.width / 2 - 195)).toBeLessThan(20);
    const row = page.getByTestId("setup-limit").filter({ hasText: "Home" });
    const name = (await row.getByText("Home", { exact: true }).boundingBox())!;
    const chip = (await row.getByText("Add limit").boundingBox())!;
    expect(name.x).toBeLessThan(chip.x);
    expect(Math.abs(name.y - chip.y)).toBeLessThan(40);
    await overflow("setup");
    await page.screenshot({ path: "tests/e2e/shots/budget-setup.png", fullPage: true });
    await page.getByTestId("setup-limit").filter({ hasText: "Eating out" }).click();
    await expect(page.getByTestId("limit-sheet")).toBeVisible();
    await page.screenshot({ path: "tests/e2e/shots/budget-limit.png" });
    await page.getByRole("button", { name: "Cancel" }).click();
    // Home, detail, Analytics › Budgets
    for (const [url, tid] of [["/", "budget-card"], ["/budget", "budget-screen"]] as const) {
      await page.goto(url);
      await expect(page.getByTestId(tid)).toBeVisible();
      await overflow(url);
    }
    await page.goto("/analytics");
    await page.getByTestId("tab-budgets").click();
    await expect(page.getByTestId("budget-health")).toBeVisible();
    await overflow("analytics budgets");
  });
});
