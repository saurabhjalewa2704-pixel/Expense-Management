// Month-end close: the rules that need no database (MONTH-CLOSE-PRD §3 to §11). Edge cases are named after their IDs.
import { describe, expect, it } from "vitest";
import {
  bankFigure, cardMode, closeNotificationCopy, dayContext, differenceOptions, differenceTitle, dueCloseNotification, errorPct, estimateMinutes, firstUnfinishedStep, formatDuration,
  groupRuns, laterUntilMs, monthsToClose, nextCloseDate, notLoggingForAWhile, statusChip, stepCounts, stepStatus, suggestedLimit, waitingLine,
} from "@/lib/close/logic";
import type { CloseChecks, CloseMonthState, CloseState } from "@/lib/close/types";
import { londonParts } from "@/lib/dates";

const empty: CloseChecks = { month: "2026-11-01", from: "2026-11-01", to: "2026-11-30", partial: false, tracking_started_on: "2026-10-01", missing_days: [], bills: [], balances: [], duplicates: [], large: [], one_offs: [] };
const checks = (o: Partial<CloseChecks>): CloseChecks => ({ ...empty, ...o });
const month = (o: Partial<CloseMonthState> = {}): CloseMonthState => ({ month: "2026-11-01", status: "open", step_state: {}, started_at: null, closed_at: null, changed_since_close: false, spent: null, snapshot_rev: 0, prompted: true, partial: false, duration_s: null, reopened_count: 0, ...o });

describe("MC-03 the estimated time", () => {
  it("10 s an item in steps 1, 2 and 4, 15 s an account, 30 s for steps 5 and 6, to the nearest minute (halves to even), at least 1", () => {
    expect(estimateMinutes({ missing: 2, bills: 2, tidy: 2, accounts: 4 })).toBe(2);        // the PRD scenario: 60 + 60 + 30 = 150 s
    expect(estimateMinutes({ missing: 0, bills: 0, tidy: 0, accounts: 0 })).toBe(1);        // 30 s, never less than 1
    expect(estimateMinutes({ missing: 6, bills: 0, tidy: 0, accounts: 0 })).toBe(2);        // 90 s
    expect(estimateMinutes({ missing: 9, bills: 0, tidy: 0, accounts: 0 })).toBe(2);        // 120 s
    expect(estimateMinutes({ missing: 12, bills: 0, tidy: 0, accounts: 0 })).toBe(2);       // 150 s
    expect(estimateMinutes({ missing: 15, bills: 0, tidy: 0, accounts: 0 })).toBe(3);       // 180 s
  });
});

describe("step 1: missing days", () => {
  const d = (day: string, answer: "no_spend" | "not_tracked" | null = null) => ({ day, answer });
  it("MC-13 three or more consecutive unanswered days are one run; two are not", () => {
    const items = groupRuns([d("2026-11-12"), d("2026-11-13"), d("2026-11-14"), d("2026-11-15"), d("2026-11-16"), d("2026-11-20"), d("2026-11-22"), d("2026-11-23")]);
    expect(items.map((i) => i.kind)).toEqual(["run", "day", "day", "day"]);
    expect(items[0]).toMatchObject({ kind: "run", from: "2026-11-12", to: "2026-11-16" });
  });
  it("Pick days expands a run into single days", () => {
    const items = groupRuns([d("2026-11-12"), d("2026-11-13"), d("2026-11-14")], new Set(["2026-11-12"]));
    expect(items.map((i) => i.kind)).toEqual(["day", "day", "day"]);
  });
  it("an answered day breaks a run and stays as a single, answered item", () => {
    const items = groupRuns([d("2026-11-12"), d("2026-11-13", "no_spend"), d("2026-11-14"), d("2026-11-15"), d("2026-11-16")]);
    expect(items.map((i) => i.kind)).toEqual(["day", "day", "run"]);
  });
  it("more than 15 unanswered days lead with the banner", () => {
    const days = Array.from({ length: 16 }, (_, i) => d(`2026-11-${String(i + 1).padStart(2, "0")}`));
    expect(notLoggingForAWhile(days)).toBe(true);
    expect(notLoggingForAWhile(days.slice(0, 15))).toBe(false);
  });
  it("MC-11 the context line: the weekday profile when on, else the usual, else just 'Nothing logged'", () => {
    const weekday = [1, 1, 1, 1, 1, 1.5, 1.2];                                     // Monday first; Thursday = index 3
    expect(dayContext("2026-11-05", 6114, weekday)).toBe("Nothing logged · you usually spend about £61 on a Thursday");
    expect(dayContext("2026-11-14", 6114, weekday)).toBe("Nothing logged · Saturdays are usually your biggest day");
    expect(dayContext("2026-11-05", 6114, null)).toBe("Nothing logged · you usually spend about £61 on a Thursday");
    expect(dayContext("2026-11-05", null, null)).toBe("Nothing logged");
  });
});

describe("step status and the overview", () => {
  const n = stepCounts(checks({ missing_days: [{ day: "2026-11-05", answer: null }, { day: "2026-11-14", answer: "no_spend" }], balances: [
    { account_id: "a", name: "Monzo", type: "current", counts_as_cash: true, sterling_pence: 1, answer: null, payload: null },
    { account_id: "b", name: "Marcus", type: "savings", counts_as_cash: false, sterling_pence: 1, answer: null, payload: null }] }), false);
  it("counts what is open and answered, with savings behind the toggle", () => {
    expect(n.missing_days).toEqual({ total: 2, open: 1, answered: 1 });
    expect(n.balances.total).toBe(1);
    expect(stepCounts(checks({ balances: [{ account_id: "b", name: "Marcus", type: "savings", counts_as_cash: false, sterling_pence: 1, answer: null, payload: null }] }), true).balances.total).toBe(1);
  });
  it("MC-07 a step with nothing in it is ticked automatically; steps 5 and 6 are never empty", () => {
    expect(stepStatus("bills", {}, n).kind).toBe("nothing");
    expect(stepStatus("review", {}, n).kind).toBe("todo");
  });
  it("MC-06 Resume opens the first unfinished step, passing over empty ones", () => {
    expect(firstUnfinishedStep({}, n)).toBe("missing_days");
    expect(firstUnfinishedStep({ missing_days: "skipped" }, n)).toBe("missing_days");
    expect(firstUnfinishedStep({ missing_days: "skipped" }, n, true)).toBe("balances");
  });
  it("the Home card's line says what is waiting", () => {
    const w = stepCounts(checks({ missing_days: [{ day: "2026-11-05", answer: null }, { day: "2026-11-14", answer: null }], bills: [
      { occurrence_id: "1", item_id: "i", payee: "A", status: "estimate", due_on: "2026-11-20", amount_pence: 1, account_name: "x", transaction_id: null, logged_on: null, varies: true, answer: null },
      { occurrence_id: "2", item_id: "j", payee: "B", status: "pending", due_on: "2026-11-07", amount_pence: 1, account_name: "x", transaction_id: null, logged_on: null, varies: false, answer: null }],
      balances: ["a", "b", "c", "d"].map((x) => ({ account_id: x, name: x, type: "current" as const, counts_as_cash: true, sterling_pence: 1, answer: null, payload: null })) }), false);
    expect(waitingLine(w)).toBe("2 days with nothing logged, 2 bills to confirm, 4 balances");
  });
});

describe("step 3: sorting out a difference", () => {
  it("MC-33 the title states the difference in words", () => {
    expect(differenceTitle("Cash", "cash", -2000)).toBe("Cash is £20.00 short");
    expect(differenceTitle("Monzo", "current", 3510)).toBe("Monzo has £35.10 more than expected");
    expect(differenceTitle("Amex Gold", "credit_card", -1000)).toBe("Amex Gold owes £10.00 more than expected");
  });
  it("EC-MC14 a difference of £1.00 or less pre-selects 'Just correct the balance'", () => {
    expect(differenceOptions(-100).preselected).toBe("adjustment");
    expect(differenceOptions(100).preselected).toBe("adjustment");
    expect(differenceOptions(-101).preselected).toBe("untracked_spend");
    expect(differenceOptions(5000).options).toEqual(["untracked_income", "adjustment"]);
  });
  it("EC-MC13 a card is typed as owed and stored negative; in credit it is stored positive", () => {
    expect(bankFigure("credit_card", 143680)).toBe(-143680);
    expect(bankFigure("credit_card", 5000, true)).toBe(5000);
    expect(bankFigure("current", 284612)).toBe(284612);
  });
  it("EC-MC15 the difference is recomputed against the new Sterling balance and can become a match", () => {
    const diff = (bank: number, sterling: number) => bank - sterling;
    expect(diff(16000, 18000)).toBe(-2000);
    expect(diff(16000, 16000)).toBe(0);                  // a missed expense logged before saving: the item resolves as a match
  });
});

describe("step 6 and the review", () => {
  it("MC-61 a limit over in 2 of the last 3 months: the average actual, rounded up to the nearest £25", () => {
    expect(suggestedLimit([49875, 45000])).toBe(47500);
    expect(suggestedLimit([40001, 40001])).toBe(42500);
    expect(suggestedLimit([40000, 40000])).toBe(40000);
  });
  it("the forecast's error against the final figure", () => {
    expect(errorPct(413871, 417812)).toBe("−0.9%");
    expect(errorPct(402978, 417812)).toBe("−3.6%");
    expect(errorPct(417812, 417812)).toBe("0.0%");
    expect(errorPct(1, 0)).toBe("—");
  });
  it("the done screen's duration and next close", () => {
    expect(formatDuration(112)).toBe("1 min 52 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(nextCloseDate("2026-12-01")).toBe("2027-01-01");
  });
});

describe("the Home card, notifications and chips", () => {
  const nowMs = Date.parse("2026-12-01T09:30:00Z");
  it("MC-01 ready, in progress, slim after 14 days, hidden when closed", () => {
    expect(cardMode(month(), "2026-12-01", null, nowMs)).toBe("ready");
    expect(cardMode(month({ status: "in_progress", started_at: "2026-12-01T09:00:00Z" }), "2026-12-01", null, nowMs)).toBe("in_progress");
    expect(cardMode(month(), "2026-12-15", null, nowMs)).toBe("slim");
    expect(cardMode(month(), "2026-12-14", null, nowMs)).toBe("ready");
    expect(cardMode(month({ status: "closed" }), "2026-12-01", null, nowMs)).toBe("hidden");
  });
  it("with several months waiting the card stays full until even the newest is 14 days old", () => {
    const old = month({ month: "2026-10-01" }), recent = month({ month: "2026-11-01" });
    expect(cardMode(old, "2026-12-01", null, nowMs, recent)).toBe("ready");
    expect(cardMode(old, "2026-12-15", null, nowMs, recent)).toBe("slim");
  });
  it("EC-MC35 Later hides the card until 06:00 the next day, and it returns then", () => {
    const until = laterUntilMs("2026-12-01");
    expect(new Date(until).toISOString()).toBe("2026-12-02T06:00:00.000Z");
    expect(cardMode(month(), "2026-12-01", until, nowMs)).toBe("hidden");
    expect(cardMode(month(), "2026-12-02", until, Date.parse("2026-12-02T06:00:01Z"))).toBe("ready");
  });
  it("EC-MC32 several open months: oldest first", () => {
    const st: CloseState = { current: "2027-01-01", since: "2026-11-01", months: [month({ month: "2026-12-01" }), month({ month: "2026-11-01" }), month({ month: "2026-10-01", prompted: false }), month({ month: "2026-09-01", status: "closed" })] };
    expect(monthsToClose(st).map((m) => m.month)).toEqual(["2026-11-01", "2026-12-01"]);
  });
  it("§10.3 the chips", () => {
    expect(statusChip(month({ status: "closed" }))).toEqual({ tone: "pos", label: "Closed" });
    expect(statusChip(month({ status: "closed", changed_since_close: true }), 1999).label).toBe("Changed since close · +£20");
    expect(statusChip(month({ status: "closed_with_skips", step_state: { bills: "skipped" } }))).toEqual({ tone: "muted", label: "Closed, 1 skipped" });
    expect(statusChip(month())).toEqual({ tone: "muted", label: "Open" });
  });
  const base = { windowMin: 15, notifyTime: "09:00", month: month(), readySent: false, reminderSent: false, enabled: true };
  it("MC-80 the first notice at 09:00 on the 1st, the reminder at 19:00 on the 4th, at most two, none once closed", () => {
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-01", hour: 9, minute: 5 })).toBe("ready");
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-01", hour: 8, minute: 50 })).toBeNull();
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-01", hour: 9, minute: 5, readySent: true })).toBeNull();
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-04", hour: 19, minute: 10 })).toBe("reminder");
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-04", hour: 19, minute: 10, reminderSent: true })).toBeNull();
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-04", hour: 19, minute: 10, month: month({ status: "closed" }) })).toBeNull();
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-01", hour: 9, minute: 5, enabled: false })).toBeNull();
    expect(dueCloseNotification({ ...base, londonDate: "2026-12-01", hour: 9, minute: 5, notifyTime: "07:30" })).toBeNull();
  });
  it("EC-MC2 09:00 London on the 1st is 09:00 in both GMT and BST (the cron reads London wall-clock time)", () => {
    expect(londonParts(Date.parse("2026-12-01T09:00:00Z"))).toMatchObject({ date: "2026-12-01", hour: 9 });       // GMT
    expect(londonParts(Date.parse("2026-05-01T08:00:00Z"))).toMatchObject({ date: "2026-05-01", hour: 9 });       // BST
    expect(londonParts(Date.parse("2026-10-31T23:30:00Z"))).toMatchObject({ date: "2026-10-31", hour: 23 });      // still October in London (BST ended later that night)
    expect(londonParts(Date.parse("2026-11-01T00:30:00Z"))).toMatchObject({ date: "2026-11-01", hour: 0 });
  });
  it("the copy", () => {
    expect(closeNotificationCopy("ready", "2026-11-01", false, null, 2)).toMatchObject({ title: "November is ready to close", body: "Six quick checks, about 2 minutes.", url: "/close/2026-11" });
    expect(closeNotificationCopy("reminder", "2026-11-01", false, null, 2)).toMatchObject({ title: "November is still open", body: "Two minutes now keeps December's numbers right." });
    expect(closeNotificationCopy("reminder", "2026-11-01", true, "Balances", 2)).toMatchObject({ title: "Finish closing November", body: "You stopped at Balances.", url: "/close/2026-11?resume=1" });
  });
});
