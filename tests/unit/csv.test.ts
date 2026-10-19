import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/lib/csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Gail\'s, "Bakery"')).toBe('"Gail\'s, ""Bakery"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralises formula injection but keeps negative numbers", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("-12.80")).toBe("-12.80");
  });
  it("rows", () => expect(csvRow(["a", null, 3])).toBe("a,,3"));
});
