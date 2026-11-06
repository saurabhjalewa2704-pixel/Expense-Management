"use client";
// Step 4 · Tidy up (MC07, §8): possible duplicates, large purchases not marked as one-offs, automatic one-offs.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteTransaction, restoreTransaction } from "@/app/actions/transactions";
import { useToast } from "@/components/ui/toast";
import { dayShortLabel, monthFromParam } from "@/lib/close/logic";
import type { DuplicateItem, TidyTxn } from "@/lib/close/types";
import type { ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { londonTime } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { CloseGate, CloseShell, StepHead, Tick, useCloseFlow } from "./common";

type Entry = { kind: "duplicate"; amount: number; d: DuplicateItem } | { kind: "large"; amount: number; t: TidyTxn } | { kind: "one_off"; amount: number; t: TidyTxn };
const dayLabel = dayShortLabel;

export function StepTidy({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}

function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const qc = useQueryClient();
  const toast = useToast();
  const c = f.checks.data!;
  const [showAll, setShowAll] = useState(false);
  // at most 10 in total, largest amounts first (§8); answered ones stay where they were
  const entries: Entry[] = [
    ...c.duplicates.map((d) => ({ kind: "duplicate" as const, amount: d.amount_pence * d.txns.length, d })),
    ...c.large.map((t) => ({ kind: "large" as const, amount: t.amount_pence, t })),
    ...c.one_offs.map((t) => ({ kind: "one_off" as const, amount: t.amount_pence, t })),
  ].sort((a, b) => b.amount - a.amount);
  // the ten largest, shown in the order of §8: duplicates, then large purchases, then automatic one-offs
  const KIND = { duplicate: 0, large: 1, one_off: 2 } as const;
  const shown = (showAll ? entries : entries.slice(0, 10)).sort((a, b) => KIND[a.kind] - KIND[b.kind] || b.amount - a.amount);
  const open = entries.filter((e) => !(e.kind === "duplicate" ? e.d.answer : e.t.answer)).length;
  const answered = entries.length - open;
  const title = entries.length === 0 ? "Nothing to tidy" : open === 0 ? `${entries.length} ${entries.length === 1 ? "thing" : "things"} reviewed` : `${open} ${open === 1 ? "thing" : "things"} to look at`;

  const removeDuplicate = async (d: DuplicateItem) => {
    const extra = d.txns.slice(1);                                       // keep the first, delete the rest
    for (const t of extra) { const r = await deleteTransaction(t.id); if (!r.ok) { toast({ message: r.error }); return; } }
    await f.actions.answerDuplicate(d.key, "deleted");
    await qc.invalidateQueries();
    toast({ message: extra.length > 1 ? "Duplicates deleted" : "Duplicate deleted", action: { label: "Undo", onClick: async () => { for (const t of extra) await restoreTransaction(t.id); await f.actions.answerDuplicate(d.key, "reset"); await qc.invalidateQueries(); } } });
  };

  return (
    <CloseShell month={month} index={4} back={() => f.go("overview")} hint={entries.length ? `${answered} of ${entries.length} answered` : undefined}
      footer={<button className="btn" data-testid="close-continue" onClick={() => void f.finishStep("tidy_up")}>Continue</button>}>
      <StepHead step="Step 4 · Tidy up" title={title} lead={entries.length ? "Nothing here is wrong for certain. A quick look stops a slip from skewing your numbers." : "No likely duplicates or unusual one-offs this month."} />
      {shown.map((e) => {
        if (e.kind === "duplicate") {
          const d = e.d;
          return (
            <div className="mc-item" key={d.key} data-testid="tidy-duplicate" data-answer={d.answer ?? ""}>
              <div className="eyebrow">Possible duplicate</div>
              {d.txns.map((t) => (
                <div className="hd" key={t.id} style={{ marginTop: 10 }}><div className="tile"><UI.Copy size={18} aria-hidden /></div>
                  <div className="ti"><b>{d.payee}</b><span>{dayLabel(t.occurred_on)}{t.occurred_at ? ` · ${londonTime(t.occurred_at)}` : ""} · {d.account_name}</span></div><div className="am">{formatGBP(d.amount_pence)}</div></div>
              ))}
              {!d.answer && (
                <div className="mc-acts">
                  <button className="mc-act" data-testid="dup-delete" onClick={() => void removeDuplicate(d)}>{d.txns.length > 2 ? "Keep one" : "Delete the second"}</button>
                  <button className="mc-act" data-testid="dup-both" onClick={() => void f.actions.answerDuplicate(d.key, "both_real")}>Both are real</button>
                </div>
              )}
              {d.answer === "both_real" && <><Tick>Both are real. They won’t be flagged again</Tick><div className="mc-acts" style={{ marginTop: 4 }}><button className="mc-act ghost" onClick={() => void f.actions.answerDuplicate(d.key, "reset")}>Undo</button></div></>}
            </div>
          );
        }
        const t = e.t;
        const large = e.kind === "large";
        return (
          <div className="mc-item" key={t.id} data-testid={large ? "tidy-large" : "tidy-one-off"} data-answer={t.answer ?? ""}>
            <div className="eyebrow">{large ? "Large purchase" : "Automatic one-off"}</div>
            <div className="hd" style={{ marginTop: 10 }}><div className="tile"><UI.Receipt size={18} aria-hidden /></div>
              <div className="ti"><b>{t.payee}</b><span>{dayLabel(t.occurred_on)} · {t.category} · {t.account_name}</span></div><div className="am">{formatGBP(t.amount_pence)}</div></div>
            <p className="sub" style={{ marginTop: 10, lineHeight: 1.4 }}>{large ? "Was this a one-off? " : "The app flagged this as a one-off. "}One-offs still count as spending but don’t raise your “usual”.</p>
            {!t.answer && (
              <div className="mc-acts">
                <button className="mc-act" data-testid="mark-one-off" onClick={() => void (large ? f.actions.answerLarge(t.id, "one_off") : f.actions.answerOneOff(t.id, "keep"))}>{large ? "Mark as one-off" : "Keep as one-off"}</button>
                <button className="mc-act" data-testid="normal-spending" onClick={() => void (large ? f.actions.answerLarge(t.id, "normal") : f.actions.answerOneOff(t.id, "normal"))}>It’s normal spending</button>
              </div>
            )}
            {t.answer && <><Tick>{t.answer === "one_off" || t.answer === "keep" ? "Kept as a one-off" : "Counted as normal spending"}</Tick><div className="mc-acts" style={{ marginTop: 4 }}><button className="mc-act ghost" onClick={() => void (large ? f.actions.answerLarge(t.id, "reset") : f.actions.answerOneOff(t.id, "reset"))}>Change</button></div></>}
          </div>
        );
      })}
      {entries.length > shown.length && <button className="btn secondary" style={{ marginTop: 12, height: 44 }} data-testid="tidy-show-more" onClick={() => setShowAll(true)}>Show {entries.length - shown.length} more</button>}
    </CloseShell>
  );
}
