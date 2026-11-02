"use client";
// EC-F30 (mock-up F6): when an expense looks like part of a planned extra, ask once. Nothing changes unless the owner answers.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { answerPlannedExtra } from "@/app/actions/forecast";
import { useToast } from "@/components/ui/toast";
import { matchesExtra, type ExtraLike } from "@/lib/forecast/match";
import { monthStart } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { supabaseBrowser } from "@/lib/supabase/client";

type Extra = ExtraLike;

export function PlannedMatch({ txn }: { txn: { id: string; amount_pence: number; occurred_on: string; category_id: string | null; payee_name?: string | null; note?: string | null } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["planned-match", txn.id, txn.occurred_on],
    queryFn: async () => {
      const db = supabaseBrowser();
      const [{ data: extras }, { data: answered }, { data: cats }] = await Promise.all([
        db.from("planned_extras").select("id,label,amount_pence,category_id").eq("month", monthStart(txn.occurred_on)),
        db.from("planned_extra_answers").select("transaction_id").eq("transaction_id", txn.id),
        db.from("categories").select("id,parent_id"),
      ]);
      if ((answered ?? []).length) return null;
      const c = ((cats ?? []) as { id: string; parent_id: string | null }[]).find((x) => x.id === txn.category_id);
      const l1 = c ? (c.parent_id ?? c.id) : null;
      return ((extras ?? []) as Extra[]).find((e) => matchesExtra(e, l1, `${txn.payee_name ?? ""} ${txn.note ?? ""}`)) ?? null;
    },
  });
  const e = q.data;
  if (!e) return null;
  const left = e.amount_pence - txn.amount_pence;
  const answer = async (a: "still_to_spend" | "all_of_it" | "no") => {
    const r = await answerPlannedExtra(txn.id, e.id, a);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
  };
  return (
    <div style={{ border: "1px solid var(--rule-strong)", borderRadius: 16, padding: 16, marginTop: 12 }} data-testid="planned-match">
      <div style={{ fontSize: 17, fontWeight: 600 }}>Was this part of “{e.label}”?</div>
      <div className="sub" style={{ marginTop: 4, lineHeight: 1.4 }}>You planned {formatGBP(e.amount_pence)} for {new Date(txn.occurred_on + "T12:00:00Z").toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}. It’s still counted in your forecast on top of what you spend.</div>
      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {left > 0 && <button data-testid="match-still" onClick={() => answer("still_to_spend")} style={{ height: 44, borderRadius: 12, background: "var(--ink)", color: "var(--on-ink)", fontWeight: 600 }}>Yes, {formatGBP(left)} still to spend</button>}
        <button data-testid="match-all" onClick={() => answer("all_of_it")} style={{ height: 44, borderRadius: 12, background: "var(--surface-2)" }}>Yes, that’s all of it</button>
        <button data-testid="match-no" onClick={() => answer("no")} className="sub" style={{ height: 40 }}>No, it’s something else</button>
      </div>
    </div>
  );
}
