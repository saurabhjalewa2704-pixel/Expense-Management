import { expect, test } from "@playwright/test";
import { addAccountViaEditor, heroPence, resetDb, signIn } from "./helpers";

test("first run: accounts, categories, install, then Home shows the right available cash (AUTH-02)", async ({ page }) => {
  await resetDb(); // a brand-new owner: not onboarded
  await signIn(page);
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();

  // step 1 cannot be skipped: at least one account
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByRole("button", { name: "Add an account" }).click();
  await addAccountViaEditor(page, { name: "Monzo", balance: "3214.08" });
  await expect(page.getByTestId("onboarding-account")).toContainText("£3,214.08");

  // a credit card is entered as the amount owed and shown as negative (ACC-01)
  await page.getByRole("button", { name: "Add another account" }).click();
  await addAccountViaEditor(page, { name: "Amex Gold", type: "Credit card", balance: "1184.73" });
  await expect(page.getByTestId("onboarding-account").nth(1)).toContainText("−£1,184.73");

  // savings are kept apart by default
  await page.getByRole("button", { name: "Add another account" }).click();
  await addAccountViaEditor(page, { name: "Marcus", type: "Savings", balance: "12400" });
  await expect(page.getByTestId("onboarding-account").nth(2)).toContainText("kept apart");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("We've set up 12 categories for you")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Start using/ }).click();

  await expect(page).toHaveURL("/");
  // 3,214.08 − 1,184.73 = 2,029.35; savings are not in available cash
  await expect.poll(() => heroPence(page)).toBe(202935);
  await page.reload();
  await expect(page).toHaveURL("/");
});

test("setup cannot be re-entered once it is done", async ({ page }) => {
  await resetDb({ onboarded: true });
  await signIn(page);
  await page.goto("/welcome");
  await expect(page).toHaveURL("/");
});
