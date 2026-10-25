// REC-05: the three notifications, as plain data. The cron sends them; each can be switched off in Settings → Reminders.
import { formatDayMonth, type ISODate } from "@/lib/dates";
import { formatGBP, type Pence } from "@/lib/money";

export interface LoggedBill {
  occurrenceId: string; itemId: string; transactionId: string | null;
  name: string; type: "expense" | "income" | "transfer"; amount: Pence; due_on: ISODate;
  status: "logged" | "estimate" | "pending";
  /** Why a payment is waiting for the owner when it was meant to log itself. */
  blocked: boolean;
}
export interface BillPush {
  title: string; body: string; url: string; tag: string;
  actions?: { action: string; title: string }[];
  data?: { occurrence?: string; transaction?: string | null; item?: string };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One summary for everything logged on its own (several on one day, or a catch-up after an outage), then one per estimate and per reminder. */
export function buildBillPushes(rows: readonly LoggedBill[], today: ISODate): BillPush[] {
  const out: BillPush[] = [];
  const logged = rows.filter((r) => r.status === "logged");
  const estimates = rows.filter((r) => r.status === "estimate");
  const pending = rows.filter((r) => r.status === "pending");

  if (logged.length > 0) {
    const spend = logged.filter((r) => r.type === "expense");
    const total = spend.reduce((s, r) => s + r.amount, 0);
    const catchUp = logged.some((r) => r.due_on < today);
    const noun = spend.length === logged.length ? "bill" : "payment";
    const n = spend.length === logged.length ? spend.length : logged.length;
    out.push({
      title: `${plural(n, noun)} logged ${catchUp ? "" : "today "}· ${formatGBP(spend.length === logged.length ? total : logged.reduce((s, r) => s + r.amount, 0))}`.replace("  ", " "),
      body: logged.map((r) => `${r.name} ${formatGBP(r.amount)}${r.due_on < today ? ` (${formatDayMonth(r.due_on)})` : ""}`).join(" · "),
      url: "/bills", tag: "bills-logged",
    });
  }
  for (const r of estimates) {
    out.push({
      title: `${r.name} logged: ${formatGBP(r.amount)} (estimate)`, body: "This bill varies. Check the amount once it’s been taken.",
      url: r.transactionId ? `/activity?txn=${r.transactionId}` : `/bills/${r.itemId}`, tag: `bill-${r.occurrenceId}`,
      actions: [{ action: "confirm", title: "Looks right" }, { action: "change", title: "Change amount" }],
      data: { occurrence: r.occurrenceId, transaction: r.transactionId, item: r.itemId },
    });
  }
  for (const r of pending) {
    out.push({
      title: r.blocked ? `${r.name} is due today` : `${r.name} ${formatGBP(r.amount)} is due today`,
      body: r.blocked ? "Account no longer active, choose another." : "Tap to log it or skip it.",
      url: `/bills/${r.itemId}`, tag: `bill-${r.occurrenceId}`,
      actions: r.blocked ? undefined : [{ action: "log", title: "Log it" }, { action: "skip", title: "Skip" }],
      data: { occurrence: r.occurrenceId, item: r.itemId },
    });
  }
  return out;
}
