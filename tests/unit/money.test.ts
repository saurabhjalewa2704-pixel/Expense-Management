import { describe, expect, it } from "vitest";
import { formatGBP, medianPence, penceToDecimal, pctChange, pressKey, splitGBP, toPence, MAX_PENCE } from "@/lib/money";

describe("toPence", () => {
  it.each([
    ["12.80", 1280], ["0.1", 10], ["12.", 1200], [".5", 50], ["1,234.50", 123450], ["£3", 300], ["0", 0],
    ["  7 ", 700], ["19.99", 1999], ["0.29", 29], ["1.15", 115], ["4.35", 435], ["-5.5", -550],
  ])("%s -> %d", (input, pence) => expect(toPence(input)).toBe(pence));

  it("never goes through a float: classic float traps are exact", () => {
    // 0.1 + 0.2 and 1.005 * 100 are the usual offenders
    expect(toPence("0.30")).toBe(30);
    expect(toPence("1.005")).toBe(101); // half-up on the decimal string
    expect(toPence("1.004")).toBe(100);
    expect(toPence("8.675")).toBe(868);
  });
  it("rejects things that are not amounts", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "£", "--1", "1e5", "12,,x"]) expect(toPence(bad)).toBeNull();
  });
});

describe("formatGBP", () => {
  it("formats with pence, grouping and a real minus sign", () => {
    expect(formatGBP(476555)).toBe("£4,765.55");
    expect(formatGBP(-118473)).toBe("−£1,184.73");
    expect(formatGBP(0)).toBe("£0.00");
    expect(formatGBP(5)).toBe("£0.05");
    expect(formatGBP(12160, { signed: true })).toBe("+£121.60");
    expect(formatGBP(-12160, { signed: true })).toBe("−£121.60");
    expect(formatGBP(294000, { whole: true })).toBe("£2,940");
    expect(formatGBP(39590, { whole: true })).toBe("£396");
    expect(formatGBP(36725, { whole: true })).toBe("£367");
    expect(formatGBP(100000000)).toBe("£1,000,000.00");
  });
  it("rejects non-integers", () => expect(() => formatGBP(12.5)).toThrow());
  it("splits the hero figure", () => {
    expect(splitGBP(476555)).toEqual({ sign: "", whole: "4,765", pence: "55" });
    expect(splitGBP(-5)).toEqual({ sign: "−", whole: "0", pence: "05" });
  });
});

describe("pressKey (keypad)", () => {
  const type = (keys: string) => [...keys].reduce((s, k) => pressKey(s, k === "<" ? "back" : k), "");
  it("limits to two decimals and £999,999.99", () => {
    expect(type("12.345")).toBe("12.34");
    expect(type("99999999")).toBe("999999");
    expect(type("9999999")).toBe("999999");
    expect(type("999999.99")).toBe("999999.99");
  });
  it("turns a leading dot into 0. and avoids leading zeros", () => {
    expect(type(".5")).toBe("0.5");
    expect(type("007")).toBe("7");
    expect(type("0.05")).toBe("0.05");
    expect(type("1..2")).toBe("1.2");
  });
  it("backspace and clear", () => {
    expect(type("12.8<")).toBe("12.");
    expect(pressKey("123", "clear")).toBe("");
    expect(MAX_PENCE).toBe(99_999_999);
  });
});

describe("helpers", () => {
  it("pctChange / median", () => {
    expect(pctChange(31260, 22600)).toBe(38);
    expect(pctChange(100, 0)).toBeNull();
    expect(medianPence([300, 100, 200])).toBe(200);
    expect(medianPence([100, 201])).toBe(151);
    expect(medianPence([])).toBe(0);
  });
});

describe("penceToDecimal", () => {
  it("is exact", () => {
    expect(penceToDecimal(1280)).toBe("12.80");
    expect(penceToDecimal(5)).toBe("0.05");
    expect(penceToDecimal(-118473)).toBe("-1184.73");
    expect(penceToDecimal(0)).toBe("0.00");
  });
});
