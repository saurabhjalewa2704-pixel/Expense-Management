"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { dismissSuggestion, saveRecurring } from "@/app/actions/recurring";
import { useToast } from "@/components/ui/toast";
import { addDays } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { firstOccurrence, ordinal } from "@/lib/recurrence";
import { qk } from "@/lib/queries/keys";
import { useBankHolidays, useRecurringSuggestions, useToday } from "@/lib/queries/hooks";
import type { RecurringSuggestion } from "@/lib/types";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const wording = (s: RecurringSuggestion) =>
  s.frequency === "weekly" ? `weekly, ${formatGBP(s.amount_pence)} on ${WEEKDAYS[s.weekday - 1]}s`
  : s.frequency === "quarterly" ? `every 3 months, ${formatGBP(s.amount_pence)} on the ${ordinal(s.day_of_month)}`
  : s.frequency === "yearly" ? `yearly, ${formatGBP(s.amount_pence)} on ${s.day_of_month}/${s.month_of_year}`
  : `monthly, ${formatGBP(s.amount_pence)} on the ${ordinal(s.day_of_month)}`;

/** REC-07: repeating payments the owner has not made into bills yet, one tap to add. */
export function Suggestions({ heading = "Looks like these repeat" }: { heading?: string }) {
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useRecurringSuggestions();
  const holidays = useBankHolidays().data;
  const [busy, setBusy] = useState<string | null>(null);
  const list = data ?? [];
  if (list.length === 0) return null;

  const add = async (s: RecurringSuggestion) => {
    setBusy(s.payee_id);
    const rule = {
      frequency: s.frequency, day_of_month: s.frequency === "weekly" ? null : s.day_of_month, last_day: false, weekday: s.frequency === "weekly" ? s.weekday : null,
      month_of_year: s.frequency === "yearly" ? s.month_of_year : null, working_day_rule: "on_day" as const, starts_on: addDays(today, 0), ends_on: null, max_occurrences: null,
    };
    const first = firstOccurrence(rule, today, holidays);
    const r = await saveRecurring(null, {
      type: "expense", amount_pence: s.amount_pence, account_id: s.account_id, category_id: s.category_id, payee: s.payee_name,
      frequency: s.frequency, day_of_month: rule.day_of_month, weekday: rule.weekday, month_of_year: rule.month_of_year, starts_on: first?.scheduled_on ?? today,
    });
    setBusy(null);
    if (!r.ok) return toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries({ queryKey: qk.recurring });
    toast({ message: `${s.payee_name} added to Bills` });
  };
  const dismiss = async (s: RecurringSuggestion) => {
    setBusy(s.payee_id);
    await dismissSuggestion(s.payee_id);
    setBusy(null);
    await qc.invalidateQueries({ queryKey: qk.recurringSuggestions });
  };

  return (
    <section data-testid="suggestions">
      <div className="section-h"><h2>{heading}</h2></div>
      <div className="list">
        {list.map((s) => (
          <div key={s.payee_id} className="row" style={{ alignItems: "flex-start", flexWrap: "wrap", rowGap: 10 }} data-testid="suggestion">
            <div className="row-main"><div className="row-t">{s.payee_name}</div><div className="row-s" style={{ whiteSpace: "normal" }}>Looks like {s.payee_name} is {wording(s)}. Add to Bills?</div></div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <button className="btn" style={{ height: 40, flex: 1, fontSize: 14 }} disabled={busy === s.payee_id} onClick={() => add(s)}>Add to Bills</button>
              <button className="btn secondary" style={{ height: 40, flex: 1, fontSize: 14 }} disabled={busy === s.payee_id} onClick={() => dismiss(s)}>Not now</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
