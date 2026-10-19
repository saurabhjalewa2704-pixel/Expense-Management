import { describe, expect, it } from "vitest";
import { applyBalances, applyFlow, applyPace, livePending, mergePending, pendingRow } from "@/lib/overlay";
import type { OutboxItem } from "@/lib/outbox";
import type { Account, CashFlow, Category, MonthPace, TxnRow } from "@/lib/types";

const acc = (id: string, cash: boolean): Account => ({
  id, name: id, institution: null, type: cash ? "current" : "savings", opening_balance_pence: 0, opening_date: "2026-01-01",
  counts_as_cash: cash, is_default: false, sort_order: 0, archived_at: null, created_at: "",
});
const accounts = [acc("monzo", true), acc("amex", true), acc("marcus", false)];
const item = (p: Partial<OutboxItem["payload"]> & Pick<OutboxItem["payload"], "type" | "amount_pence" | "account_id">, extra: Partial<OutboxItem> = {}): OutboxItem => ({
  client_id: crypto.randomUUID(), created_at: 1000, status: "pending", attempts: 0,
  payload: { client_id: "x", occurred_on: "2026-10-18", tags: [], account_manual: false, source: "app", ...p } as OutboxItem["payload"], ...extra,
});
const flow: CashFlow = { opening_pence: 786240, income_pence: 14000, spend_pence: 323685, set_aside_pence: 0, adjust_pence: 0, closing_pence: 476555 };

describe("livePending", () => {
  it("hides failed items and items the server has accepted once data is newer", () => {
    const a = item({ type: "expense", amount_pence: 100, account_id: "monzo" });
    const failed = item({ type: "expense", amount_pence: 100, account_id: "monzo" }, { status: "failed" });
    const confirmed = item({ type: "expense", amount_pence: 100, account_id: "monzo" }, { confirmed_at: 5000 });
    expect(livePending([a, failed, confirmed], 4000)).toEqual([a, confirmed]); // data older than the confirmation: still overlay
    expect(livePending([a, failed, confirmed], 5000)).toEqual([a]);            // refetched since: server figure already includes it
  });
});

describe("applyFlow", () => {
  it("an expense on a pool account lowers cash and raises spend", () => {
    const r = applyFlow(flow, [item({ type: "expense", amount_pence: 1280, account_id: "amex" })], accounts, "2026-10-01", "2026-10-18");
    expect(r.spend_pence).toBe(323685 + 1280);
    expect(r.closing_pence).toBe(476555 - 1280);
    expect(r.opening_pence + r.income_pence - r.spend_pence + r.set_aside_pence + r.adjust_pence).toBe(r.closing_pence);
  });
  it("income raises cash", () => {
    const r = applyFlow(flow, [item({ type: "income", amount_pence: 5000, account_id: "monzo" })], accounts, "2026-10-01", "2026-10-18");
    expect(r.income_pence).toBe(19000);
    expect(r.closing_pence).toBe(481555);
  });
  it("a transfer inside the pool changes nothing; to savings is set aside", () => {
    const inside = applyFlow(flow, [item({ type: "transfer", amount_pence: 50000, account_id: "monzo", counter_account_id: "amex" })], accounts, "2026-10-01", "2026-10-18");
    expect(inside).toEqual(flow);
    const toSavings = applyFlow(flow, [item({ type: "transfer", amount_pence: 50000, account_id: "monzo", counter_account_id: "marcus" })], accounts, "2026-10-01", "2026-10-18");
    expect(toSavings.set_aside_pence).toBe(-50000);
    expect(toSavings.closing_pence).toBe(476555 - 50000);
    expect(toSavings.spend_pence).toBe(flow.spend_pence);
  });
  it("ignores items outside the period and spend on accounts outside the pool", () => {
    expect(applyFlow(flow, [item({ type: "expense", amount_pence: 999, account_id: "monzo", occurred_on: "2026-09-30" })], accounts, "2026-10-01", "2026-10-18")).toEqual(flow);
    expect(applyFlow(flow, [item({ type: "expense", amount_pence: 999, account_id: "marcus" })], accounts, "2026-10-01", "2026-10-18")).toEqual(flow);
  });
});

describe("applyBalances / applyPace", () => {
  it("moves balances for both sides of a transfer", () => {
    const rows = [{ account_id: "monzo", balance_pence: 1000 }, { account_id: "amex", balance_pence: -5000 }];
    const out = applyBalances(rows, [item({ type: "transfer", amount_pence: 300, account_id: "monzo", counter_account_id: "amex" })]);
    expect(out.map((r) => r.balance_pence)).toEqual([700, -4700]);
  });
  it("adds month-to-date spend", () => {
    const pace: MonthPace = { month_start: "2026-10-01", day_of_month: 18, days_in_month: 31, spend_pence: 323685, prev_spend_pence: 360410, prev_label_day: 18, prev_total_pence: 531600 };
    expect(applyPace(pace, [item({ type: "expense", amount_pence: 640, account_id: "amex" })], "2026-10-18").spend_pence).toBe(324325);
    expect(applyPace(pace, [item({ type: "income", amount_pence: 640, account_id: "amex" })], "2026-10-18").spend_pence).toBe(323685);
  });
});

describe("lists", () => {
  const cats: Category[] = [
    { id: "eat", parent_id: null, kind: "expense", name: "Eating out", icon: "utensils", color: "clay", sort_order: 1, is_fixed: false, archived_at: null },
    { id: "cof", parent_id: "eat", kind: "expense", name: "Coffee & snacks", icon: "coffee", color: "clay", sort_order: 1, is_fixed: false, archived_at: null },
  ];
  it("shapes a pending item like a list row", () => {
    const r = pendingRow(item({ type: "expense", amount_pence: 640, account_id: "amex", category_id: "cof", payee: "Gail's Bakery" }), accounts, cats);
    expect(r).toMatchObject({ pending: true, category_name: "Coffee & snacks", parent_category_name: "Eating out", payee_name: "Gail's Bakery", account_name: "amex" });
  });
  it("merges pending rows on top and never duplicates a synced one", () => {
    const row = (client_id: string, on: string, created: string): TxnRow => ({ client_id, occurred_on: on, created_at: created, id: client_id } as TxnRow);
    const server = [row("a", "2026-10-17", "2026-10-17T09:00:00Z")];
    const pending = [{ ...row("b", "2026-10-18", "2026-10-18T09:00:00Z"), pending: true }, { ...row("a", "2026-10-17", "x"), pending: true }];
    expect(mergePending(server, pending).map((r) => r.client_id)).toEqual(["b", "a"]);
  });
});
