import { expect, type Page } from "@playwright/test";

const GATEWAY = "http://127.0.0.1:54321";
export const OWNER = "owner@sterling.local";

/** Wipe the database and recreate the owner. seed: "demo" loads supabase/seed.sql; onboarded skips first-run setup. */
export async function resetDb(opts: { seed?: "demo"; onboarded?: boolean } = {}) {
  const q = new URLSearchParams();
  if (opts.seed) q.set("seed", opts.seed);
  if (opts.onboarded) q.set("onboarded", "1");
  const r = await fetch(`${GATEWAY}/__test/reset?${q}`, { method: "POST" });
  if (!r.ok) throw new Error(`reset failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { user_id: string };
}

/** Sign in through the real UI with the e-mailed-code flow (the gateway's fixed code is 123456). */
export async function signIn(page: Page, email = OWNER) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E-mail me a code instead" }).click();
  await page.getByLabel("E-mail address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page).not.toHaveURL(/sign-in/);
}

/** Add an account through the first-run / Settings editor. */
export async function addAccountViaEditor(page: Page, a: { name: string; type?: string; balance?: string }) {
  await page.getByLabel("Account name").fill(a.name);
  if (a.type) await page.getByRole("radio", { name: a.type, exact: true }).click();
  if (a.balance) await page.getByLabel(/^(Balance|Amount owed)$/).fill(a.balance);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

import type { BrowserContext, Page as P } from "@playwright/test";

/** Pin "now" to the mock-up day (Sunday 18 October 2026, 09:30 London) so dates, pace and headers are stable. */
export async function fixClock(ctx: BrowserContext) {
  await ctx.clock.install({ time: new Date("2026-10-18T09:30:00+01:00") });
}

/** Load the demo data (PRD Appendix A), pin the clock and sign in. */
export async function startDemo(page: P) {
  await resetDb({ seed: "demo" });
  await fixClock(page.context());
  await signIn(page);
  await page.clock.resume();
  await expect(page.getByTestId("hero")).toBeVisible();
}

/** The hero figure in pence, read from its accessible name ("Available cash £4,765.55"). */
export async function heroPence(page: P): Promise<number> {
  const label = (await page.getByTestId("hero").getAttribute("aria-label")) ?? "";
  const m = /(−|-)?£([\d,]+)\.(\d{2})/.exec(label);
  if (!m) throw new Error(`no figure in "${label}"`);
  return (m[1] ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3]));
}

/** Press the on-screen keypad: amountKeys(page, "12.80"). */
export async function amountKeys(page: P, amount: string) {
  for (const ch of amount) await page.getByRole("button", { name: ch === "." ? "Decimal point" : ch, exact: true }).click();
}

export async function openAdd(page: P) {
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await expect(page.getByTestId("quick-add")).toBeVisible();
}

export const toast = (page: P) => page.getByRole("status");
