import { describe, expect, it } from "vitest";
import { parseSearch } from "@/lib/search";

describe("parseSearch", () => {
  it("text", () => expect(parseSearch("  gail's bakery ")).toEqual({ text: "gail's bakery" }));
  it("exact amount", () => {
    expect(parseSearch("12.80")).toEqual({ text: "", amount: 1280 });
    expect(parseSearch("£1,234.50")).toEqual({ text: "", amount: 123450 });
    expect(parseSearch("12")).toEqual({ text: "", amount: 1200 });
  });
  it("comparisons", () => {
    expect(parseSearch(">100")).toEqual({ text: "", min: 10000 });
    expect(parseSearch("<20.5")).toEqual({ text: "", max: 2050 });
    expect(parseSearch("coffee >5")).toEqual({ text: "coffee", min: 500 });
    expect(parseSearch(">=£10 <50")).toEqual({ text: "", min: 1000, max: 5000 });
  });
  it("a number among words is text", () => expect(parseSearch("7 eleven")).toEqual({ text: "7 eleven" }));
  it("empty", () => expect(parseSearch("")).toEqual({ text: "" }));
});
