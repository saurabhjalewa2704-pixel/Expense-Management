"use client";
// Step 5 · Review (MC08).
import { useCloseSummary } from "@/lib/close/data";
import { monthFromParam } from "@/lib/close/logic";
import type { ISODate } from "@/lib/dates";
import { CloseGate, CloseShell, StepHead, useCloseFlow } from "./common";
import { ReviewBody, fromSummary } from "./review";

export function StepReview({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}
function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const s = useCloseSummary(month);
  return (
    <CloseShell month={month} index={5} back={() => f.go("tidy_up")} footer={<button className="btn" data-testid="close-continue" onClick={() => void f.finishStep("review")}>Continue to {f.next}</button>}>
      <StepHead step="Step 5 · Review" title={`${f.name} in review`} />
      {s.data ? <ReviewBody d={fromSummary(s.data)} /> : <div className="skeleton" style={{ height: 220, marginTop: 14 }} aria-busy />}
    </CloseShell>
  );
}
