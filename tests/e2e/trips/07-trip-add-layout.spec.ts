import { expect, test } from "@playwright/test";
import { sql, sqlOne } from "../db";
import { amountKeys, openAdd, startTrip } from "../helpers";

// A trip in a currency with no symbol of its own (the Moroccan dirham), which the ECB feed behind the rate service does not carry.
test.describe("Add expense on a trip in Moroccan dirhams (TRIP-04, TRIP-06)", () => {
  test("EC-T19 the screen stays fixed: one currency chip, a one-line rate row, the whole keypad and the Add button in view, and it saves", async ({ page }) => {
    await startTrip(page);
    await sql(`update trips set currency = 'MAD', name = 'Marrakech' where name = 'USA'`);
    await sql(`update trip_stops set currency = null`);
    await page.route("**/api/fx**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "No rate available" }) }));
    await page.reload();
    await openAdd(page);
    await amountKeys(page, "960");
    await page.getByLabel("Payee").fill("Desert Safari");
    await page.getByLabel("Payee").blur();
    await page.getByTestId("qcard").nth(3).click();

    // the code is shown once in the chip (no "MAD MAD"), and the rate row is one line beside it
    await expect(page.getByTestId("currency-chip")).toHaveText("MAD");
    const missing = page.getByTestId("fx-missing");
    await expect(missing).toBeVisible();
    const [chip, row, line] = await Promise.all([page.getByTestId("currency-chip").boundingBox(), missing.boundingBox(), page.getByTestId("fx-line").boundingBox()]);
    expect(line!.height).toBeLessThan(40);
    expect(Math.abs((row!.y + row!.height / 2) - (chip!.y + chip!.height / 2))).toBeLessThan(8);

    // nothing is cut off: the keypad ends above the Add button, which sits inside the screen, and the form needs no scrolling
    await expect(page.getByRole("group", { name: "Amount keypad" })).toBeVisible();
    const geo = await page.evaluate(() => {
      const add = document.querySelector(".qa-foot .btn") as HTMLButtonElement;
      const kp = document.querySelector("[data-testid=quick-add] .keypad")!.getBoundingClientRect();
      const body = document.querySelector("[data-testid=quick-add] .vaul-body") as HTMLElement;
      return { addBottom: add.getBoundingClientRect().bottom, addTop: add.getBoundingClientRect().top, kpBottom: kp.bottom, vh: innerHeight, over: body.scrollHeight - body.clientHeight, disabled: add.disabled };
    });
    expect(geo.addBottom).toBeLessThanOrEqual(geo.vh);
    expect(geo.kpBottom).toBeLessThanOrEqual(geo.addTop);
    expect(geo.over).toBe(0);
    expect(geo.disabled).toBe(true);                                                          // no rate yet: it says what is missing instead

    await page.getByTestId("fx-manual-rate").fill("0.079");
    await expect(page.getByTestId("fx-conversion")).toContainText("£75.84");
    await page.getByRole("button", { name: /^Add MAD 960\.00 · £75\.84/ }).click();
    await expect.poll(async () => (await sql(`select 1 from transactions where original_currency = 'MAD' and original_amount_minor = 96000`)).length).toBe(1);
    expect(await sqlOne(`select amount_pence::int p, fx_source s from transactions where original_currency = 'MAD'`)).toEqual({ p: 7584, s: "manual" });
  });
});
