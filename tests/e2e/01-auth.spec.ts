import { expect, test } from "@playwright/test";
import { OWNER, resetDb, signIn } from "./helpers";

test.beforeEach(async () => { await resetDb({ onboarded: true }); });

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/activity");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Factivity/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a wrong code shows an inline error; the right code lands on Home", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E-mail me a code instead" }).click();
  await page.getByLabel("E-mail address").fill(OWNER);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await expect(page.locator("#auth-error")).toContainText("isn't right");
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Available cash").first()).toBeVisible();
});

test("only the owner's e-mail may sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E-mail me a code instead" }).click();
  await page.getByLabel("E-mail address").fill("someone.else@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("#auth-error")).toContainText("can't sign in");
  await expect(page.getByLabel("6-digit code")).toHaveCount(0);
});

test("the session survives a reload and sign-out ends it", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page).toHaveURL("/");
  await page.goto("/settings");
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
});

test("password sign-in: wrong password is refused, the right one lands on Home", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("E-mail address").fill(OWNER);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#auth-error")).toContainText("e-mail or password isn't right");
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Available cash").first()).toBeVisible();
});

test("password sign-in is still limited to the owner's e-mail", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("E-mail address").fill("someone.else@example.com");
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#auth-error")).toContainText("can't sign in");
});
