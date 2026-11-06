"use client";
// Month close: the shared shell (MC §4), the flow hook every step uses, and small pieces. Mock-ups MC02 to MC10.
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { monthStart, type ISODate } from "@/lib/dates";
import { ck, useCloseActions, useCloseChecks, useCloseRow, useFlushCloseQueue, useQueuedAnswers } from "@/lib/close/data";
import { closeUrl, monthName, nextMonthOf, nextStepAfter, stepCounts, stepStatus, type StepCounts } from "@/lib/close/logic";
import { STEPS, isClosed, type CloseChecks, type StepKey } from "@/lib/close/types";
import { UI } from "@/lib/icons";
import { useOutbox, useProfile, useToday } from "@/lib/queries/hooks";

const slugOf = (k: StepKey) => STEPS.find((s) => s.key === k)!.slug;

/** Everything a step needs about the close of one month. */
export function useCloseFlow(month: ISODate) {
  const router = useRouter();
  const qc = useQueryClient();
  const today = useToday();
  const checks = useCloseChecks(month);
  const row = useCloseRow(month);
  const { data: profile } = useProfile();
  const actions = useCloseActions(month);
  const queued = useQueuedAnswers();
  const outbox = useOutbox();
  useFlushCloseQueue();
  // MC-08: an expense saved through Quick Add resolves the matching item; refetch when the outbox changes
  const pending = outbox.length;
  useEffect(() => { void qc.invalidateQueries({ queryKey: ["close", "checks"] }); }, [pending, qc]);

  const checkSavings = profile?.close_check_savings ?? false;
  const counts = useMemo<Record<StepKey, StepCounts> | null>(() => (checks.data ? stepCounts(checks.data, checkSavings) : null), [checks.data, checkSavings]);
  const stepState = row.data?.step_state;
  const ended = month < monthStart(today);
  const closed = isClosed(row.data?.status);
  const name = monthName(month);
  const next = monthName(nextMonthOf(month));

  const go = (key: StepKey | "overview" | "done") => router.push(key === "overview" ? closeUrl(month) : key === "done" ? closeUrl(month, "done") : closeUrl(month, slugOf(key)));

  /** MC-06: Continue is always enabled; unanswered items mark the step skipped, and it moves to the next step that has something. */
  const finishStep = async (key: StepKey) => {
    if (counts) {
      const st = counts[key];
      await actions.setStep(key, st.total === 0 ? "nothing" : st.open > 0 ? "skipped" : "done");
    }
    const after = counts ? nextStepAfter(key, { ...(stepState ?? {}), [key]: "done" }, counts) : null;
    if (after) go(after); else go("overview");
  };
  return { router, today, month, name, next, checks, row, counts, stepState, checkSavings, ended, closed, actions, queued, go, finishStep, profile };
}

/** The header, progress bar, body and footer (MC §4). `index` is 1 to 6. */
export function CloseShell({ month, index, children, footer, hint, back }: { month: ISODate; index: number; children: ReactNode; footer?: ReactNode; hint?: ReactNode; back?: () => void }) {
  const router = useRouter();
  const { counts, stepState } = useCloseFlow(month);
  const name = monthName(month);
  return (
    <div className="mc-shell" data-testid="close-shell" data-step={index}>
      <header className="mc-top">
        <div className="mc-bar">
          <button className="round" aria-label="Save and close" onClick={() => router.push("/")}><UI.X size={18} strokeWidth={2} aria-hidden /></button>
          <div className="t">Close {name}</div>
          <span className="r" data-testid="close-step-of">{index} of 6</span>
        </div>
        <div className="mc-prog" aria-label={`Step ${index} of 6`}>
          {STEPS.map((s, i) => {
            const done = counts ? ["done", "nothing"].includes(stepStatus(s.key, stepState, counts).kind) && i + 1 < index : false;
            return <i key={s.key} className={done ? "d" : i + 1 === index ? "c" : ""} />;
          })}
        </div>
      </header>
      <div className="mc-body">{children}</div>
      <footer className="mc-foot">
        {hint && <div className="hint" data-testid="close-hint">{hint}</div>}
        {footer}
        {back && <div className="link-row"><button className="mc-act ghost" onClick={back}>Back</button></div>}
      </footer>
    </div>
  );
}

/** Eyebrow, title and lead of a step. */
export function StepHead({ step, title, lead }: { step: string; title: string; lead?: ReactNode }) {
  return (
    <>
      <div className="eyebrow" style={{ marginTop: 14 }}>{step}</div>
      <h1 className="mc-h1" data-testid="close-title">{title}</h1>
      {lead && <p className="mc-lead">{lead}</p>}
    </>
  );
}

export const Tick = ({ children }: { children: ReactNode }) => <div className="mc-done"><UI.Check size={16} strokeWidth={2.25} aria-hidden />{children}</div>;

/** Waits for the month's data; says so plainly when the month has not ended (EC-MC1). */
export function CloseGate({ month, children }: { month: ISODate; children: (c: { checks: CloseChecks }) => ReactNode }) {
  const { checks, ended } = useCloseFlow(month);
  if (!ended) return <GateMessage title="Not yet" text={`${monthName(month)} can be closed once it has ended.`} />;
  if (checks.isError) return <GateMessage title="Couldn't load" text="Check your connection and try again." />;
  if (!checks.data) return <div className="mc-shell"><div className="mc-body"><div className="skeleton" style={{ height: 200, marginTop: 120 }} aria-busy /></div></div>;
  return <>{children({ checks: checks.data })}</>;
}
function GateMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="mc-shell"><div className="mc-body" style={{ paddingTop: 120 }}>
      <h1 className="mc-h1">{title}</h1><p className="mc-lead">{text}</p>
      <Link href="/" className="btn" style={{ marginTop: 24 }}>Back to Home</Link>
    </div></div>
  );
}
export { ck };
