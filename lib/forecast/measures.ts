// Budget measures built on a forecast (BUD-03, BUD-04, BUD-07, CASH-06). Arithmetic on the engine's answer; no projecting here.
import Decimal from "decimal.js";
import { r2p } from "./prior";
import type { FcView } from "./view";

export type BudgetStatus = "early" | "on_track" | "tight" | "over";

/** BUD-04: Over if the forecast is above the budget, Tight above 95% of it, otherwise On track. Days 1–6: "Early days" unless spend is >10% over plan. */
export function budgetStatus(f: FcView, budget: number, plan: number): BudgetStatus {
  if (f.closed) return f.spent > budget ? "over" : "on_track";
  if (f.dom <= 6 && !(plan > 0 && f.spent * 10 > plan * 11)) return "early";
  if (!f.available) return f.spent + f.scheduled > budget ? "over" : "on_track";
  if (f.forecast > budget) return "over";
  if (f.forecast * 100 > budget * 95) return "tight";
  return "on_track";
}

/** BUD-03: plan to date = recurring expenses scheduled on or before today + (budget − all recurring scheduled this month) × days elapsed ÷ days in month. */
export function planToDate(budget: number, recurringUpToToday: number, recurringAllMonth: number, dayOfMonthToday: number, dim: number, straightLine = false): number {
  if (straightLine) return r2p(new Decimal(budget).mul(dayOfMonthToday).div(dim));
  const rest = Math.max(0, budget - recurringAllMonth);
  return recurringUpToToday + r2p(new Decimal(rest).mul(dayOfMonthToday).div(dim));
}

/** BUD-04: (budget − spent − what is still to come that is known) ÷ days left including today, floored at £0. */
export function safeToSpend(budget: number, f: Pick<FcView, "spent" | "scheduled" | "trips" | "extras" | "daysLeft">): number {
  if (f.daysLeft <= 0) return 0;
  const left = budget - f.spent - f.scheduled - f.trips - f.extras;
  return left <= 0 ? 0 : r2p(new Decimal(left).div(f.daysLeft));
}

export interface WhatIf { key: "low" | "safe" | "usual" | "high"; perDay: number; monthEnd: number; diff: number }
/** BUD-07: where the month ends at four daily spends. "Usual" is the forecast itself. */
export function whatIfs(budget: number, f: FcView): WhatIf[] {
  const usual = f.expectedPerDay;
  const safe = safeToSpend(budget, f);
  const base = f.spent + f.scheduled + f.trips + f.extras;
  const tenth = (n: number) => Math.max(1000, Math.round(n / 1000) * 1000);
  const rows: { key: WhatIf["key"]; perDay: number }[] = [
    { key: "low", perDay: tenth(Math.round(usual * 0.75)) }, { key: "safe", perDay: safe }, { key: "usual", perDay: usual }, { key: "high", perDay: tenth(Math.round(usual * 1.25)) },
  ];
  return rows.map((r) => {
    const end = r.key === "usual" ? f.forecast : base + Math.max(0, r.perDay * f.daysLeft - f.loggedToday);
    return { ...r, monthEnd: end, diff: budget - end };
  });
}

/** CASH-06: available now − what the forecast says is still to be spent − recurring transfers out of the pool + recurring income into it. */
export function projectedClose(availableNow: number, f: Pick<FcView, "available" | "closed" | "forecast" | "spent">, transfersOut: number, incomeIn: number): number | null {
  if (!f.available || f.closed) return null;
  return availableNow - (f.forecast - f.spent) - transfersOut + incomeIn;
}
