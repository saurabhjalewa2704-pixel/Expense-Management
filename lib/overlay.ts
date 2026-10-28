// Pending (outbox) transactions are overlaid on server data so every view reflects what the user just did,
// even offline. These are pure functions over integer pence; they mirror the SQL in PRD §10.4 for one transaction.
import type { OutboxItem } from "@/lib/outbox";
import type { Account, CashFlow, Category, MonthPace, TxnRow } from "@/lib/types";
import type { ISODate } from "@/lib/dates";

/**
 * Items that still need to be layered over a query's data. An item stops counting once the server accepted it
 * AND the query's data was fetched after that moment (so the server figure already includes it).
 */
export function livePending(items: readonly OutboxItem[], dataUpdatedAt: number): OutboxItem[] {
  return items.filter((i) => i.status === "pending" && !(i.confirmed_at && dataUpdatedAt >= i.confirmed_at));
}

const inPool = (accounts: readonly Account[], id: string | null | undefined) =>
  !!id && !!accounts.find((a) => a.id === id)?.counts_as_cash;

/** Effect of one pending item on one account's balance. */
export function balanceDelta(item: OutboxItem, accountId: string): number {
  const p = item.payload;
  const a = item.flags?.a ?? true, b = item.flags?.b ?? true;             // an entry that does not count moves nothing (BAL-02)
  if (p.type === "expense") return p.account_id === accountId && a ? -p.amount_pence : 0;
  if (p.type === "income") return p.account_id === accountId && a ? p.amount_pence : 0;
  if (p.type === "transfer") {
    return (p.account_id === accountId && a ? -p.amount_pence : 0) + (p.counter_account_id === accountId && b ? p.amount_pence : 0);
  }
  return 0;
}

export function applyBalances<T extends { account_id: string; balance_pence: number }>(rows: readonly T[], items: readonly OutboxItem[]): T[] {
  return rows.map((r) => ({ ...r, balance_pence: r.balance_pence + items.reduce((s, i) => s + balanceDelta(i, r.account_id), 0) }));
}

/** cash_flow() for a period, with pending items inside [from, to] layered on. */
export function applyFlow(flow: CashFlow, items: readonly OutboxItem[], accounts: readonly Account[], from: ISODate, to: ISODate): CashFlow {
  let income = 0, spend = 0, pot = 0, setAside = 0;
  for (const { payload: p, flags } of items) {
    if (p.occurred_on < from || p.occurred_on > to) continue;
    const counts = flags?.a ?? true;
    if (p.type === "income" && inPool(accounts, p.account_id) && counts) { if (p.pot_id) pot += p.amount_pence; else income += p.amount_pence; }
    else if (p.type === "expense" && inPool(accounts, p.account_id) && counts) { if (p.pot_id) pot -= p.amount_pence; else spend += p.amount_pence; }
    else if (p.type === "transfer") {
      const a = inPool(accounts, p.account_id) && counts, b = inPool(accounts, p.counter_account_id) && (flags?.b ?? true);
      if (a && !(inPool(accounts, p.counter_account_id))) setAside -= p.amount_pence;
      if (b && !(inPool(accounts, p.account_id))) setAside += p.amount_pence;
    }
  }
  return {
    ...flow,
    income_pence: flow.income_pence + income,
    spend_pence: flow.spend_pence + spend,
    pot_pence: (flow.pot_pence ?? 0) + pot,
    set_aside_pence: flow.set_aside_pence + setAside,
    closing_pence: flow.closing_pence + income - spend + pot + setAside,
  };
}

/** month_pace(): month-to-date spend gains pending expenses dated inside the month (any account counts as spend). */
export function applyPace(pace: MonthPace, items: readonly OutboxItem[], today: ISODate): MonthPace {
  const extra = items.reduce((s, { payload: p }) => s + (p.type === "expense" && !p.pot_id && p.occurred_on >= pace.month_start && p.occurred_on <= today ? p.amount_pence : 0), 0);
  return { ...pace, spend_pence: pace.spend_pence + extra };
}

/** Shape a pending item like a list_transactions row, so lists can show it with a "waiting to sync" glyph. */
export function pendingRow(item: OutboxItem, accounts: readonly Account[], categories: readonly Category[], pots: readonly { pot_id: string; name: string }[] = []): TxnRow {
  const p = item.payload;
  const acc = accounts.find((a) => a.id === p.account_id);
  const counter = accounts.find((a) => a.id === p.counter_account_id);
  const cat = categories.find((c) => c.id === p.category_id);
  const parent = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : undefined;
  return {
    id: `pending:${item.client_id}`, client_id: item.client_id, type: p.type, amount_pence: p.amount_pence,
    account_id: p.account_id, account_name: acc?.name ?? "Account",
    counter_account_id: p.counter_account_id ?? null, counter_account_name: counter?.name ?? null,
    category_id: p.category_id ?? null, category_name: cat?.name ?? null,
    parent_category_id: parent?.id ?? null, parent_category_name: parent?.name ?? null, category_icon: cat?.icon ?? parent?.icon ?? null,
    payee_id: null, payee_name: p.payee?.trim() || null, note: p.note ?? null, tags: p.tags ?? [],
    occurred_on: p.occurred_on, occurred_at: p.occurred_at ?? null, source: p.source ?? "app", needs_review: false,
    created_at: new Date(item.created_at).toISOString(), pot_id: p.pot_id ?? null, pot_name: pots.find((x) => x.pot_id === p.pot_id)?.name ?? null, pending: true,
    counts_in_balance: item.flags?.a ?? true, counter_counts_in_balance: p.type === "transfer" ? item.flags?.b ?? true : null,
    trip_id: p.trip_id ?? null, trip_origin: p.trip_id ? p.trip_origin ?? null : null,
    original_amount_minor: p.original_amount_minor ?? null, original_currency: p.original_currency ?? null,
    fx_rate: p.fx_rate != null ? Number(p.fx_rate) : null, fx_rate_on: p.fx_rate_on ?? null, fx_source: p.fx_source ?? null,
  };
}

/** Merge pending rows into a newest-first list (occurred_on desc, then created_at desc). */
export function mergePending(rows: readonly TxnRow[], pending: readonly TxnRow[]): TxnRow[] {
  const seen = new Set(rows.map((r) => r.client_id));
  const extra = pending.filter((r) => !seen.has(r.client_id));
  return [...extra, ...rows].sort((a, b) => (a.occurred_on === b.occurred_on ? (a.created_at < b.created_at ? 1 : -1) : a.occurred_on < b.occurred_on ? 1 : -1));
}
