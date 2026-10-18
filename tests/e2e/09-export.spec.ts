import { expect, test } from "@playwright/test";
import { sqlOne } from "./db";
import { startDemo } from "./helpers";

test.describe("export (AN-11)", () => {
  test("CSV of the filtered Activity: exact amounts, signed, one row per transaction", async ({ page }) => {
    await startDemo(page);
    const res = await page.request.get("/api/export?format=csv&from=2026-10-01&to=2026-10-18");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("sterling-activity-");
    const text = (await res.text()).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Type,Amount (GBP),Account,To account,Category,Sub-category,Payee,Note,Tags,Source,ID");
    expect(lines.length - 1).toBe(52);
    expect(lines.some((l) => l.includes(",expense,-6.40,Amex Gold,,Eating out,Coffee & snacks,Gail's Bakery"))).toBe(true);     // spend is negative
    expect(lines.some((l) => l.includes(",income,121.60,Monzo,,Refunds,,ASOS"))).toBe(true);
    const sum = lines.slice(1).reduce((s, l) => s + Math.round(Number(l.split(",")[2]) * 100), 0);
    expect(sum).toBe(14000 - 323685);                                                                                           // income − spend, to the penny
  });

  test("CSV honours filters", async ({ page }) => {
    await startDemo(page);
    const res = await page.request.get("/api/export?format=csv&q=dishoom&from=2026-10-01&to=2026-10-18");
    const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Dishoom Kensington");
  });

  test("JSON backup holds every table, with money as integer pence", async ({ page }) => {
    await startDemo(page);
    const res = await page.request.get("/api/export?format=json");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.format).toBe("sterling-backup-v1");
    expect(data.accounts).toHaveLength(5);
    expect(data.categories.length).toBe(69);
    const { n } = await sqlOne<{ n: number }>("select count(*)::int n from transactions");
    expect(data.transactions).toHaveLength(n);
    expect(data.transactions.every((t: { amount_pence: number }) => Number.isInteger(t.amount_pence))).toBe(true);
    expect(data.accounts.find((a: { name: string }) => a.name === "Amex Gold").opening_balance_pence).toEqual(expect.any(Number));
  });

  test("export needs a session", async ({ request }) => {
    const res = await request.get("/api/export?format=csv", { maxRedirects: 0 });
    expect([302, 307, 401]).toContain(res.status());
  });
});
