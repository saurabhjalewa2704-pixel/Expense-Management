import { describe, expect, it } from "vitest";
import { decideNudge, QUIET_COPY, REMINDER_COPY, REMINDER_SLOTS, type NudgeInput } from "@/lib/nudge";

const base: NudgeInput = { today: "2026-10-18", hour: 21, minute: 0, reminderTime: "21:00:00", windowMin: 15, lastReminderOn: null, loggedToday: false, noSpendToday: false, lastTxnOn: "2026-10-17" };

describe("evening reminder decision (NOT-01)", () => {
  it("sends once at the slot when nothing is logged today", () => expect(decideNudge(base)).toEqual({ send: true, body: REMINDER_COPY }));
  it("stays silent when something was logged today", () => expect(decideNudge({ ...base, loggedToday: true })).toEqual({ send: false, reason: "logged-today" }));
  it("stays silent after 'Nothing to log'", () => expect(decideNudge({ ...base, noSpendToday: true })).toEqual({ send: false, reason: "no-spend-marked" }));
  it("sends at most one a day", () => expect(decideNudge({ ...base, lastReminderOn: "2026-10-18" })).toEqual({ send: false, reason: "already-sent" }));
  it("only inside the slot window", () => {
    expect(decideNudge({ ...base, hour: 20, minute: 59 })).toMatchObject({ send: false, reason: "outside-slot" });
    expect(decideNudge({ ...base, minute: 14 })).toMatchObject({ send: true });
    expect(decideNudge({ ...base, minute: 15 })).toMatchObject({ send: false, reason: "outside-slot" });
    expect(decideNudge({ ...base, minute: 45, windowMin: 60 })).toMatchObject({ send: true });   // an hourly cron still catches it
  });
  it("honours a custom time", () => {
    expect(decideNudge({ ...base, reminderTime: "18:30", hour: 18, minute: 30 })).toMatchObject({ send: true });
    expect(decideNudge({ ...base, reminderTime: "18:30" })).toMatchObject({ send: false });
  });
  it("changes the copy after three quiet days", () => {
    expect(decideNudge({ ...base, lastTxnOn: "2026-10-16" })).toEqual({ send: true, body: REMINDER_COPY });
    expect(decideNudge({ ...base, lastTxnOn: "2026-10-15" })).toEqual({ send: true, body: QUIET_COPY });
    expect(decideNudge({ ...base, lastTxnOn: null })).toEqual({ send: true, body: QUIET_COPY });
  });
  it("offers 21 slots from 18:00 to 23:00", () => {
    expect(REMINDER_SLOTS).toHaveLength(21);
    expect([REMINDER_SLOTS[0], REMINDER_SLOTS[1], REMINDER_SLOTS[20]]).toEqual(["18:00", "18:15", "23:00"]);
  });
});
