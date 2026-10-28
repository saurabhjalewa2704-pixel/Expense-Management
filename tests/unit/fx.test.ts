import { describe, expect, it } from "vitest";
import { convertToPence, currencySymbol, effectiveRate, exponentOf, formatMinor, gbpPerUnit, parseMinor, rateLabel, scaleRate } from "@/lib/fx";

describe("foreign currency (TRIP-06, EC-M4, EC-T8)", () => {
  it("$48.60 at 0.7900 is £38.39", () => expect(convertToPence(4860, "USD", "0.7900")).toBe(3839));
  it("matches every figure of the Appendix A.2 trip", () => {
    const rows: [number, number][] = [[5840, 4614], [9620, 7600], [6400, 5056], [7230, 5712], [2000, 1580], [8500, 6715], [1240, 980], [4680, 3697], [2450, 1936], [6890, 5443],
      [1800, 1422], [6000, 4740], [3400, 2686], [21000, 16590], [5875, 4641], [14260, 11265], [28900, 22831], [1180, 932], [2140, 1691]];
    for (const [minor, pence] of rows) expect(convertToPence(minor, "USD", "0.79"), `$${minor / 100}`).toBe(pence);
    expect(rows.reduce((s, r) => s + r[1], 0)).toBe(110131);
    expect(rows.reduce((s, r) => s + r[0], 0)).toBe(139405);
  });
  it("EC-M4 rounds half-even, never with floats", () => {
    expect(convertToPence(125, "USD", "0.50")).toBe(62);       // 62.5p → 62 (even)
    expect(convertToPence(135, "USD", "0.50")).toBe(68);       // 67.5p → 68 (even)
    expect(convertToPence(1, "USD", "0.1")).toBe(0);           // a tenth of a penny
    expect(convertToPence(10, "USD", "0.5")).toBe(5);
  });
  it("card fees are added on top of the rate", () => {
    expect(convertToPence(10000, "USD", "0.79", 299)).toBe(8136);          // £79.00 + 2.99% = £81.36
    expect(convertToPence(10000, "USD", "0.79", 0)).toBe(7900);
  });
  it("EC-T8 currency exponents: JPY has none, KWD has three", () => {
    expect([exponentOf("JPY"), exponentOf("USD"), exponentOf("KWD"), exponentOf("EUR")]).toEqual([0, 2, 3, 2]);
    expect(convertToPence(12000, "JPY", "0.0052")).toBe(6240);             // ¥12,000 → £62.40
    expect(convertToPence(12345, "KWD", "2.6000")).toBe(3210);             // 12.345 KWD × 2.6 = £32.097 → £32.10
    expect(parseMinor("1200", "JPY")).toBe(1200);
    expect(parseMinor("12.345", "KWD")).toBe(12345);
  });
  it("EC-M1 typed amounts", () => {
    expect(parseMinor("48.60", "USD")).toBe(4860);
    expect(parseMinor("12.", "USD")).toBe(1200);
    expect(parseMinor(".5", "USD")).toBe(50);
    expect(parseMinor("1,234.5", "USD")).toBe(123450);
    expect(parseMinor("1.239", "USD")).toBe(123);                          // a third decimal is ignored
    expect(parseMinor(".", "USD")).toBeNull();
    expect(parseMinor("", "USD")).toBeNull();
    expect(parseMinor("abc", "USD")).toBeNull();
  });
  it("the effective rate of a corrected £ figure: £39.10 for $48.60 is 0.8045", () => {
    expect(effectiveRate(3910, 4860, "USD")).toBe("0.8045");
    expect(effectiveRate(3839, 4860, "USD")).toBe("0.7899");
  });
  it("rates scale to 8 decimals and show in 4", () => {
    expect(scaleRate("0.79")).toBe(79_000_000n);
    expect(scaleRate(0.79)).toBe(79_000_000n);
    expect(rateLabel("0.79")).toBe("0.7900");
    expect(rateLabel(0.8045123)).toBe("0.8045");
  });
  it("Frankfurter's units per £ becomes £ per unit", () => {
    expect(gbpPerUnit(1.2658)).toBe("0.79001422");
    expect(gbpPerUnit("1.25")).toBe("0.80000000");
  });
  it("formats the original amount", () => {
    expect(formatMinor(4860, "USD")).toBe("$48.60");
    expect(formatMinor(1200, "JPY")).toBe("¥1,200");
    expect(currencySymbol("USD")).toBe("$");
  });
});

import { pressKeyFx } from "@/lib/fx";
describe("keypad for a foreign amount (EC-T8)", () => {
  it("JPY takes no decimal point", () => {
    expect(pressKeyFx("12", ".", "JPY")).toBe("12");
    expect(pressKeyFx("1200000", "5", "JPY")).toBe("12000005");
  });
  it("USD stops at two decimals, KWD at three", () => {
    expect(pressKeyFx("48.6", "0", "USD")).toBe("48.60");
    expect(pressKeyFx("48.60", "1", "USD")).toBe("48.60");
    expect(pressKeyFx("1.234", "5", "KWD")).toBe("1.234");
    expect(pressKeyFx("1.23", "4", "KWD")).toBe("1.234");
  });
  it("a leading point becomes 0. and no leading zeros", () => {
    expect(pressKeyFx("", ".", "USD")).toBe("0.");
    expect(pressKeyFx("0", "7", "USD")).toBe("7");
  });
});
