"use client";
// Step 2 · Bills (MC04, §6): confirm estimates, answer payments that wait for the owner.
import { useState } from "react";
import { formatGBP, toPence } from "@/lib/money";
import { dayShortLabel, monthFromParam } from "@/lib/close/logic";
import type { BillItem } from "@/lib/close/types";
import type { ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { CloseGate, CloseShell, StepHead, Tick, useCloseFlow } from "./common";

const dayLabel = dayShortLabel;

export function StepBills({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}

function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const bills = f.checks.data!.bills;
  const open = bills.filter((b) => !b.answer).length;
  const answered = bills.length - open;
  const est = bills.filter((b) => b.status === "estimate" || b.answer === "confirmed").length;
  const title = bills.length === 0 ? "No bills to confirm" : open === 0 ? `${bills.length} ${bills.length === 1 ? "bill" : "bills"} confirmed` : `Confirm ${open} ${open === 1 ? "bill" : "bills"}`;
  const lead = bills.length === 0 ? "Every bill this month is confirmed." : est && bills.length > est ? "One was logged at an estimated amount, and one is waiting for you to say it was paid." : est ? "These were logged at an estimated amount. Enter what your statement says." : "These are waiting for you to say they were paid.";
  const varies = bills.find((b) => b.varies);
  return (
    <CloseShell month={month} index={2} back={() => f.go("overview")} hint={bills.length ? `${answered} of ${bills.length} confirmed` : undefined}
      footer={<button className="btn" data-testid="close-continue" onClick={() => void f.finishStep("bills")}>Continue</button>}>
      <StepHead step="Step 2 · Bills" title={title} lead={lead} />
      {bills.map((b) => <BillCard key={b.occurrence_id} bill={b} onResolve={f.actions.resolveBill} />)}
      {varies && <p className="mc-note">Confirming updates the transaction itself. Next month’s {varies.payee} estimate will use the amount you confirm.</p>}
    </CloseShell>
  );
}

function BillCard({ bill, onResolve }: { bill: BillItem; onResolve: (o: string, a: "confirm" | "log" | "skip", amount?: number) => Promise<{ ok: boolean; error?: string }> }) {
  const estimate = bill.status === "estimate";
  const [text, setText] = useState((bill.amount_pence / 100).toFixed(2));
  const [different, setDifferent] = useState(false);
  const [error, setError] = useState<string>();
  const pence = toPence(text);
  const valid = pence !== null && pence > 0;
  const done = bill.answer;
  const act = async (a: "confirm" | "log" | "skip", amount?: number) => { const r = await onResolve(bill.occurrence_id, a, amount); if (!r.ok) setError(r.error); };
  return (
    <div className="mc-item" data-testid="bill-item" data-status={bill.status} data-answer={done ?? ""}>
      <div className="hd">
        <div className="tile"><UI.Receipt size={20} aria-hidden /></div>
        <div className="ti"><b>{bill.payee} {bill.varies && <span className="mc-pill muted" style={{ display: "inline-flex", marginLeft: 4 }}>EST</span>}</b>
          <span>{estimate || done === "confirmed" ? `Logged ${bill.logged_on ? dayLabel(bill.logged_on) : dayLabel(bill.due_on)} · ${bill.account_name}${bill.varies ? " · amount varies" : ""}` : `Due ${dayLabel(bill.due_on)} · ${bill.account_name}${done ? "" : " · waiting for you to confirm"}`}</span></div>
        <div className={`am ${!done && estimate ? "dim" : ""}`} data-testid="bill-amount">{formatGBP(bill.amount_pence)}</div>
      </div>
      {!done && estimate && (
        <>
          <label className="mc-input focus"><span className="k">Amount on your statement</span>
            <span>£</span><input inputMode="decimal" aria-label="Amount on your statement" data-testid="bill-input" value={text} autoFocus onChange={(e) => setText(e.target.value)} /></label>
          <div className="mc-acts">
            <button className="mc-act on" data-testid="bill-confirm" disabled={!valid} onClick={() => void act("confirm", pence!)}><UI.Check size={16} aria-hidden />Confirm {valid ? formatGBP(pence!) : ""}</button>
            <button className="mc-act ghost" data-testid="bill-later">Confirm later</button>
          </div>
        </>
      )}
      {!done && !estimate && (
        <>
          {different && (
            <label className="mc-input focus"><span className="k">Amount</span><span>£</span><input inputMode="decimal" aria-label="Amount paid" data-testid="bill-input" value={text} autoFocus onChange={(e) => setText(e.target.value)} /></label>
          )}
          <div className="mc-acts">
            {!different ? (
              <>
                <button className="mc-act on" data-testid="bill-paid" onClick={() => void act("log")}><UI.Check size={16} aria-hidden />It was paid</button>
                <button className="mc-act" data-testid="bill-different" onClick={() => setDifferent(true)}>Different amount</button>
                <button className="mc-act ghost" data-testid="bill-skip" onClick={() => void act("skip")}>Didn’t happen</button>
              </>
            ) : (
              <>
                <button className="mc-act on" data-testid="bill-log" disabled={!valid} onClick={() => void act("log", pence!)}><UI.Check size={16} aria-hidden />Log {valid ? formatGBP(pence!) : ""}</button>
                <button className="mc-act ghost" onClick={() => setDifferent(false)}>Back</button>
              </>
            )}
          </div>
        </>
      )}
      {done === "confirmed" && <Tick>Confirmed at {formatGBP(bill.amount_pence)}</Tick>}
      {(done === "paid" || done === "paid_different") && <Tick>Logged as paid, {formatGBP(bill.amount_pence)}</Tick>}
      {done === "skipped" && <Tick>Marked as not paid this month</Tick>}
      {error && <p role="alert" className="mc-note" style={{ color: "var(--caution)" }}>{error}</p>}
    </div>
  );
}
