"use client";
// MC02: the overview of the six steps, with what is waiting in each.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { closeOnline, useCloseState } from "@/lib/close/data";
import { balancesShown, estimateMinutes, firstUnfinishedStep, monthFromParam, monthsToClose, stepStatus } from "@/lib/close/logic";
import { STEPS, type StepKey } from "@/lib/close/types";
import type { ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { CloseGate, CloseShell, useCloseFlow } from "./common";

export function CloseOverview({ param, resume }: { param: string; resume: boolean }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Overview month={month} resume={resume} />}</CloseGate>;
}

function Overview({ month, resume }: { month: ISODate; resume: boolean }) {
  const f = useCloseFlow(month);
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const state = useCloseState();
  const waiting = monthsToClose(state.data);
  const newerWaiting = waiting.some((m) => m.month > month);                 // §10.4: only an older month, while a newer one is also waiting
  const counts = f.counts!;
  const c = f.checks.data!;
  const minutes = estimateMinutes({ missing: counts.missing_days.open, bills: counts.bills.open, tidy: counts.tidy_up.open, accounts: balancesShown(c.balances, f.checkSavings).length });
  const first = firstUnfinishedStep(f.stepState, counts);
  const startable = f.row.isFetched;
  useEffect(() => { if (resume && startable && first) f.go(first); }, [resume, startable]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (k: StepKey) => {
    const st = stepStatus(k, f.stepState, counts);
    if (st.kind === "nothing") return { ct: "Nothing to check", ok: true };
    if (st.kind === "done") return { ct: null, ok: true, tick: true };
    const n = st.kind === "open" || st.kind === "skipped" ? st.open : 0;
    const word = k === "missing_days" ? "to check" : k === "bills" ? "to confirm" : k === "balances" ? (n === 1 ? "account" : "accounts") : k === "tidy_up" ? "to look at" : "";
    return { ct: k === "review" || k === "next_month" ? null : `${n} ${word}`, ok: false };
  };
  const quickClose = async () => {
    setBusy(true);
    const r = await closeOnline("close_month", { p_month: month, p_today: f.today, p_quick: true });
    setBusy(false);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
    f.router.push("/");
  };
  return (
    <CloseShell month={month} index={0 + 1} footer={
      <>
        <button className="btn" data-testid="close-start" onClick={() => f.go(first ?? "review")}>{first ? `Start with ${STEPS.find((s) => s.key === first)!.title.toLowerCase()}` : "Review and close"}</button>
        {newerWaiting && <div className="link-row"><button className="mc-act ghost" data-testid="close-quick" disabled={busy} onClick={quickClose}>Close without review</button></div>}
      </>
    }>
      <h1 className="mc-h1" style={{ marginTop: 14 }} data-testid="close-title">Let’s close {f.name}</h1>
      <p className="mc-lead">Six short steps. Anything you fix now makes your analytics, budgets and forecasts more accurate. You can stop at any point and pick up where you left off.</p>
      <div className="card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }} data-testid="close-overview">
        {STEPS.map((s, i) => {
          const st = stepStatus(s.key, f.stepState, counts);
          const l = label(s.key);
          return (
            <button key={s.key} className="mc-step" data-testid={`close-step-${s.slug}`} onClick={() => f.go(s.key)}>
              <span className={`n ${l.ok ? "ok" : s.key === first ? "now" : ""}`}>{l.ok && (st.kind === "done" || st.kind === "nothing") ? <UI.Check size={16} strokeWidth={2.5} aria-hidden /> : i + 1}</span>
              <span className="ti"><b>{s.title.replace("{next}", f.next)}</b><span>{s.blurb.replace("{month}", f.name).replace("{next}", f.next)}</span></span>
              {l.ct && <span className={`ct ${l.ok ? "ok" : ""}`}>{st.kind === "skipped" ? `${l.ct} · skipped` : l.ct}</span>}
              <UI.ChevronRight size={16} strokeWidth={2} className="chev" aria-hidden />
            </button>
          );
        })}
      </div>
      <p className="mc-note" data-testid="close-estimate">Steps with nothing to check are ticked for you. About {minutes} {minutes === 1 ? "minute" : "minutes"} in total.</p>
      {f.queued > 0 && <p className="mc-note">{f.queued} {f.queued === 1 ? "answer is" : "answers are"} waiting for a connection.</p>}
    </CloseShell>
  );
}
