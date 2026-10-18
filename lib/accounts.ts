import type { AccountType } from "@/lib/types";

export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: "current", label: "Current account" },
  { id: "savings", label: "Savings" },
  { id: "credit_card", label: "Credit card" },
  { id: "cash", label: "Wallet" },
  { id: "other", label: "Other" },
];
export const accountTypeLabel = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.id === t)?.label ?? t;
