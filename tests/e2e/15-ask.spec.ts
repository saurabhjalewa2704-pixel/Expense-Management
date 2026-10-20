import { expect, test, type Page } from "@playwright/test";
import { sql, sqlOne } from "./db";
import { startDemo } from "./helpers";

// No Anthropic key in the test stack: STERLING_ASK_STUB swaps in a scripted model that picks tools from keywords and words the
// result. Everything else is real: the tools (SQL as the user), the grounding check, retry, fallback, storage and the UI.
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function ask(page: Page, q: string) {
  const before = await page.getByTestId("ask-answer").count();
  await page.getByLabel("Ask about your money").fill(q);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("ask-answer")).toHaveCount(before + 1, { timeout: 20_000 });
  return page.getByTestId("ask-answer").last();
}

test.describe("Ask Sterling (natural-language questions)", () => {
  test("Insights offers it; a starter question opens the conversation and answers from the user's own numbers", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights");
    await expect(page.getByTestId("ask-dock")).toContainText("Ask about your money…");
    await page.getByRole("link", { name: "Compare this month with last month" }).click();
    await expect(page).toHaveURL(/\/insights\/ask/);
    const answer = page.getByTestId("ask-answer").last();
    await Promise.race([
      answer.waitFor({ timeout: 20_000 }),
      page.getByTestId("ask-error").waitFor({ timeout: 20_000 }).then(async () => { throw new Error(`Ask failed: ${await page.getByTestId("ask-error").innerText()}`); }),
    ]);
    await expect(answer).toContainText("£3,236.85");                         // October so far (usual spending)
    await expect(answer).toContainText("£5,316.20");                         // all of September
    await answer.getByText(/Numbers used/).click();
    await expect(answer.locator(".ask-facts li").first()).toContainText("Current period spending");
  });

  test("a typed question is answered with figures that match SQL exactly, and every figure is one a tool returned", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights/ask");
    const answer = await ask(page, "What did I spend on eating out last month?");
    const sep = await sqlOne<{ total: string }>(`select coalesce(sum(t.amount_pence),0)::text total from transactions t join categories c on c.id = t.category_id
      where t.type='expense' and t.deleted_at is null and t.occurred_on between '2026-09-01' and '2026-09-30' and (c.name='Eating out' or c.parent_id = (select id from categories where name='Eating out' and parent_id is null))`);
    expect(Number(sep.total)).toBeGreaterThan(0);
    await expect(answer).toContainText(gbp(Number(sep.total)));
    const row = await sqlOne<{ answer: string; facts: { display: string }[]; used_fallback: boolean; model: string; input_tokens: number }>(`select answer, facts, used_fallback, model, input_tokens from ask_turns`);
    expect(row).toMatchObject({ used_fallback: false, model: "stub" });
    expect(row.input_tokens).toBeGreaterThan(0);
    const shown = new Set(row.facts.map((f) => f.display));
    const figures = row.answer.match(/£(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?|\d+(?:\.\d+)?%/g) ?? [];
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(shown, `"${f}" must come from a tool`).toContain(f);
  });

  test("conversations are kept: a reload shows the earlier question and answer", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights/ask");
    await ask(page, "How much cash do I have?");
    await expect(page.getByTestId("ask-answer").last()).toContainText("£4,765.55");
    await page.reload();
    await expect(page.getByTestId("ask-question").first()).toHaveText("How much cash do I have?");
    await expect(page.getByTestId("ask-answer").first()).toContainText("£4,765.55");
  });

  test("an answer with an invented figure is rejected, retried once, and the corrected answer is what you see", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights/ask");
    const answer = await ask(page, "ungrounded please: what did I spend this month?");
    await expect(answer).not.toContainText("999,999");
    await expect(answer).toContainText("£3,236.85");
    expect((await sqlOne<{ used_fallback: boolean }>(`select used_fallback from ask_turns`)).used_fallback).toBe(false);
  });

  test("if the model keeps inventing numbers, the figures themselves are listed instead and nothing invented is shown", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights/ask");
    const answer = await ask(page, "ungrounded forever: what did I spend this month?");
    await expect(answer).toContainText("I couldn't word that reliably");
    await expect(answer).toContainText("£3,236.85");
    await expect(answer).not.toContainText("999,999");
    await expect(answer).not.toContainText("77%");
    expect((await sqlOne<{ used_fallback: boolean }>(`select used_fallback from ask_turns`)).used_fallback).toBe(true);
  });

  test("one-off pots stay out of every answer, unless you ask about the pot", async ({ page }) => {
    await startDemo(page);
    await sql(`insert into pots (user_id, name, target_pence) select id, 'Home purchase', 4500000 from profiles`);
    await sql(`insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, pot_id)
               select p.id, gen_random_uuid(), 'expense', 1250000, (select id from accounts order by sort_order limit 1),
                      (select id from categories where name = 'Home' and parent_id is null), '2026-10-10', (select id from pots limit 1) from profiles p`);
    await page.goto("/insights/ask");
    const usual = await ask(page, "What did I spend this month?");
    await expect(usual).toContainText("£3,236.85");
    await expect(usual).not.toContainText("12,500");
    const payees = await ask(page, "Where do I spend the most?");
    await expect(payees).not.toContainText("12,500");
    const pot = await ask(page, "How much has my home purchase cost so far?");
    await expect(pot).toContainText("£12,500.00");
    await expect(pot).toContainText("Home purchase");
    await expect(pot).toContainText("£32,500.00");                        // left of the £45,000 budget
  });

  test("limits and guards: sign-in, an empty question, the daily limit, and the AI switch", async ({ page, request }) => {
    await startDemo(page);
    expect((await request.post("/api/ask", { data: { question: "hi" }, maxRedirects: 0 })).status()).toBe(307);
    expect((await page.request.post("/api/ask", { data: { question: "   " } })).status()).toBe(400);
    expect((await page.request.post("/api/ask", { data: { question: "x".repeat(501) } })).status()).toBe(400);

    await sql(`insert into ask_turns (user_id, question, answer, model) select p.id, 'q', 'a', 'stub' from profiles p, generate_series(1,30)`);
    const limited = await page.request.post("/api/ask", { data: { question: "How much cash do I have?" } });
    expect(limited.status()).toBe(429);
    expect((await limited.json()).error).toMatch(/30 questions/);
    await sql(`delete from ask_turns`);

    await sql(`update profiles set ai_enabled = false`);
    expect((await page.request.post("/api/ask", { data: { question: "How much cash do I have?" } })).status()).toBe(403);
    await page.goto("/insights");
    await expect(page.getByTestId("ask-dock")).toHaveCount(0);
  });

  test("questions count towards the monthly AI usage, and Clear AI history removes them", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights/ask");
    await ask(page, "How much cash do I have?");
    await page.goto("/settings/ai");
    await expect(page.getByTestId("ai-usage")).not.toContainText(/^0 of/);
    await page.getByRole("button", { name: "Clear AI history" }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from ask_turns`).then((r) => r.n)).toBe(0);
    await page.goto("/insights/ask");
    await expect(page.getByTestId("ask-answer")).toHaveCount(0);
  });
});
