"use client";
import { useMemo } from "react";
import { CategoryIcon, UI } from "@/lib/icons";
import { useAccounts, useCategoryTree, usePayees } from "@/lib/queries/hooks";
import type { RecurringItem } from "@/lib/types";

/** Names and icons for a recurring payment: payee and "sub-category · account" for money going out or in, "To …" and "Transfer · from …" for a transfer. */
export function useBillLabels() {
  const payeeData = usePayees().data;
  const accountData = useAccounts().data;
  const { tree } = useCategoryTree();
  return useMemo(() => {
    const payees = payeeData ?? [], accounts = accountData ?? [];
    const acct = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "account";
    const nameOf = (i: RecurringItem) => (i.type === "transfer" ? `To ${acct(i.counter_account_id)}` : payees.find((p) => p.id === i.payee_id)?.name ?? tree.byId.get(i.category_id ?? "")?.name ?? "Payment");
    const captionOf = (i: RecurringItem) => (i.type === "transfer" ? `Transfer · from ${acct(i.account_id)}` : `${tree.byId.get(i.category_id ?? "")?.name ?? "Uncategorised"} · ${acct(i.account_id)}`);
    const parentOf = (i: RecurringItem) => { const c = tree.byId.get(i.category_id ?? ""); return c?.parent_id ? tree.byId.get(c.parent_id)?.name ?? null : null; };
    const archived = (i: RecurringItem) => !!accounts.find((a) => a.id === i.account_id)?.archived_at || !!accounts.find((a) => a.id === i.counter_account_id)?.archived_at
      || !!(i.category_id && tree.byId.get(i.category_id)?.archived_at);
    return { nameOf, captionOf, parentOf, archived, accountName: acct, iconOf: (i: RecurringItem) => (i.type === "transfer" ? "piggy-bank" : tree.byId.get(i.category_id ?? "")?.icon ?? null) };
  }, [payeeData, accountData, tree]);
}

/** The tile on a bill row: the category's icon, or a green savings tile for a transfer. */
export function BillTile({ item, icon, size = 20 }: { item: RecurringItem; icon: string | null; size?: number }) {
  return item.type === "transfer"
    ? <div className="tile pos"><UI.PiggyBank size={size} strokeWidth={1.75} aria-hidden /></div>
    : <div className="tile"><CategoryIcon name={icon ?? undefined} size={size} /></div>;
}
