import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { OWNER, PARTNER, fixClock, resetDb, signIn } from "./helpers";

// Two people, one app (PRD §3, AUTH-01, EC-P7): each person's data is their own; the category list is the one thing they share.
const AUTH = { authorization: "Bearer local-cron-secret" };

async function setUpPartner() {
  const partner = await sqlOne<{ id: string }>(`select id from auth.users where email = $1`, [PARTNER]);
  await sql(`update profiles set onboarded_at = now() where id = $1`, [partner.id]);
  const acc = await sqlOne<{ id: string }>(
    `insert into accounts (user_id, name, type, opening_balance_pence, opening_date, is_default) values ($1, 'Partner current', 'current', 12300, '2026-01-01', true) returning id`, [partner.id]);
  const groceries = await sqlOne<{ id: string }>(`select id from categories where name = 'Groceries' and parent_id is null`);
  const payee = await sqlOne<{ id: string }>(`insert into payees (user_id, name) values ($1, 'PartnerCafe') returning id`, [partner.id]);
  await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, occurred_at)
             values ($1, gen_random_uuid(), 'expense', 555, $2, $3, $4, '2026-10-08', '2026-10-08 12:00+01')`, [partner.id, acc.id, groceries.id, payee.id]);
  return partner.id;
}

test.describe("two people, one app", () => {
  test("EC-P7 an address that is not on the allow-list cannot sign in, and both listed people can", async ({ page, browser }) => {
    await resetDb({ seed: "demo", partner: true });
    await fixClock(page.context());
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "E-mail me a code instead" }).click();
    await page.getByLabel("E-mail address").fill("stranger@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("That address can't sign in to this app.")).toBeVisible();

    await signIn(page, OWNER);                                    // the first person
    await expect(page).not.toHaveURL(/sign-in/);
    const ctx = await browser.newContext();                       // the second person, in a session of their own
    const page2 = await ctx.newPage();
    await signIn(page2, PARTNER);
    await expect(page2).not.toHaveURL(/sign-in/);
    await ctx.close();
  });

  test("each person sees only their own accounts, payees and transactions, but the same categories", async ({ page, browser }) => {
    await resetDb({ seed: "demo", partner: true });
    await setUpPartner();
    await fixClock(page.context());
    await signIn(page, OWNER);
    await page.clock.resume();
    await page.goto("/activity");
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
    await expect(page.getByText("PartnerCafe")).toHaveCount(0);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await ctx.newPage();
    await fixClock(ctx);
    await signIn(page2, PARTNER);
    await page2.clock.resume();
    await page2.goto("/activity?from=2026-10-01&to=2026-10-31");
    await expect(page2.getByText("PartnerCafe")).toBeVisible();
    await expect(page2.getByText("Tesco")).toHaveCount(0);        // the first person's payees and rows are invisible
    await expect(page2.getByTestId("txn-row")).toHaveCount(1);

    await page2.goto("/settings/categories");
    await expect(page2.getByText("Groceries")).toBeVisible();     // the shared list
    await page.goto("/settings/categories");
    await expect(page.getByText("Groceries")).toBeVisible();
    await ctx.close();
  });

  test("a category one person adds appears for the other, and each keeps their own budget", async ({ page, browser }) => {
    await resetDb({ seed: "demo", partner: true });
    const partnerId = await setUpPartner();
    await sql(`insert into categories (user_id, kind, name, icon, color, sort_order) values ($1, 'expense', 'Dog walking', 'dog', 'sage', 99)`, [partnerId]);
    await fixClock(page.context());
    await signIn(page, OWNER);
    await page.clock.resume();
    await page.goto("/settings/categories");
    await expect(page.getByText("Dog walking")).toBeVisible();    // created by the other person, shared
    const groceries = await sqlOne<{ id: string }>(`select id from categories where name = 'Groceries' and parent_id is null`);
    await sql(`insert into budgets (user_id, category_id, amount_pence, effective_from) values ($1, $2, 25000, '2026-10-01')`, [partnerId, groceries.id]);
    const mine = await sql(`select count(*)::int as n from budgets where user_id = (select id from auth.users where email = $1)`, [OWNER]);
    expect(mine[0]!.n).toBe(0);                                   // the other person's limit is not the first person's
  });

  test("the digest job works through each person with their own figures", async ({ request }) => {
    await resetDb({ seed: "demo", partner: true });
    await setUpPartner();
    const r = await request.get("/api/cron/digest?scope=weekly", { headers: AUTH });
    expect(r.status()).toBe(200);
    expect((await r.json()).ran).toHaveLength(2);
    const runs = await sql<{ email: string; facts: string }>(
      `select u.email, r.facts::text as facts from insight_runs r join auth.users u on u.id = r.user_id where r.scope = 'weekly' and r.trip_id is null`);
    expect(runs).toHaveLength(2);
    const owner = runs.find((x) => x.email === OWNER)!, partner = runs.find((x) => x.email === PARTNER)!;
    expect(partner.facts).toContain("PartnerCafe");
    expect(owner.facts).not.toContain("PartnerCafe");             // nothing of the partner in the owner's digest
    expect(partner.facts).not.toMatch(/Tesco|Pret|Gail|Uber|Deliveroo/);   // nothing of the owner's in the partner's
  });
});
