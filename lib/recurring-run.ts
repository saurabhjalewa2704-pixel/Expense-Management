// REC-04, the loop shared by the scheduled job and by the app itself: log every occurrence that is due and not recorded yet.
// The caller passes the client and which database function to call, so the same code runs as the service role (cron) or as the owner (app open).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoggedBill } from "@/lib/bills-notify";
import type { ISODate } from "@/lib/dates";
import { planDue, type EngineItem } from "@/lib/recurring-engine";

export interface RunItem extends EngineItem {
  user_id: string; type: "expense" | "income" | "transfer"; payee_id: string | null; counter_account_id: string | null; auto_log: boolean;
}
export interface RunResult { logged: { user: string; bill: LoggedBill }[]; finished: number; errors: string[] }

/** `fn` is "recurring_log" (service role, any owner) or "recurring_log_now" (the signed-in owner's own rules). */
export async function runDue(db: SupabaseClient, fn: "recurring_log" | "recurring_log_now", items: readonly RunItem[], today: ISODate,
  holidays: ReadonlySet<ISODate>, names: ReadonlyMap<string, string>): Promise<RunResult> {
  const out: RunResult = { logged: [], finished: 0, errors: [] };
  for (const it of items) {
    const { planned, finished } = planDue(it, today, holidays);
    if (finished) {
      const { error } = await db.from("recurring_items").update({ ended_at: new Date().toISOString() }).eq("id", it.id);
      if (error) out.errors.push(error.message); else out.finished++;
      continue;
    }
    for (const p of planned) {
      const { data, error } = await db.rpc(fn, { p_item: it.id, p_scheduled: p.scheduled_on, p_due: p.due_on, p_next: p.next });
      if (error) { out.errors.push(`${it.id}: ${error.message}`); break; }
      const row = (data as { occurrence_id: string; transaction_id: string | null; status: LoggedBill["status"]; amount_pence: number }[] | null)?.[0];
      if (!row) continue;                                              // already recorded: nothing new
      out.logged.push({
        user: it.user_id,
        bill: {
          occurrenceId: row.occurrence_id, itemId: it.id, transactionId: row.transaction_id, name: names.get(it.id) ?? "Payment", type: it.type,
          amount: Number(row.amount_pence), due_on: p.due_on, status: row.status, blocked: row.status === "pending" && it.auto_log,   // meant to log itself, could not
        },
      });
    }
  }
  return out;
}

/** A readable name for each rule: the payee, or "To <account>" for a transfer. */
export async function nameLookup(db: SupabaseClient, items: readonly RunItem[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!items.length) return names;
  const [{ data: payees }, { data: accts }] = await Promise.all([
    db.from("payees").select("id, name").in("id", items.map((i) => i.payee_id).filter(Boolean) as string[]),
    db.from("accounts").select("id, name").in("id", items.map((i) => i.counter_account_id).filter(Boolean) as string[]),
  ]);
  const p = new Map((payees ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  const a = new Map((accts ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  for (const i of items) names.set(i.id, i.type === "transfer" ? `To ${a.get(i.counter_account_id ?? "") ?? "savings"}` : p.get(i.payee_id ?? "") ?? "Payment");
  return names;
}
