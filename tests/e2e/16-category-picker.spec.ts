import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { amountKeys, openAdd, startDemo, toast } from "./helpers";

const saved = (name: string, pence: number) =>
  sqlOne<{ n: number }>(`select count(*)::int n from transactions t join categories c on c.id=t.category_id where c.name='${name}' and t.amount_pence=${pence} and t.deleted_at is null`).then((r) => r.n);

test.describe("category picker (parent → child)", () => {
  test("tapping a parent slides to its own list; Back returns; a sub-category saves and shows its parent", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "7.50");
    await page.getByRole("button", { name: "More categories" }).click();
    await expect(page.getByRole("button", { name: "Transport", exact: true })).toBeVisible();      // the parent grid

    await page.getByRole("button", { name: "Transport", exact: true }).click();
    const list = page.getByTestId("cat-list");
    await expect(list).toContainText("Transport (general)");
    await expect(list).toContainText("Anything in Transport");
    await expect(list.getByRole("button", { name: "Taxis" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to all categories" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Groceries", exact: true })).toHaveCount(0);        // the grid is gone: no hunting below it

    await page.getByRole("button", { name: "Back to all categories" }).click();
    await expect(page.getByRole("button", { name: "Groceries", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transport", exact: true }).click();

    await page.getByRole("button", { name: "Taxis" }).click();                                         // one tap chooses and closes
    await expect(page.getByLabel("Search categories")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Taxis" })).toBeChecked();               // the chosen category leads the cards, with its parent beneath
    await page.getByRole("button", { name: "Add £7.50" }).click();
    await expect(toast(page)).toContainText("Added £7.50 · Taxis");
    await expect.poll(() => saved("Taxis", 750)).toBe(1);
  });

  test("'(general)' is a visible row, so choosing the parent itself needs no hidden second tap", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "12");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Transport", exact: true }).click();
    await page.getByRole("button", { name: /Transport \(general\)/ }).click();
    await page.getByRole("button", { name: "Add £12.00" }).click();
    await expect.poll(() => saved("Transport", 1200)).toBe(1);
  });

  test("reopening with a choice lands on that parent's list with the choice marked", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "3");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Transport", exact: true }).click();
    await page.getByRole("button", { name: "Taxis" }).click();
    await page.getByRole("button", { name: "More categories" }).click();
    const list = page.getByTestId("cat-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("button", { name: "Taxis" }).locator(".radio.on")).toHaveCount(1);
    await page.getByRole("button", { name: "Back to all categories" }).click();
    await expect(page.getByRole("button", { name: "Transport", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("search spans both levels and shows each match's parent", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "4");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByLabel("Search categories").fill("taxi");
    const hit = page.getByRole("button", { name: /Taxis/ });
    await expect(hit).toContainText("Transport");
    await hit.click();
    await page.getByRole("button", { name: "Add £4.00" }).click();
    await expect.poll(() => saved("Taxis", 400)).toBe(1);
  });

  test("a Suggested row offers the likely categories with their parents, one tap each", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "9");
    await page.getByRole("button", { name: "More categories" }).click();
    const suggested = page.getByTestId("cat-suggested");
    await expect(suggested).toBeVisible();
    const chips = suggested.getByRole("button");
    expect(await chips.count()).toBeGreaterThanOrEqual(3);
    const label = (await chips.first().getAttribute("aria-label"))!.replace("Suggested: ", "");
    const leaf = label.split(" › ").pop()!;
    await chips.first().click();
    await page.getByRole("button", { name: "Add £9.00" }).click();
    await expect.poll(() => saved(leaf, 900)).toBe(1);
  });

  test("New inside a parent's list creates a sub-category under that parent and chooses it", async ({ page }) => {
    await startDemo(page);
    await openAdd(page);
    await amountKeys(page, "20");
    await page.getByRole("button", { name: "More categories" }).click();
    await page.getByRole("button", { name: "Transport", exact: true }).click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByLabel("Category name").fill("Scooter hire");
    await page.getByRole("radio", { name: "bike" }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("radio", { name: "Scooter hire" })).toBeChecked();
    expect((await sql<{ parent: string }>(`select p.name parent from categories c join categories p on p.id=c.parent_id where c.name='Scooter hire'`))[0]?.parent).toBe("Transport");
  });
});
