import { expect, test, type Page } from "@playwright/test";
import { sql } from "./db";
import { fixClock, resetDb, signIn } from "./helpers";

// UX: while the saved copy of the data is being read back, a screen must show its skeleton, never an empty state or "Not found".
// (TanStack reports isLoading=false during that restore, so every "if (!isLoading && nothing)" branch flashed for a moment on each open.)

/** Opens `route` as a fresh page load and returns every forbidden phrase that appeared in the page at any moment. */
async function flashes(page: Page, route: string, phrases: string[]): Promise<string[]> {
  await page.addInitScript((ps: string[]) => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    const look = () => { const t = document.body?.innerText ?? ""; for (const p of ps) if (t.includes(p)) seen.add(p); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  }, phrases);
  await page.goto(route);
  await page.waitForTimeout(2500);
  return page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
}

test("UI-FL-01 no empty state or 'Not found' flashes while the saved data loads", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await resetDb({ seed: "budget" });
  await fixClock(context);
  await signIn(page);
  await page.clock.resume();
  const id = async (q: string) => (await sql<{ id: string }>(q))[0]!.id;
  const acc = await id(`select id::text from accounts limit 1`), cat = await id(`select id::text from categories where parent_id is null and kind = 'expense' limit 1`);
  const pot = await id(`select pot_id::text id from pots limit 1`).catch(() => undefined);
  // visit everything once so the cache is saved, then give it time to reach IndexedDB
  for (const r of ["/", `/accounts/${acc}`, `/settings/categories/${cat}`, ...(pot ? [`/pots/${pot}`] : []), "/bills", "/trips", "/pots", "/activity"]) { await page.goto(r); await page.waitForTimeout(1200); }
  await page.waitForTimeout(2500);
  await page.close();

  const cases: [string, string[]][] = [
    ["/", ["Nothing logged yet"]],
    [`/accounts/${acc}`, ["Not found", "doesn't exist", "doesn’t exist", "No transactions"]],
    [`/settings/categories/${cat}`, ["Not found"]],
    ...(pot ? [[`/pots/${pot}`, ["Not found"]] as [string, string[]]] : []),
    ["/activity", ["No transactions", "Nothing matches"]],
  ];
  for (const [route, phrases] of cases) {
    const p = await context.newPage();
    expect(await flashes(p, route, phrases), `${route}: shown while loading`).toEqual([]);
    await p.close();
  }
  await context.close();
});
