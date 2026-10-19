import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dayHeader, daysInMonth, diffDays, formatLong, formatShort, londonDateOf, londonParts,
  monthEnd, monthStart, quarterEnd, quarterStart, todayLondon, weekdayIndex,
} from "@/lib/dates";

describe("Europe/London dates around the BST changes (29 Mar and 25 Oct 2026)", () => {
  it("is still GMT the night before the clocks go forward", () => {
    expect(londonDateOf("2026-03-28T23:30:00Z")).toBe("2026-03-28");
    expect(londonDateOf("2026-03-29T00:30:00Z")).toBe("2026-03-29");
  });
  it("is already the next day at 23:30 UTC once BST starts", () => {
    expect(londonDateOf("2026-03-29T23:30:00Z")).toBe("2026-03-30");
    expect(londonDateOf("2026-10-24T23:30:00Z")).toBe("2026-10-25");
  });
  it("is back to GMT after 25 Oct 01:00 UTC", () => {
    expect(londonDateOf("2026-10-25T23:30:00Z")).toBe("2026-10-25");
    expect(londonDateOf("2026-10-25T00:30:00Z")).toBe("2026-10-25"); // 01:30 BST, first pass
    expect(londonParts(new Date("2026-10-25T01:30:00Z")).hour).toBe(1);  // 01:30 GMT, second pass
  });
  it("reads the hour in London, not the device", () => {
    expect(londonParts(new Date("2026-07-01T20:00:00Z")).hour).toBe(21);
    expect(londonParts(new Date("2026-01-01T20:00:00Z")).hour).toBe(20);
  });
  it("todayLondon takes an instant", () => expect(todayLondon(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01"));
});

describe("calendar arithmetic", () => {
  it("adds days across the DST weekends without drift", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(diffDays("2026-10-26", "2026-10-24")).toBe(2);
    expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
  });
  it("clamps months", () => {
    expect(addMonths("2026-10-31", -1)).toBe("2026-09-30");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("month and quarter bounds", () => {
    expect(monthStart("2026-10-18")).toBe("2026-10-01");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(daysInMonth("2026-10-18")).toBe(31);
    expect(quarterStart("2026-11-05")).toBe("2026-10-01");
    expect(quarterEnd("2026-11-05")).toBe("2026-12-31");
  });
  it("weeks start on Monday", () => {
    expect(weekdayIndex("2026-10-19")).toBe(0);
    expect(weekdayIndex("2026-10-18")).toBe(6);
  });
});

describe("labels", () => {
  it("formats like the mock-ups", () => {
    expect(formatLong("2026-10-18")).toBe("Sunday 18 October");
    expect(formatShort("2026-10-16")).toBe("Fri 16 Oct");
  });
  it("day headers", () => {
    expect(dayHeader("2026-10-18", "2026-10-18")).toBe("Today");
    expect(dayHeader("2026-10-17", "2026-10-18")).toBe("Yesterday");
    expect(dayHeader("2026-10-16", "2026-10-18")).toBe("Fri 16 Oct");
  });
});
