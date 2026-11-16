import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { resetDb, signIn } from "./helpers";

// Needs the production build: the service worker is only registered there.
test.skip(!process.env.E2E_PROD && !process.env.E2E_PORT?.startsWith("32"), "the service worker only runs on a production build");

/**
 * A server that answers full-page requests slowly, like a serverless function waking up after a quiet night (plus the proxy's
 * Supabase sign-in check). Everything else passes straight through. `delay.ms` can be changed while the test runs.
 */
async function slowServer(target: number) {
  const delay = { ms: 0, served: 0 };
  const server = http.createServer((req, res) => {
    const doc = req.headers["sec-fetch-dest"] === "document" || (req.headers.accept ?? "").includes("text/html");
    const go = () => {
      const up = http.request({ host: "localhost", port: target, path: req.url, method: req.method, headers: req.headers }, (r) => { if (doc) delay.served++; res.writeHead(r.statusCode ?? 500, r.headers); r.pipe(res); });
      up.on("error", () => { res.statusCode = 502; res.end(); });
      req.pipe(up);
    };
    if (doc && delay.ms > 0) setTimeout(go, delay.ms); else go();
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  return { delay, origin: `http://localhost:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const target = () => Number(process.env.E2E_PORT ?? 3100);

test("PERF-01: the first open of the day shows the app and the cached figures while the server is still waking up", async ({ browser }) => {
  test.setTimeout(120_000);
  const srv = await slowServer(target());
  const context = await browser.newContext({ baseURL: srv.origin, viewport: { width: 390, height: 844 } });
  try {
    await resetDb({ seed: "budget" });
    const page = await context.newPage();
    await signIn(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();                                       // controlled by the service worker from here on
    await expect(page.getByTestId("hero")).toBeVisible();
    await page.goto("/activity");
    await page.goto("/");
    await expect(page.getByTestId("hero")).toBeVisible();
    await page.waitForTimeout(2500);                           // let the query cache persist to IndexedDB
    await page.close();

    // the next morning: a new window, the server needs 4 seconds to answer the page request
    srv.delay.ms = 4000;
    const before = srv.delay.served;
    const morning = await context.newPage();
    const t0 = Date.now();
    await morning.goto("/", { waitUntil: "commit" }).catch(() => undefined);
    await expect(morning.getByTestId("hero")).toBeVisible({ timeout: 2500 });   // from the device, not from the 4 s answer
    await expect(morning.getByTestId("txn-row").first()).toBeVisible({ timeout: 2500 });
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(srv.delay.served).toBe(before);                     // the slow answer had not arrived yet
    // ...and the page is refreshed behind the scenes for next time
    await expect.poll(() => srv.delay.served, { timeout: 10_000 }).toBeGreaterThan(before);
  } finally { await context.close(); srv.close(); }
});

test("PERF-02: a session that ended overnight still lands on the sign-in screen when the app opens from the device", async ({ browser }) => {
  test.setTimeout(120_000);
  const srv = await slowServer(target());
  const context = await browser.newContext({ baseURL: srv.origin, viewport: { width: 390, height: 844 } });
  try {
    await resetDb({ seed: "budget" });
    const page = await context.newPage();
    await signIn(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible();
    await page.close();

    await context.clearCookies();                              // signed out everywhere, or the cookie simply expired
    const next = await context.newPage();
    await next.goto("/", { waitUntil: "commit" }).catch(() => undefined);
    await expect(next).toHaveURL(/sign-in/, { timeout: 15_000 });
    await next.goto("/");                                      // the stored copy was dropped: this one asks the server
    await expect(next).toHaveURL(/sign-in/);
  } finally { await context.close(); srv.close(); }
});
