// Renders the PWA icons (ivory "£" in Instrument Sans on the near-black ground) with Chromium.
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium, see PLAYWRIGHT_BROWSERS_PATH)
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const font = readFileSync(path.join(root, "app/fonts/instrument-sans-latin-wght-normal.woff2")).toString("base64");
mkdirSync(path.join(root, "public"), { recursive: true });

const page = (size, glyph, radius) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:IS;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:400 700}
html,body{margin:0;background:transparent}
.i{width:${size}px;height:${size}px;background:#0C0D0C;border-radius:${radius}px;display:grid;place-items:center;overflow:hidden;position:relative}
.i::after{content:"";position:absolute;inset:0;border-radius:${radius}px;box-shadow:inset 0 0 0 ${Math.max(1, size / 256)}px rgba(255,255,255,.08)}
.g{font:600 ${Math.round(size * glyph)}px/1 IS,sans-serif;color:#F3F2EE;letter-spacing:-.04em;transform:translateY(${Math.round(size * -0.02)}px)}
</style><div class="i"><span class="g">£</span></div>`;

const targets = [
  { file: "icon-192.png", size: 192, glyph: 0.62, radius: 0 },
  { file: "icon-512.png", size: 512, glyph: 0.62, radius: 0 },
  { file: "apple-icon.png", size: 180, glyph: 0.62, radius: 0 },       // iOS rounds the corners itself
  { file: "icon-maskable-512.png", size: 512, glyph: 0.46, radius: 0 }, // glyph inside the 80% safe zone
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
for (const t of targets) {
  const ctx = await browser.newContext({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(page(t.size, t.glyph, t.radius));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(root, "public", t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  await ctx.close();
}
await browser.close();
console.log("icons written to public/");
