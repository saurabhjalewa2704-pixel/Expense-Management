import { expect, test } from "@playwright/test";
import { sql } from "./db";
import { amountKeys, openAdd, startDemo, toast } from "./helpers";

test.describe("Quick Add (redesigned)", () => {
  test("header, type switch, amount, payee, top-category cards, details, keypad and Add all fit one 390×844 screen", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "12.80");
    const qa = page.getByTestId("quick-add");
    await expect(page.getByText("New expense")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(page.getByText("Your top categories")).toBeVisible();
    await expect(page.getByRole("button", { name: "More categories" })).toContainText("All categories");
    await expect(page.getByTestId("qcard")).toHaveCount(6);
    const { sh, ch } = await qa.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(sh).toBeLessThanOrEqual(ch);                                                   // nothing to scroll
    const add = (await page.getByRole("button", { name: "Add £12.80" }).boundingBox())!;
    expect(add.y + add.height).toBeLessThanOrEqual(844);                                  // Add is on screen
  });

  test("cards show the lowest-level categories people actually use, each with its parent underneath", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    const cards = page.getByTestId("qcard");
    const texts = await cards.allInnerTexts();
    // sub-categories carry their parent, never the other way round
    expect(texts.some((t) => /Coffee & snacks\s+Eating out/.test(t))).toBe(true);
    expect(texts.some((t) => /Supermarket\s+Groceries/.test(t))).toBe(true);
    // two leaves of the same parent can both be offered
    expect(texts.filter((t) => /Eating out/.test(t)).length).toBeGreaterThanOrEqual(1);
    expect(texts.every((t) => !/^Eating out\s*$/.test(t.trim()))).toBe(true);             // not the bare level-1 node
  });

  test("a remembered payee selects its leaf card, and tapping a card saves it (three taps)", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "12.80");
    await page.getByLabel("Payee").fill("Gail");
    await page.getByRole("option", { name: /Gail's Bakery/ }).click();
    const coffee = page.getByRole("radio", { name: "Coffee & snacks" });
    await expect(coffee).toBeChecked();
    await expect(coffee).toContainText("Eating out");
    await coffee.click();
    await expect(toast(page)).toContainText("Added £12.80 · Coffee & snacks");
  });

  test("All categories opens the full picker, and the choice leads the cards", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "8");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Health", exact: true }).click();
    await page.getByTestId("cat-list").getByRole("button").nth(1).click();               // the first sub-category (row 0 is "(general)")
    const first = page.getByTestId("qcard").first();
    await expect(first).toHaveAttribute("aria-checked", "true");
    await expect(first).toContainText("Health");                                         // its parent beneath
    await expect(page.getByTestId("qcard")).toHaveCount(6);
    await page.getByRole("button", { name: /^Add £8/ }).click();
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int n from transactions where amount_pence = 800 and deleted_at is null`))[0]!.n).toBe(1);
  });

  test("income shows income types, transfers have no categories, and the title follows the type", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await page.getByRole("tab", { name: "Income" }).click();
    await expect(page.getByText("New income")).toBeVisible();
    await expect(page.getByText("Income type")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Salary" })).toBeVisible();
    await page.getByRole("tab", { name: "Transfer" }).click();
    await expect(page.getByText("New transfer")).toBeVisible();
    await expect(page.getByTestId("qcard")).toHaveCount(0);
  });

  test("the close button asks before throwing away a half-typed entry; editing keeps its own title", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("quick-add")).toHaveCount(0);                          // nothing typed: closes straight away
    await openAdd(page);
    await amountKeys(page, "5");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Discard this entry?");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByTestId("amount")).toHaveText("5");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.goto("/activity");
    await page.getByTestId("txn-row").first().click();
    await expect(page.locator(".qa-head .t")).toHaveText("Edit transaction");
  });
});
