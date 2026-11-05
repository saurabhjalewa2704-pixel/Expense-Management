import { describe, expect, it } from "vitest";
import { parseAllowList } from "@/lib/env";

describe("AUTH-01 the sign-in allow-list", () => {
  it("one address, as before", () => {
    expect(parseAllowList("Me@Example.com")).toEqual(["me@example.com"]);
  });
  it("several addresses separated by commas, semicolons or spaces, case and padding ignored", () => {
    expect(parseAllowList(" a@x.com , B@y.com;c@z.com  d@w.com ")).toEqual(["a@x.com", "b@y.com", "c@z.com", "d@w.com"]);
  });
  it("nothing listed means nobody may sign in", () => {
    expect(parseAllowList("")).toEqual([]);
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList(" , ; ")).toEqual([]);
  });
});
