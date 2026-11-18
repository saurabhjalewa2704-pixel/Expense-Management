import { describe, expect, it } from "vitest";
import { isStaleCodeError, mayReloadForNewVersion } from "@/lib/stale-code";

describe("an app that has not updated yet (stale Server Action ids)", () => {
  it("recognises the error Next throws when the server does not know the action", () => {
    expect(isStaleCodeError(Object.assign(new Error("x"), { name: "UnrecognizedActionError" }))).toBe(true);
    expect(isStaleCodeError(new Error('Server Action "7f3a" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action'))).toBe(true);
    expect(isStaleCodeError("Failed to find Server Action \"abc\". This request might be from an older or newer deployment.")).toBe(true);
  });
  it("leaves every other error alone", () => {
    expect(isStaleCodeError(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleCodeError(new Error("That already exists."))).toBe(false);
    expect(isStaleCodeError(null)).toBe(false);
    expect(isStaleCodeError(undefined)).toBe(false);
  });
  it("reloads for a new version at most once every two minutes", () => {
    expect(mayReloadForNewVersion(1_000_000, null)).toBe(true);
    expect(mayReloadForNewVersion(1_000_000, 950_000)).toBe(false);
    expect(mayReloadForNewVersion(1_000_000, 800_000)).toBe(true);
  });
});
