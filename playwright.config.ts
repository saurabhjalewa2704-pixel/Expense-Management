import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

// The E2E stack (Postgres + PostgREST + the Supabase-compatible gateway) is started with `npm run stack:up`.
const envFile = ".stack/env";
const stackEnv: Record<string, string> = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) stackEnv[m[1]!] = m[2]!;
  }
}
const PORT = Number(process.env.E2E_PORT ?? 3100);
const chromium = { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // iPhone 14 on Chromium at the installed-PWA size, 390×844 (the device profile's own 664px viewport includes Safari's toolbar).
    // The installed browser here is Chromium, so the profile's WebKit default is overridden.
    { name: "mobile", testIgnore: /desktop\./, use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 }, defaultBrowserType: "chromium", launchOptions: chromium } },
    { name: "desktop", testMatch: /desktop\./, use: { viewport: { width: 1440, height: 1024 }, launchOptions: chromium } },
  ],
  webServer: {
    command: process.env.E2E_PROD ? `npx next build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { ...stackEnv, NODE_ENV: process.env.E2E_PROD ? "production" : "development" } as Record<string, string>,
  },
});
