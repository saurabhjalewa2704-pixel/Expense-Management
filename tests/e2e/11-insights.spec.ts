import { expect, test } from "@playwright/test";
import { resetDb, signIn, startDemo } from "./helpers";
import { sql, sqlOne } from "./db";

// No ANTHROPIC_API_KEY in the test stack, so these exercise the deterministic template path end to end:
// facts from SQL → cards → grounding validator → insight_runs → UI. The real-model path is covered by unit tests with a fake
// writer and by scripts/ai-check.mjs against the live API.
test.describe("AI insights (M4)", () => {
  test("refresh creates a digest from the user's own numbers and Home shows the top card", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByTestId("insight-card")).toHaveCount(0);
    await page.goto("/insights");
    await expect(page.getByText("Nothing here yet")).toBeVisible();
    await page.getByRole("button", { name: "Refresh insights" }).click();

    const first = page.getByTestId("insight-card").first();
    await expect(first.getByRole("heading")).toHaveText(/^You're £367 under September's pace$/);   // pace comes first
    const eating = page.getByTestId("insight-card").filter({ hasText: "Eating out is running 38% above your usual" });
    await expect(eating).toBeVisible();
    await expect(eating).toContainText("£312.60");
    await expect(eating.locator(".compare .bar")).toHaveCount(2);
    await expect(page.getByText(/Updated .* · from your own data/)).toBeVisible();
    await expect(page.getByText(/^Generated from your data/)).toBeVisible();

    const run = await sqlOne<{ model: string; scope: string; n: number }>(`select model, scope, jsonb_array_length(cards) n from insight_runs`);
    expect(run).toMatchObject({ model: "template", scope: "adhoc" });
    expect(run.n).toBeGreaterThanOrEqual(3);

    await page.goto("/");
    await expect(page.getByTestId("insight-card")).toHaveCount(1);
    await expect(page.getByTestId("insight-card").getByRole("heading")).toHaveText("Eating out is running 38% above your usual");
    await expect(page.getByRole("link", { name: "See all insights" })).toBeVisible();
  });

  test("every figure on every stored card is a fact's own display string", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights");
    await page.getByRole("button", { name: "Refresh insights" }).click();
    await expect(page.getByTestId("insight-card").first()).toBeVisible();
    const run = await sqlOne<{ cards: { title: string; body: string }[]; facts: { facts: { display: string }[] } }>(`select cards, facts from insight_runs`);
    const shown = new Set(run.facts.facts.map((f) => f.display));
    const figures = run.cards.flatMap((c) => `${c.title} ${c.body}`.match(/£(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?|\d+(?:\.\d+)?%/g) ?? []);
    expect(figures.length).toBeGreaterThan(3);
    for (const f of figures) expect(shown, `"${f}" is not a fact`).toContain(f);
  });

  test("Dismiss removes a card for good, Helpful and View are recorded", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights");
    await page.getByRole("button", { name: "Refresh insights" }).click();
    const cards = page.getByTestId("insight-card");
    await expect(cards.first()).toBeVisible();
    const before = await cards.count();
    const key = await cards.first().getAttribute("data-key");

    await cards.first().getByRole("button", { name: "Helpful" }).click();
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from insight_feedback where action='helpful' and card_key='${key}'`).then((r) => r.n)).toBe(1);

    await cards.first().getByRole("button", { name: "Dismiss" }).click();
    await expect(cards).toHaveCount(before - 1);
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from insight_feedback where action='dismissed' and card_key='${key}'`).then((r) => r.n)).toBe(1);

    await page.reload();
    await expect(cards).toHaveCount(before - 1);
    await expect(page.locator(`[data-key="${key}"]`)).toHaveCount(0);

    await page.getByTestId("insight-card").filter({ hasText: "Eating out" }).getByRole("link", { name: /View/ }).click();
    await expect(page).toHaveURL(/analytics\/category\//);
  });

  test("Settings → AI: switching off disables refresh and the API; clearing history empties the screen", async ({ page }) => {
    await startDemo(page);
    await page.goto("/insights");
    await page.getByRole("button", { name: "Refresh insights" }).click();
    await expect(page.getByTestId("insight-card").first()).toBeVisible();

    await page.goto("/settings/ai");
    await expect(page.getByTestId("ai-usage")).toContainText("0 of 500,000 tokens");   // template runs use no tokens
    await expect(page.getByText(/No API key is configured/)).toBeVisible();
    await page.getByRole("button", { name: "Clear AI history" }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => sqlOne<{ n: number }>(`select count(*)::int n from insight_runs`).then((r) => r.n)).toBe(0);

    await page.getByRole("switch", { name: "AI insights" }).click();
    await expect.poll(() => sqlOne<{ ai_enabled: boolean }>(`select ai_enabled from profiles`).then((r) => r.ai_enabled)).toBe(false);
    await page.goto("/insights");
    await expect(page.getByText("AI insights are switched off")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh insights" })).toBeDisabled();
    const res = await page.request.post("/api/insights");
    expect(res.status()).toBe(403);
  });

  test("refreshing has no daily limit, and the cron route needs its secret", async ({ page, request }) => {
    await startDemo(page);
    await sql(`insert into insight_runs (user_id, scope, period_start, period_end, facts, cards, model)
               select p.id, 'adhoc', '2026-10-01', '2026-10-18', '{"facts":[],"entities":[]}', '[]', 'template' from profiles p, generate_series(1,10)`);
    const res = await page.request.post("/api/insights");                      // an eleventh refresh in a day still works
    expect(res.status()).toBe(200);

    expect((await request.get("/api/cron/digest")).status()).toBe(401);
    expect((await request.get("/api/cron/maintenance")).status()).toBe(401);
    expect((await request.post("/api/insights", { maxRedirects: 0 })).status()).toBe(307);  // signed out: the proxy sends them to /sign-in
  });

  test("the digest cron writes weekly and monthly runs once per period", async ({ page, request }) => {
    await startDemo(page);
    const auth = { authorization: "Bearer local-cron-secret" };
    const a = await request.get("/api/cron/digest?scope=weekly", { headers: auth });
    expect(a.status()).toBe(200);
    expect((await a.json()).ran).toHaveLength(1);
    const again = await (await request.get("/api/cron/digest?scope=weekly", { headers: auth })).json();
    expect(again.ran[0].skipped).toBe("already generated");
    await request.get("/api/cron/digest?scope=monthly", { headers: auth });
    const runs = await sql<{ scope: string; period_start: string }>(`select scope, period_start::text from insight_runs order by scope`);
    expect(runs).toEqual([{ scope: "monthly", period_start: "2026-09-01" }, { scope: "weekly", period_start: "2026-10-05" }]);

    await page.goto("/insights");
    await expect(page.getByTestId("insight-card").first()).toBeVisible();
    expect((await request.get("/api/cron/maintenance", { headers: auth })).status()).toBe(200);
  });
});
